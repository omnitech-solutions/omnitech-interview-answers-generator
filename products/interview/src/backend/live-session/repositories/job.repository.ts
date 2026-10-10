// Persistence of the link from a session to its agent jobs: the actions that
// name a job. No decisions here.
import type { TenantDatabase } from "@omnitech/database";
import { sql } from "drizzle-orm";
import { type OwnerScope, rowsOf } from "../scope";

export type NamedJobRow = { jobId: string; created: boolean };

// The jobs the session's actions name (raw, moved verbatim).
export async function listNamedJobs(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<NamedJobRow[]> {
  const rows = await rowsOf<{ job_id: string; job_created: boolean }>(
    tx,
    sql`SELECT job_id, job_created FROM interview.session_actions
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND owner_user_id = ${scope.actorId}::uuid
          AND session_id = ${sessionId}::uuid AND job_id IS NOT NULL`,
  );
  return rows.map((row) => ({ jobId: row.job_id, created: row.job_created }));
}
