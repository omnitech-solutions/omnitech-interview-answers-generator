import type {
  AgentJob,
  AgentJobRepository,
  CreateAgentJob,
  PersistedAgentEvent,
} from "@omnitech/agent-job-service";
import type { AgentEvent } from "@omnitech/agent-runtime-contracts";
import type { PlatformDatabase } from "@omnitech/database";
import { type JobRow, mapJob } from "./agent-job-row.js";
import { ConnectedAccountVault } from "./connected-account-vault.js";

// A member's jobs: every read and write runs inside the job's tenant.
export class PostgresAgentJobRepository implements AgentJobRepository {
  constructor(private readonly database: PlatformDatabase) {}

  async create(input: CreateAgentJob): Promise<AgentJob> {
    const result = await this.database.tenantTransaction(
      input.tenantId,
      (client) =>
        client.query<JobRow>(
          `INSERT INTO ai.agent_jobs
             (tenant_id, user_id, product_id, status, profile_snapshot,
              prompt_reference)
           VALUES ($1, $2, $3, 'queued', $4, $5)
           RETURNING *`,
          [
            input.tenantId,
            input.userId,
            input.productId,
            input.profile,
            input.promptReference,
          ],
        ),
    );
    const row = result.rows[0];
    if (!row) throw new Error("Agent job creation failed.");
    return mapJob(row);
  }

  async get(tenantId: string, jobId: string): Promise<AgentJob | undefined> {
    return this.database.tenantTransaction(tenantId, async (client) => {
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
    jobId: string,
    sequence: number,
  ): Promise<PersistedAgentEvent[]> {
    const result = await this.database.tenantTransaction(tenantId, (client) =>
      client.query<{
        sequence: number;
        event: AgentEvent;
        created_at: Date;
      }>(
        `SELECT sequence, event, created_at
         FROM ai.agent_job_events
         WHERE tenant_id = $1 AND job_id = $2 AND sequence > $3
         ORDER BY sequence`,
        [tenantId, jobId, sequence],
      ),
    );
    return result.rows.map((row) => ({
      jobId,
      sequence: row.sequence,
      event: row.event,
      createdAt: row.created_at,
    }));
  }

  async requestCancellation(tenantId: string, jobId: string): Promise<boolean> {
    return this.database.tenantTransaction(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE ai.agent_jobs SET status = 'cancelling', updated_at = now()
         WHERE tenant_id = $1 AND id = $2
           AND status IN ('queued', 'claimed', 'starting', 'running',
             'awaiting-input')`,
        [tenantId, jobId],
      );
      return (result.rowCount ?? 0) === 1;
    });
  }

  async requestResume(
    tenantId: string,
    jobId: string,
    promptReference: string,
  ): Promise<boolean> {
    return this.database.tenantTransaction(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE ai.agent_jobs SET
           status = 'queued', prompt_reference = $3,
           result_reference = NULL, updated_at = now()
         WHERE tenant_id = $1 AND id = $2
           AND status IN ('awaiting-input', 'failed', 'cancelled')
           AND session_id IS NOT NULL`,
        [tenantId, jobId, promptReference],
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
