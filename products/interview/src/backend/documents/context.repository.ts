import type { PlatformDatabase } from "@omnitech/database";
import { withTenant } from "@omnitech/database";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";

type Row = Record<string, unknown>;

export type DocumentContextRows = {
  profile: Row | undefined;
  candidacy: Row | undefined;
  interview: Row | undefined;
};

// One transaction. `onProfile` runs after the profile read and
// `onCandidacy` after the candidacy read, so a missing row stops the later
// reads exactly as before (they throw from the caller's check).
export async function readDocumentContextRows(
  database: PlatformDatabase,
  input: {
    tenantId: string;
    actorId: string;
    profileId: string;
    profileRevision: number;
    candidacyId: string | null;
    interviewId: string | null;
  },
  checks: {
    profile: (row: Row | undefined) => void;
    candidacy: (row: Row | undefined) => void;
    interview: (row: Row | undefined) => void;
  },
): Promise<DocumentContextRows> {
  return withTenant(
    {
      tenantId: input.tenantId,
      actorId: input.actorId,
      productId: INTERVIEW_PRODUCT_ID,
    },
    async (db) => {
      const profile = (
        await db.execute(sql`
          SELECT r.matrix, r.sha256 FROM interview.candidate_profile_revisions r
          JOIN interview.candidate_profiles p
            ON (p.tenant_id, p.actor_id, p.product_id, p.id)
             = (r.tenant_id, r.actor_id, r.product_id, r.id)
          WHERE r.tenant_id=${input.tenantId} AND r.actor_id=${input.actorId}
            AND r.product_id=${INTERVIEW_PRODUCT_ID} AND r.id=${input.profileId}
            AND r.revision=${input.profileRevision} AND p.revoked_at IS NULL
        `)
      ).rows[0];
      checks.profile(profile);

      let candidacy: Row | undefined;
      if (input.candidacyId) {
        candidacy = (
          await db.execute(sql`
            SELECT c.title, c.job_description, co.name AS company_name
            FROM interview.candidacies c
            JOIN interview.member_people mp
              ON mp.tenant_id=c.tenant_id AND mp.person_id=c.candidate_person_id
            JOIN interview.companies co
              ON co.tenant_id=c.tenant_id AND co.id=c.company_id
            WHERE c.tenant_id=${input.tenantId}::uuid
              AND c.id=${input.candidacyId}::uuid
              AND mp.user_id=${input.actorId}::uuid
          `)
        ).rows[0];
        checks.candidacy(candidacy);
      }

      let interview: Row | undefined;
      if (input.interviewId && input.candidacyId) {
        interview = (
          await db.execute(sql`
            SELECT kind, label FROM interview.interviews
            WHERE tenant_id=${input.tenantId}::uuid
              AND id=${input.interviewId}::uuid
              AND candidacy_id=${input.candidacyId}::uuid
          `)
        ).rows[0];
        checks.interview(interview);
      }
      return { profile, candidacy, interview };
    },
    { database },
  );
}
