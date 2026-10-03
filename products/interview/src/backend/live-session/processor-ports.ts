// The ports the session processor runs against. Everything the processor needs
// from the outside is named here and injected, so a tick is testable with
// in-memory fakes and, where the fenced writes matter, with the real
// repository over a disposable database (session-ports.ts composes that).
// The processor never builds a gateway (rule:model-calls-gateway-routed): the
// host hands one in, and the processor names profiles, never providers.
import type { AiExecutionGateway } from "@omnitech/ai-contracts";
import type { Clock } from "./core/index.js";
import type { FencedSessionWrites } from "./fenced-writes.js";
import type { InterviewSessionPolicy } from "./interview-policy.js";
import type { OwnerScope } from "./scope.js";
import type {
  LeaseRenewal,
  SessionClaim,
  SessionTarget,
} from "./session-claim.js";
import type { SessionContext } from "./session-context.js";
import type { PurgeResult } from "./session-purge.js";
import type { StoredAction, StoredObservation } from "./session-reads.js";
import type { SessionView } from "./session-record.js";
import type { TraceSink } from "./trace.js";

// The worker's cross-tenant claim: ids and a fence only. Lease and fence are
// the only columns it may change (rule:claim-writes-lease-and-fence-only).
export interface SessionClaimPort {
  claim(
    limit: number,
    options: { includeOwnLive: boolean },
  ): Promise<SessionClaim[]>;
  renew(claim: SessionClaim): Promise<LeaseRenewal>;
  release(claim: SessionClaim): Promise<boolean>;
  // Ended sessions that delete at end or are past retention, and purges that
  // crashed part-way.
  purgeCandidates(limit: number): Promise<SessionTarget[]>;
  // Open sessions past their duration cap.
  capExpired(limit: number): Promise<SessionTarget[]>;
}

// Every method opens an actor-scoped transaction for the session OWNER named
// by the scope; the processor holds no other way to read session data
// (rule:tenant-scoped-worker-access, rule:owner-checked-read-paths).
export type SessionStorePort = Pick<
  FencedSessionWrites,
  | "recordAction"
  | "readDispatchStanding"
  | "publishResult"
  | "recordFailure"
  | "abandonAction"
> & {
  // The time-derived standing: the duration cap ends, an expired credential or
  // a silent companion pauses (rule:stop-authority). Cancels jobs on a change.
  reconcile(scope: OwnerScope, sessionId: string): Promise<SessionView>;
  observationsAfter(
    scope: OwnerScope,
    sessionId: string,
    afterSequence: number,
    limit: number,
  ): Promise<StoredObservation[]>;
  actions(scope: OwnerScope, sessionId: string): Promise<StoredAction[]>;
  // The session's pinned approved context (profile revision hash-verified,
  // linked briefing draft). Rejects when it is unavailable; never a stale one.
  loadContext(scope: OwnerScope, sessionId: string): Promise<SessionContext>;
  // Requests cancellation of the session's in-flight jobs; a job already
  // terminal counts as cancelled (rule:pause-end-suppression).
  cancelJobs(scope: OwnerScope, sessionId: string): Promise<unknown>;
  purge(target: SessionTarget): Promise<PurgeResult>;
};

export type SessionProcessorPorts = {
  claim: SessionClaimPort;
  store: SessionStorePort;
  gateway: AiExecutionGateway;
  policy: InterviewSessionPolicy;
  clock: Clock;
  trace: TraceSink;
};

export type SessionProcessorOptions = {
  // The worker id the claim was made under; with the fence it is the holder
  // token every fenced write presents.
  workerId: string;
  // Sessions held at once (default 8).
  maxSessions?: number;
  // A trailing utterance is processed once no new transcript arrived for this
  // long, so a question split across segments is one task (default 1500).
  settleMs?: number;
  // Failed (retryable) dispatches per task revision in one run (default 3).
  maxAttempts?: number;
  // How often the cap and purge sweeps run (default 30000).
  sweepEveryMs?: number;
  sweepBatch?: number;
  // Consecutive failed lease renewals after which a session is no longer
  // treated as held and is dropped without writing (default 3). The lease
  // expires on its own, so another worker can then take the session.
  maxRenewFailures?: number;
  observationPage?: number;
};
