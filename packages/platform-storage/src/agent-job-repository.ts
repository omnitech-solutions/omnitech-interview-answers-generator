import type {
  AgentJob,
  AgentJobRepository,
  CancellationOutcome,
  CreateAgentJob,
  CreateJobOptions,
  JobActor,
  PersistedAgentEvent,
  ResumeJobOptions,
} from "@omnitech/agent-job-service";
import type { AgentEvent } from "@omnitech/agent-runtime-contracts";
import {
  type DatabaseClient,
  enterTenant,
  type PlatformDatabase,
} from "@omnitech/database";
import { type JobRow, mapJob } from "./agent-job-row.js";
import { ConnectedAccountVault } from "./connected-account-vault.js";

// A member's jobs: every read and write runs inside the job's tenant and as
// an explicit actor, so a private job (ADR-0012 Agent jobs) is visible only
// to its creator. A `null` actor is a caller with no user: it sees no private
// row. Lock order for a session job is the session row, then the job row.
export class PostgresAgentJobRepository implements AgentJobRepository {
  constructor(private readonly database: PlatformDatabase) {}

  // The transaction a request runs in: the tenant, plus the actor when there
  // is one. The settings are set by @omnitech/database (ADR-0005).
  private run<Result>(
    tenantId: string,
    actorId: JobActor,
    work: (client: DatabaseClient) => Promise<Result>,
  ): Promise<Result> {
    if (actorId === null)
      return this.database.tenantTransaction(tenantId, work);
    return this.database.transaction(async (client) => {
      await enterTenant(client, { tenantId, actorId });
      return work(client);
    });
  }

