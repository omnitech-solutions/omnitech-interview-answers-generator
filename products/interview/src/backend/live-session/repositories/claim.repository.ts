// Every statement of the worker's cross-tenant claim and lease. Raw
// parameterised SQL moved verbatim from session-claim.ts: the SKIP LOCKED claim
// and the lease writes are PostgreSQL-specific and cross-tenant, so none is
// rewritten in the builder. The caller (session-claim.ts) sets
// app.session_worker and owns the transaction; these functions make no
// decision, throw nothing and log nothing.
import type { DatabaseClient } from "@omnitech/database";

export type ClaimRow = {
  tenant_id: string;
  owner_user_id: string;
  id: string;
};

export type LeaseRow = {
  fence: string | number;
  lease_holder_id: string | null;
  lease_expires_at: Date | null;
  now_ms: number;
};

type Target = { tenantId: string; ownerUserId: string; sessionId: string };

// Raises the fence and takes the lease of up to `limit` free or expired
// sessions, skipping rows another claimer holds locked.
export async function acquireLeases(
  client: DatabaseClient,
  workerId: string,
  leaseMs: number,
  limit: number,
  includeOwnLive: boolean,
): Promise<(ClaimRow & { fence: string | number })[]> {
  const result = await client.query<ClaimRow & { fence: string | number }>(
    `UPDATE interview.active_sessions s SET
         fence = s.fence + 1,
         lease_holder_id = $1,
         lease_expires_at = now() + ($2 * interval '1 millisecond')
       FROM (
         SELECT id FROM interview.active_session_claims
         WHERE status = 'active' AND purged_at IS NULL
           AND (lease_holder_id IS NULL OR lease_expires_at IS NULL
                OR lease_expires_at <= now()
                OR ($4::boolean AND lease_holder_id = $1))
         ORDER BY lease_expires_at NULLS FIRST, id
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       ) c
       WHERE s.id = c.id
       RETURNING s.tenant_id, s.owner_user_id, s.id, s.fence`,
    [workerId, leaseMs, Math.max(0, limit), includeOwnLive],
  );
  return result.rows;
}

// Locks the session row and reads its lease with the database clock.
export async function lockLease(
  client: DatabaseClient,
  claim: Target,
): Promise<LeaseRow | undefined> {
  const current = await client.query<LeaseRow>(
    `SELECT fence, lease_holder_id, lease_expires_at,
              (extract(epoch from now()) * 1000)::float8 AS now_ms
       FROM interview.active_sessions
       WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3
       FOR UPDATE`,
    [claim.tenantId, claim.ownerUserId, claim.sessionId],
  );
  return current.rows[0];
}

export async function extendLease(
  client: DatabaseClient,
  claim: Target & { fence: number },
  workerId: string,
  leaseMs: number,
): Promise<void> {
  await client.query(
    `UPDATE interview.active_sessions
       SET lease_expires_at = now() + ($4 * interval '1 millisecond')
       WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3
         AND fence = $5 AND lease_holder_id = $6`,
    [
      claim.tenantId,
      claim.ownerUserId,
      claim.sessionId,
      leaseMs,
      claim.fence,
      workerId,
    ],
  );
}

// True when the holder at that fence released its lease.
export async function clearLease(
  client: DatabaseClient,
  claim: Target & { fence: number },
  workerId: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE interview.active_sessions
       SET lease_holder_id = NULL, lease_expires_at = NULL
       WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3
         AND fence = $4 AND lease_holder_id = $5`,
    [claim.tenantId, claim.ownerUserId, claim.sessionId, claim.fence, workerId],
  );
  return (result.rowCount ?? 0) === 1;
}

export async function selectPurgeCandidates(
  client: DatabaseClient,
  limit: number,
  thirtyDaysMs: number,
): Promise<ClaimRow[]> {
  const result = await client.query<ClaimRow>(
    `SELECT tenant_id, owner_user_id, id
       FROM interview.active_session_claims
       WHERE purged_at IS NULL
         AND (status = 'purging'
              OR (status = 'ended'
                  AND (retention_mode = 'delete_at_end'
                       OR (retention_mode = 'thirty_days'
                           AND ended_at <= now() - ($2 * interval '1 millisecond')))))
       ORDER BY ended_at NULLS FIRST, id
       LIMIT $1`,
    [Math.max(0, limit), thirtyDaysMs],
  );
  return result.rows;
}

export async function selectCapExpired(
  client: DatabaseClient,
  limit: number,
): Promise<ClaimRow[]> {
  const result = await client.query<ClaimRow>(
    `SELECT tenant_id, owner_user_id, id
       FROM interview.active_session_claims
       WHERE status IN ('created', 'active', 'paused')
         AND purged_at IS NULL AND expires_at <= now()
       ORDER BY expires_at, id
       LIMIT $1`,
    [Math.max(0, limit)],
  );
  return result.rows;
}
