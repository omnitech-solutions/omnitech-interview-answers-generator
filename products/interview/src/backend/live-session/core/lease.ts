// Lease and fence model (rule:fenced-current-publish; ADR-0010 Fencing). A
// per-session counter fence rises on every acquire, so a restarted or slow
// worker holding an older fence can never publish over its successor.
import type { SessionStatus } from "./status.js";

export type Lease = {
  fence: number;
  holderId: string | null;
  expiresAtMs: number | null;
};

export const initialLease = (): Lease => ({
  fence: 0,
  holderId: null,
  expiresAtMs: null,
});

export type AcquireDecision =
  | { acquired: true; lease: Lease; fence: number }
  | { acquired: false; reason: "held_by_other"; fence: number };

// Acquiring always increments the fence, even for the same holder id, because
// a restarted process reusing its id must still outrank its earlier self.
export function acquireLease(
  lease: Lease,
  holderId: string,
  nowMs: number,
  ttlMs: number,
): AcquireDecision {
  const live =
    lease.holderId !== null &&
    lease.expiresAtMs !== null &&
    lease.expiresAtMs > nowMs;
  if (live && lease.holderId !== holderId)
    return { acquired: false, reason: "held_by_other", fence: lease.fence };
  const fence = lease.fence + 1;
  return {
    acquired: true,
    fence,
    lease: { fence, holderId, expiresAtMs: nowMs + ttlMs },
  };
}

export type RenewDecision =
  | { renewed: true; lease: Lease }
  | {
      renewed: false;
      reason: "fence_superseded" | "not_holder" | "expired";
    };

// Renewing keeps the fence. An expired lease must be re-acquired (new fence).
export function renewLease(
  lease: Lease,
  holderId: string,
  holderFence: number,
  nowMs: number,
  ttlMs: number,
): RenewDecision {
  if (holderFence !== lease.fence)
    return { renewed: false, reason: "fence_superseded" };
  if (lease.holderId !== holderId)
    return { renewed: false, reason: "not_holder" };
  if (lease.expiresAtMs === null || lease.expiresAtMs <= nowMs)
    return { renewed: false, reason: "expired" };
  return { renewed: true, lease: { ...lease, expiresAtMs: nowMs + ttlMs } };
}

export type HolderStanding = "holding" | "stop-superseded" | "stop-expired";

// A holder that sees any fence other than its own has been succeeded and stops.
export function holderStanding(
  lease: Lease,
  holderId: string,
  holderFence: number,
  nowMs: number,
): HolderStanding {
  if (holderFence !== lease.fence || lease.holderId !== holderId)
    return "stop-superseded";
  if (lease.expiresAtMs === null || lease.expiresAtMs <= nowMs)
    return "stop-expired";
  return "holding";
}

export type PublishSuppression =
  | "session_not_active"
  | "session_paused"
  | "session_ended"
  | "session_purging"
  | "fence_superseded"
  | "revision_stale"
  | "source_superseded";

export type PublishEligibility =
  | { eligible: true }
  | { eligible: false; reason: PublishSuppression };

export type PublishCheck = {
  sessionStatus: SessionStatus;
  // The fence currently stored for the session, and the one the result carries.
  leaseFence: number;
  holderFence: number;
  taskRevision: number;
  currentTaskRevision: number;
  // True when a segment the revision was built on has been superseded.
  sourceSuperseded?: boolean;
};

const STATUS_SUPPRESSION: Record<SessionStatus, PublishSuppression | null> = {
  active: null,
  created: "session_not_active",
  paused: "session_paused",
  ended: "session_ended",
  purging: "session_purging",
};

// Eligibility only; the persistence port enforces the same check atomically
// under the session-row lock (rule:fenced-current-publish).
export function canPublish(check: PublishCheck): PublishEligibility {
  const status = STATUS_SUPPRESSION[check.sessionStatus];
  if (status) return { eligible: false, reason: status };
  if (check.holderFence !== check.leaseFence)
    return { eligible: false, reason: "fence_superseded" };
  if (check.taskRevision !== check.currentTaskRevision)
    return { eligible: false, reason: "revision_stale" };
  if (check.sourceSuperseded)
    return { eligible: false, reason: "source_superseded" };
  return { eligible: true };
}
