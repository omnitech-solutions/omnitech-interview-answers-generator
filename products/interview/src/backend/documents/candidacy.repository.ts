import { type PlatformDatabase, withTenant } from "@omnitech/database";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import { readBrief } from "../brief/repository";

export type CandidacyScope = {
  tenantId: string;
  actorId: string;
  productId: typeof INTERVIEW_PRODUCT_ID;
};

export type InterviewStageInput = { kind: string; label: string };

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

// "Me" in this workspace: the person the member's applications belong to,
// created from their display name the first time they need one.
async function memberPerson(db: TenantDb, scope: CandidacyScope) {
  const found = (
    await db.execute(sql`SELECT person_id FROM interview.member_people
      WHERE tenant_id=${scope.tenantId}::uuid AND user_id=${scope.actorId}::uuid`)
  ).rows[0];
  if (found) return String(found["person_id"]);
  const name =
    (
      await db.execute(
        sql`SELECT display_name FROM platform.users WHERE id=${scope.actorId}::uuid`,
      )
    ).rows[0]?.["display_name"] ?? "Me";
  const personId = String(
    (
      await db.execute(sql`INSERT INTO interview.people(tenant_id,full_name)
        VALUES (${scope.tenantId}::uuid, ${String(name)}) RETURNING id`)
    ).rows[0]?.["id"],
  );
  await db.execute(sql`INSERT INTO interview.member_people(tenant_id,user_id,person_id)
    VALUES (${scope.tenantId}::uuid, ${scope.actorId}::uuid, ${personId}::uuid)`);
  return personId;
}

async function addInterview(
  db: TenantDb,
  scope: CandidacyScope,
  candidacyId: string,
  input: InterviewStageInput,
) {
  return String(
    (
      await db.execute(sql`INSERT INTO interview.interviews
        (tenant_id,candidacy_id,ordinal,kind,label)
        VALUES (${scope.tenantId}::uuid, ${candidacyId}::uuid,
          COALESCE((SELECT max(ordinal)+1 FROM interview.interviews
            WHERE tenant_id=${scope.tenantId}::uuid AND candidacy_id=${candidacyId}::uuid), 1),
          ${input.kind}::interview.interview_kind, ${input.label})
        RETURNING id`)
    ).rows[0]?.["id"],
  );
}

// The candidacy as the live session's context: company, role, the job spec
// and notes the person typed, and the model-cleaned employer brief.
const ownedCandidacy = (scope: CandidacyScope, id: string) => sql`
    SELECT c.id, c.title, c.job_description, c.notes, c.employer_brief,
           c.employer_brief_sha256, co.name AS company_name
    FROM interview.candidacies c
    JOIN interview.member_people mp
      ON mp.tenant_id=c.tenant_id AND mp.person_id=c.candidate_person_id
    JOIN interview.companies co ON co.tenant_id=c.tenant_id AND co.id=c.company_id
    WHERE c.tenant_id=${scope.tenantId}::uuid AND c.id=${id}::uuid
      AND mp.user_id=${scope.actorId}::uuid`;

export async function listContextRows(
  database: PlatformDatabase,
  scope: CandidacyScope,
) {
  return withTenant(
    scope,
    async (db) => {
      const [profiles, candidacies, interviews] = await Promise.all([
        db.execute(sql`SELECT id, name, revision, updated_at FROM interview.candidate_profiles
            WHERE tenant_id=${scope.tenantId} AND actor_id=${scope.actorId}
              AND product_id=${INTERVIEW_PRODUCT_ID} AND revoked_at IS NULL ORDER BY updated_at DESC`),
        db.execute(sql`SELECT c.id, c.title, c.job_description, co.name AS company_name
            FROM interview.candidacies c
            JOIN interview.member_people mp ON mp.tenant_id=c.tenant_id AND mp.person_id=c.candidate_person_id
            JOIN interview.companies co ON co.tenant_id=c.tenant_id AND co.id=c.company_id
            WHERE c.tenant_id=${scope.tenantId}::uuid AND mp.user_id=${scope.actorId}::uuid ORDER BY c.created_at DESC`),
        db.execute(sql`SELECT i.id, i.candidacy_id, i.label, i.kind FROM interview.interviews i
            JOIN interview.candidacies c ON c.tenant_id=i.tenant_id AND c.id=i.candidacy_id
            JOIN interview.member_people mp ON mp.tenant_id=c.tenant_id AND mp.person_id=c.candidate_person_id
            WHERE i.tenant_id=${scope.tenantId}::uuid AND mp.user_id=${scope.actorId}::uuid ORDER BY i.ordinal`),
      ]);
      return {
        profiles: profiles.rows,
        candidacies: candidacies.rows,
        interviews: interviews.rows,
      };
    },
    { database },
  );
}

