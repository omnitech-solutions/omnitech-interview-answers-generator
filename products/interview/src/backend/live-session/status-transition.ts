// Status changes of a locked session row, decided by the neutral core
// (rule:owner-starts-and-resumes, rule:pause-only-credential-stop,
// rule:owner-or-cap-ends). Only the owner starts or resumes; expiry and a
// companion stop PAUSE; the owner or duration cap end. The caller holds the
// row lock (lockSession) and commits;
// jobs are cancelled only after the status flip commits (rule:pause-end-
// suppression: status first, then cancellation).
import type { TenantDatabase } from "@omnitech/database";
import {
  type SessionStatus,
  type StatusActor,
  type StatusCommand,
  transitionStatus,
} from "./core/index";
import {
  decideReconcile,
  type ReconcileOptions,
} from "./domain/session-transition";
import { SessionError } from "./errors";
import {
  suppressInFlightActions,
  writeStatus,
} from "./repositories/session.repository";
import type { SessionRecord } from "./session-record";

export type Transition = {
  changed: boolean;
  from: SessionStatus;
  to: SessionStatus;
};

// Commands after which the session's in-flight jobs must be cancelled.
export const CANCELS_JOBS: readonly StatusCommand[] = [
  "pause",
  "end",
  "begin-purge",
];

export async function transitionLocked(
  tx: TenantDatabase,
  row: SessionRecord,
  command: StatusCommand,
  actor: StatusActor,
): Promise<Transition> {
  const decision = transitionStatus(row.status, command, actor);
  if (!decision.ok) throw new SessionError("status_refused");
  if (!decision.changed)
    return { changed: false, from: row.status, to: row.status };
  const to = decision.status;
  await writeStatus(tx, row, to, command);
  // A pause or end suppresses the session's in-flight processor actions in the
  // same transaction as the status change, so a model result that began before
  // it can never publish later - not even after a resume that lands before the
  // holder notices (rule:pause-end-suppression, rule:fenced-current-publish,
  // ADR-0011). Job-backed actions are settled by their job's cancellation.
  if (to === "paused" || to === "ended")
    await suppressInFlightActions(tx, row, `session_${to}`);
  return { changed: true, from: row.status, to };
}

export type { ReconcileOptions };

export type Reconciled = {
  status: SessionStatus;
  // The command applied, when the session's standing changed.
  applied: "end" | "pause" | null;
};

// Derives the session's standing from time (decideReconcile) and applies it.
export async function reconcileLocked(
  tx: TenantDatabase,
  row: SessionRecord,
  options: ReconcileOptions,
): Promise<Reconciled> {
  const decision = decideReconcile(row, options);
  if (!decision) return { status: row.status, applied: null };
  await transitionLocked(tx, row, decision.command, decision.actor);
  return {
    status: decision.command === "end" ? "ended" : "paused",
    applied: decision.command,
  };
}
