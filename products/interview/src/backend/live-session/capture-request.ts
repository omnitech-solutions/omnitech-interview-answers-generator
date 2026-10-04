// Capture now: the owner's one-shot request that the native companion capture
// ONCE (the focused window, a masked region, or the display) and that Studio
// analyse what comes back. The request lives on the session row (one pending
// request per session; a newer one replaces it), and reaches the companion only
// as `control.capture` on an acknowledgement it already receives.
//   - the companion credential can never create an analyze on its own: a
//     snapshot is analysed only when it names the exact id of THIS session's
//     pending, unexpired request, and the analysis is created in the same
//     transaction that stores the snapshot (fulfilCaptureRequest);
//   - a snapshot with no matching pending request (none, other id, expired,
//     already captured) is stored exactly as before and never analysed;
//   - a device-only session refuses early with the same reason the dispatcher
//     would give (vision_device_only): nothing is requested, nothing captured;
//   - the request is session content and the purge clears it.
// Nothing here logs; regions, hints and ids never appear in an error.
import type {
  CaptureRequest,
  Observation,
} from "@omnitech/active-session-contracts";
import type { PlatformDatabase, TenantDatabase } from "@omnitech/database";
import {
  LIVE_CAPTURE_REQUEST_TTL_MS,
  type LiveCaptureRequest,
  type LiveCaptureState,
  liveCaptureRequestSchema,
} from "@omnitech/interview-contracts";
import { sql } from "drizzle-orm";
import { assertUuid, SessionError } from "./errors.js";
import {
  findStoredOwnerInput,
  insertOwnerInput,
  OWNER_INPUT_MAX_PER_SESSION,
  type OwnerInputBody,
  sameBody,
} from "./owner-input.js";
import { firstRow, inOwnerScope, type OwnerScope } from "./scope.js";
import { lockSession, type SessionRecord } from "./session-record.js";

export const CAPTURE_REFUSED_DEVICE_ONLY = "vision_device_only";

// The stored shape: the validated request plus its lifecycle.
export type StoredCaptureRequest = {
  request: LiveCaptureRequest;
  status: "pending" | "captured" | "refused";
  reason?: string;
  createdAt: string;
  expiresAt: string;
  snapshot?: { sourceId: string; eventId: string };
};

function decode(raw: unknown): StoredCaptureRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const stored = raw as StoredCaptureRequest;
  return typeof stored.request?.requestId === "string" &&
    typeof stored.expiresAt === "string"
    ? stored
    : null;
}

// What the owner sees: pending turns expired once its time has passed.
function stateOf(
  stored: StoredCaptureRequest,
  nowMs: number,
): LiveCaptureState {
  const expired =
    stored.status === "pending" && Date.parse(stored.expiresAt) <= nowMs;
  return {
    requestId: stored.request.requestId,
    status: expired ? "expired" : stored.status,
    expiresAt: stored.expiresAt,
    ...(stored.reason ? { reason: stored.reason } : {}),
  };
}

// The request the companion may be handed: pending, unexpired, and only while
// the session is capturing. Nothing but id, mode and region leaves Studio.
export function pendingCaptureOf(
  row: SessionRecord,
  status: SessionRecord["status"],
): CaptureRequest | undefined {
  if (status !== "active") return undefined;
  const stored = decode(row.captureRequest);
  if (
    !stored ||
    stored.status !== "pending" ||
    Date.parse(stored.expiresAt) <= row.nowMs
  )
    return undefined;
  return {
    requestId: stored.request.requestId,
    mode: stored.request.mode,
    ...(stored.request.region ? { region: stored.request.region } : {}),
  };
}

