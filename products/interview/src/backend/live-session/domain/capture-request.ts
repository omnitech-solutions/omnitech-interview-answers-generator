// The capture request as stored on its session row, and the decisions made
// from it. Pure: the stored value and the database clock come in, a decision
// goes out (capture-request.ts and the ingest handlers persist it).
import type {
  CaptureFailureCode,
  CaptureRequest,
  CompanionDeclaration,
} from "@omnitech/active-session-contracts";
import type {
  LiveCaptureRequest,
  LiveCaptureState,
} from "@omnitech/interview-contracts";
import type { SessionRecord } from "../session-record";

// The stored shape: the validated request plus its lifecycle.
export type StoredCaptureRequest = {
  request: LiveCaptureRequest;
  // The screen selection a region request is bound to: the owner's, else the
  // companion's declared one at submission. Absent for the other modes.
  selection?: string;
  status: "pending" | "captured" | "refused" | "failed";
  reason?: string;
  createdAt: string;
  expiresAt: string;
  snapshot?: { sourceId: string; eventId: string };
};

export function decodeCaptureRequest(
  raw: unknown,
): StoredCaptureRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const stored = raw as StoredCaptureRequest;
  return typeof stored.request?.requestId === "string" &&
    typeof stored.expiresAt === "string"
    ? stored
    : null;
}

// What the owner sees: pending turns expired once its time has passed.
export function captureStateOf(
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

// The request the companion may be handed: pending, unexpired, only while the
// session is capturing, and only to a companion that declared it can read it. A
// region goes only to a companion whose declared screen selection is still the
// one the region was bound to. Nothing but id, mode, region, selection and
// deadline leaves Studio.
export function pendingCaptureOf(
  row: SessionRecord,
  status: SessionRecord["status"],
  declaration: CompanionDeclaration,
): CaptureRequest | undefined {
  if (status !== "active" || !declaration.captureRequests) return undefined;
  const stored = decodeCaptureRequest(row.captureRequest);
  if (stored?.status !== "pending" || Date.parse(stored.expiresAt) <= row.nowMs)
    return undefined;
  if (stored.request.mode === "region") {
    const selection = stored.selection;
    if (!selection || selection !== declaration.screenSelection)
      return undefined;
  }
  return {
    requestId: stored.request.requestId,
    mode: stored.request.mode,
    ...(stored.request.region ? { region: stored.request.region } : {}),
    ...(stored.request.mode === "region" && stored.selection
      ? { selection: stored.selection }
      : {}),
    expiresAt: stored.expiresAt,
  };
}

// A region request whose bound selection is no longer the companion's declared
// one is failed at once (the mask is never applied to another source). The
// request as it must be stored now, or null when nothing changes.
export function failedBySelectionChange(
  row: SessionRecord,
  declaration: CompanionDeclaration,
): StoredCaptureRequest | null {
  const stored = decodeCaptureRequest(row.captureRequest);
  if (
    !declaration.captureRequests ||
    !declaration.screenSelection ||
    !stored ||
    stored.status !== "pending" ||
    stored.request.mode !== "region" ||
    stored.selection === declaration.screenSelection
  )
    return null;
  return { ...stored, status: "failed", reason: "source-changed" };
}

// The companion's own report that it could not capture for this request. Only
// the session's pending, unexpired request of that exact id changes; anything
// else is a harmless no-op, so a credential can neither fail a request it was
// not handed nor revive a finished one.
export function failedByCompanion(
  row: SessionRecord,
  requestId: string,
  code: CaptureFailureCode,
): StoredCaptureRequest | null {
  const stored = decodeCaptureRequest(row.captureRequest);
  if (
    stored?.status !== "pending" ||
    stored.request.requestId !== requestId ||
    Date.parse(stored.expiresAt) <= row.nowMs
  )
    return null;
  return { ...stored, status: "failed", reason: code };
}

// Whether the session's request is the pending, unexpired one of this id.
export function isPendingRequest(row: SessionRecord, requestId: string) {
  const stored = decodeCaptureRequest(row.captureRequest);
  return (
    stored?.status === "pending" &&
    stored.request.requestId === requestId &&
    !(Date.parse(stored.expiresAt) <= row.nowMs)
  );
}
