import {
  actorPredicate,
  tenantColumns,
  tenantPolicy,
  tenantPredicate,
  tenantReference,
  tenantUnique,
  timestamps,
} from "@omnitech/database";
import {
  tenantMemberships,
  tenants,
  users,
} from "@omnitech/platform-storage/schema";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  getTableConfig,
  index,
  integer,
  pgPolicy,
  type PgTable,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { interview } from "./studio.js";

const platform = { tenants, users };

export const candidacyStatus = interview.enum("candidacy_status", [
  "exploring",
  "applied",
  "interviewing",
  "offer",
  "accepted",
  "declined",
  "rejected",
  "withdrawn",
  "on_hold",
]);
export const candidacySource = interview.enum("candidacy_source", [
  "recruiter_outreach",
  "referral",
  "applied",
  "inbound",
]);
export const interviewKind = interview.enum("interview_kind", [
  "recruiter_screen",
  "hiring_manager",
  "technical",
  "system_design",
  "take_home",
  "panel",
  "final",
  "other",
]);
export const interviewFormat = interview.enum("interview_format", [
  "video",
  "phone",
  "onsite",
]);
export const interviewStatus = interview.enum("interview_status", [
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
]);
export const participantRole = interview.enum("participant_role", [
  "candidate",
  "interviewer",
  "recruiter",
  "hiring_manager",
  "coordinator",
  "observer",
  "other",
]);

export const companies = interview.table.withRLS(
  "companies",
  {
    ...tenantColumns(platform),
    name: text("name").notNull(),
    domain: text("domain"),
    notes: text("notes"),
    research: text("research"),
  },
  (t) => [
    tenantUnique("companies", t.tenantId, t.id),
    uniqueIndex("companies_tenant_domain_key")
      .on(t.tenantId, t.domain)
      .where(sql`${t.domain} IS NOT NULL`),
    tenantPolicy("companies", t.tenantId),
  ],
);

export const people = interview.table.withRLS(
  "people",
  {
    ...tenantColumns(platform),
    fullName: text("full_name").notNull(),
    title: text("title"),
    companyId: uuid("company_id"),
    linkedinUrl: text("linkedin_url"),
    linkedUserId: uuid("linked_user_id").references(() => users.id),
    notes: text("notes"),
  },
  (t) => [
    tenantUnique("people", t.tenantId, t.id),
    ...tenantReference(
      "people_company_fkey",
      [t.tenantId, t.companyId],
      [companies.tenantId, companies.id],
    ),
    tenantPolicy("people", t.tenantId),
  ],
);

// "Me": maps a signed-in member of the workspace to their Person.
export const memberPeople = interview.table.withRLS(
  "member_people",
  {
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    personId: uuid("person_id").notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: "member_people_pkey", columns: [t.tenantId, t.userId] }),
    unique("member_people_tenant_person_key").on(t.tenantId, t.personId),
    foreignKey({
      name: "member_people_membership_fkey",
      columns: [t.tenantId, t.userId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId],
    }).onDelete("cascade"),
    ...tenantReference(
      "member_people_person_fkey",
      [t.tenantId, t.personId],
      [people.tenantId, people.id],
    ),
    tenantPolicy("member_people", t.tenantId),
  ],
);

