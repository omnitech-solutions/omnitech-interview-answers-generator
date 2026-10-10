// A session's agent jobs: finding them through the actions that name them, and
// cancelling them with the actor-carrying cancel (ADR-0012 Agent jobs). The
// session and the job stay separate records (rule:three-concept-split): the
// session names a job only through an action row, and a job never carries
// session identity.
import type { PlatformDatabase } from "@omnitech/database";
import type { PostgresAgentJobRepository } from "@omnitech/platform-storage";
import { SessionError } from "./errors";
import { listNamedJobs } from "./repositories/job.repository";
import { inOwnerScope, type OwnerScope } from "./scope";

// What the session layer needs from the job repository. The platform-storage
// repository satisfies it, so a test can pass the real one.
export type SessionJobs = Pick<
  PostgresAgentJobRepository,
  "create" | "get" | "requestCancellation" | "requestResume"
>;

export type NamedJob = { jobId: string; created: boolean };

export function namedJobs(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<NamedJob[]> {
  return inOwnerScope(database, scope, (tx) =>
    listNamedJobs(tx, scope, sessionId),
  );
}

export type CancellationSummary = { requested: number; alreadyEnded: number };

// Requests cancellation of every job the session's actions name. A job that is
// already terminal counts as cancelled. A job the actor cannot see fails
// closed; a reserved id whose job was never created has nothing to cancel.
// Every job is attempted before the failure is raised.
export async function cancelSessionJobs(
  database: PlatformDatabase,
  jobs: SessionJobs,
  scope: OwnerScope,
  sessionId: string,
): Promise<CancellationSummary> {
  const named = await namedJobs(database, scope, sessionId);
  const summary: CancellationSummary = { requested: 0, alreadyEnded: 0 };
  let failed = false;
  for (const job of named) {
    const outcome = await jobs.requestCancellation(
      scope.tenantId,
      scope.actorId,
      job.jobId,
    );
    if (outcome === "requested") summary.requested += 1;
    else if (outcome === "already-ended") summary.alreadyEnded += 1;
    else if (job.created) failed = true;
  }
  if (failed) throw new SessionError("job_cancellation_failed");
  return summary;
}
