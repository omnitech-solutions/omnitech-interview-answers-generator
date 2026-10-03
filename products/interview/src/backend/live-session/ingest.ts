// Ingest: one credential-authenticated message (an observation or a heartbeat)
// from the capture companion. Identity comes only from the credential
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
  type ControlStatus,
  detectScreenshotMediaType,
  heartbeatSchema,
  isWithinEnvelopeByteLimit,
  type ObservationIssue,
  type RefusalCode,
  validateObservation,
  WIRE_VERSION,
} from "@omnitech/active-session-contracts";
import type { PlatformDatabase, TenantDatabase } from "@omnitech/database";
import { PostgresAgentJobRepository } from "@omnitech/platform-storage";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile.js";
import { SESSION_SCREENSHOT_ARTIFACT_TYPE } from "../db/live-session.js";
import {
  decideObservation,
  dedupKey,
  emptyLedger,
  ingestRefusal,
  type SessionStatus,
} from "./core/index.js";
import { withCredentialLookup } from "./credential-lookup.js";
import { isUuid } from "./errors.js";
import { firstRow, inOwnerScope, type OwnerScope } from "./scope.js";
import { presentedCredentialHash } from "./session-credential.js";
import { cancelSessionJobs, type SessionJobs } from "./session-jobs.js";
import { lockSession, type SessionRecord } from "./session-record.js";
import { reconcileLocked, transitionLocked } from "./status-transition.js";

export type IngestOptions = {
  // The screenshot's bytes, which travel apart from the envelope.
  payload?: Uint8Array;
  jobs?: SessionJobs;
  // Overrides for tests only; production uses the frozen contract constants.
  limits?: Partial<IngestLimits>;
};

type IngestLimits = { -readonly [K in keyof ActiveSessionLimits]: number };

type Refused = Extract<Acknowledgement, { status: "refused" }>;

const refusal = (
  code: RefusalCode,
  extra: { control?: ControlStatus; issues?: ObservationIssue[] } = {},
): Refused => ({
  version: WIRE_VERSION,
  status: "refused",
  code,
  ...(extra.control ? { control: extra.control } : {}),
  ...(extra.issues ? { issues: extra.issues.slice(0, 20) } : {}),
});

// A session that has not started capturing reads as paused to the companion.
const controlState = (status: SessionStatus): ControlStatus["state"] =>
  status === "created" ? "paused" : status;

const controlOf = (
  row: SessionRecord,
  status: SessionStatus,
): ControlStatus => ({
  state: controlState(status),
  credentialExpiresAt: (row.credentialExpiresAt ?? row.expiresAt).toISOString(),
});

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

type Locked = { ack: Acknowledgement; cancelJobs: boolean };

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

  // [SAFETY] Membership is re-verified before any domain write
  // (rule:ingest-membership-recheck). A removed member's credential is revoked.
  const member = await firstRow(
    tx,
    sql`SELECT 1 AS ok FROM platform.tenant_memberships
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND user_id = ${scope.actorId}::uuid`,
  );
  if (!member) {
    await tx.execute(sql`
      UPDATE interview.active_sessions
      SET credential_revoked_at = COALESCE(credential_revoked_at, now())
      WHERE tenant_id = ${scope.tenantId}::uuid
        AND owner_user_id = ${scope.actorId}::uuid AND id = ${sessionId}::uuid`);
    return done(refusal("credential_refused"));
  }

  // The lock serializes this message against control, other ingest, the
  // processor's writes and the purge.
  const row = await lockSession(tx, scope, sessionId);
  if (!row) return done(refusal("credential_refused"));
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
  const control = controlOf(row, status);
  const closed = ingestRefusal(status);

  const heartbeat =
    typeof envelope === "object" &&
    envelope !== null &&
    (envelope as { kind?: unknown }).kind === "heartbeat";
  if (heartbeat)
    return heartbeatLocked(
      tx,
      scope,
      row,
      status,
      control,
      closed,
      envelope,
      cancelJobs,
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

  // Stored acknowledgement of a resend, and the session's running counts.
  const stored = await firstRow<{ sequence: string | number; ack: unknown }>(
    tx,
    sql`SELECT sequence, ack FROM interview.session_observations
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND owner_user_id = ${scope.actorId}::uuid
          AND session_id = ${sessionId}::uuid
          AND source_id = ${observation.sourceId}
          AND event_id = ${observation.eventId}`,
  );
  const counts = (await firstRow<{
    total: number;
    screenshots: number;
    recent: number;
    max_sequence: string | number;
  }>(
    tx,
    sql`SELECT count(*)::int AS total,
               (count(*) FILTER (WHERE kind = 'screen.snapshot'))::int AS screenshots,
               (count(*) FILTER (WHERE received_at > now() - interval '1 minute'))::int AS recent,
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
    control,
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
  return done(decision.ack, cancelJobs);
}

const touch = (tx: TenantDatabase, scope: OwnerScope, sessionId: string) =>
  tx.execute(sql`
    UPDATE interview.active_sessions SET last_heartbeat_at = now()
    WHERE tenant_id = ${scope.tenantId}::uuid
      AND owner_user_id = ${scope.actorId}::uuid AND id = ${sessionId}::uuid`);

// A content-free heartbeat updates the contact stamp so resume is observable. A
// companion that reports it stopped capturing pauses the session (never ends
// it); every answer carries the control state.
async function heartbeatLocked(
  tx: TenantDatabase,
  scope: OwnerScope,
  row: SessionRecord,
  status: SessionStatus,
  control: ControlStatus,
  closed: RefusalCode | null,
  envelope: unknown,
  cancelJobs: boolean,
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
  await touch(tx, scope, row.id);
  if (status === "active" && !parsed.data.capturing) {
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
      eventId: "heartbeat",
      control,
    },
    cancelJobs,
  };
}

// An owner-private platform artifact of the session type, bound to its session
// by metadata.session_id. Identical bytes within a session share one artifact
// (a digest dedupes stored bytes only; observations stay keyed by source and
// event id).
async function storeScreenshot(
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
