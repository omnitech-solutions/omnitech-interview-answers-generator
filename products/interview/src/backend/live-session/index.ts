// The Active Session repository layer: the one public entrypoint of the
// persistence side of the live session (the neutral core is core/index.ts and
// imports none of this). Everything here opens an actor-scoped transaction for
// the session owner, except the three narrow cross-tenant settings, each set by
// one owning file: the worker claim (session-claim.ts), the credential lookup
// (credential-lookup.ts) and the purge delete (session-purge.ts).
export { SessionError, type SessionErrorCode } from "./errors.js";
export {
  createSessionJob,
  FencedSessionWrites,
  type FenceHolder,
  type PublishEffect,
  type PublishEffectContext,
  type PublishOutcome,
  type RecordActionOutcome,
  reserveJobId,
  resumeSessionJob,
  type SessionJobRequest,
  type SettleOutcome,
  sessionJobResumeGuard,
  type WriteRefusalReason,
} from "./fenced-writes.js";
export { type IngestOptions, ingestObservation } from "./ingest.js";
export {
  type RetentionMode,
  type WorkspaceDraftKey,
} from "./mapping.js";
export {
  ActiveSessionRepository,
  type ActiveSessionRepositoryOptions,
  type ControlAction,
  type RenewedCredential,
  type StartedSession,
  type StartSessionInput,
} from "./repository.js";
export type { OwnerScope } from "./scope.js";
export {
  claimCapExpired,
  claimPurgeCandidates,
  claimSessions,
  type LeaseRenewal,
  releaseLease,
  renewLease,
  type SessionClaim,
  type SessionTarget,
} from "./session-claim.js";
export {
  credentialExpiry,
  type MintedCredential,
  mintSessionCredential,
} from "./session-credential.js";
export {
  sessionDraftKey,
  sessionDraftPurger,
  sessionWorkspaceId,
} from "./session-drafts.js";
export { cancelSessionJobs, type SessionJobs } from "./session-jobs.js";
export {
  noSessionDraftPurger,
  PURGE_JOB_WAIT_MS,
  type PurgeCounts,
  type PurgeOptions,
  type PurgeResult,
  purgeSession,
  type SessionDraftPurger,
} from "./session-purge.js";
export type {
  ScreenshotDownload,
  SessionContext,
  StoredAction,
  StoredObservation,
} from "./session-reads.js";
export type { SessionView } from "./session-record.js";
export { HEARTBEAT_STALE_MS } from "./status-transition.js";