export async function updateJobDescription(
  database: PlatformDatabase,
  scope: CandidacyScope,
  id: string,
  jobDescription: string,
) {
  return withTenant(
    scope,
    async (db) =>
      (
        await db.execute(sql`UPDATE interview.candidacies AS c
            SET job_description=${jobDescription.trim() || null}
            WHERE c.tenant_id=${scope.tenantId}::uuid AND c.id=${id}::uuid
              AND EXISTS (
                SELECT 1 FROM interview.member_people mp
                WHERE mp.tenant_id=c.tenant_id
                  AND mp.person_id=c.candidate_person_id
                  AND mp.user_id=${scope.actorId}::uuid
              )
            RETURNING c.job_description`)
      ).rows[0],
    { database },
  );
}

export async function readOwnedCandidacy(
  database: PlatformDatabase,
  scope: CandidacyScope,
  id: string,
) {
  return withTenant(
    scope,
    async (db) => (await db.execute(ownedCandidacy(scope, id))).rows[0],
    { database },
  );
}

export async function updateCandidacyContext(
  database: PlatformDatabase,
  scope: CandidacyScope,
  id: string,
  input: {
    title?: string | undefined;
    jobDescription?: string | undefined;
    notes?: string | undefined;
  },
) {
  return withTenant(
    scope,
    async (db) => {
      const owned = (await db.execute(ownedCandidacy(scope, id))).rows[0];
      if (!owned) return null;
      await db.execute(sql`UPDATE interview.candidacies SET
            title = COALESCE(${input.title ?? null}, title),
            job_description = CASE WHEN ${input.jobDescription === undefined}
              THEN job_description ELSE ${input.jobDescription?.trim() || null} END,
            notes = CASE WHEN ${input.notes === undefined}
              THEN notes ELSE ${input.notes?.trim() || null} END
          WHERE tenant_id=${scope.tenantId}::uuid AND id=${id}::uuid`);
      return (await db.execute(ownedCandidacy(scope, id))).rows[0];
    },
    { database },
  );
}

// [DOMAIN] The person's notes are the application's old notes and each
// stage's own (brief/repository.ts): notes moved onto a stage are still
// what the brief's prep lines are distilled from.
export async function readStageNotes(
  database: PlatformDatabase,
  scope: CandidacyScope,
  id: string,
) {
  return withTenant(
    scope,
    async (db) =>
      (await readBrief(db, scope, id)).stages.flatMap((stage) =>
        stage.notes ? [`${stage.label} stage:\n${stage.notes}`] : [],
      ),
    { database },
  );
}

export async function saveEmployerBrief(
  database: PlatformDatabase,
  scope: CandidacyScope,
  id: string,
  brief: unknown,
  sourceSha: string,
) {
  return withTenant(
    scope,
    async (db) => {
      await db.execute(sql`UPDATE interview.candidacies SET
            employer_brief = ${JSON.stringify(brief)}::jsonb,
            employer_brief_sha256 = ${sourceSha}
          WHERE tenant_id=${scope.tenantId}::uuid AND id=${id}::uuid`);
      return (await db.execute(ownedCandidacy(scope, id))).rows[0];
    },
    { database },
  );
}

export async function createCandidacy(
  database: PlatformDatabase,
  scope: CandidacyScope,
  input: {
    companyName: string;
    title: string;
    jobDescription?: string | undefined;
    interview?: InterviewStageInput | undefined;
  },
) {
  return withTenant(
    scope,
    async (db) => {
      const personId = await memberPerson(db, scope);
      const existing = (
        await db.execute(sql`SELECT id FROM interview.companies
            WHERE tenant_id=${scope.tenantId}::uuid
              AND lower(name)=lower(${input.companyName}) ORDER BY created_at LIMIT 1`)
      ).rows[0];
      const companyId = String(
        existing?.["id"] ??
          (
            await db.execute(sql`INSERT INTO interview.companies(tenant_id,name)
                VALUES (${scope.tenantId}::uuid, ${input.companyName}) RETURNING id`)
          ).rows[0]?.["id"],
      );
      const candidacyId = String(
        (
          await db.execute(sql`INSERT INTO interview.candidacies
              (tenant_id,company_id,candidate_person_id,title,job_description)
              VALUES (${scope.tenantId}::uuid, ${companyId}::uuid, ${personId}::uuid,
                ${input.title}, ${input.jobDescription?.trim() || null})
              RETURNING id`)
        ).rows[0]?.["id"],
      );
      const interviewId = input.interview
        ? await addInterview(db, scope, candidacyId, input.interview)
        : null;
      return { candidacyId, interviewId };
    },
    { database },
  );
}

export async function addCandidacyInterview(
  database: PlatformDatabase,
  scope: CandidacyScope,
  candidacyId: string,
  input: InterviewStageInput,
) {
  return withTenant(
    scope,
    async (db) => {
      const owned = (
        await db.execute(sql`SELECT 1 FROM interview.candidacies c
            JOIN interview.member_people mp
              ON mp.tenant_id=c.tenant_id AND mp.person_id=c.candidate_person_id
            WHERE c.tenant_id=${scope.tenantId}::uuid AND c.id=${candidacyId}::uuid
              AND mp.user_id=${scope.actorId}::uuid`)
      ).rows[0];
      if (!owned) return null;
      return addInterview(db, scope, candidacyId, input);
    },
    { database },
  );
}
