// Status changes of a locked session row, decided by the neutral core
// (rule:owner-starts-and-resumes, rule:pause-only-credential-stop,
// rule:owner-or-cap-ends). Only the owner starts or resumes; expiry and a
// companion stop PAUSE; the owner or duration cap end. The caller holds the
// row lock (lockSession) and commits;
// jobs are cancelled only after the status flip commits (rule:pause-end-
// suppression: status first, then cancellation).
import type { TenantDatabase } from "@omnitech/database";
import { sql } from "drizzle-orm";
import {
  type SessionStatus,
  type StatusActor,
  type StatusCommand,
  transitionStatus,
} from "./core/index.js";
import { SessionError } from "./errors.js";
import type { SessionRecord } from "./session-record.js";

// A companion that has made contact and then goes silent this long is treated
// as stopped; capture pauses and stays open (never ends).
const HEARTBEAT_STALE_MS = 2 * 60 * 1000;

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
  // Ending or starting a purge also revokes the credential and stamps the end
  // (rule:credential-revocation); a purge also stamps its start.
  await tx.execute(sql`
    UPDATE interview.active_sessions SET
      status = ${to}::text,
      ended_at = CASE WHEN ${to}::text IN ('ended', 'purging')
        THEN COALESCE(ended_at, now()) ELSE ended_at END,
      purge_started_at = CASE WHEN ${to}::text = 'purging'
        THEN COALESCE(purge_started_at, now()) ELSE purge_started_at END,
      credential_revoked_at = CASE WHEN ${to}::text IN ('ended', 'purging')
        THEN COALESCE(credential_revoked_at, now()) ELSE credential_revoked_at END,
      last_heartbeat_at = CASE WHEN ${command}::text = 'resume'
        THEN NULL ELSE last_heartbeat_at END
    WHERE tenant_id = ${row.tenantId}::uuid
      AND owner_user_id = ${row.ownerUserId}::uuid
      AND id = ${row.id}::uuid`);
  // A pause or end suppresses the session's in-flight processor actions in the
  // same transaction as the status change, so a model result that began before
  // it can never publish later - not even after a resume that lands before the
  // holder notices (rule:pause-end-suppression, rule:fenced-current-publish,
  // ADR-0011). Job-backed actions are settled by their job's cancellation.
  if (to === "paused" || to === "ended")
    await tx.execute(sql`
      UPDATE interview.session_actions SET
        dispatch_status = 'suppressed', suppression_reason = ${`session_${to}`}::text
      WHERE tenant_id = ${row.tenantId}::uuid
        AND owner_user_id = ${row.ownerUserId}::uuid
        AND session_id = ${row.id}::uuid
        AND dispatch_status = 'in_flight' AND job_id IS NULL`);
  return { changed: true, from: row.status, to };
}

export type ReconcileOptions = {
  // True when the companion has just made contact (ingest): staleness of its
  // heartbeat is then moot.
  contact: boolean;
  heartbeatStaleMs?: number;
};

export type Reconciled = {
  status: SessionStatus;
  // The command applied, when the session's standing changed.
  applied: "end" | "pause" | null;
};

// Derives the session's standing from time: the duration cap ends it; an
// expired or revoked credential and a silent companion pause it. Never ends a
// session for credential expiry or a companion stop.
export async function reconcileLocked(
  tx: TenantDatabase,
  row: SessionRecord,
  options: ReconcileOptions,
): Promise<Reconciled> {
  const open =
    row.status === "created" ||
    row.status === "active" ||
    row.status === "paused";
  if (!open || row.purgedAt !== null)
    return { status: row.status, applied: null };
  if (row.nowMs >= row.expiresAt.getTime()) {
    await transitionLocked(tx, row, "end", "duration-cap");
    return { status: "ended", applied: "end" };
  }
  if (row.status !== "active") return { status: row.status, applied: null };
  // A companion rule applies only to a session a companion has contacted: a
  // session captured from the browser alone has no companion to lose, and a
  // resume clears the old heartbeat so a stale one cannot re-pause it.
  if (row.lastHeartbeatAt === null)
    return { status: row.status, applied: null };
  const credentialDead =
    row.credentialHash === null ||
    row.credentialRevokedAt !== null ||
    row.credentialExpiresAt === null ||
    row.credentialExpiresAt.getTime() <= row.nowMs;
  if (credentialDead) {
    await transitionLocked(tx, row, "pause", "credential-expiry");
    return { status: "paused", applied: "pause" };
  }
  const stale = options.heartbeatStaleMs ?? HEARTBEAT_STALE_MS;
  if (
    !options.contact &&
    row.lastHeartbeatAt !== null &&
    row.nowMs - row.lastHeartbeatAt.getTime() > stale
  ) {
    await transitionLocked(tx, row, "pause", "companion-stop");
    return { status: "paused", applied: "pause" };
  }
  return { status: row.status, applied: null };
}
