// What the Studio Live setup screen needs to start a session, and nothing
// else: the owner's candidacies and interviews (the same links confirmLinks in
// repository.ts authorizes at start) and the owner's approved candidate-profile
// revisions. Every query repeats confirmLinks' ownership predicate, so a choice
// offered here is a choice a start is not refused for. Titles, labels, dates
// and counts only: no matrix text, notes, job description or research.
import type { PlatformDatabase } from "@omnitech/database";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile.js";
import { inOwnerScope, type OwnerScope, rowsOf } from "./scope.js";

const MAX_CANDIDACIES = 50;
const MAX_INTERVIEWS_PER_CANDIDACY = 20;
const MAX_PROFILE_REVISIONS = 50;

export type InterviewChoice = {
  id: string;
  label: string;
  kind: string;
  scheduledAt: string | null;
};
export type CandidacyChoice = {
  id: string;
  title: string;
  companyName: string;
  createdAt: string;
  interviews: InterviewChoice[];
};
export type ProfileChoice = {
  profileId: string;
  name: string;
  revision: number;
  createdAt: string;
  // The number of roles in the revision's matrix.
  entryCount: number;
  latest: boolean;
};
export type SessionChoices = {
  candidacies: CandidacyChoice[];
  profiles: ProfileChoice[];
};

const iso = (value: unknown): string => new Date(value as string).toISOString();

export async function getSessionChoices(
  database: PlatformDatabase,
  scope: OwnerScope,
): Promise<SessionChoices> {
  return inOwnerScope(database, scope, async (tx) => {
    // [GUARD] A candidacy is the owner's only through member_people, the same
    // join the start's link check uses.
    const candidacyRows = await rowsOf<Record<string, unknown>>(
      tx,
      sql`SELECT c.id, c.title, c.created_at, co.name AS company_name
          FROM interview.candidacies c
          JOIN interview.member_people mp
            ON mp.tenant_id = c.tenant_id AND mp.person_id = c.candidate_person_id
          JOIN interview.companies co
            ON co.tenant_id = c.tenant_id AND co.id = c.company_id
          WHERE c.tenant_id = ${scope.tenantId}::uuid
            AND mp.user_id = ${scope.actorId}::uuid
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT ${MAX_CANDIDACIES}`,
    );
    const candidacyIds = candidacyRows.map((row) => String(row["id"]));
    const interviewRows =
      candidacyIds.length === 0
        ? []
        : await rowsOf<Record<string, unknown>>(
            tx,
            sql`SELECT i.id, i.candidacy_id, i.label, i.kind, i.scheduled_at
                FROM interview.interviews i
                WHERE i.tenant_id = ${scope.tenantId}::uuid
                  AND i.candidacy_id IN (${sql.join(
                    candidacyIds.map((id) => sql`${id}::uuid`),
                    sql`, `,
                  )})
                ORDER BY i.candidacy_id, i.ordinal
                LIMIT ${MAX_CANDIDACIES * MAX_INTERVIEWS_PER_CANDIDACY}`,
          );
    const interviewsByCandidacy = new Map<string, InterviewChoice[]>();
    for (const row of interviewRows) {
      const list = interviewsByCandidacy.get(String(row["candidacy_id"])) ?? [];
      list.push({
        id: String(row["id"]),
        label: String(row["label"]),
        kind: String(row["kind"]),
        scheduledAt: row["scheduled_at"] ? iso(row["scheduled_at"]) : null,
      });
      interviewsByCandidacy.set(String(row["candidacy_id"]), list);
    }

    // Approved revisions of the owner's profiles that are not revoked, the
    // ones a start may pin. The matrix is reduced to a count in the database.
    const profileRows = await rowsOf<Record<string, unknown>>(
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
          LIMIT ${MAX_PROFILE_REVISIONS}`,
    );

    return {
      candidacies: candidacyRows.map((row) => ({
        id: String(row["id"]),
        title: String(row["title"]),
        companyName: String(row["company_name"]),
        createdAt: iso(row["created_at"]),
        interviews: interviewsByCandidacy.get(String(row["id"])) ?? [],
      })),
      profiles: profileRows.map((row) => ({
        profileId: String(row["id"]),
        name: String(row["name"]),
        revision: Number(row["revision"]),
        createdAt: iso(row["created_at"]),
        entryCount: Number(row["entry_count"]),
        latest: Number(row["revision"]) === Number(row["current_revision"]),
      })),
    };
  });
}
