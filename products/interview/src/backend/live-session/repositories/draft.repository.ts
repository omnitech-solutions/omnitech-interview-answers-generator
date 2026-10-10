// Persistence of the session-owned Workspace draft's row lock and its purge.
// Raw: the draft table belongs to the assistant workspace, and the purge runs on
// the purge transaction's own string-query client. No decisions here.
import type { TenantDatabase } from "@omnitech/database";
import { sql } from "drizzle-orm";
import { firstRow } from "../scope";

// Locks the draft row (if any) and reads its revision.
export async function lockDraftRevision(
  tx: TenantDatabase,
  key: {
    tenantId: string;
    actorId: string;
    productId: string;
    workspaceId: string;
    artifactId: string;
  },
): Promise<{ revision: string | number } | undefined> {
  return firstRow<{ revision: string | number }>(
    tx,
    sql`SELECT revision FROM interview.assistant_drafts
        WHERE tenant_id = ${key.tenantId}
          AND actor_id = ${key.actorId}
          AND product_id = ${key.productId}
          AND workspace_id = ${key.workspaceId}
          AND artifact_id = ${key.artifactId}
        FOR UPDATE`,
  );
}

// Deletes the session's own untouched drafts; returns how many went.
export async function deleteSessionOwnedDrafts(
  client: {
    query(
      text: string,
      values?: unknown[],
    ): Promise<{ rowCount: number | null }>;
  },
  values: {
    tenantId: string;
    ownerUserId: string;
    productId: string;
    workspaceId: string;
    proposalId: string;
    sessionId: string;
    actionKind: string;
  },
): Promise<number> {
  const result = await client.query(
    `DELETE FROM interview.assistant_drafts d
     WHERE d.tenant_id = $1 AND d.actor_id = $2 AND d.product_id = $3
       AND d.workspace_id = $4
       AND starts_with(COALESCE(d.provenance->>'proposalId', ''), $5)
       AND d.revision = (
         SELECT max((a.result->'workspace'->>'artifactRevision')::int)
         FROM interview.session_actions a
         WHERE a.tenant_id = $1::uuid AND a.owner_user_id = $2::uuid
           AND a.session_id = $6::uuid
           AND a.action_kind = $7
           AND a.dispatch_status = 'succeeded'
           AND a.result->'workspace'->>'published' = 'true'
           AND 'coding:' || a.task_id = d.artifact_id)
       AND NOT EXISTS (
         SELECT 1 FROM interview.assistant_answer_revisions r
         WHERE r.tenant_id = d.tenant_id AND r.actor_id = d.actor_id
           AND r.product_id = d.product_id AND r.workspace_id = d.workspace_id
           AND r.artifact_id = d.artifact_id)
       AND NOT EXISTS (
         SELECT 1 FROM interview.assistant_reverts v
         WHERE v.tenant_id = d.tenant_id AND v.actor_id = d.actor_id
           AND v.product_id = d.product_id AND v.workspace_id = d.workspace_id
           AND v.artifact_id = d.artifact_id)`,
    [
      values.tenantId,
      values.ownerUserId,
      values.productId,
      values.workspaceId,
      values.proposalId,
      values.sessionId,
      values.actionKind,
    ],
  );
  return result.rowCount ?? 0;
}
