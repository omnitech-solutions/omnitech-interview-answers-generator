// Ingest: one credential-authenticated message (an observation, a heartbeat or
// another content-free report) from the capture companion. Identity comes only from the credential
// (rule:identity-from-credential): the credential's hash resolves the ONE
// session, and every later read or write runs in a tenant-and-actor transaction
// for that session's owner. A failed lookup is one refusal (rule:credential-
// strength); membership is re-verified before any domain write
// (rule:ingest-membership-recheck); bounds are enforced before anything is
// written (rule:bounded-ingest); a resend returns the ORIGINAL stored
// acknowledgement (rule:idempotent-observation). Nothing here logs, and no
// refusal carries content: codes, paths and control state only.
import { createHash, randomUUID } from "node:crypto";
import {
  ACTIVE_SESSION_LIMITS,
  type Acknowledgement,
  type ActiveSessionLimits,
  CAPABILITY_ACK_EVENT_ID,
  CAPTURE_FAILURE_ACK_EVENT_ID,
  type CapabilityReport,
  type CompanionDeclaration,
  type ControlStatus,
  capabilityReportSchema,
  captureFailureSchema,
  detectScreenshotMediaType,
  HEARTBEAT_ACK_EVENT_ID,
  heartbeatSchema,
  isWithinEnvelopeByteLimit,
  type Observation,
  type ObservationIssue,
  type RefusalCode,
  VOICE_ACTIVITY_ACK_EVENT_ID,
  type VoiceActivity,
  validateObservation,
  validateWireMessage,
  voiceActivitySchema,
  WIRE_VERSION,
} from "@omnitech/active-session-contracts";
import type { PlatformDatabase, TenantDatabase } from "@omnitech/database";
import { createLogger } from "@omnitech/logging";
import { PostgresAgentJobRepository } from "@omnitech/platform-storage";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import {
  OWNER_CAPTURE_SOURCE_ID,
  OWNER_INPUT_SOURCE_ID,
  OWNER_MICROPHONE_SOURCE_ID,
  SESSION_SCREENSHOT_ARTIFACT_TYPE,
} from "../db/live-session";
import { canonicalJson } from "./canonical-json";
import {
  checkSnapshotRequest,
  failCaptureRequest,
  failIfSelectionChanged,
  fulfilCaptureRequest,
  pendingCaptureOf,
} from "./capture-request";
import {
  noteDeclaration,
  reportedWithin,
  storeCapability,
} from "./companion-capability";
import {
  decideObservation,
  dedupKey,
  emptyLedger,
  ingestRefusal,
  type SessionStatus,
} from "./core/index";
import { withCredentialLookup } from "./credential-lookup";
import { isUuid } from "./errors";
import { firstRow, inOwnerScope, type OwnerScope } from "./scope";
import { presentedCredentialHash } from "./session-credential";
import { cancelSessionJobs, type SessionJobs } from "./session-jobs";
import { lockSession, type SessionRecord } from "./session-record";
import { reconcileLocked, transitionLocked } from "./status-transition";
import {
  type VoiceActivityGate,
  type VoiceActivityHeard,
  voiceActivityGate,
} from "./voice-activity";

// Companion lifecycle events: ids, codes and permission states, never content.
const log = createLogger({ service: "interview-web" });

export type IngestOptions = {
  // The screenshot's bytes, which travel apart from the envelope.
  payload?: Uint8Array;
  jobs?: SessionJobs;
  // What the companion declared on this request (negotiation.ts). Absent reads
  // as an older companion: it is never handed a capture request and a capture
  // request is never promised to it.
  declaration?: CompanionDeclaration;
  // Overrides for tests only; production uses the frozen contract constants.
  limits?: Partial<IngestLimits>;
  // Told how long a rate_limited refusal asks the companion to wait, so the
  // route can answer Retry-After (a spacing refusal is seconds, not a minute).
  onRetryAfter?: (seconds: number) => void;
  // Told each transcript line a session stored, after it is committed. The
  // line says whether its session may be processed off this device: a coach
  // on a remote model reads only those; the owner's own recording, which
  // stays on this machine, may keep any.
  onHeard?: (heard: HeardLine) => void;
  // Whether this Studio takes voice activity at all (the owner's switch).
  // Absent or false: a report is refused voice_activity_off and told to nobody.
  voiceActivity?: boolean;
  // Told that an audio source of a session started or stopped hearing a
  // voice. [SAFETY] Only ever for a session whose owner allows processing off
  // this device: a device-only session's activity is told to nobody.
  onActivity?: (activity: VoiceActivityHeard) => void;
  // The bound on how often a session's activity reports are taken. Tests pass
  // their own; production shares the process's.
  activityGate?: VoiceActivityGate;
};

