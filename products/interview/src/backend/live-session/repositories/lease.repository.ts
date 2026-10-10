// The lease and fence statements the job paths run on the session row. They
// take the job store's own string-query transaction (not a tenant handle), so
// they stay raw and verbatim. No decisions here: callers decide.
import type { TenantDatabase } from "@omnitech/database";
import { and, eq } from "drizzle-orm";
import { activeSessions } from "../../db/live-session";
import type { OwnerScope } from "../scope";

export type GuardTransaction = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

// Locks the session row for a job about to be created and reads its standing:
// status, policy, fence, holder, whether the lease is live, and whether an
// action of the session names the reserved job id.
export async function lockSessionForJob(
  transaction: GuardTransaction,
  scope: { tenantId: string; actorId: string },
  sessionId: string,
  jobId: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await transaction.query(
    `SELECT s.status, s.processing_policy, s.fence, s.lease_holder_id,
            (s.lease_expires_at IS NOT NULL AND s.lease_expires_at > now()) AS lease_live,
            EXISTS (
              SELECT 1 FROM interview.session_actions a
              WHERE a.tenant_id = s.tenant_id AND a.owner_user_id = s.owner_user_id
                AND a.session_id = s.id AND a.job_id = $4::uuid
            ) AS reserved
     FROM interview.active_sessions s
     WHERE s.tenant_id = $1::uuid AND s.owner_user_id = $2::uuid AND s.id = $3::uuid
     FOR UPDATE`,
    [scope.tenantId, scope.actorId, sessionId, jobId],
  );
  return result.rows[0];
}

// Locks the session that the action naming the job belongs to and reads its
// status and policy (the resume guard).
export async function lockSessionOfJob(
  transaction: GuardTransaction,
  tenantId: string,
  jobId: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await transaction.query(
    `SELECT s.status, s.processing_policy
     FROM interview.session_actions a
     JOIN interview.active_sessions s
       ON s.tenant_id = a.tenant_id AND s.owner_user_id = a.owner_user_id
      AND s.id = a.session_id
     WHERE a.tenant_id = $1::uuid AND a.job_id = $2::uuid
     FOR UPDATE OF s`,
    [tenantId, jobId],
  );
  return result.rows[0];
}

// The status and processing policy of the owner's session, as stored.
export async function readStanding(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<{ status: string; processing_policy: string } | undefined> {
  const rows = await tx
    .select({
      status: activeSessions.status,
      processing_policy: activeSessions.processingPolicy,
    })
    .from(activeSessions)
    .where(
      and(
        eq(activeSessions.tenantId, scope.tenantId),
        eq(activeSessions.ownerUserId, scope.actorId),
        eq(activeSessions.id, sessionId),
      ),
    );
  return rows[0];
}
