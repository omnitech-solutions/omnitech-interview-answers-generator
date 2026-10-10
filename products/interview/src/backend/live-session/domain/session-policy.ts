// Who may ingest, when a session takes a message, and what the answer says of
// the session's standing. Pure: the locked row (with the database clock it was
// read with), the limits and the message come in; a decision goes out.
import type {
  CompanionDeclaration,
  ControlStatus,
} from "@omnitech/active-session-contracts";
import type { IngestLimits } from "../contracts/ingest";
import type { SessionStatus } from "../core/index";
import type { SessionRecord } from "../session-record";
import { pendingCaptureOf } from "./capture-request";

// Roles that hold interview.write, the permission starting a session needs
// (see rolePermissions in platform-storage).
const WRITE_ROLES: ReadonlySet<string> = new Set(["admin", "owner"]);

// [SAFETY] A removed member (no role) or a demoted one may not ingest
// (rule:ingest-membership-recheck).
export const mayIngest = (role: string | undefined): boolean =>
  role !== undefined && WRITE_ROLES.has(role);

// The presented credential is the session's own, unrevoked and unexpired by
// the database clock. An expired, revoked or replaced one is the same refusal.
export const credentialIsLive = (
  row: SessionRecord,
  credentialHash: string,
): boolean =>
  row.credentialHash === credentialHash &&
  row.credentialRevokedAt === null &&
  row.credentialExpiresAt !== null &&
  row.credentialExpiresAt.getTime() > row.nowMs;

// A session that has not started capturing reads as paused to the companion.
export const controlState = (status: SessionStatus): ControlStatus["state"] =>
  status === "created" ? "paused" : status;

// The control state every answer carries, with the pending capture request
// when this companion may be handed it.
export function controlOf(
  row: SessionRecord,
  status: SessionStatus,
  declaration: CompanionDeclaration,
): ControlStatus {
  const capture = pendingCaptureOf(row, status, declaration);
  return {
    state: controlState(status),
    credentialExpiresAt: (
      row.credentialExpiresAt ?? row.expiresAt
    ).toISOString(),
    ...(capture ? { capture } : {}),
  };
}

// Stored acknowledgements never carry a capture request: a resend returns the
// original unchanged, and a request is only ever live on a fresh answer.
export const withoutCapture = ({
  capture: _capture,
  ...control
}: ControlStatus): ControlStatus => control;

// The kind an envelope names, whatever it is; undefined when it names none.
export const messageKindOf = (envelope: unknown): unknown =>
  typeof envelope === "object" && envelope !== null
    ? (envelope as { kind?: unknown }).kind
    : undefined;

// Heartbeats are spaced by minHeartbeatIntervalMs against the last contact.
// Standing keeps precedence over the spacing: only an active session's
// capturing heartbeat is spaced, and a stop report (capturing: false) is never
// delayed by it (rule:pause-only-credential-stop).
export const heartbeatTooSoon = (
  row: SessionRecord,
  status: SessionStatus,
  capturing: boolean,
  limits: Pick<IngestLimits, "minHeartbeatIntervalMs">,
): boolean =>
  status === "active" &&
  capturing &&
  row.lastHeartbeatAt !== null &&
  row.nowMs - row.lastHeartbeatAt.getTime() < limits.minHeartbeatIntervalMs;

// How long a spaced message asks the companion to wait: the spacing in whole
// seconds, never under one.
export const spacingRetryAfterSeconds = (
  limits: Pick<IngestLimits, "minHeartbeatIntervalMs">,
): number => Math.max(1, Math.ceil(limits.minHeartbeatIntervalMs / 1000));

// Whether a session's voice activity may be told to anyone: the owner's
// switch is on and the owner allows processing off this device (the listener
// is the coach, on a remote model).
export const voiceActivityAllowed = (
  row: SessionRecord,
  switchedOn: boolean,
): boolean => switchedOn && row.policy === "permitted-remote";

// The capture sources fixed at the session's start.
export const permittedSources = (row: SessionRecord): readonly string[] =>
  row.sources?.captureSources ?? [];