export type HeardLine = {
  text: string;
  // The audio source the session registered ("microphone", "application-audio").
  source?: string;
  occurredAt: string;
  // The session it was heard in and its owner, from the row found.
  session: { tenantId: string; actorId: string; sessionId: string };
  // Whether the session's owner allows processing off this device.
  remote: boolean;
};

type IngestLimits = { -readonly [K in keyof ActiveSessionLimits]: number };

type Refused = Extract<Acknowledgement, { status: "refused" }>;

const refusal = (
  code: RefusalCode,
  extra: { control?: ControlStatus; issues?: ObservationIssue[] } = {},
): Refused => {
  log.debug("companion.refused", { code, control: extra.control?.state });
  return {
    version: WIRE_VERSION,
    status: "refused",
    code,
    ...(extra.control ? { control: extra.control } : {}),
    ...(extra.issues ? { issues: extra.issues.slice(0, 20) } : {}),
  };
};

// A session that has not started capturing reads as paused to the companion.
const controlState = (status: SessionStatus): ControlStatus["state"] =>
  status === "created" ? "paused" : status;

const controlOf = (
  row: SessionRecord,
  status: SessionStatus,
  declaration: CompanionDeclaration,
): ControlStatus => {
  const capture = pendingCaptureOf(row, status, declaration);
  return {
    state: controlState(status),
    credentialExpiresAt: (
      row.credentialExpiresAt ?? row.expiresAt
    ).toISOString(),
    ...(capture ? { capture } : {}),
  };
};

// Stored acknowledgements never carry a capture request: a resend returns the
// original unchanged, and a request is only ever live on a fresh answer.
const withoutCapture = ({
  capture: _capture,
  ...control
}: ControlStatus): ControlStatus => control;

function parseEnvelope(
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; ack: Refused } {
  let serialized: string;
  if (typeof raw === "string") serialized = raw;
  else {
    try {
      serialized = JSON.stringify(raw) ?? "";
    } catch {
      return { ok: false, ack: refusal("invalid_observation") };
    }
  }
  if (!isWithinEnvelopeByteLimit(serialized))
    return { ok: false, ack: refusal("envelope_too_large") };
  if (typeof raw !== "string") return { ok: true, value: raw };
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, ack: refusal("invalid_observation") };
  }
}

type Locked = {
  ack: Acknowledgement;
  cancelJobs: boolean;
  heard?: HeardLine;
  activity?: VoiceActivityHeard;
  retryAfterSeconds?: number;
};

export async function ingestObservation(
  database: PlatformDatabase,
  credentialPlaintext: string,
  tenantId: string,
  rawEnvelope: unknown,
  options: IngestOptions = {},
): Promise<Acknowledgement> {
  const limits = { ...ACTIVE_SESSION_LIMITS, ...options.limits };
  // [GUARD] Size and shape first: they disclose nothing about any session.
  const envelope = parseEnvelope(rawEnvelope);
  if (!envelope.ok) return envelope.ack;
  const credentialHash = await presentedCredentialHash(credentialPlaintext);
  if (credentialHash === null || !isUuid(tenantId))
    return refusal("credential_refused");

  // [SAFETY] The one lookup: a named select-only policy admits the single live
  // row whose credential hash is presented, in the tenant the route names.
  const found = await withCredentialLookup(
    database,
    { tenantId, credentialHash },
    async (client) =>
      (
        await client.query<{ id: string; owner_user_id: string }>(
          "SELECT id, owner_user_id FROM interview.active_sessions WHERE credential_hash = $1",
          [credentialHash],
        )
      ).rows[0],
  );
  if (!found) return refusal("credential_refused");

  // [STRATEGY] From here the owner is the actor, taken from the row found,
  // never from the message.
  const scope: OwnerScope = { tenantId, actorId: found.owner_user_id };
  const outcome = await inOwnerScope(database, scope, (tx) =>
    ingestLocked(
      tx,
      scope,
      found.id,
      credentialHash,
      envelope.value,
      options,
      limits,
    ),
  );
  if (outcome.retryAfterSeconds !== undefined)
    options.onRetryAfter?.(outcome.retryAfterSeconds);
  if (outcome.heard) {
    try {
      options.onHeard?.(outcome.heard);
    } catch {
      // The acknowledgement stands whatever a listener does.
    }
  }
  if (outcome.activity) {
    try {
      options.onActivity?.(outcome.activity);
    } catch {
      // The acknowledgement stands whatever a listener does.
    }
  }
  if (outcome.cancelJobs) {
    try {
      await cancelSessionJobs(
        database,
        options.jobs ?? new PostgresAgentJobRepository(database),
        scope,
        found.id,
      );
    } catch {
      // The ack stands; pause, end and the purge request cancellation again.
    }
  }
  return outcome.ack;
}

