// The database-backed ports of the session processor: the cross-tenant claim
// (session-claim.ts, the one file that sets app.session_worker), the fenced
// writes, the owner-checked reads and the purge, composed over the real
// PlatformDatabase. The processor itself knows only the port interfaces.
import type { PlatformDatabase } from "@omnitech/database";
import { PostgresAgentJobRepository } from "@omnitech/platform-storage";
import { createSessionJob, FencedSessionWrites } from "./fenced-writes.js";
import type { SessionClaimPort, SessionStorePort } from "./processor-ports.js";
import { ActiveSessionRepository } from "./repository.js";
import { loadSessionContext } from "./session-context.js";
import { SessionError } from "./errors.js";
import { inOwnerScope } from "./scope.js";
import { listActionsNewest } from "./session-reads.js";
import { readSession } from "./session-record.js";
import {
  claimCapExpired,
  claimPurgeCandidates,
  claimSessions,
  releaseLease,
  renewLease,
} from "./session-claim.js";
import { cancelSessionJobs, type SessionJobs } from "./session-jobs.js";
import { sessionDraftPurger } from "./session-drafts.js";
import { purgeSession, type SessionDraftPurger } from "./session-purge.js";

export type DatabasePortOptions = {
  workerId: string;
  // How long an acquired lease lasts before another worker may take it.
  leaseMs?: number;
  jobs?: SessionJobs;
  drafts?: SessionDraftPurger;
  // How many of a session's newest actions a rebuilt run is seeded from.
  actionLimit?: number;
};

export const DEFAULT_LEASE_MS = 60_000;
export const DEFAULT_ACTION_LIMIT = 5_000;

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
  options: Pick<DatabasePortOptions, "jobs" | "drafts" | "actionLimit"> = {},
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
    recordProcessedThrough: (input) => writes.recordProcessedThrough(input),
    actions: (scope, sessionId) =>
      listActionsNewest(
        database,
        scope,
        sessionId,
        options.actionLimit ?? DEFAULT_ACTION_LIMIT,
      ),
    processedThrough: (scope, sessionId) =>
      inOwnerScope(database, scope, async (tx) => {
        const row = await readSession(tx, scope, sessionId);
        if (!row) throw new SessionError("not_found");
        return row.processedThrough;
      }),
    loadContext: (scope, sessionId) =>
      loadSessionContext(database, scope, sessionId),
    cancelJobs: (scope, sessionId) =>
      cancelSessionJobs(database, jobs, scope, sessionId),
    createJob: (input) => createSessionJob(database, jobs, input),
    purge: (target) =>
      purgeSession(database, target, {
        jobs,
        drafts: options.drafts ?? sessionDraftPurger,
      }),
  };
}
