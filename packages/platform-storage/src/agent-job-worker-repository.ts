import type {
  AgentJob,
  AgentJobWorkerRepository,
  PersistedAgentEvent,
} from "@omnitech/agent-job-service";
import type {
  AgentEvent,
  AgentJobStatus,
} from "@omnitech/agent-runtime-contracts";
import type { DatabaseClient, PlatformDatabase } from "@omnitech/database";
import { type JobRow, mapJob } from "./agent-job-row.js";

// The isolated agent worker's jobs, exported only from
// `@omnitech/platform-storage/worker` and constructed only by apps/agent-worker
// (scripts/package-boundaries.test.ts).
export class PostgresAgentJobWorkerRepository
  implements AgentJobWorkerRepository
{
  constructor(private readonly database: PlatformDatabase) {}

  // [SAFETY] The worker leases jobs before it knows their tenant and then
  // holds only a job id. Its transactions set app.agent_worker, which the
  // agent_worker_* policies admit; this is the one file that sets it
  // (scripts/tenant-context-boundary.test.ts). A job's identity, tenant,
  // profile and prompt can never change under it (agent_jobs_identity
  // trigger), so the flag only advances a job's lifecycle.
  private asWorker<Result>(
    work: (client: DatabaseClient) => Promise<Result>,
  ): Promise<Result> {
    return this.database.transaction(async (client) => {
      await client.query("SELECT set_config('app.agent_worker', 'on', true)");
      return work(client);
    });
  }

  async claim(
    workerId: string,
    leaseMs: number,
  ): Promise<AgentJob | undefined> {
    return this.asWorker(async (client) => {
      // A cancelled job nobody is running (never claimed, or its worker's
      // lease ran out) ends here, so a cancel always reaches a terminal state.
      await client.query(
        `WITH swept AS (
           UPDATE ai.agent_jobs
           SET status = 'cancelled', updated_at = now(),
               next_event_sequence = next_event_sequence + 1
           WHERE status = 'cancelling'
             AND (claimed_by IS NULL OR lease_expires_at < now())
           RETURNING id, tenant_id, execution_id, claimed_by,
             next_event_sequence - 1 AS sequence
         )
         INSERT INTO ai.agent_job_events
           (tenant_id, job_id, sequence, execution_id, attempt_id, event)
         SELECT tenant_id, id, sequence, execution_id, claimed_by,
           jsonb_build_object('type', 'failed', 'error',
             jsonb_build_object('code', 'cancelled',
               'message', 'Agent job cancelled.', 'retryable', false))
         FROM swept`,
      );
      const result = await client.query<JobRow>(
        `WITH candidate AS (
           SELECT id FROM ai.agent_jobs
           WHERE status = 'queued'
              OR (status IN ('claimed', 'starting', 'running')
                  AND lease_expires_at < now())
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE ai.agent_jobs j SET
           status = 'claimed',
           claimed_by = $1,
           lease_expires_at = now() + ($2 * interval '1 millisecond'),
           updated_at = now()
         FROM candidate
         WHERE j.id = candidate.id
         RETURNING j.*`,
        [workerId, leaseMs],
      );
      const row = result.rows[0];
      return row ? mapJob(row) : undefined;
    });
  }

  async renewLease(
    jobId: string,
    workerId: string,
    leaseMs: number,
  ): Promise<boolean> {
    const result = await this.asWorker((client) =>
      client.query(
        `UPDATE ai.agent_jobs
         SET lease_expires_at = now() + ($3 * interval '1 millisecond')
         WHERE id = $1 AND claimed_by = $2
           AND lease_expires_at > now()
           AND status IN ('claimed', 'starting', 'running', 'cancelling')`,
        [jobId, workerId, leaseMs],
      ),
    );
    return (result.rowCount ?? 0) === 1;
  }

  // Once claimed, the worker knows the job's tenant and reads it there. It
  // reads as the worker (app.agent_worker), the one reader besides a private
  // job's creator that the private-job policy admits (ADR-0012 Agent jobs).
  async get(tenantId: string, jobId: string): Promise<AgentJob | undefined> {
    return this.asWorker(async (client) => {
      const result = await client.query<JobRow>(
        `SELECT * FROM ai.agent_jobs WHERE tenant_id = $1 AND id = $2`,
        [tenantId, jobId],
      );
      const row = result.rows[0];
      return row ? mapJob(row) : undefined;
    });
  }

  async transition(
    jobId: string,
    expected: readonly AgentJobStatus[],
    next: AgentJobStatus,
    claimant?: string,
  ): Promise<boolean> {
    const result = await this.asWorker((client) =>
      client.query(
        `UPDATE ai.agent_jobs SET status = $3, updated_at = now()
         WHERE id = $1 AND status = ANY($2::text[])
           AND ($4::text IS NULL OR (claimed_by = $4 AND lease_expires_at > now()))`,
        [jobId, expected, next, claimant ?? null],
      ),
    );
    return (result.rowCount ?? 0) === 1;
  }

  async setResultReference(
    jobId: string,
    reference: string,
    claimant?: string,
  ): Promise<void> {
    await this.asWorker((client) =>
      client.query(
        `UPDATE ai.agent_jobs
         SET result_reference = $2, updated_at = now()
         WHERE id = $1 AND ($3::text IS NULL OR (claimed_by = $3 AND lease_expires_at > now() AND status IN ('claimed', 'starting', 'running')))`,
        [jobId, reference, claimant ?? null],
      ),
    );
  }

  async setSessionId(
    jobId: string,
    sessionId: string,
    claimant?: string,
  ): Promise<void> {
    await this.asWorker((client) =>
      client.query(
        `UPDATE ai.agent_jobs
         SET session_id = $2, updated_at = now()
         WHERE id = $1 AND ($3::text IS NULL OR (claimed_by = $3 AND lease_expires_at > now() AND status IN ('claimed', 'starting', 'running')))`,
        [jobId, sessionId, claimant ?? null],
      ),
    );
  }

  // The event row takes its tenant from the job it belongs to; the composite
  // (tenant_id, job_id) foreign key keeps the two from ever disagreeing.
  async appendEvent(
    jobId: string,
    event: AgentEvent,
    claimant?: string,
  ): Promise<PersistedAgentEvent> {
    return this.asWorker(async (client) => {
      const inserted = await client.query<{
        sequence: number;
        created_at: Date;
        execution_id: string;
        claimed_by: string | null;
      }>(
        `WITH job AS (
           UPDATE ai.agent_jobs SET
             next_event_sequence = next_event_sequence + 1,
             updated_at = now()
           WHERE id = $1 AND ($3::text IS NULL OR (claimed_by = $3 AND lease_expires_at > now() AND status IN ('claimed', 'starting', 'running')))
           RETURNING tenant_id, execution_id, claimed_by,
             next_event_sequence - 1 AS sequence
         ), appended AS (
           INSERT INTO ai.agent_job_events
             (tenant_id, job_id, sequence, execution_id, attempt_id, event)
           SELECT tenant_id, $1, sequence, execution_id, claimed_by, $2 FROM job
         )
         -- The worker may append events but never read them back, so the
         -- result comes from the job row; created_at defaults to now().
         SELECT sequence, execution_id, claimed_by, now() AS created_at FROM job`,
        [jobId, event, claimant ?? null],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error("Agent job was not found.");
      return {
        jobId,
        sequence: row.sequence,
        executionId: row.execution_id,
        attemptId: row.claimed_by,
        event,
        createdAt: row.created_at,
      };
    });
  }

  async finalize(
    jobId: string,
    expected: readonly AgentJobStatus[],
    next: AgentJobStatus,
    event: Extract<
      AgentEvent,
      { type: "completed" | "failed" | "awaiting-input" }
    >,
    claimant: string,
    resultReference?: string,
  ): Promise<boolean> {
    return this.asWorker(async (client) => {
      const updated = await client.query<{
        tenant_id: string;
        sequence: number;
        execution_id: string;
        claimed_by: string;
      }>(
        `UPDATE ai.agent_jobs SET
           status = $3,
           result_reference = COALESCE($5, result_reference),
           next_event_sequence = next_event_sequence + 1,
           updated_at = now()
         WHERE id = $1 AND status = ANY($2::text[])
           AND claimed_by = $4 AND lease_expires_at > now()
         RETURNING tenant_id, execution_id, claimed_by,
           next_event_sequence - 1 AS sequence`,
        [jobId, expected, next, claimant, resultReference ?? null],
      );
      const row = updated.rows[0];
      if (!row) return false;
      await client.query(
        `INSERT INTO ai.agent_job_events
           (tenant_id, job_id, sequence, execution_id, attempt_id, event)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          row.tenant_id,
          jobId,
          row.sequence,
          row.execution_id,
          row.claimed_by,
          event,
        ],
      );
      return true;
    });
  }
}