// Roles that hold interview.write, the permission starting a session needs.
const WRITE_ROLES: ReadonlySet<string> = new Set(["admin", "owner"]);

async function ingestLocked(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  credentialHash: string,
  envelope: unknown,
  options: IngestOptions,
  limits: IngestLimits,
): Promise<Locked> {
  const done = (ack: Acknowledgement, cancelJobs = false): Locked => ({
    ack,
    cancelJobs,
  });

  // [SAFETY] Membership and the permission that starting a session requires
  // (interview.write: the admin and owner roles, see rolePermissions in
  // platform-storage) are re-verified before any domain write
  // (rule:ingest-membership-recheck). A removed or demoted member's credential
  // is revoked and refused like any other bad credential.
  const member = await firstRow<{ role: string }>(
    tx,
    sql`SELECT role FROM platform.tenant_memberships
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND user_id = ${scope.actorId}::uuid`,
  );
  if (!member || !WRITE_ROLES.has(member.role)) {
    await tx.execute(sql`
      UPDATE interview.active_sessions
      SET credential_revoked_at = COALESCE(credential_revoked_at, now())
      WHERE tenant_id = ${scope.tenantId}::uuid
        AND owner_user_id = ${scope.actorId}::uuid AND id = ${sessionId}::uuid`);
    return done(refusal("credential_refused"));
  }

  // The lock serializes this message against control, other ingest, the
  // processor's writes and the purge.
  const locked = await lockSession(tx, scope, sessionId);
  if (!locked) return done(refusal("credential_refused"));
  let row: SessionRecord = locked;
  const credentialLive =
    row.credentialHash === credentialHash &&
    row.credentialRevokedAt === null &&
    row.credentialExpiresAt !== null &&
    row.credentialExpiresAt.getTime() > row.nowMs;
  const reconciled = await reconcileLocked(tx, row, { contact: true });
  const cancelJobs = reconciled.applied !== null;
  const status = reconciled.status;
  // An expired, revoked or replaced credential is the same single refusal.
  if (!credentialLive) return done(refusal("credential_refused"), cancelJobs);
  // [SAFETY] A declaration is recorded, and the request bound to a selection
  // that is no longer the companion's is failed, before anything is answered.
  const declaration = options.declaration ?? { captureRequests: false };
  if (options.declaration) {
    await noteDeclaration(tx, scope, options.declaration);
    row = await failIfSelectionChanged(tx, scope, row, options.declaration);
  }
  const control = controlOf(row, status, declaration);
  const closed = ingestRefusal(status);

  const kind =
    typeof envelope === "object" && envelope !== null
      ? (envelope as { kind?: unknown }).kind
      : undefined;
  if (kind === "heartbeat")
    return heartbeatLocked(
      tx,
      scope,
      row,
      status,
      control,
      closed,
      envelope,
      cancelJobs,
      limits,
    );
  if (kind === "capability.report")
    return capabilityLocked(
      tx,
      scope,
      row,
      control,
      closed,
      envelope,
      cancelJobs,
      limits,
      declaration,
    );
  if (kind === "capture.failure")
    return captureFailureLocked(
      tx,
      scope,
      row,
      status,
      control,
      closed,
      envelope,
      cancelJobs,
    );
  if (kind === "voice.activity")
    return voiceActivityLocked(
      scope,
      row,
      status,
      control,
      closed,
      envelope,
      cancelJobs,
      options,
      limits,
    );

  // [GUARD] A session that is not capturing accepts nothing, a resend or not.
  if (closed && status !== "active") {
    return done(refusal(closed, { control }), cancelJobs);
  }

  const validated = validateObservation(envelope);
  if (!validated.ok) {
    const code = validated.issues.some((i) => i.code === "unsupported_version")
      ? "unsupported_version"
      : "invalid_observation";
    return done(
      refusal(code, { control, issues: validated.issues }),
      cancelJobs,
    );
  }
  const observation = validated.value;
  // [SAFETY] The owner-input source namespace is reserved (ADR-0016): the
  // companion can never pre-claim the dedup key of an owner input.
  if (
    observation.sourceId === OWNER_INPUT_SOURCE_ID ||
    observation.sourceId === OWNER_CAPTURE_SOURCE_ID ||
    observation.sourceId === OWNER_MICROPHONE_SOURCE_ID
  )
    return done(
      refusal("invalid_observation", {
        control,
        issues: [{ path: ["sourceId"], code: "invalid_value" }],
      }),
      cancelJobs,
    );

  // [SAFETY] The companion cannot broaden the sources fixed at start
  // (rule:versioned-wire-contract, ADR-0011): a screenshot needs the screen source
  // and a transcript needs an audio source. Refused by path and code only.
  // A transcript that names its audio source must name one the session
  // registered at start: microphone text never passes as application audio, or
  // the reverse (the label is a source, never a verified identity).
  const permitted = row.sources?.captureSources ?? [];
  const needed =
    observation.kind === "screen.snapshot"
      ? ["screen"]
      : observation.kind === "transcript.final"
        ? observation.content.source
          ? [observation.content.source]
          : ["microphone", "application-audio"]
        : null;
  if (needed && !needed.some((source) => permitted.includes(source)))
    return done(
      refusal("invalid_observation", {
        control,
        issues: [
          {
            path:
              observation.kind === "transcript.final" &&
              observation.content.source
                ? ["content", "source"]
                : ["kind"],
            code: "invalid_value",
          },
        ],
      }),
      cancelJobs,
    );

  // Stored acknowledgement of a resend, and the session's running counts.
  const stored = await firstRow<{
    sequence: string | number;
    ack: unknown;
    kind: string;
    content: unknown;
    payload_sha256: string | null;
  }>(
    tx,
    sql`SELECT o.sequence, o.ack, o.kind, o.content,
               a.metadata->>'sha256' AS payload_sha256
        FROM interview.session_observations o
        LEFT JOIN platform.artifacts a
          ON a.tenant_id = o.tenant_id AND a.id = o.screenshot_artifact_id
        WHERE o.tenant_id = ${scope.tenantId}::uuid
          AND o.owner_user_id = ${scope.actorId}::uuid
          AND o.session_id = ${sessionId}::uuid
          AND o.source_id = ${observation.sourceId}
          AND o.event_id = ${observation.eventId}`,
  );
  // [SAFETY] The same source and event id with DIFFERENT content is a
  // conflict, never a duplicate and never an overwrite: the stored original
  // stays as it is (rule:idempotent-observation). Only an identical resend
  // reaches the dedup below.
  if (stored && !sameObservation(stored, observation, options.payload))
    return done(refusal("event_conflict", { control }), cancelJobs);
  const counts = (await firstRow<{
    total: number;
    screenshots: number;
    recent: number;
    max_sequence: string | number;
  }>(
    tx,
    // Owner inputs are the owner's own requests, stored DB-side: they count
    // toward neither the capture cap nor the capture rate (they still take a
    // sequence number, hence max_sequence covers every row).
    // The owner's own browser captures are exempt too.
    sql`SELECT (count(*) FILTER (WHERE kind <> 'owner.input' AND source_id NOT IN (${OWNER_CAPTURE_SOURCE_ID}, ${OWNER_MICROPHONE_SOURCE_ID})))::int AS total,
               (count(*) FILTER (WHERE kind = 'screen.snapshot' AND source_id <> ${OWNER_CAPTURE_SOURCE_ID}))::int AS screenshots,
               (count(*) FILTER (WHERE kind <> 'owner.input' AND source_id NOT IN (${OWNER_CAPTURE_SOURCE_ID}, ${OWNER_MICROPHONE_SOURCE_ID}) AND received_at > now() - interval '1 minute'))::int AS recent,
               COALESCE(max(sequence), 0) AS max_sequence
        FROM interview.session_observations
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND owner_user_id = ${scope.actorId}::uuid
          AND session_id = ${sessionId}::uuid`,
  )) ?? { total: 0, screenshots: 0, recent: 0, max_sequence: 0 };

  // [STRATEGY] The core decides dedup and the per-session sequence; the ledger
  // handed to it holds only this message's stored acknowledgement and the next
  // sequence, which is all the decision needs here.
  const ledger = {
    ...emptyLedger(),
    nextSeq: Number(counts.max_sequence) + 1,
    acks: stored
      ? {
          [dedupKey(observation.sourceId, observation.eventId)]: {
            seq: Number(stored.sequence),
            ack: stored.ack as never,
          },
        }
      : {},
  };
  const decision = decideObservation(ledger, {
    observation,
    sessionStatus: status,
    control: withoutCapture(control),
  });
  if (decision.decision === "refused")
    return done(refusal(decision.code, { control }), cancelJobs);
  if (decision.decision === "duplicate") return done(decision.ack, cancelJobs);

  // [SAFETY] Bounds, enforced before anything is written: one over-limit
  // message is refused with a content-free code and NOTHING is stored.
  if (counts.total >= limits.maxObservationsPerSession)
    return done(refusal("limit_reached", { control }), cancelJobs);
  if (counts.recent >= limits.maxIngestPerMinute)
    return done(refusal("rate_limited", { control }), cancelJobs);
  let screenshot: { bytes: Uint8Array; mediaType: string } | null = null;
  if (observation.kind === "screen.snapshot") {
    if (counts.screenshots >= limits.maxScreenshotsPerSession)
      return done(refusal("limit_reached", { control }), cancelJobs);
    const bytes = options.payload;
    if (!bytes)
      return done(
        refusal("invalid_observation", {
          control,
          issues: [{ path: ["payload"], code: "too_small" }],
        }),
        cancelJobs,
      );
    if (
      bytes.byteLength > limits.maxScreenshotBytes ||
      observation.content.byteLength > limits.maxScreenshotBytes
    )
      return done(refusal("payload_too_large", { control }), cancelJobs);
    // The payload is accepted by its leading bytes only: SVG, HTML and
    // everything else is refused and never decoded (rule:screenshots-as-
    // private-artifacts).
    const detected = detectScreenshotMediaType(bytes);
    if (detected === null || detected !== observation.content.mediaType)
      return done(
        refusal("invalid_observation", {
          control,
          issues: [{ path: ["payload"], code: "invalid_value" }],
        }),
        cancelJobs,
      );
    if (bytes.byteLength !== observation.content.byteLength)
      return done(
        refusal("invalid_observation", {
          control,
          issues: [{ path: ["content", "byteLength"], code: "invalid_value" }],
        }),
        cancelJobs,
      );
    // [SAFETY] A snapshot that names a capture request must match this
    // session's pending, unexpired one NOW, before anything is stored: an
    // expired, replaced, failed, finished or unknown id is refused, not kept as
    // an ordinary snapshot. No requestId: a plain snapshot, unchanged.
    if (observation.content.requestId !== undefined) {
      const standing = await checkSnapshotRequest(
        tx,
        scope,
        sessionId,
        row,
        observation.content.requestId,
      );
      if (standing === "stale")
        return done(refusal("capture_request_stale", { control }), cancelJobs);
      if (standing === "limit")
        return done(refusal("limit_reached", { control }), cancelJobs);
    }
    screenshot = { bytes, mediaType: detected };
  }

  // Store: the screenshot as an owner-private artifact bound to the session,
  // then the observation (final transcript text lives only here; interim text
  // never reaches ingest), and the contact stamp.
  const artifactId = screenshot
    ? await storeScreenshot(tx, scope, sessionId, screenshot)
    : null;
  await tx.execute(sql`
    INSERT INTO interview.session_observations
      (tenant_id, owner_user_id, session_id, source_id, event_id, sequence,
       kind, content, ack, screenshot_artifact_id)
    VALUES (${scope.tenantId}::uuid, ${scope.actorId}::uuid, ${sessionId}::uuid,
      ${observation.sourceId}, ${observation.eventId}, ${decision.seq},
      ${observation.kind},
      ${JSON.stringify({
        occurredAt: observation.occurredAt,
        sourceSequence: observation.sequence,
        body: observation.content,
      })}::jsonb,
      ${JSON.stringify(decision.ack)}::jsonb, ${artifactId}::uuid)`);
  await touch(tx, scope, sessionId);
  // One line per stored observation, so the server log shows what arrived:
  // the kind, the source and a size, never the words (rule:id-only-traces).
  log.info("observation.stored", {
    sessionId,
    kind: observation.kind,
    sourceId: observation.sourceId,
    sequence: decision.seq,
    ...(observation.kind === "transcript.final"
      ? {
          chars: observation.content.text.length,
          speaker: observation.content.source ?? observation.content.speaker,
          // Written only where content logging is on (a local `pnpm dev`).
          content: observation.content.text,
        }
      : {}),
  });

  // [SAFETY] A capture request is fulfilled only by a snapshot naming the exact
  // id of this session's pending, unexpired request, in this same transaction
  // (the capture credential can never analyse on its own). Anything else leaves
  // the snapshot a plain snapshot. A request just fulfilled is no longer live,
  // so the fresh answer omits it; an unfulfilled one stays on the answer.
  const fulfilled =
    observation.kind === "screen.snapshot" &&
    (await fulfilCaptureRequest(
      tx,
      scope,
      sessionId,
      row,
      observation,
      decision.seq,
    ));
  const answer =
    decision.ack.status === "accepted"
      ? {
          ...decision.ack,
          control: fulfilled ? withoutCapture(control) : control,
        }
      : decision.ack;
  // [SAFETY] Only a line this request newly stored is told to a listener,
  // with whether its owner allowed processing off the device.
  const heard: HeardLine | undefined =
    observation.kind === "transcript.final" &&
    decision.ack.status === "accepted"
      ? {
          remote: row.policy === "permitted-remote",
          text: observation.content.text,
          ...(observation.content.source
            ? { source: observation.content.source }
            : {}),
          occurredAt: observation.occurredAt,
          session: { ...scope, sessionId },
        }
      : undefined;
  return { ...done(answer, cancelJobs), ...(heard ? { heard } : {}) };
}

