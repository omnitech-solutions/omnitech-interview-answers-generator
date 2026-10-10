// Reads of a session's approved context: the pinned profile revision, the
// linked candidacy with its company, and the linked briefing draft. No
// decisions here; the use case validates and assembles. Raw, moved verbatim.
import type { TenantDatabase } from "@omnitech/database";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../../assistant-profile";
import { firstRow, type OwnerScope } from "../scope";

// The pinned profile revision's matrix and hash; undefined when unreadable or
// the profile is revoked.
export function readPinnedProfileRevision(
  tx: TenantDatabase,
  scope: OwnerScope,
  profileId: string,
  profileRevision: number,
): Promise<{ matrix: unknown; sha256: string } | undefined> {
  return firstRow<{ matrix: unknown; sha256: string }>(
    tx,
    sql`SELECT r.matrix, r.sha256
        FROM interview.candidate_profile_revisions r
        JOIN interview.candidate_profiles p
          ON (p.tenant_id, p.actor_id, p.product_id, p.id)
           = (r.tenant_id, r.actor_id, r.product_id, r.id)
        WHERE r.tenant_id = ${scope.tenantId}
          AND r.actor_id = ${scope.actorId}
          AND r.product_id = ${INTERVIEW_PRODUCT_ID}
          AND r.id = ${profileId}
          AND r.revision = ${profileRevision}
          AND p.revoked_at IS NULL`,
  );
}

// The candidacy with its company's name and research.
export function readCandidacyWithCompany(
  tx: TenantDatabase,
  scope: OwnerScope,
  candidacyId: string,
): Promise<Record<string, unknown> | undefined> {
  return firstRow<Record<string, unknown>>(
    tx,
    sql`SELECT c.title, c.job_description, c.notes, c.employer_brief,
               co.name AS company_name, co.research AS company_research
        FROM interview.candidacies c
        JOIN interview.companies co
          ON co.tenant_id = c.tenant_id AND co.id = c.company_id
        WHERE c.tenant_id = ${scope.tenantId}::uuid
          AND c.id = ${candidacyId}::uuid`,
  );
}

// The owner's workspace draft: revision and value.
export function readWorkspaceDraft(
  tx: TenantDatabase,
  scope: OwnerScope,
  workspaceId: string,
  artifactId: string,
): Promise<{ revision: unknown; value: unknown } | undefined> {
  return firstRow<{ revision: unknown; value: unknown }>(
    tx,
    sql`SELECT revision, value FROM interview.assistant_drafts
        WHERE tenant_id = ${scope.tenantId}
          AND actor_id = ${scope.actorId}
          AND product_id = ${INTERVIEW_PRODUCT_ID}
          AND workspace_id = ${workspaceId}
          AND artifact_id = ${artifactId}`,
  );
}
