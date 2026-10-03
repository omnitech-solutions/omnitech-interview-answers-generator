// Session status machine and stop authority (rule:stop-authority, as amended by
// ADR-0011: credential expiry and a companion stop pause; only the owner's
// control, owner delete or the duration cap end). Pure; persistence enforces it.
import type { RefusalCode } from "@omnitech/active-session-contracts";

export type SessionStatus =
  | "created"
  | "active"
  | "paused"
  | "purging"
  | "ended";

export type StatusActor =
  | "owner-control"
  | "credential-expiry"
  | "companion-stop"
  | "duration-cap"
  | "purge";

export type StatusCommand =
  | "start"
  | "resume"
  | "pause"
  | "end"
  | "begin-purge"
  | "complete-purge";

export type StatusRefusalReason = "actor_not_permitted" | "invalid_transition";

export type StatusDecision =
  | { ok: true; status: SessionStatus; changed: boolean }
  | {
      ok: false;
      reason: StatusRefusalReason;
      from: SessionStatus;
      command: StatusCommand;
      actor: StatusActor;
    };

// Who may issue each command. Capture starts and resumes only on the owner's
// control; credential expiry and the companion stop can only pause.
const PERMITTED_ACTORS: Record<StatusCommand, readonly StatusActor[]> = {
  start: ["owner-control"],
  resume: ["owner-control"],
  pause: ["owner-control", "credential-expiry", "companion-stop"],
  end: ["owner-control", "duration-cap"],
  // The purge module, or the owner deleting the session.
  "begin-purge": ["purge", "owner-control"],
  "complete-purge": ["purge"],
};

// Where each command may begin, and where it lands.
const TRANSITIONS: Record<
  StatusCommand,
  { from: readonly SessionStatus[]; to: SessionStatus }
> = {
  start: { from: ["created"], to: "active" },
  resume: { from: ["paused"], to: "active" },
  pause: { from: ["active"], to: "paused" },
  end: { from: ["created", "active", "paused"], to: "ended" },
  // A purge may follow an end (delete at end) or an owner delete.
  "begin-purge": {
    from: ["created", "active", "paused", "ended"],
    to: "purging",
  },
  "complete-purge": { from: ["purging"], to: "ended" },
};

const IDEMPOTENT: readonly StatusCommand[] = ["pause", "end", "begin-purge"];

export function transitionStatus(
  from: SessionStatus,
  command: StatusCommand,
  actor: StatusActor,
): StatusDecision {
  const refuse = (reason: StatusRefusalReason): StatusDecision => ({
    ok: false,
    reason,
    from,
    command,
    actor,
  });
  // [GUARD] Authority is checked before state so a forbidden actor learns nothing.
  if (!PERMITTED_ACTORS[command].includes(actor))
    return refuse("actor_not_permitted");
  const rule = TRANSITIONS[command];
  // A repeated pause/end/purge is idempotent: races between expiry, stop and
  // the owner must not turn into errors.
  if (from === rule.to && IDEMPOTENT.includes(command))
    return { ok: true, status: from, changed: false };
  if (!rule.from.includes(from)) return refuse("invalid_transition");
  return { ok: true, status: rule.to, changed: true };
}

// Ingest is accepted only while capture is running. Maps to the wire refusal code.
export function ingestRefusal(status: SessionStatus): RefusalCode | null {
  switch (status) {
    case "active":
      return null;
    case "paused":
    case "created":
      // A session that has not started capturing is not accepting ingest either.
      return "session_paused";
    case "ended":
      return "session_ended";
    case "purging":
      return "session_purging";
  }
}

// Dispatch needs an active session; purging and ended refuse it outright.
export const acceptsDispatch = (status: SessionStatus): boolean =>
  status === "active";

export type ProcessingPolicy = "device-only" | "permitted-remote";

export type TightenDecision =
  | { ok: true; policy: ProcessingPolicy }
  | { ok: false; reason: "loosening_refused" };

// rule:tighten-only-locality: a session may move to device-only, never away.
export function tightenPolicy(
  current: ProcessingPolicy,
  requested: ProcessingPolicy,
): TightenDecision {
  if (current === "device-only" && requested === "permitted-remote")
    return { ok: false, reason: "loosening_refused" };
  return { ok: true, policy: requested };
}