const touch = (tx: TenantDatabase, scope: OwnerScope, sessionId: string) =>
  tx.execute(sql`
    UPDATE interview.active_sessions SET last_heartbeat_at = now()
    WHERE tenant_id = ${scope.tenantId}::uuid
      AND owner_user_id = ${scope.actorId}::uuid AND id = ${sessionId}::uuid`);

// Whether a stored observation is the same message as the one resent. A
// transcript, disconnect or gap is the same when kind, source sequence and body
// match; occurredAt is a clock stamp a companion may re-take on a resend, so it
// is not compared. A screenshot is compared by body only (its sequence is the
// capture loop's bookkeeping, not what was seen) plus the payload bytes when
// both sides have them.
function sameObservation(
  stored: { kind: string; content: unknown; payload_sha256: string | null },
  observation: Observation,
  payload: Uint8Array | undefined,
): boolean {
  if (stored.kind !== observation.kind) return false;
  const content = stored.content as {
    sourceSequence?: unknown;
    body?: unknown;
  };
  if (canonicalJson(content.body) !== canonicalJson(observation.content))
    return false;
  if (
    observation.kind !== "screen.snapshot" &&
    content.sourceSequence !== observation.sequence
  )
    return false;
  if (!payload || stored.payload_sha256 === null) return true;
  return (
    createHash("sha256").update(payload).digest("hex") === stored.payload_sha256
  );
}

