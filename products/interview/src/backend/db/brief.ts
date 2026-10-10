// The interview brief's own tables (BRIEF-interview-brief-and-context-pack,
// section 3): a stage's transcripts, what the employer said, and the research
// documents of a company or an application. A stage's people stay in
// `interview_participants`/`people`, and its notes and outcome are columns of
// `interviews` (schema.ts).
//
// [SAFETY] All three hold a person's private content, so each row belongs to
// the member who wrote it: forced row-level security pins a row to its tenant
// AND its owner (ADR-0005), and every reference to another tenant-owned row is
// composite on (tenant_id, id). Another member of the same workspace reads
// nothing here.
import {
  actorPredicate,
  tenantColumns,
  tenantPredicate,
  tenantReference,
  tenantUnique,
} from "@omnitech/database";
import { tenants, users } from "@omnitech/platform-storage/schema";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  integer,
  pgPolicy,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { candidacies, companies, interviews } from "./schema";
import { interview } from "./studio";

const platform = { tenants, users };

const owner = () => ({
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id),
});
// USING and WITH CHECK both pin a row to the transaction's tenant and actor.
const ownerPolicy = (
  table: string,
  tenantId: AnyPgColumn,
  ownerUserId: AnyPgColumn,
) =>
  pgPolicy(`tenant_user_${table}`, {
    as: "permissive",
    for: "all",
    using: sql`${tenantPredicate(tenantId)} AND ${actorPredicate(ownerUserId)}`,
    withCheck: sql`${tenantPredicate(tenantId)} AND ${actorPredicate(ownerUserId)}`,
  });

// What was actually said in a stage. Kept as text (decision 3 of the brief):
// extraction must be repeatable when the recipe improves. `capture_policy` is
// the policy it was taken under; a device-only one is never sent to a model
// that does not run on this machine.
export const interviewTranscripts = interview.table.withRLS(
  "interview_transcripts",
  {
    ...tenantColumns(platform),
    ...owner(),
    interviewId: uuid("interview_id").notNull(),
    title: text("title").notNull(),
    origin: text("origin").notNull(),
    originName: text("origin_name"),
    capturePolicy: text("capture_policy").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    content: text("content").notNull(),
    contentSha256: text("content_sha256").notNull(),
    chars: integer("chars").notNull(),
    turns: integer("turns").notNull(),
  },
  (t) => [
    tenantUnique("interview_transcripts", t.tenantId, t.id),
    // The same words attached to a stage twice are one transcript.
    unique("interview_transcripts_stage_content_key").on(
      t.tenantId,
      t.interviewId,
      t.contentSha256,
    ),
    ...tenantReference(
      "interview_transcripts_interview_fkey",
      [t.tenantId, t.interviewId],
      [interviews.tenantId, interviews.id],
      { onDelete: "cascade" },
    ),
    check(
      "interview_transcripts_origin_check",
      sql`${t.origin} IN ('recorded', 'uploaded', 'pasted')`,
    ),
    check(
      "interview_transcripts_policy_check",
      sql`${t.capturePolicy} IN ('device-only', 'permitted-remote')`,
    ),
    ownerPolicy("interview_transcripts", t.tenantId, t.ownerUserId),
  ],
);

// What the employer or a recruiter told the person, one dated entry each.
export const employerSaidEntries = interview.table.withRLS(
  "employer_said_entries",
  {
    ...tenantColumns(platform),
    ...owner(),
    candidacyId: uuid("candidacy_id").notNull(),
    said: text("said").notNull(),
    saidBy: text("said_by"),
    channel: text("channel"),
    // Null: an entry with no date (the old single text, carried over).
    saidOn: date("said_on"),
    contentSha256: text("content_sha256").notNull(),
  },
  (t) => [
    tenantUnique("employer_said_entries", t.tenantId, t.id),
    ...tenantReference(
      "employer_said_entries_candidacy_fkey",
      [t.tenantId, t.candidacyId],
      [candidacies.tenantId, candidacies.id],
      { onDelete: "cascade" },
    ),
    check(
      "employer_said_entries_channel_check",
      sql`${t.channel} IS NULL OR ${t.channel} IN ('email', 'call', 'message', 'other')`,
    ),
    ownerPolicy("employer_said_entries", t.tenantId, t.ownerUserId),
  ],
);

// What the person found out. A document belongs to a company, and to one
// application when `candidacy_id` is set; nothing is read from disk at run
// time (decision 2 of the brief).
export const researchDocuments = interview.table.withRLS(
  "research_documents",
  {
    ...tenantColumns(platform),
    ...owner(),
    companyId: uuid("company_id").notNull(),
    candidacyId: uuid("candidacy_id"),
    title: text("title").notNull(),
    origin: text("origin").notNull(),
    originRef: text("origin_ref"),
    content: text("content").notNull(),
    contentSha256: text("content_sha256").notNull(),
    chars: integer("chars").notNull(),
  },
  (t) => [
    tenantUnique("research_documents", t.tenantId, t.id),
    ...tenantReference(
      "research_documents_company_fkey",
      [t.tenantId, t.companyId],
      [companies.tenantId, companies.id],
    ),
    ...tenantReference(
      "research_documents_candidacy_fkey",
      [t.tenantId, t.candidacyId],
      [candidacies.tenantId, candidacies.id],
      { onDelete: "cascade" },
    ),
    check(
      "research_documents_origin_check",
      sql`${t.origin} IN ('url', 'file', 'pasted')`,
    ),
    ownerPolicy("research_documents", t.tenantId, t.ownerUserId),
  ],
);

// Every table of this file: each is private to its owner.
export const briefTables = [
  interviewTranscripts,
  employerSaidEntries,
  researchDocuments,
] as const;
