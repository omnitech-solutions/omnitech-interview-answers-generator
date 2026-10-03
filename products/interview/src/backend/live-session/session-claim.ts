// The worker's cross-tenant claim of Active Sessions. This is the one file that
// sets app.session_worker (rule:session-claim-setting; scripts/tenant-context-
// boundary.test.ts). Under it the database admits SELECT of every session and
// permits changing only lease and fence columns
// (rule:claim-writes-lease-and-fence-only), and the claim port projects ids
// only: tenant, owner and session id, plus the fence the holder was granted (a
// lease token, not content). After the claim the worker acts as the owner only
// in a separate actor-scoped transaction (rule:tenant-scoped-worker-access).
import type { DatabaseClient, PlatformDatabase } from "@omnitech/database";
import { type Lease, renewLease as renewLeaseDecision } from "./core/index.js";

// [SAFETY] The explicit claim projection. It is read from the
// interview.active_session_claims view, which omits credential_hash, the
// sources snapshot, the links and the rehearsal fields, and this list names no
// column beyond it. A test pins both.
export const CLAIM_COLUMNS = [
  "id",
  "tenant_id",
  "owner_user_id",
  "status",
  "processing_policy",
  "retention_mode",
  "fence",
  "lease_holder_id",
  "lease_expires_at",
  "expires_at",
  "last_heartbeat_at",
  "credential_expires_at",
  "credential_revoked_at",
  "ended_at",
  "purge_started_at",
  "purged_at",
] as const;

export const CLAIM_SELECT = `SELECT ${CLAIM_COLUMNS.join(", ")} FROM interview.active_session_claims`;

// Thirty days from end (rule:retention-modes).
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Runs `work` in a transaction with the claim setting on. The setting is
// transaction-local, so a pooled connection never carries it away. The worker
// acts as the owner only afterwards, in a separate actor-scoped transaction.
export function asSessionWorker<Result>(
  database: PlatformDatabase,
  work: (client: DatabaseClient) => Promise<Result>,
): Promise<Result> {
  return database.transaction(async (client) => {
    await client.query("SELECT set_config('app.session_worker', 'on', true)");
    return work(client);
  });
}

export type SessionTarget = {
  tenantId: string;
  ownerUserId: string;
  sessionId: string;
};
// The holder's lease token: the fence its acquire produced.
export type SessionClaim = SessionTarget & { fence: number };

type Row = { tenant_id: string; owner_user_id: string; id: string };
const target = (row: Row): SessionTarget => ({
  tenantId: row.tenant_id,
  ownerUserId: row.owner_user_id,
  sessionId: row.id,
});

// Claims up to `limit` active sessions whose lease is free or expired. Acquiring
// raises the session's fence, so a restarted worker outranks its earlier self
// (ADR-0010 Fencing); `includeOwnLive` lets a restarted worker re-acquire the
// live leases its previous process still holds under the same id.
export function claimSessions(
  database: PlatformDatabase,
  workerId: string,
  leaseMs: number,
  limit: number,
  options: { includeOwnLive?: boolean } = {},
): Promise<SessionClaim[]> {
  return asSessionWorker(database, async (client) => {
    const result = await client.query<Row & { fence: string | number }>(
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
      [workerId, leaseMs, Math.max(0, limit), options.includeOwnLive === true],
    );
    return result.rows.map((row) => ({
      ...target(row),
      fence: Number(row.fence),
    }));
  });
}

export type LeaseRenewal =
  | { renewed: true }
  | { renewed: false; reason: "fence_superseded" | "not_holder" | "expired" };

// Renews the lease the claim granted, keeping its fence. It fails when a newer
// fence exists (the holder has been succeeded and must stop), when the caller
// is not the holder, or when the lease already expired.
export function renewLease(
  database: PlatformDatabase,
  claim: SessionClaim,
  workerId: string,
  leaseMs: number,
): Promise<LeaseRenewal> {
  return asSessionWorker(database, async (client) => {
    const current = await client.query<{
      fence: string | number;
      lease_holder_id: string | null;
      lease_expires_at: Date | null;
      now_ms: number;
    }>(
      `SELECT fence, lease_holder_id, lease_expires_at,
              (extract(epoch from now()) * 1000)::float8 AS now_ms
       FROM interview.active_sessions
       WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3
       FOR UPDATE`,
      [claim.tenantId, claim.ownerUserId, claim.sessionId],
    );
    const row = current.rows[0];
    if (!row) return { renewed: false, reason: "fence_superseded" };
    const lease: Lease = {
      fence: Number(row.fence),
      holderId: row.lease_holder_id,
      expiresAtMs: row.lease_expires_at
        ? new Date(row.lease_expires_at).getTime()
        : null,
    };
    const decision = renewLeaseDecision(
      lease,
      workerId,
      claim.fence,
      Number(row.now_ms),
      leaseMs,
    );
    if (!decision.renewed) return { renewed: false, reason: decision.reason };
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
    return { renewed: true };
  });
}

// Releases the lease, keeping the fence (it never falls). Only the holder at
// that fence can release; a stale holder releases nothing.
export function releaseLease(
  database: PlatformDatabase,
  claim: SessionClaim,
  workerId: string,
): Promise<boolean> {
  return asSessionWorker(database, async (client) => {
    const result = await client.query(
      `UPDATE interview.active_sessions
       SET lease_holder_id = NULL, lease_expires_at = NULL
       WHERE tenant_id = $1 AND owner_user_id = $2 AND id = $3
         AND fence = $4 AND lease_holder_id = $5`,
      [
        claim.tenantId,
        claim.ownerUserId,
        claim.sessionId,
        claim.fence,
        workerId,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  });
}

// Purge sweeps find sessions through the same claim path and receive ids only:
// a purge that crashed (purging), an ended session that deletes at end, and an
// ended session thirty days past its end. The purge is idempotent, so two
// sweepers racing is safe.
export function claimPurgeCandidates(
  database: PlatformDatabase,
  limit: number,
): Promise<SessionTarget[]> {
  return asSessionWorker(database, async (client) => {
    const result = await client.query<Row>(
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
      [Math.max(0, limit), THIRTY_DAYS_MS],
    );
    return result.rows.map(target);
  });
}

// Sessions past their duration cap that are still open: the sweep ends them
// (actor duration-cap), whether or not anything is ingesting.
export function claimCapExpired(
  database: PlatformDatabase,
  limit: number,
): Promise<SessionTarget[]> {
  return asSessionWorker(database, async (client) => {
    const result = await client.query<Row>(
      `SELECT tenant_id, owner_user_id, id
       FROM interview.active_session_claims
       WHERE status IN ('created', 'active', 'paused')
         AND purged_at IS NULL AND expires_at <= now()
       ORDER BY expires_at, id
       LIMIT $1`,
      [Math.max(0, limit)],
    );
    return result.rows.map(target);
  });
}
