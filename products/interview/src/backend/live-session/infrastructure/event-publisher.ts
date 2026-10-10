// What ingest tells the outside once its transaction is committed: the wait a
// refusal asks for, the line a session heard, the voice on one of its sources,
// and the cancellation of its jobs after a change of standing. In that order.
// The acknowledgement stands whatever a listener or the job repository does.
import type { PlatformDatabase } from "@omnitech/database";
import { PostgresAgentJobRepository } from "@omnitech/platform-storage";
import type { IngestDependencies, IngestOutcome } from "../contracts/ingest";
import type { OwnerScope } from "../scope";
import { cancelSessionJobs } from "../session-jobs";

export async function publishIngestEffects(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  outcome: IngestOutcome,
  listeners: IngestDependencies,
): Promise<void> {
  if (outcome.retryAfterSeconds !== undefined)
    listeners.onRetryAfter?.(outcome.retryAfterSeconds);
  if (outcome.heard) {
    try {
      listeners.onHeard?.(outcome.heard);
    } catch {
      // The acknowledgement stands whatever a listener does.
    }
  }
  if (outcome.activity) {
    try {
      listeners.onActivity?.(outcome.activity);
    } catch {
      // The acknowledgement stands whatever a listener does.
    }
  }
  if (outcome.cancelJobs) {
    try {
      await cancelSessionJobs(
        database,
        listeners.jobs ?? new PostgresAgentJobRepository(database),
        scope,
        sessionId,
      );
    } catch {
      // The ack stands; pause, end and the purge request cancellation again.
    }
  }
}
