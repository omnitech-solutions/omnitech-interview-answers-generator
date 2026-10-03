// The platform's tables: users, sign-in, tenants, memberships, installed
// products, artifacts and audit events.
import { sql } from "drizzle-orm";
import {
  pgSchema,
  text,
  uuid,
  timestamp,
  boolean,
  bytea,
  integer,
  jsonb,
  index,
  foreignKey,
  primaryKey,
  unique,
  check,
  pgPolicy,
} from "drizzle-orm/pg-core";

export const platform = pgSchema("platform");
export const tenantRole = platform.enum("tenant_role", [
  "owner",
  "admin",
  "member",
]);
export const themePreference = platform.enum("theme_preference", [
  "system",
  "light",
  "dark",
]);

export const artifacts = platform.table.withRLS(
  "artifacts",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    ownerUserId: uuid("owner_user_id"),
    productId: text("product_id").notNull(),
    artifactType: text("artifact_type").notNull(),
    title: text().notNull(),
    metadata: jsonb().default({}).notNull(),
    payloadReference: text("payload_reference").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "artifacts_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerUserId],
      foreignColumns: [users.id],
      name: "artifacts_owner_user_id_fkey",
    }),
    index("artifacts_tenant_product_updated_idx").using(
      "btree",
      table.tenantId.asc().nullsLast(),
      table.productId.asc().nullsLast(),
      table.updatedAt.desc().nullsFirst(),
    ),
    unique("artifacts_tenant_id_id_key").on(table.tenantId, table.id),
    check(
      "artifacts_ownerless_builtin_check",
      sql`(owner_user_id IS NOT NULL AND artifact_type <> 'interview.document-template-builtin') OR (owner_user_id IS NULL AND product_id = 'omnitech.interview' AND artifact_type = 'interview.document-template-builtin')`,
    ),
    pgPolicy("tenant_artifacts", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
    pgPolicy("document_artifacts_select", {
      as: "restrictive",
      for: "select",
      using: sql`(product_id <> 'omnitech.interview' OR artifact_type NOT IN ('interview.document-template-source', 'interview.document-template-builtin', 'interview.document-export') OR owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid OR (artifact_type = 'interview.document-template-builtin' AND owner_user_id IS NULL))`,
    }),
    pgPolicy("document_artifacts_insert", {
      as: "restrictive",
      for: "insert",
      withCheck: sql`(product_id <> 'omnitech.interview' OR artifact_type NOT IN ('interview.document-template-source', 'interview.document-template-builtin', 'interview.document-export') OR (owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid AND artifact_type <> 'interview.document-template-builtin') OR (artifact_type = 'interview.document-template-builtin' AND owner_user_id IS NULL AND current_setting('app.document_catalog_provisioner', true) = 'on'))`,
    }),
    pgPolicy("document_artifacts_update", {
      as: "restrictive",
      for: "update",
      using: sql`(product_id <> 'omnitech.interview' OR artifact_type NOT IN ('interview.document-template-source', 'interview.document-template-builtin', 'interview.document-export'))`,
      withCheck: sql`(product_id <> 'omnitech.interview' OR artifact_type NOT IN ('interview.document-template-source', 'interview.document-template-builtin', 'interview.document-export'))`,
    }),
    pgPolicy("document_artifacts_delete", {
      as: "restrictive",
      for: "delete",
      using: sql`(product_id <> 'omnitech.interview' OR artifact_type NOT IN ('interview.document-template-source', 'interview.document-template-builtin', 'interview.document-export'))`,
    }),
    // ADR-0011 rule:private-session-artifact-types: a stored screenshot is an
    // owner-only artifact, never updated, deleted only by the purge, which
    // sets app.session_purge in its one owning file.
    pgPolicy("session_artifacts_select", {
      as: "restrictive",
      for: "select",
      using: sql`(product_id <> 'omnitech.interview' OR artifact_type <> 'interview.session-screenshot' OR owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid)`,
    }),
    pgPolicy("session_artifacts_insert", {
      as: "restrictive",
      for: "insert",
      withCheck: sql`(product_id <> 'omnitech.interview' OR artifact_type <> 'interview.session-screenshot' OR owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid)`,
    }),
    pgPolicy("session_artifacts_update", {
      as: "restrictive",
      for: "update",
      using: sql`(product_id <> 'omnitech.interview' OR artifact_type <> 'interview.session-screenshot')`,
      withCheck: sql`(product_id <> 'omnitech.interview' OR artifact_type <> 'interview.session-screenshot')`,
    }),
    pgPolicy("session_artifacts_delete", {
      as: "restrictive",
      for: "delete",
      using: sql`(product_id <> 'omnitech.interview' OR artifact_type <> 'interview.session-screenshot' OR (owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid AND current_setting('app.session_purge', true) = 'on'))`,
    }),
  ],
);