const rateLimited = (
  control: ControlStatus,
  cancelJobs: boolean,
  limits: IngestLimits,
): Locked => ({
  ack: refusal("rate_limited", { control }),
  cancelJobs,
  retryAfterSeconds: Math.max(
    1,
    Math.ceil(limits.minHeartbeatIntervalMs / 1000),
  ),
});

// A content-free heartbeat updates the contact stamp so resume is observable. A
// companion that reports it stopped capturing pauses the session (never ends
// it); every answer carries the control state. Heartbeats are spaced by
// minHeartbeatIntervalMs against the last contact: a closer one is refused
// rate_limited and stores nothing. A stop report (capturing: false) is never
// delayed by the spacing (rule:pause-only-credential-stop).
async function heartbeatLocked(
  tx: TenantDatabase,
  scope: OwnerScope,
  row: SessionRecord,
  status: SessionStatus,
  control: ControlStatus,
  closed: RefusalCode | null,
  envelope: unknown,
  cancelJobs: boolean,
  limits: IngestLimits,
): Promise<Locked> {
  const parsed = heartbeatSchema.safeParse(envelope);
  if (!parsed.success)
    return {
      ack: refusal("invalid_observation", {
        control,
        issues: [{ path: ["heartbeat"], code: "invalid" }],
      }),
      cancelJobs,
    };
  if (status === "ended" || status === "purging")
    return { ack: refusal(closed ?? "session_ended", { control }), cancelJobs };
  // Standing keeps precedence over the spacing: only an active session's
  // capturing heartbeat is spaced; a paused one still answers session_paused.
  if (
    status === "active" &&
    parsed.data.capturing &&
    row.lastHeartbeatAt !== null &&
    row.nowMs - row.lastHeartbeatAt.getTime() < limits.minHeartbeatIntervalMs
  )
    return rateLimited(control, cancelJobs, limits);
  await touch(tx, scope, row.id);
  if (status === "active" && !parsed.data.capturing) {
    // The one line that says WHY a session paused by itself: the companion's
    // own state rides the heartbeat as codes (rule:id-only-traces).
    log.info("companion.heartbeat_stop", {
      sessionId: row.id,
      sourceId: parsed.data.sourceId,
      state: parsed.data.diagnostics?.state ?? "unknown",
      sources: parsed.data.diagnostics?.sources ?? {},
      speechFailure: parsed.data.diagnostics?.speechFailure ?? null,
    });
    await transitionLocked(tx, { ...row, status }, "pause", "companion-stop");
    return {
      ack: refusal("session_paused", {
        control: { ...control, state: "paused" },
      }),
      cancelJobs: true,
    };
  }
  if (status !== "active")
    return { ack: refusal("session_paused", { control }), cancelJobs };
  return {
    ack: {
      version: WIRE_VERSION,
      status: "accepted",
      sourceId: parsed.data.sourceId,
      eventId: HEARTBEAT_ACK_EVENT_ID,
      control,
    },
    cancelJobs,
  };
}

