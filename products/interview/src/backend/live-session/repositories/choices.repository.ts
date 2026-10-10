// The Studio Live setup screen's reads: the owner's candidacies, their
// interviews, and the approved profile revisions a start may pin. Raw because
// of the composite-key row-value join and the jsonb array length.
import type { TenantDatabase } from "@omnitech/database";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../../assistant-profile";
import { type OwnerScope, rowsOf } from "../scope";

type Row = Record<string, unknown>;

// [GUARD] A candidacy is the owner's only through member_people, the same
// join the start's link check uses.
export function readCandidacyRows(
  tx: TenantDatabase,
  scope: OwnerScope,
  limit: number,
): Promise<Row[]> {
  return rowsOf<Row>(
    tx,
    sql`SELECT c.id, c.title, c.created_at, co.name AS company_name,
                 (c.job_description IS NOT NULL) AS has_job_spec,
                 (c.employer_brief IS NOT NULL) AS has_brief
          FROM interview.candidacies c
          JOIN interview.member_people mp
            ON mp.tenant_id = c.tenant_id AND mp.person_id = c.candidate_person_id
          JOIN interview.companies co
            ON co.tenant_id = c.tenant_id AND co.id = c.company_id
          WHERE c.tenant_id = ${scope.tenantId}::uuid
            AND mp.user_id = ${scope.actorId}::uuid
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT ${limit}`,
  );
}

export function readInterviewRows(
  tx: TenantDatabase,
  scope: OwnerScope,
  candidacyIds: string[],
  limit: number,
): Promise<Row[]> {
  return rowsOf<Row>(
    tx,
    sql`SELECT i.id, i.candidacy_id, i.label, i.kind, i.scheduled_at
                FROM interview.interviews i
                WHERE i.tenant_id = ${scope.tenantId}::uuid
                  AND i.candidacy_id IN (${sql.join(
                    candidacyIds.map((id) => sql`${id}::uuid`),
                    sql`, `,
                  )})
                ORDER BY i.candidacy_id, i.ordinal
                LIMIT ${limit}`,
  );
}

// Approved revisions of the owner's profiles that are not revoked, the ones a
// start may pin. The matrix is reduced to a count in the database.
export function readProfileRevisionRows(
  tx: TenantDatabase,
  scope: OwnerScope,
  limit: number,
): Promise<Row[]> {
  return rowsOf<Row>(
    tx,
    sql`SELECT r.id, r.name, r.revision, r.created_at,
                 p.revision AS current_revision,
                 CASE WHEN jsonb_typeof(r.matrix->'roles') = 'array'
                      THEN jsonb_array_length(r.matrix->'roles') ELSE 0 END
                   AS entry_count
          FROM interview.candidate_profile_revisions r
          JOIN interview.candidate_profiles p
            ON (p.tenant_id, p.actor_id, p.product_id, p.id)
             = (r.tenant_id, r.actor_id, r.product_id, r.id)
          WHERE r.tenant_id = ${scope.tenantId} AND r.actor_id = ${scope.actorId}
            AND r.product_id = ${INTERVIEW_PRODUCT_ID}
            AND p.revoked_at IS NULL
          ORDER BY r.created_at DESC, r.revision DESC, r.id
          LIMIT ${limit}`,
  );
}