export const artifactPayloads = platform.table.withRLS(
  "artifact_payloads",
  {
    tenantId: uuid("tenant_id").notNull(),
    artifactId: uuid("artifact_id").notNull(),
    bytes: bytea().notNull(),
    byteLength: integer("byte_length").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.artifactId],
      name: "artifact_payloads_pkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.artifactId],
      foreignColumns: [artifacts.tenantId, artifacts.id],
      name: "artifact_payloads_artifact_fkey",
    }).onDelete("cascade"),
    check(
      "artifact_payloads_size_check",
      sql`byte_length >= 0 AND byte_length <= 10485760 AND octet_length(bytes) = byte_length`,
    ),
    pgPolicy("artifact_payloads_select", {
      for: "select",
      using: sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM platform.artifacts a WHERE a.tenant_id = artifact_payloads.tenant_id AND a.id = artifact_payloads.artifact_id AND a.product_id = 'omnitech.interview' AND (a.owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid OR (a.artifact_type = 'interview.document-template-builtin' AND a.owner_user_id IS NULL)))`,
    }),
    pgPolicy("artifact_payloads_insert", {
      for: "insert",
      withCheck: sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (SELECT 1 FROM platform.artifacts a WHERE a.tenant_id = artifact_payloads.tenant_id AND a.id = artifact_payloads.artifact_id AND a.product_id = 'omnitech.interview' AND (a.owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid OR (a.artifact_type = 'interview.document-template-builtin' AND a.owner_user_id IS NULL AND current_setting('app.document_catalog_provisioner', true) = 'on')))`,
    }),
    // A session screenshot's bytes are deleted only by the purge, for the
    // owner and the session artifact type (rule:purge-delete-setting). No
    // other payload can be deleted, and none is ever updated.
    pgPolicy("artifact_payloads_session_delete", {
      for: "delete",
      using: sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND current_setting('app.session_purge', true) = 'on' AND EXISTS (SELECT 1 FROM platform.artifacts a WHERE a.tenant_id = artifact_payloads.tenant_id AND a.id = artifact_payloads.artifact_id AND a.product_id = 'omnitech.interview' AND a.artifact_type = 'interview.session-screenshot' AND a.owner_user_id = nullif(current_setting('app.actor_id', true), '')::uuid)`,
    }),
  ],
);

export const auditEvents = platform.table.withRLS(
  "audit_events",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    actorUserId: uuid("actor_user_id").notNull(),
    action: text().notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    metadata: jsonb().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "audit_events_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.actorUserId],
      foreignColumns: [users.id],
      name: "audit_events_actor_user_id_fkey",
    }),
    index("audit_events_tenant_created_idx").using(
      "btree",
      table.tenantId.asc().nullsLast(),
      table.createdAt.desc().nullsFirst(),
    ),

    pgPolicy("tenant_audit_events", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

export const authSessions = platform.table(
  "auth_sessions",
  {
    id: uuid().defaultRandom().primaryKey(),
    sessionTokenHash: text("session_token_hash").notNull(),
    userId: uuid("user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "auth_sessions_user_id_fkey",
    }).onDelete("cascade"),
    unique("auth_sessions_session_token_hash_key").on(table.sessionTokenHash),
  ],
);

export const connectedAccounts = platform.table(
  "connected_accounts",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    provider: text().notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    status: text().notNull(),
    scopes: text().array().default([]).notNull(),
    accessTokenCiphertext: jsonb("access_token_ciphertext").notNull(),
    refreshTokenCiphertext: jsonb("refresh_token_ciphertext"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "connected_accounts_user_id_fkey",
    }).onDelete("cascade"),
    unique("connected_accounts_user_id_provider_key").on(
      table.userId,
      table.provider,
    ),
    check(
      "connected_accounts_provider_check",
      sql`(provider = ANY (ARRAY['google'::text, 'linkedin'::text]))`,
    ),
    check(
      "connected_accounts_status_check",
      sql`(status = ANY (ARRAY['connected'::text, 'expired'::text, 'revoked'::text]))`,
    ),
  ],
);

export const loginIdentities = platform.table(
  "login_identities",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    provider: text().notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "login_identities_user_id_fkey",
    }).onDelete("cascade"),
    unique("login_identities_provider_provider_account_id_key").on(
      table.provider,
      table.providerAccountId,
    ),
    check(
      "login_identities_provider_check",
      sql`(provider = ANY (ARRAY['google'::text, 'linkedin'::text]))`,
    ),
  ],
);

export const productInstallations = platform.table.withRLS(
  "product_installations",
  {
    tenantId: uuid("tenant_id").notNull(),
    productId: text("product_id").notNull(),
    displayName: text("display_name").notNull(),
    description: text().notNull(),
    icon: text().notNull(),
    enabled: boolean().default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    configuration: jsonb().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "product_installations_tenant_id_fkey",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.tenantId, table.productId],
      name: "product_installations_pkey",
    }),

    pgPolicy("tenant_product_installations", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

// Memberships are read inside the tenant they belong to (ADR-0005): a member
// is resolved by entering the slug's tenant and finding their own row.
export const tenantMemberships = platform.table.withRLS(
  "tenant_memberships",
  {
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: tenantRole().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "tenant_memberships_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "tenant_memberships_user_id_fkey",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.tenantId, table.userId],
      name: "tenant_memberships_pkey",
    }),
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

export const tenants = platform.table(
  "tenants",
  {
    id: uuid().defaultRandom().primaryKey(),
    slug: text().notNull(),
    name: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    unique("tenants_slug_key").on(table.slug),
    check(
      "tenants_slug_check",
      sql`(slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text)`,
    ),
  ],
);

export const userPreferences = platform.table(
  "user_preferences",
  {
    userId: uuid("user_id").primaryKey(),
    theme: themePreference().default("system").notNull(),
    locale: text().default("en").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    aiProfileId: text("ai_profile_id"),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "user_preferences_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const users = platform.table(
  "users",
  {
    id: uuid().defaultRandom().primaryKey(),
    email: text().notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    status: text().default("active").notNull(),
  },
  (table) => [
    unique("users_email_key").on(table.email),
    check(
      "users_status_check",
      sql`(status = ANY (ARRAY['active'::text, 'pending'::text, 'disabled'::text]))`,
    ),
  ],
);