// A capability report is the companion's own local readiness (speech support
// and permission states, never content). It is accepted before capture starts
// (a created or paused session) and while active, replaces the owner's latest
// report, and is spaced like a heartbeat.
async function capabilityLocked(
  tx: TenantDatabase,
  scope: OwnerScope,
  row: SessionRecord,
  control: ControlStatus,
  closed: RefusalCode | null,
  envelope: unknown,
  cancelJobs: boolean,
  limits: IngestLimits,
  declaration: CompanionDeclaration,
): Promise<Locked> {
  log.debug("companion.capability", { sessionId: row.id, report: envelope });
  const validated = validateWireMessage<CapabilityReport>(
    capabilityReportSchema,
    envelope,
  );
  if (!validated.ok)
    return {
      ack: refusal(
        validated.issues.some((i) => i.code === "unsupported_version")
          ? "unsupported_version"
          : "invalid_observation",
        { control, issues: validated.issues },
      ),
      cancelJobs,
    };
  if (closed && control.state !== "paused" && control.state !== "active")
    return { ack: refusal(closed, { control }), cancelJobs };
  if (await reportedWithin(tx, scope, limits.minHeartbeatIntervalMs))
    return rateLimited(control, cancelJobs, limits);
  await storeCapability(tx, scope, validated.value, declaration);
  await touch(tx, scope, row.id);
  return {
    ack: {
      version: WIRE_VERSION,
      status: "accepted",
      sourceId: validated.value.sourceId,
      eventId: CAPABILITY_ACK_EVENT_ID,
      control,
    },
    cancelJobs,
  };
}