export const candidacies = interview.table.withRLS(
  "candidacies",
  {
    ...tenantColumns(platform),
    companyId: uuid("company_id").notNull(),
    candidatePersonId: uuid("candidate_person_id").notNull(),
    title: text("title").notNull(),
    jobDescription: text("job_description"),
    status: candidacyStatus("status").notNull().default("exploring"),
    source: candidacySource("source"),
    postingUrl: text("posting_url"),
    notes: text("notes"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    tenantUnique("candidacies", t.tenantId, t.id),
    ...tenantReference(
      "candidacies_company_fkey",
      [t.tenantId, t.companyId],
      [companies.tenantId, companies.id],
    ),
    ...tenantReference(
      "candidacies_candidate_fkey",
      [t.tenantId, t.candidatePersonId],
      [people.tenantId, people.id],
    ),
    tenantPolicy("candidacies", t.tenantId),
  ],
);

export const interviews = interview.table.withRLS(
  "interviews",
  {
    ...tenantColumns(platform),
    candidacyId: uuid("candidacy_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    kind: interviewKind("kind").notNull(),
    label: text("label").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes"),
    format: interviewFormat("format"),
    status: interviewStatus("status").notNull().default("scheduled"),
  },
  (t) => [
    tenantUnique("interviews", t.tenantId, t.id),
    unique("interviews_tenant_id_id_candidacy_id_key").on(
      t.tenantId,
      t.id,
      t.candidacyId,
    ),
    unique("interviews_candidacy_ordinal_key").on(t.candidacyId, t.ordinal),
    ...tenantReference(
      "interviews_candidacy_fkey",
      [t.tenantId, t.candidacyId],
      [candidacies.tenantId, candidacies.id],
    ),
    check(
      "interviews_duration_check",
      sql`${t.durationMinutes} IS NULL OR ${t.durationMinutes} BETWEEN 5 AND 480`,
    ),
    tenantPolicy("interviews", t.tenantId),
  ],
);

export const interviewParticipants = interview.table.withRLS(
  "interview_participants",
  {
    ...tenantColumns(platform),
    interviewId: uuid("interview_id").notNull(),
    personId: uuid("person_id").notNull(),
    role: participantRole("role").notNull(),
    roleLabel: text("role_label"),
  },
  (t) => [
    tenantUnique("interview_participants", t.tenantId, t.id),
    unique("interview_participants_unique_key").on(
      t.interviewId,
      t.personId,
      t.role,
    ),
    ...tenantReference(
      "interview_participants_interview_fkey",
      [t.tenantId, t.interviewId],
      [interviews.tenantId, interviews.id],
    ),
    ...tenantReference(
      "interview_participants_person_fkey",
      [t.tenantId, t.personId],
      [people.tenantId, people.id],
    ),
    check(
      "interview_participants_other_label_check",
      sql`${t.role} <> 'other' OR ${t.roleLabel} IS NOT NULL`,
    ),
    tenantPolicy("interview_participants", t.tenantId),
  ],
);

// A standalone briefing pack, optionally linked into the domain. briefing_id
// is the pack's artifact id; packs are keyed per actor in Interview Studio's
// tables, so it has no foreign key.
export const briefingLinks = interview.table.withRLS(
  "briefing_links",
  {
    ...tenantColumns(platform),
    briefingId: text("briefing_id").notNull(),
    candidacyId: uuid("candidacy_id"),
    interviewId: uuid("interview_id"),
  },
  (t) => [
    tenantUnique("briefing_links", t.tenantId, t.id),
    unique("briefing_links_briefing_key").on(t.tenantId, t.briefingId),
    ...tenantReference(
      "briefing_links_candidacy_fkey",
      [t.tenantId, t.candidacyId],
      [candidacies.tenantId, candidacies.id],
    ),
    ...tenantReference(
      "briefing_links_interview_fkey",
      [t.tenantId, t.interviewId],
      [interviews.tenantId, interviews.id],
    ),
    check(
      "briefing_links_target_check",
      sql`${t.candidacyId} IS NOT NULL OR ${t.interviewId} IS NOT NULL`,
    ),
    tenantPolicy("briefing_links", t.tenantId),
  ],
);

export const practice = pgSchema("practice");
export const exerciseKind = practice.enum("exercise_kind", [
  "algorithm",
  "data_structure",
  "backend",
  "frontend",
  "react",
  "sql",
  "testing",
  "other",
]);
export const exerciseDifficulty = practice.enum("exercise_difficulty", [
  "easy",
  "medium",
  "hard",
]);
export const exerciseSource = practice.enum("exercise_source", [
  "original",
  "generated",
  "user_submitted",
]);

// tenant_id NULL = shared catalog (read by everyone, written by no tenant);
// set = private to that workspace.
export const exercises = practice.table.withRLS(
  "exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    promptKey: text("prompt_key").notNull(),
    kind: exerciseKind("kind").notNull(),
    difficulty: exerciseDifficulty("difficulty"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    sourceKind: exerciseSource("source_kind").notNull(),
    sourceUrl: text("source_url"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("exercises_scope_slug_key").on(
      sql`coalesce(${t.tenantId}::text, '')`,
      t.slug,
    ),
    index("exercises_tenant_prompt_key_idx").on(t.tenantId, t.promptKey),
    pgPolicy("exercises_read", {
      as: "permissive",
      for: "select",
      using: sql`${t.tenantId} IS NULL OR ${tenantPredicate(t.tenantId)}`,
    }),
    pgPolicy("exercises_write", {
      as: "permissive",
      for: "all",
      using: tenantPredicate(t.tenantId),
      withCheck: tenantPredicate(t.tenantId),
    }),
  ],
);

// An attempt is one of the user's Workspace drafts solving an exercise in a
// language. Drafts are keyed per actor in Interview Studio's tables, so
// draft_id has no foreign key. Private to its user.
export const exerciseAttempts = practice.table.withRLS(
  "exercise_attempts",
  {
    ...tenantColumns(platform),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id),
    language: text("language").notNull(),
    draftId: text("draft_id").notNull(),
  },
  (t) => [
    tenantUnique("exercise_attempts", t.tenantId, t.id),
    unique("exercise_attempts_draft_key").on(t.tenantId, t.userId, t.draftId),
    index("exercise_attempts_exercise_idx").on(t.exerciseId),
    pgPolicy("tenant_user_exercise_attempts", {
      as: "permissive",
      for: "all",
      using: sql`${tenantPredicate(t.tenantId)} AND ${actorPredicate(t.userId)}`,
      withCheck: sql`${tenantPredicate(t.tenantId)} AND ${actorPredicate(t.userId)}`,
    }),
  ],
);

const tables = {
  companies,
  people,
  memberPeople,
  candidacies,
  interviews,
  interviewParticipants,
  briefingLinks,
  exercises,
  exerciseAttempts,
};

// Every tenant-owned table: RLS-enabled tables except the shared exercise
// catalog. Catalog case 12 in security.test.ts catches a table left out here.
export const domainTables: readonly PgTable[] = Object.values(tables).filter(
  (table: PgTable) => getTableConfig(table).enableRLS && table !== exercises,
);
