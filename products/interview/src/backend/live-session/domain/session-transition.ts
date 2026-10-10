// What time does to a session's standing, decided from the locked row alone.
// Pure: the row carries the database clock it was read with.
import type { StatusActor } from "../core/index";
import type { SessionRecord } from "../session-record";

// A companion that has made contact and then goes silent this long is treated
// as stopped; capture pauses and stays open (never ends).
export const HEARTBEAT_STALE_MS = 2 * 60 * 1000;

export type ReconcileOptions = {
  // True when the companion has just made contact (ingest): staleness of its
  // heartbeat is then moot.
  contact: boolean;
  heartbeatStaleMs?: number;
};

export type ReconcileDecision = {
  command: "end" | "pause";
  actor: StatusActor;
};

// The duration cap ends a session; an expired or revoked credential and a
// silent companion pause it. Never ends a session for credential expiry or a
// companion stop. Null: the standing holds.
export function decideReconcile(
  row: SessionRecord,
  options: ReconcileOptions,
): ReconcileDecision | null {
  const open =
    row.status === "created" ||
    row.status === "active" ||
    row.status === "paused";
  if (!open || row.purgedAt !== null) return null;
  if (row.nowMs >= row.expiresAt.getTime())
    return { command: "end", actor: "duration-cap" };
  if (row.status !== "active") return null;
  // A companion rule applies only to a session a companion has contacted: a
  // session captured from the browser alone has no companion to lose, and a
  // resume clears the old heartbeat so a stale one cannot re-pause it.
  if (row.lastHeartbeatAt === null) return null;
  const credentialDead =
    row.credentialHash === null ||
    row.credentialRevokedAt !== null ||
    row.credentialExpiresAt === null ||
    row.credentialExpiresAt.getTime() <= row.nowMs;
  if (credentialDead) return { command: "pause", actor: "credential-expiry" };
  const stale = options.heartbeatStaleMs ?? HEARTBEAT_STALE_MS;
  if (!options.contact && row.nowMs - row.lastHeartbeatAt.getTime() > stale)
    return { command: "pause", actor: "companion-stop" };
  return null;
}
