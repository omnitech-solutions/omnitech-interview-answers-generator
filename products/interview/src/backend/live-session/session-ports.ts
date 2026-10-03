// The database-backed ports of the session processor: the cross-tenant claim
// (session-claim.ts, the one file that sets app.session_worker), the fenced
// writes, the owner-checked reads and the purge, composed over the real
// PlatformDatabase. The processor itself knows only the port interfaces.
import type { PlatformDatabase } from "@omnitech/database";
import { PostgresAgentJobRepository } from "@omnitech/platform-storage";
import { FencedSessionWrites } from "./fenced-writes.js";
import type { SessionClaimPort, SessionStorePort } from "./processor-ports.js";
import { ActiveSessionRepository } from "./repository.js";
import { loadSessionContext } from "./session-context.js";
import {
  claimCapExpired,
  claimPurgeCandidates,
  claimSessions,
  releaseLease,
  renewLease,
} from "./session-claim.js";
import { cancelSessionJobs, type SessionJobs } from "./session-jobs.js";
import {
  noSessionDraftPurger,
  purgeSession,
  type SessionDraftPurger,
} from "./session-purge.js";

export type DatabasePortOptions = {
  workerId: string;
  // How long an acquired lease lasts before another worker may take it.
  leaseMs?: number;
  jobs?: SessionJobs;
  drafts?: SessionDraftPurger;
};

export const DEFAULT_LEASE_MS = 60_000;

export function createDatabaseClaimPort(
  database: PlatformDatabase,
  options: DatabasePortOptions,
): SessionClaimPort {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  return {
    claim: (limit, { includeOwnLive }) =>
      claimSessions(database, options.workerId, leaseMs, limit, {
        includeOwnLive,
      }),
    renew: (claim) => renewLease(database, claim, options.workerId, leaseMs),
    release: (claim) => releaseLease(database, claim, options.workerId),
    purgeCandidates: (limit) => claimPurgeCandidates(database, limit),
    capExpired: (limit) => claimCapExpired(database, limit),
  };
}

export function createDatabaseStorePort(
  database: PlatformDatabase,
  options: Pick<DatabasePortOptions, "jobs" | "drafts"> = {},
): SessionStorePort {
  const jobs = options.jobs ?? new PostgresAgentJobRepository(database);
  const repository = new ActiveSessionRepository(database, { jobs });
  const writes = new FencedSessionWrites(database);
  return {
    recordAction: (input) => writes.recordAction(input),
    readDispatchStanding: (input) => writes.readDispatchStanding(input),
    publishResult: (input) => writes.publishResult(input),
    recordFailure: (input) => writes.recordFailure(input),
    abandonAction: (input) => writes.abandonAction(input),
    reconcile: (scope, sessionId) =>
      repository.reconcileSession(scope, sessionId),
    observationsAfter: (scope, sessionId, afterSequence, limit) =>
      repository.listObservations(scope, sessionId, { afterSequence, limit }),
    actions: (scope, sessionId) =>
      repository.listActions(scope, sessionId, { limit: 500 }),
    loadContext: (scope, sessionId) =>
      loadSessionContext(database, scope, sessionId),
    cancelJobs: (scope, sessionId) =>
      cancelSessionJobs(database, jobs, scope, sessionId),
    purge: (target) =>
      purgeSession(database, target, {
        jobs,
        drafts: options.drafts ?? noSessionDraftPurger,
      }),
  };
}
