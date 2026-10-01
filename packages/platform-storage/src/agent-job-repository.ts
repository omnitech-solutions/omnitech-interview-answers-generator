import type {
  AgentJob,
  AgentJobRepository,
  CreateAgentJob,
  PersistedAgentEvent,
} from "@omnitech/agent-job-service";
import type {
  AgentEvent,
  AgentJobStatus,
  AgentProfile,
} from "@omnitech/agent-runtime-contracts";
import { ConnectedAccountVault } from "./connected-account-vault.js";
import type { PlatformDatabase } from "./database.js";

type JobRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  product_id: string;
  status: AgentJobStatus;
  profile_snapshot: AgentProfile;
  prompt_reference: string;
  result_reference: string | null;
  session_id: string | null;
  claimed_by: string | null;
  lease_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapJob(row: JobRow): AgentJob {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    productId: row.product_id,
    status: row.status,
    profile: row.profile_snapshot,
    promptReference: row.prompt_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.result_reference === null
      ? {}
      : { resultReference: row.result_reference }),
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    ...(row.claimed_by === null ? {} : { claimedBy: row.claimed_by }),
    ...(row.lease_expires_at === null
      ? {}
      : { leaseExpiresAt: row.lease_expires_at }),
  };
}

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

  async claim(
    workerId: string,
    leaseMs: number,
  ): Promise<AgentJob | undefined> {
    return this.database.transaction(async (client) => {
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

  async transition(
    jobId: string,
    expected: readonly AgentJobStatus[],
    next: AgentJobStatus,
  ): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE ai.agent_jobs SET status = $3, updated_at = now()
       WHERE id = $1 AND status = ANY($2::text[])`,
      [jobId, expected, next],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async setResultReference(jobId: string, reference: string): Promise<void> {
    await this.database.query(
      `UPDATE ai.agent_jobs
       SET result_reference = $2, updated_at = now()
       WHERE id = $1`,
      [jobId, reference],
    );
  }

  async setSessionId(jobId: string, sessionId: string): Promise<void> {
    await this.database.query(
      `UPDATE ai.agent_jobs
       SET session_id = $2, updated_at = now()
       WHERE id = $1`,
      [jobId, sessionId],
    );
  }

  async appendEvent(
    jobId: string,
    event: AgentEvent,
  ): Promise<PersistedAgentEvent> {
    return this.database.transaction(async (client) => {
      const sequence = await client.query<{ sequence: number }>(
        `UPDATE ai.agent_jobs SET
           next_event_sequence = next_event_sequence + 1,
           updated_at = now()
         WHERE id = $1
         RETURNING next_event_sequence - 1 AS sequence`,
        [jobId],
      );
      const value = sequence.rows[0]?.sequence;
      if (!value) throw new Error("Agent job was not found.");
      const inserted = await client.query<{ created_at: Date }>(
        `INSERT INTO ai.agent_job_events (job_id, sequence, event)
         VALUES ($1, $2, $3)
         RETURNING created_at`,
        [jobId, value, event],
      );
      return {
        jobId,
        sequence: value,
        event,
        createdAt: inserted.rows[0]?.created_at ?? new Date(),
      };
    });
  }

  async eventsAfter(
    jobId: string,
    sequence: number,
  ): Promise<PersistedAgentEvent[]> {
    const result = await this.database.query<{
      sequence: number;
      event: AgentEvent;
      created_at: Date;
    }>(
      `SELECT sequence, event, created_at
       FROM ai.agent_job_events
       WHERE job_id = $1 AND sequence > $2
       ORDER BY sequence`,
      [jobId, sequence],
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

  async load(reference: string): Promise<string> {
    const result = await this.database.query<{ ciphertext: unknown }>(
      `SELECT ciphertext FROM ai.agent_job_payloads
       WHERE reference = $1 AND expires_at > now()
       LIMIT 1`,
      [reference],
    );
    const ciphertext = result.rows[0]?.ciphertext;
    if (!ciphertext) throw new Error("Agent job payload is unavailable.");
    return this.vault.decrypt(ciphertext);
  }

  async remove(reference: string): Promise<void> {
    await this.database.query(
      `DELETE FROM ai.agent_job_payloads WHERE reference = $1`,
      [reference],
    );
  }
}