export async function submitCaptureRequest(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  raw: unknown,
): Promise<LiveCaptureState> {
  assertUuid(sessionId);
  const parsed = liveCaptureRequestSchema.safeParse(raw);
  if (!parsed.success) throw new SessionError("invalid_input");
  const request = parsed.data;
  return inOwnerScope(database, scope, async (tx) => {
    const row = await lockSession(tx, scope, sessionId);
    if (!row || row.purgedAt !== null) throw new SessionError("not_found");

    // [SAFETY] Dedup on the request id comes first: an identical resend
    // reports the request's current state; the same id with different content
    // is refused and the stored original stays.
    const existing = decode(row.captureRequest);
    if (existing && existing.request.requestId === request.requestId) {
      if (!sameBody(existing.request, request))
        throw new SessionError("invalid_input");
      return stateOf(existing, row.nowMs);
    }

    // [GUARD] Only a capturing session with live assistance and a screen
    // source chosen at start takes a request. Created, paused and ended
    // sessions refuse; so does one with no screen source.
    if (
      row.status !== "active" ||
      row.sources?.liveAssistance !== true ||
      !row.sources.captureSources.includes("screen")
    )
      throw new SessionError("status_refused");

    // The request id becomes the analyze observation's event id, so it can
    // never collide with an owner input the owner already made.
    if (await findStoredOwnerInput(tx, scope, sessionId, request.requestId))
      throw new SessionError("invalid_input");

    const createdAt = new Date(row.nowMs);
    const stored: StoredCaptureRequest = {
      request,
      // [SAFETY] A device-only session never sends an image to an agent, so
      // the request is refused here with the dispatcher's own reason and the
      // companion is never asked to capture.
      status: row.policy === "device-only" ? "refused" : "pending",
      ...(row.policy === "device-only"
        ? { reason: CAPTURE_REFUSED_DEVICE_ONLY }
        : {}),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        row.nowMs + LIVE_CAPTURE_REQUEST_TTL_MS,
      ).toISOString(),
    };
    // A newer request replaces the older one whatever its state.
    await tx.execute(sql`
      UPDATE interview.active_sessions
      SET capture_request = ${JSON.stringify(stored)}::jsonb
      WHERE tenant_id = ${scope.tenantId}::uuid
        AND owner_user_id = ${scope.actorId}::uuid
        AND id = ${sessionId}::uuid`);
    return stateOf(stored, row.nowMs);
  });
}

// The state of the session's current request. A replaced or unknown id is
// not found: only the latest request is kept.
export async function readCaptureRequest(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  requestId: string,
): Promise<LiveCaptureState> {
  assertUuid(sessionId);
  return inOwnerScope(database, scope, async (tx) => {
    const row = await firstRow<{
      capture_request: unknown;
      now_ms: number;
      purged_at: Date | null;
    }>(
      tx,
      sql`SELECT capture_request, purged_at,
                 (extract(epoch from now()) * 1000)::float8 AS now_ms
          FROM interview.active_sessions
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND id = ${sessionId}::uuid`,
    );
    const stored = row ? decode(row.capture_request) : null;
    if (
      !row ||
      row.purged_at !== null ||
      !stored ||
      stored.request.requestId !== requestId
    )
      throw new SessionError("not_found");
    return stateOf(stored, Number(row.now_ms));
  });
}

// Called by ingest, under the session lock, right after it stored a screen
// snapshot. Only an exact, pending, unexpired request of this session is
// fulfilled; everything else returns false and changes nothing, so the
// snapshot stays the plain snapshot it always was.
export async function fulfilCaptureRequest(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  row: SessionRecord,
  observation: Extract<Observation, { kind: "screen.snapshot" }>,
  snapshotSequence: number,
): Promise<boolean> {
  const requestId = observation.content.requestId;
  if (requestId === undefined) return false;
  const stored = decode(row.captureRequest);
  if (
    !stored ||
    stored.status !== "pending" ||
    stored.request.requestId !== requestId ||
    Date.parse(stored.expiresAt) <= row.nowMs
  )
    return false;
  // The owner-input cap and an owner input already under this id are not
  // errors here: the snapshot is stored and simply not analysed.
  if (await findStoredOwnerInput(tx, scope, sessionId, requestId)) return false;
  const inputs = await firstRow<{ n: number }>(
    tx,
    sql`SELECT count(*)::int AS n FROM interview.session_observations
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND owner_user_id = ${scope.actorId}::uuid
          AND session_id = ${sessionId}::uuid
          AND kind = 'owner.input'`,
  );
  if (Number(inputs?.n ?? 0) >= OWNER_INPUT_MAX_PER_SESSION) return false;

  const snapshot = {
    sourceId: observation.sourceId,
    eventId: observation.eventId,
  };
  const body: OwnerInputBody = {
    operation: "analyze",
    ...(stored.request.targetTaskId !== undefined &&
    stored.request.targetRevision !== undefined
      ? {
          target: {
            taskId: stored.request.targetTaskId,
            revision: stored.request.targetRevision,
          },
        }
      : {}),
    ...(stored.request.skill ? { skill: stored.request.skill } : {}),
    ...(stored.request.language ? { language: stored.request.language } : {}),
    snapshots: [snapshot],
  };
  // The input takes the sequence right after the snapshot, so a reader that
  // replays in order sees the image first.
  await insertOwnerInput(
    tx,
    scope,
    sessionId,
    row,
    requestId,
    snapshotSequence + 1,
    body,
  );
  await tx.execute(sql`
    UPDATE interview.active_sessions
    SET capture_request = ${JSON.stringify({ ...stored, status: "captured", snapshot })}::jsonb
    WHERE tenant_id = ${scope.tenantId}::uuid
      AND owner_user_id = ${scope.actorId}::uuid
      AND id = ${sessionId}::uuid`);
  return true;
}
