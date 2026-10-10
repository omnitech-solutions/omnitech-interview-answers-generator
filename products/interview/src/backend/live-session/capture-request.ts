// Capture now: the owner's one-shot request that the native companion capture
// ONCE (the focused window, a masked region, or the display) and that Studio
// analyse what comes back. The request lives on the session row (one pending
// request per session; a newer one replaces it), and reaches the companion only
// as `control.capture` on an acknowledgement it already receives.
//   - the companion credential can never create an analyze on its own: a
//     snapshot is analysed only when it names the exact id of THIS session's
//     pending, unexpired request, and the analysis is created in the same
//     transaction that stores the snapshot (fulfilCaptureRequest);
//   - a snapshot that NAMES a request (requestId) which is not this session's
//     pending, unexpired one (expired, replaced, failed, already captured,
//     unknown) is refused before anything is stored (checkSnapshotRequest);
//     a snapshot with no requestId is a plain snapshot, unchanged;
//   - the request reaches only a companion that declared support for it
//     (negotiation.ts); one that did not is refused with
//     companion_update_required, and the owner's request is bound to the
//     companion's screen selection so a mask is never reused across a change;
//   - the companion reports it could not capture (failCaptureRequest), and the
//     owner's state turns "failed" at once instead of waiting for expiry;
//   - a device-only session refuses early with the same reason the dispatcher
//     would give (vision_device_only): nothing is requested, nothing captured;
//   - the request is session content and the purge clears it.
// Nothing here logs; regions, hints and ids never appear in an error.
import type {
  CaptureFailureCode,
  CompanionDeclaration,
  Observation,
} from "@omnitech/active-session-contracts";
import type { PlatformDatabase, TenantDatabase } from "@omnitech/database";
import {
  LIVE_CAPTURE_REQUEST_TTL_MS,
  type LiveCaptureState,
  liveCaptureRequestSchema,
} from "@omnitech/interview-contracts";
import {
  captureStateOf,
  decodeCaptureRequest,
  failedByCompanion,
  failedBySelectionChange,
  isPendingRequest,
  type StoredCaptureRequest,
} from "./domain/capture-request";
import { assertUuid, SessionError } from "./errors";
import {
  findStoredOwnerInput,
  insertOwnerInput,
  OWNER_INPUT_MAX_PER_SESSION,
  type OwnerInputBody,
  sameBody,
} from "./owner-input";
import { readDeclaration } from "./repositories/capability.repository";
import {
  readStoredCaptureRequest,
  writeCaptureRequest,
} from "./repositories/capture.repository";
import { countOwnerInputs } from "./repositories/observation.repository";
import { lockSession } from "./repositories/session.repository";
import { inOwnerScope, type OwnerScope } from "./scope";
import type { SessionRecord } from "./session-record";

const CAPTURE_REFUSED_DEVICE_ONLY = "vision_device_only";
const CAPTURE_REFUSED_UPDATE_REQUIRED = "companion_update_required";
const CAPTURE_REFUSED_SOURCE_CHANGED = "source_changed";

// A region request whose bound selection is no longer the companion's declared
// one is failed at once (the mask is never applied to another source). Returns
// the row with the request as stored now.
export async function failIfSelectionChanged(
  tx: TenantDatabase,
  scope: OwnerScope,
  row: SessionRecord,
  declaration: CompanionDeclaration,
): Promise<SessionRecord> {
  const failed = failedBySelectionChange(row, declaration);
  if (!failed) return row;
  await writeCaptureRequest(tx, scope, row.id, failed);
  return { ...row, captureRequest: failed };
}

// The companion's own report that it could not capture for this request
// (failedByCompanion decides whether anything changes).
export async function failCaptureRequest(
  tx: TenantDatabase,
  scope: OwnerScope,
  row: SessionRecord,
  requestId: string,
  code: CaptureFailureCode,
): Promise<void> {
  const failed = failedByCompanion(row, requestId, code);
  if (failed) await writeCaptureRequest(tx, scope, row.id, failed);
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
    const existing = decodeCaptureRequest(row.captureRequest);
    if (existing && existing.request.requestId === request.requestId) {
      if (!sameBody(existing.request, request))
        throw new SessionError("invalid_input");
      return captureStateOf(existing, row.nowMs);
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

    // [SAFETY] What the companion declared decides whether, and against which
    // screen selection, the request can be made. A known companion that did not
    // declare support is an old build (update required). A region is bound to
    // the selection the owner drew it against; one that is not the companion's
    // current selection, or cannot be bound at all, is refused and never sent.
    const declared = await readDeclaration(tx, scope);
    const selection =
      request.mode === "region"
        ? (request.selection ?? declared?.screenSelection)
        : undefined;
    let refusal: string | undefined;
    if (row.policy === "device-only") refusal = CAPTURE_REFUSED_DEVICE_ONLY;
    else if (declared && !declared.captureRequests)
      refusal = CAPTURE_REFUSED_UPDATE_REQUIRED;
    else if (
      request.mode === "region" &&
      (!selection ||
        (declared?.screenSelection !== undefined &&
          declared.screenSelection !== selection))
    )
      refusal = CAPTURE_REFUSED_SOURCE_CHANGED;

    const createdAt = new Date(row.nowMs);
    const stored: StoredCaptureRequest = {
      request,
      ...(selection ? { selection } : {}),
      // A device-only session never sends an image to an agent, so the
      // request is refused here with the dispatcher's own reason and the
      // companion is never asked to capture.
      status: refusal ? "refused" : "pending",
      ...(refusal ? { reason: refusal } : {}),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        row.nowMs + LIVE_CAPTURE_REQUEST_TTL_MS,
      ).toISOString(),
    };
    // A newer request replaces the older one whatever its state.
    await writeCaptureRequest(tx, scope, sessionId, stored);
    return captureStateOf(stored, row.nowMs);
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
    const row = await readStoredCaptureRequest(tx, scope, sessionId);
    const stored = row ? decodeCaptureRequest(row.captureRequest) : null;
    if (
      !row ||
      row.purgedAt !== null ||
      !stored ||
      stored.request.requestId !== requestId
    )
      throw new SessionError("not_found");
    return captureStateOf(stored, row.nowMs);
  });
}

// Called by ingest BEFORE it stores a screen snapshot that names a request.
// Only an exact, pending, unexpired request of this session (with room for its
// analysis) lets the snapshot in; everything else is refused so the image is
// never retained under a standing it does not have. A snapshot with no
// requestId never comes here.
export type SnapshotRequestCheck = "ok" | "stale" | "limit";
export async function checkSnapshotRequest(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  row: SessionRecord,
  requestId: string,
): Promise<SnapshotRequestCheck> {
  if (
    !isPendingRequest(row, requestId) ||
    (await findStoredOwnerInput(tx, scope, sessionId, requestId))
  )
    return "stale";
  const inputs = await countOwnerInputs(tx, scope, sessionId);
  return inputs >= OWNER_INPUT_MAX_PER_SESSION ? "limit" : "ok";
}

// Called by ingest, under the session lock, right after it stored a screen
// snapshot that checkSnapshotRequest admitted: creates the analysis in the same
// transaction and marks the request captured.
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
  const stored = decodeCaptureRequest(row.captureRequest);
  if (stored?.status !== "pending" || stored.request.requestId !== requestId)
    return false;
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
  await writeCaptureRequest(tx, scope, sessionId, {
    ...stored,
    status: "captured",
    snapshot,
  });
  return true;
}