  // [SAFETY] The creating user is the actor, so the job row is the creator's
  // to read back. `private` marks a session job: this is the session dispatch
  // path, the one place that sets app.session_dispatch (the database refuses
  // a private job otherwise, and refuses changing the marker later), and it
  // sets it only after beforeInsert has run, so the hook cannot widen it. The
  // caller's beforeInsert runs in this same transaction, so it can lock the
  // session row and verify it is active before the insert. A repeated create
  // with the same id returns the existing job instead of a second row.
  async create(
    input: CreateAgentJob,
    options: CreateJobOptions = {},
  ): Promise<AgentJob> {
    return this.run(input.tenantId, input.userId, async (client) => {
      await options.beforeInsert?.(client);
      if (input.private) {
        await client.query(
          "SELECT set_config('app.session_dispatch', 'on', true)",
        );
      }
      const inserted = await client.query<JobRow>(
        `INSERT INTO ai.agent_jobs
           (id, tenant_id, user_id, product_id, status, profile_snapshot,
            prompt_reference, private)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, 'queued',
                 $5, $6, $7)
         ON CONFLICT (id) DO NOTHING
         RETURNING *`,
        [
          input.id ?? null,
          input.tenantId,
          input.userId,
          input.productId,
          input.profile,
          input.promptReference,
          input.private === true,
        ],
      );
      const created = inserted.rows[0];
      if (created) return mapJob(created);
      // Idempotent only for the same tenant, creator and marker; the actor
      // cannot read a row of another tenant or a private row of another user.
      const existing = await client.query<JobRow>(
        `SELECT * FROM ai.agent_jobs WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.id],
      );
      const row = existing.rows[0];
      if (
        !row ||
        row.user_id !== input.userId ||
        row.private !== (input.private === true)
      ) {
        throw new Error("Agent job id is already in use.");
      }
      return mapJob(row);
    });
  }

  async get(
    tenantId: string,
    actorId: JobActor,
    jobId: string,
  ): Promise<AgentJob | undefined> {
    return this.run(tenantId, actorId, async (client) => {
      const result = await client.query<JobRow>(
        `SELECT * FROM ai.agent_jobs WHERE tenant_id = $1 AND id = $2`,
        [tenantId, jobId],
      );
      const row = result.rows[0];
      return row ? mapJob(row) : undefined;
    });
  }

  async eventsAfter(
    tenantId: string,
    actorId: JobActor,
    jobId: string,
    sequence: number,
  ): Promise<PersistedAgentEvent[]> {
    const result = await this.run(tenantId, actorId, (client) =>
      client.query<{
        sequence: number;
        execution_id: string;
        attempt_id: string | null;
        event: AgentEvent;
        created_at: Date;
      }>(
        `SELECT sequence, execution_id, attempt_id, event, created_at
         FROM ai.agent_job_events
         WHERE tenant_id = $1 AND job_id = $2 AND sequence > $3
         ORDER BY sequence`,
        [tenantId, jobId, sequence],
      ),
    );
    return result.rows.map((row) => ({
      jobId,
      sequence: row.sequence,
      executionId: row.execution_id,
      attemptId: row.attempt_id,
      event: row.event,
      createdAt: row.created_at,
    }));
  }

  // [SAFETY] Fails closed: a job the actor cannot see reads as "not-found",
  // the same as a job that does not exist, and is never touched. A job that
  // is visible but already cancelling or finished counts as cancelled.
  async requestCancellation(
    tenantId: string,
    actorId: JobActor,
    jobId: string,
  ): Promise<CancellationOutcome> {
    return this.run(tenantId, actorId, async (client) => {
      const result = await client.query(
        `UPDATE ai.agent_jobs SET status = 'cancelling', updated_at = now()
         WHERE tenant_id = $1 AND id = $2
           AND status IN ('queued', 'claimed', 'starting', 'running',
             'awaiting-input')`,
        [tenantId, jobId],
      );
      if ((result.rowCount ?? 0) === 1) return "requested";
      const visible = await client.query(
        `SELECT 1 FROM ai.agent_jobs WHERE tenant_id = $1 AND id = $2`,
        [tenantId, jobId],
      );
      return visible.rows.length === 1 ? "already-ended" : "not-found";
    });
  }

  // The optional guard runs first, in this transaction, so a session job's
  // caller can take the session-row lock and verify the session is active
  // before the job row is touched (session row, then job row). A private
  // (session) job resumes only through such a guard: without one the update
  // matches no private row, so the generic resume path cannot revive a job
  // of an ended or paused session (ADR-0012 no-resume-after-end). Trust point:
  // the repository only checks that a guard was supplied, not what it checks;
  // the caller's guard is responsible for verifying the session is active.
  async requestResume(
    tenantId: string,
    actorId: JobActor,
    jobId: string,
    promptReference: string,
    options: ResumeJobOptions = {},
  ): Promise<boolean> {
    return this.run(tenantId, actorId, async (client) => {
      if (options.guard && !(await options.guard(client))) return false;
      const result = await client.query(
        `UPDATE ai.agent_jobs SET
           status = 'queued', prompt_reference = $3,
           result_reference = NULL,
           execution_id = CASE WHEN status = 'awaiting-input'
             THEN execution_id ELSE gen_random_uuid() END,
           session_id = CASE WHEN status = 'awaiting-input'
             THEN session_id ELSE NULL END,
           updated_at = now()
         WHERE tenant_id = $1 AND id = $2
           AND status IN ('awaiting-input', 'failed', 'cancelled')
           AND session_id IS NOT NULL
           AND (NOT private OR $4::boolean)`,
        [tenantId, jobId, promptReference, options.guard !== undefined],
      );
      return (result.rowCount ?? 0) === 1;
    });
  }
}

export class AgentPayloadStore {
  private readonly vault: ConnectedAccountVault;

  constructor(
    private readonly database: PlatformDatabase,
    secret: string,
  ) {
    this.vault = new ConnectedAccountVault(secret);
  }

  async save(
    tenantId: string,
    value: string,
    ttlMs = 86_400_000,
  ): Promise<string> {
    const reference = `agent-payload:${crypto.randomUUID()}`;
    await this.database.tenantTransaction(tenantId, async (client) => {
      await client.query(
        `INSERT INTO ai.agent_job_payloads
           (reference, tenant_id, ciphertext, expires_at)
         VALUES ($1, $2, $3, now() + ($4 * interval '1 millisecond'))`,
        [reference, tenantId, this.vault.encrypt(value), ttlMs],
      );
    });
    return reference;
  }

  // Removes one tenant's payload by reference (for a payload whose job was
  // never created). Another tenant's payload is invisible to the transaction.
  async delete(tenantId: string, reference: string): Promise<void> {
    await this.database.tenantTransaction(tenantId, async (client) => {
      await client.query(
        "DELETE FROM ai.agent_job_payloads WHERE tenant_id = $1 AND reference = $2",
        [tenantId, reference],
      );
    });
  }

  // The reference is an unguessable id and the only key the worker and a
  // job's poller hold, so the payload_reference_lookup policy admits a read
  // of exactly the payload the transaction names.
  async load(reference: string): Promise<string> {
    const result = await this.database.transaction(async (client) => {
      await client.query(
        "SELECT set_config('app.agent_payload_reference', $1, true)",
        [reference],
      );
      return client.query<{ ciphertext: unknown }>(
        `SELECT ciphertext FROM ai.agent_job_payloads
         WHERE reference = $1 AND expires_at > now()
         LIMIT 1`,
        [reference],
      );
    });
    const ciphertext = result.rows[0]?.ciphertext;
    if (!ciphertext) throw new Error("Agent job payload is unavailable.");
    return this.vault.decrypt(ciphertext);
  }
}
