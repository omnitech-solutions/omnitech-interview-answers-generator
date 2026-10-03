// The presentation product's tables.
import { sql } from "drizzle-orm";
import {
  pgSchema,
  uuid,
  primaryKey,
  timestamp,
  pgPolicy,
  text,
  jsonb,
  integer,
  unique,
  check,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants, users } from "@omnitech/platform-storage/schema";

export const presentation = pgSchema("presentation");

export const agentConversations = presentation.table.withRLS(
  "agent_conversations",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "agent_conversations_tenant_id_fkey",
        onDelete: "cascade",
      }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, {
        name: "agent_conversations_document_id_fkey",
        onDelete: "cascade",
      }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, {
        name: "agent_conversations_created_by_fkey",
      }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

export const documentFavorites = presentation.table.withRLS(
  "document_favorites",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "document_favorites_tenant_id_fkey",
        onDelete: "cascade",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "document_favorites_user_id_fkey",
        onDelete: "cascade",
      }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, {
        name: "document_favorites_document_id_fkey",
        onDelete: "cascade",
      }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.userId, table.documentId],
      name: "document_favorites_pkey",
    }),

    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

export const documents = presentation.table.withRLS(
  "documents",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "documents_tenant_id_fkey",
        onDelete: "cascade",
      }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { name: "documents_owner_user_id_fkey" }),
    title: text().notNull(),
    documentType: text("document_type").default("presentation").notNull(),
    content: jsonb().default({}).notNull(),
    revision: integer().default(1).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

export const exports = presentation.table.withRLS(
  "exports",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "exports_tenant_id_fkey",
        onDelete: "cascade",
      }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, {
        name: "exports_document_id_fkey",
        onDelete: "cascade",
      }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { name: "exports_requested_by_fkey" }),
    format: text().notNull(),
    status: text().notNull(),
    assetReference: text("asset_reference"),
    errorCode: text("error_code"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    unique("exports_tenant_id_idempotency_key_key").on(
      table.tenantId,
      table.idempotencyKey,
    ),
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
    check(
      "exports_format_check",
      sql`(format = ANY (ARRAY['pptx'::text, 'pdf'::text]))`,
    ),
  ],
);

export const fontPairs = presentation.table.withRLS(
  "font_pairs",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "font_pairs_tenant_id_fkey",
        onDelete: "cascade",
      }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { name: "font_pairs_owner_user_id_fkey" }),
    headingFont: text("heading_font").notNull(),
    bodyFont: text("body_font").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

export const generatedImages = presentation.table.withRLS(
  "generated_images",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "generated_images_tenant_id_fkey",
        onDelete: "cascade",
      }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, {
        name: "generated_images_owner_user_id_fkey",
      }),
    assetReference: text("asset_reference").notNull(),
    promptReference: text("prompt_reference").notNull(),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    metadata: jsonb().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

export const generationSessions = presentation.table.withRLS(
  "generation_sessions",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "generation_sessions_tenant_id_fkey",
        onDelete: "cascade",
      }),
    documentId: uuid("document_id").references(() => documents.id, {
      name: "generation_sessions_document_id_fkey",
      onDelete: "cascade",
    }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, {
        name: "generation_sessions_owner_user_id_fkey",
      }),
    profileId: text("profile_id").notNull(),
    status: text().notNull(),
    state: jsonb().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

export const presentations = presentation.table.withRLS(
  "presentations",
  {
    documentId: uuid("document_id")
      .primaryKey()
      .references(() => documents.id, {
        name: "presentations_document_id_fkey",
        onDelete: "cascade",
      }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "presentations_tenant_id_fkey",
        onDelete: "cascade",
      }),
    outline: jsonb().default([]).notNull(),
    themeId: uuid("theme_id").references(() => themes.id, {
      name: "presentations_theme_fk",
      onDelete: "set null",
    }),
    settings: jsonb().default({}).notNull(),
    generationState: jsonb("generation_state").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

export const recordings = presentation.table.withRLS(
  "recordings",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "recordings_tenant_id_fkey",
        onDelete: "cascade",
      }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, {
        name: "recordings_document_id_fkey",
        onDelete: "cascade",
      }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { name: "recordings_owner_user_id_fkey" }),
    assetReference: text("asset_reference").notNull(),
    metadata: jsonb().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

export const shares = presentation.table.withRLS(
  "shares",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "shares_tenant_id_fkey",
        onDelete: "cascade",
      }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, {
        name: "shares_document_id_fkey",
        onDelete: "cascade",
      }),
    tokenHash: text("token_hash").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { name: "shares_created_by_fkey" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    unique("shares_token_hash_key").on(table.tokenHash),
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
    // A public share link names no tenant. Reading a share is allowed only to
    // a transaction that already holds that share's token hash, so the token
    // is the credential that reveals which tenant to scope to next.
    pgPolicy("share_token_lookup", {
      for: "select",
      using: sql`(token_hash = current_setting('app.share_token_hash'::text, true))`,
    }),
  ],
);

export const slides = presentation.table.withRLS(
  "slides",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "slides_tenant_id_fkey",
        onDelete: "cascade",
      }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, {
        name: "slides_document_id_fkey",
        onDelete: "cascade",
      }),
    position: integer().notNull(),
    sourceXml: text("source_xml").notNull(),
    content: jsonb().default({}).notNull(),
    revision: integer().default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    unique("slides_document_id_position_key").on(
      table.documentId,
      table.position,
    ),
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

export const themeFavorites = presentation.table.withRLS(
  "theme_favorites",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "theme_favorites_tenant_id_fkey",
        onDelete: "cascade",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "theme_favorites_user_id_fkey",
        onDelete: "cascade",
      }),
    themeId: uuid("theme_id")
      .notNull()
      .references(() => themes.id, {
        name: "theme_favorites_theme_id_fkey",
        onDelete: "cascade",
      }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.userId, table.themeId],
      name: "theme_favorites_pkey",
    }),

    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

export const themeLikes = presentation.table.withRLS(
  "theme_likes",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "theme_likes_tenant_id_fkey",
        onDelete: "cascade",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "theme_likes_user_id_fkey",
        onDelete: "cascade",
      }),
    themeId: uuid("theme_id")
      .notNull()
      .references(() => themes.id, {
        name: "theme_likes_theme_id_fkey",
        onDelete: "cascade",
      }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.userId, table.themeId],
      name: "theme_likes_pkey",
    }),

    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

export const themes = presentation.table.withRLS(
  "themes",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      name: "themes_tenant_id_fkey",
      onDelete: "cascade",
    }),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      name: "themes_owner_user_id_fkey",
    }),
    name: text().notNull(),
    description: text().default("").notNull(),
    definition: jsonb().notNull(),
    builtIn: boolean("built_in").default(false).notNull(),
    sourceImportId: text("source_import_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("presentation_theme_source_idx")
      .using(
        "btree",
        table.tenantId.asc().nullsLast(),
        table.sourceImportId.asc().nullsLast(),
      )
      .where(sql`(source_import_id IS NOT NULL)`),

    pgPolicy("tenant_theme_scope", {
      using: sql`((tenant_id IS NULL) OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid))`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);