// The companion's report that it could not capture for one request: closed
// code, correlated by id, content-free. It is accepted in any capturing state
// (a paused or ended session answers with its standing) and changes only the
// matching pending request. Not spaced: only the first report for a request
// writes, and a repeat or a stranger's id changes nothing.
async function captureFailureLocked(
  tx: TenantDatabase,
  scope: OwnerScope,
  row: SessionRecord,
  status: SessionStatus,
  control: ControlStatus,
  closed: RefusalCode | null,
  envelope: unknown,
  cancelJobs: boolean,
): Promise<Locked> {
  const parsed = captureFailureSchema.safeParse(envelope);
  if (!parsed.success)
    return {
      ack: refusal("invalid_observation", {
        control,
        issues: [{ path: ["capture.failure"], code: "invalid" }],
      }),
      cancelJobs,
    };
  if (closed && status !== "active")
    return { ack: refusal(closed, { control }), cancelJobs };
  await failCaptureRequest(
    tx,
    scope,
    row,
    parsed.data.requestId,
    parsed.data.code,
  );
  await touch(tx, scope, row.id);
  return {
    ack: {
      version: WIRE_VERSION,
      status: "accepted",
      sourceId: parsed.data.sourceId,
      eventId: CAPTURE_FAILURE_ACK_EVENT_ID,
      control,
    },
    cancelJobs,
  };
}

