// Candidate documents live in Interview. The UUID scope matches the core
// candidacy and platform-artifact tables; legacy profile keys are text and are
// verified in the same tenant transaction before a document is inserted.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { artifacts, tenants } from "@omnitech/platform-storage/schema";
import { candidacies, interviews } from "./schema.js";
import { interview } from "./studio.js";

const tenantScope = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`;
const memberScope = sql`${tenantScope} AND owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid`;

const privatePolicy = (name: string) =>
  pgPolicy(name, { for: "all", using: memberScope, withCheck: memberScope });

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const documentTemplates = interview.table.withRLS(
  "document_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    ownerUserId: uuid("owner_user_id"),
    kind: text("kind").notNull(),
    format: text("format").notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_templates_tenant_id_id_key").on(t.tenantId, t.id),
    index("document_templates_owner_idx").on(t.tenantId, t.ownerUserId),
    // Built-ins are readable by all members but may only be provisioned by a
    // trusted migration. An ordinary request can write only its own template.
    pgPolicy("document_templates_read", {
      for: "select",
      using: sql`${tenantScope} AND (${t.ownerUserId} IS NULL OR ${t.ownerUserId} = nullif(current_setting('app.actor_id', true), '')::uuid)`,
    }),
    pgPolicy("document_templates_insert", {
      for: "insert",
      withCheck: sql`${tenantScope} AND ${t.ownerUserId} = nullif(current_setting('app.actor_id', true), '')::uuid`,
    }),
    pgPolicy("document_templates_catalog_insert", {
      for: "insert",
      withCheck: sql`${tenantScope} AND ${t.ownerUserId} IS NULL AND current_setting('app.document_catalog_provisioner', true) = 'on'`,
    }),
    pgPolicy("document_templates_update", {
      for: "update",
      using: sql`${tenantScope} AND ${t.ownerUserId} = nullif(current_setting('app.actor_id', true), '')::uuid`,
      withCheck: sql`${tenantScope} AND ${t.ownerUserId} = nullif(current_setting('app.actor_id', true), '')::uuid`,
    }),
    pgPolicy("document_templates_delete", {
      for: "delete",
      using: sql`${tenantScope} AND ${t.ownerUserId} = nullif(current_setting('app.actor_id', true), '')::uuid`,
    }),
    check(
      "document_templates_kind_check",
      sql`${t.kind} IN ('resume', 'cover_letter', 'interview_prep', 'custom')`,
    ),
    check(
      "document_templates_format_check",
      sql`${t.format} IN ('docx', 'md')`,
    ),
    foreignKey({
      name: "document_templates_tenant_fkey",
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
    }),
  ],
);

export const documentTemplateRevisions = interview.table.withRLS(
  "document_template_revisions",
  {
    tenantId: uuid("tenant_id").notNull(),
    templateId: uuid("template_id").notNull(),
    revision: integer("revision").notNull(),
    ownerUserId: uuid("owner_user_id"),
    sourceArtifactId: uuid("source_artifact_id").notNull(),
    fields: jsonb("fields").notNull(),
    instructions: text("instructions").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: "document_template_revisions_pkey",
      columns: [t.tenantId, t.templateId, t.revision],
    }),
    foreignKey({
      name: "document_template_revisions_template_fkey",
      columns: [t.tenantId, t.templateId],
      foreignColumns: [documentTemplates.tenantId, documentTemplates.id],
    }),
    foreignKey({
      name: "document_template_revisions_artifact_fkey",
      columns: [t.tenantId, t.sourceArtifactId],
      foreignColumns: [artifacts.tenantId, artifacts.id],
    }),
    index("document_template_revisions_artifact_idx").on(
      t.tenantId,
      t.sourceArtifactId,
    ),
    pgPolicy("document_template_revisions_read", {
      for: "select",
      using: sql`${tenantScope} AND (${t.ownerUserId} IS NULL OR ${t.ownerUserId} = nullif(current_setting('app.actor_id', true), '')::uuid)`,
    }),
    pgPolicy("document_template_revisions_insert", {
      for: "insert",
      withCheck: sql`${tenantScope} AND ${t.ownerUserId} = nullif(current_setting('app.actor_id', true), '')::uuid`,
    }),
    pgPolicy("document_template_revisions_catalog_insert", {
      for: "insert",
      withCheck: sql`${tenantScope} AND ${t.ownerUserId} IS NULL AND current_setting('app.document_catalog_provisioner', true) = 'on'`,
    }),
    check("document_template_revisions_revision_check", sql`${t.revision} > 0`),
  ],
);

export const documents = interview.table.withRLS(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    templateId: uuid("template_id").notNull(),
    templateRevision: integer("template_revision").notNull(),
    profileId: text("profile_id").notNull(),
    profileRevision: bigint("profile_revision", { mode: "number" }).notNull(),
    candidacyId: uuid("candidacy_id"),
    interviewId: uuid("interview_id"),
    title: text("title").notNull(),
    status: text("status").notNull().default("ready"),
    currentRevision: integer("current_revision").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("documents_tenant_owner_id_key").on(t.tenantId, t.ownerUserId, t.id),
    unique("documents_selection_key")
      .on(
        t.tenantId,
        t.ownerUserId,
        t.templateId,
        t.templateRevision,
        t.profileId,
        t.profileRevision,
        t.candidacyId,
        t.interviewId,
      )
      .nullsNotDistinct(),
    index("documents_owner_updated_idx").on(
      t.tenantId,
      t.ownerUserId,
      t.updatedAt,
    ),
    foreignKey({
      name: "documents_template_revision_fkey",
      columns: [t.tenantId, t.templateId, t.templateRevision],
      foreignColumns: [
        documentTemplateRevisions.tenantId,
        documentTemplateRevisions.templateId,
        documentTemplateRevisions.revision,
      ],
    }),
    foreignKey({
      name: "documents_candidacy_fkey",
      columns: [t.tenantId, t.candidacyId],
      foreignColumns: [candidacies.tenantId, candidacies.id],
    }),
    foreignKey({
      name: "documents_interview_candidacy_fkey",
      columns: [t.tenantId, t.interviewId, t.candidacyId],
      foreignColumns: [
        interviews.tenantId,
        interviews.id,
        interviews.candidacyId,
      ],
    }),
    check(
      "documents_interview_requires_candidacy",
      sql`${t.interviewId} IS NULL OR ${t.candidacyId} IS NOT NULL`,
    ),
    check(
      "documents_status_check",
      sql`${t.status} IN ('ready', 'invalid', 'archived')`,
    ),
    check("documents_profile_revision_check", sql`${t.profileRevision} > 0`),
    check("documents_current_revision_check", sql`${t.currentRevision} > 0`),
    privatePolicy("documents_private_scope"),
  ],
);

export const documentRevisions = interview.table.withRLS(
  "document_revisions",
  {
    tenantId: uuid("tenant_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    documentId: uuid("document_id").notNull(),
    revision: integer("revision").notNull(),
    values: jsonb("values").notNull(),
    provenance: jsonb("provenance").notNull(),
    validation: jsonb("validation").notNull(),
    aiUsage: jsonb("ai_usage"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: "document_revisions_pkey",
      columns: [t.tenantId, t.ownerUserId, t.documentId, t.revision],
    }),
    foreignKey({
      name: "document_revisions_document_fkey",
      columns: [t.tenantId, t.ownerUserId, t.documentId],
      foreignColumns: [documents.tenantId, documents.ownerUserId, documents.id],
    }),
    check("document_revisions_revision_check", sql`${t.revision} > 0`),
    privatePolicy("document_revisions_private_scope"),
  ],
);

export const documentExports = interview.table.withRLS(
  "document_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    documentId: uuid("document_id").notNull(),
    revision: integer("revision").notNull(),
    format: text("format").notNull(),
    artifactId: uuid("artifact_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "document_exports_revision_fkey",
      columns: [t.tenantId, t.ownerUserId, t.documentId, t.revision],
      foreignColumns: [
        documentRevisions.tenantId,
        documentRevisions.ownerUserId,
        documentRevisions.documentId,
        documentRevisions.revision,
      ],
    }),
    foreignKey({
      name: "document_exports_artifact_fkey",
      columns: [t.tenantId, t.artifactId],
      foreignColumns: [artifacts.tenantId, artifacts.id],
    }),
    index("document_exports_revision_idx").on(
      t.tenantId,
      t.ownerUserId,
      t.documentId,
      t.revision,
    ),
    check("document_exports_format_check", sql`${t.format} IN ('docx', 'md')`),
    privatePolicy("document_exports_private_scope"),
  ],
);
