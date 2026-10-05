// Dispatch decisions (rule:idempotent-dispatch, rule:pause-end-suppression).
// Key = session + logical task + task revision + action kind. A failed dispatch
// records its outcome and may be retried; a succeeded or in-flight one may not.
// A refusal is a suppression record carrying ids only.
import type { TraceEvent } from "./ports.js";
import { acceptsDispatch, type SessionStatus } from "./status.js";
import { revisionStanding, type TaskState } from "./tasks.js";

export type DispatchStatus = "in-flight" | "succeeded" | "failed";

type DispatchEntry = {
  key: string;
  status: DispatchStatus;
  attempts: number;
};

export type DispatchLedger = {
  entries: Readonly<Record<string, DispatchEntry>>;
};

export const emptyDispatchLedger = (): DispatchLedger => ({ entries: {} });

export type DispatchRequest = {
  sessionId: string;
  taskId: string;
  revision: number;
  actionKind: string;
};

export const dispatchKey = (request: DispatchRequest): string =>
  JSON.stringify([
    request.sessionId,
    request.taskId,
    request.revision,
    request.actionKind,
  ]);

export type DispatchSuppressionReason =
  | "session_not_active"
  | "session_paused"
  | "session_ended"
  | "session_purging"
  | "revision_stale"
  | "source_superseded"
  | "task_unknown";

type SuppressionRecord = DispatchRequest & {
  reason: DispatchSuppressionReason;
};

export type DispatchDecision =
  | {
      decision: "dispatch";
      key: string;
      attempt: number;
      ledger: DispatchLedger;
      trace: TraceEvent;
    }
  | {
      decision: "duplicate";
      key: string;
      existing: DispatchStatus;
      ledger: DispatchLedger;
      trace: TraceEvent;
    }
  | {
      decision: "suppressed";
      suppression: SuppressionRecord;
      ledger: DispatchLedger;
      trace: TraceEvent;
    };

const STATUS_REASON: Record<SessionStatus, DispatchSuppressionReason | null> = {
  active: null,
  created: "session_not_active",
  paused: "session_paused",
  ended: "session_ended",
  purging: "session_purging",
};

export function decideDispatch(
  ledger: DispatchLedger,
  tasks: TaskState,
  sessionStatus: SessionStatus,
  request: DispatchRequest,
): DispatchDecision {
  const key = dispatchKey(request);
  const baseIds = {
    sessionId: request.sessionId,
    taskId: request.taskId,
    revision: request.revision,
    actionKind: request.actionKind,
  };
  const suppress = (reason: DispatchSuppressionReason): DispatchDecision => ({
    decision: "suppressed",
    suppression: { ...request, reason },
    ledger,
    trace: { event: "dispatch.suppressed", ids: { ...baseIds, reason } },
  });

  // [SAFETY] Session state first: paused, ended and purging sessions dispatch nothing.
  const statusReason = STATUS_REASON[sessionStatus];
  if (!acceptsDispatch(sessionStatus) && statusReason)
    return suppress(statusReason);

  // Only the current, still-sourced revision of a known task may dispatch.
  const standing = revisionStanding(tasks, request.taskId, request.revision);
  if (standing === "unknown") return suppress("task_unknown");
  if (standing === "outdated") return suppress("revision_stale");
  if (standing === "source_superseded") return suppress("source_superseded");

  // [STRATEGY] Deduplicate against succeeded and in-flight work only; a
  // failed dispatch may be retried.
  const existing = ledger.entries[key];
  if (existing && existing.status !== "failed")
    return {
      decision: "duplicate",
      key,
      existing: existing.status,
      ledger,
      trace: {
        event: "dispatch.duplicate",
        ids: { ...baseIds, existing: existing.status },
      },
    };
  const attempt = (existing?.attempts ?? 0) + 1;
  return {
    decision: "dispatch",
    key,
    attempt,
    ledger: {
      entries: {
        ...ledger.entries,
        [key]: { key, status: "in-flight", attempts: attempt },
      },
    },
    trace: { event: "dispatch.started", ids: { ...baseIds, attempt } },
  };
}

// Record how an in-flight dispatch ended. Anything else is left unchanged so a
// late or repeated report cannot rewrite a settled outcome.
export function recordDispatchOutcome(
  ledger: DispatchLedger,
  key: string,
  outcome: "succeeded" | "failed",
): DispatchLedger {
  const entry = ledger.entries[key];
  if (!entry || entry.status !== "in-flight") return ledger;
  return {
    entries: { ...ledger.entries, [key]: { ...entry, status: outcome } },
  };
}