// Whether a voice is being heard on one of the session's audio sources right
// now. [SAFETY] A transient signal, never content: nothing of the report is
// written (no observation, no artifact, not even the contact stamp, so a
// heartbeat's spacing is untouched) and nothing of it is logged. It is taken only while the
// session is capturing, only for an audio source the session registered at
// start, only when the owner's switch is on, and only for a session whose
// owner allows processing off this device (the listener is the coach, on a
// remote model). Everything else is a content-free refusal; voice_activity_off
// tells the companion to stop sending for the rest of its run.
function voiceActivityLocked(
  scope: OwnerScope,
  row: SessionRecord,
  status: SessionStatus,
  control: ControlStatus,
  closed: RefusalCode | null,
  envelope: unknown,
  cancelJobs: boolean,
  options: IngestOptions,
  limits: IngestLimits,
): Locked {
  // A pending capture request rides only on the answers the companion reads
  // for one (a heartbeat, an observation), never on this.
  const standing = withoutCapture(control);
  const validated = validateWireMessage<VoiceActivity>(
    voiceActivitySchema,
    envelope,
  );
  if (!validated.ok)
    return {
      ack: refusal(
        validated.issues.some((i) => i.code === "unsupported_version")
          ? "unsupported_version"
          : "invalid_observation",
        { control: standing, issues: validated.issues },
      ),
      cancelJobs,
    };
  if (status !== "active")
    return {
      ack: refusal(closed ?? "session_paused", { control: standing }),
      cancelJobs,
    };
  if (options.voiceActivity !== true || row.policy !== "permitted-remote")
    return {
      ack: refusal("voice_activity_off", { control: standing }),
      cancelJobs,
    };
  // [SAFETY] The companion cannot broaden the sources fixed at start: a
  // source the session never registered says nothing here.
  if (!(row.sources?.captureSources ?? []).includes(validated.value.source))
    return {
      ack: refusal("invalid_observation", {
        control: standing,
        issues: [{ path: ["source"], code: "invalid_value" }],
      }),
      cancelJobs,
    };
  const gate = options.activityGate ?? voiceActivityGate;
  if (!gate.allow(row.id, row.nowMs, limits.maxVoiceActivityPerMinute))
    return {
      ack: refusal("rate_limited", { control: standing }),
      cancelJobs,
      retryAfterSeconds: 1,
    };
  return {
    ack: {
      version: WIRE_VERSION,
      status: "accepted",
      sourceId: validated.value.sourceId,
      eventId: VOICE_ACTIVITY_ACK_EVENT_ID,
      control: standing,
    },
    cancelJobs,
    activity: {
      source: validated.value.source,
      speaking: validated.value.speaking,
      session: { ...scope, sessionId: row.id },
    },
  };
}

// An owner-private platform artifact of the session type, bound to its session
// by metadata.session_id. Identical bytes within a session share one artifact
// (a digest dedupes stored bytes only; observations stay keyed by source and
// event id).
export async function storeScreenshot(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  screenshot: { bytes: Uint8Array; mediaType: string },
): Promise<string> {
  const digest = createHash("sha256").update(screenshot.bytes).digest("hex");
  const existing = await firstRow<{ id: string }>(
    tx,
    sql`SELECT id FROM platform.artifacts
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND owner_user_id = ${scope.actorId}::uuid
          AND product_id = ${INTERVIEW_PRODUCT_ID}
          AND artifact_type = ${SESSION_SCREENSHOT_ARTIFACT_TYPE}
          AND metadata->>'session_id' = ${sessionId}
          AND metadata->>'sha256' = ${digest}`,
  );
  if (existing) return existing.id;
  const artifactId = randomUUID();
  const metadata = JSON.stringify({
    session_id: sessionId,
    media_type: screenshot.mediaType,
    sha256: digest,
  });
  await tx.execute(sql`
    INSERT INTO platform.artifacts
      (id, tenant_id, owner_user_id, product_id, artifact_type, title,
       metadata, payload_reference)
    VALUES (${artifactId}::uuid, ${scope.tenantId}::uuid, ${scope.actorId}::uuid,
      ${INTERVIEW_PRODUCT_ID}, ${SESSION_SCREENSHOT_ARTIFACT_TYPE},
      'Session screenshot', ${metadata}::jsonb,
      ${`platform.artifact_payloads/${artifactId}`})`);
  await tx.execute(sql`
    INSERT INTO platform.artifact_payloads
      (tenant_id, artifact_id, bytes, byte_length)
    VALUES (${scope.tenantId}::uuid, ${artifactId}::uuid,
      ${Buffer.from(screenshot.bytes)}, ${screenshot.bytes.byteLength})`);
  return artifactId;
}
