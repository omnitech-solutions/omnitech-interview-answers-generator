// The platform's AI execution tables: provider configuration, profiles,
// usage, agent jobs and workflow threads.
import { sql } from "drizzle-orm";
import {
  pgSchema,
  uuid,
  primaryKey,
  text,
  timestamp,
  integer,
  jsonb,
  pgPolicy,
  index,
  check,
  unique,
  boolean,
  numeric,
} from "drizzle-orm/pg-core";
import { tenants, users } from "./platform.js";

export const ai = pgSchema("ai");

export const agentArtifacts = ai.table("agent_artifacts", {
  id: uuid().defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => agentJobs.id, {
      name: "agent_artifacts_job_id_fkey",
      onDelete: "cascade",
    }),
  artifactReference: text("artifact_reference").notNull(),
  kind: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const agentJobEvents = ai.table(
  "agent_job_events",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => agentJobs.id, {
        name: "agent_job_events_job_id_fkey",
        onDelete: "cascade",
      }),
    sequence: integer().notNull(),
    event: jsonb().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.jobId, table.sequence],
      name: "agent_job_events_pkey",
    }),
  ],
);

export const agentJobPayloads = ai.table.withRLS(
  "agent_job_payloads",
  {
    reference: text().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "agent_job_payloads_tenant_id_fkey",
        onDelete: "cascade",
      }),
    ciphertext: jsonb().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
    // The worker and the job's poller hold only a payload's reference, an
    // unguessable id; a transaction may read the one payload it names.
    pgPolicy("payload_reference_lookup", {
      for: "select",
      using: sql`(reference = current_setting('app.agent_payload_reference'::text, true))`,
    }),
  ],
);

export const agentJobs = ai.table.withRLS(
  "agent_jobs",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "agent_jobs_tenant_id_fkey",
        onDelete: "cascade",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { name: "agent_jobs_user_id_fkey" }),
    productId: text("product_id").notNull(),
    status: text().notNull(),
    profileSnapshot: jsonb("profile_snapshot").notNull(),
    promptReference: text("prompt_reference").notNull(),
    resultReference: text("result_reference"),
    sessionId: text("session_id"),
    claimedBy: text("claimed_by"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextEventSequence: integer("next_event_sequence").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("agent_jobs_claim_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.leaseExpiresAt.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),

    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
    // The agent worker leases queued jobs across tenants before it knows
    // whose they are, so its own transactions (app.agent_worker = 'on') may
    // read and advance any job. They can never create or delete one.
    pgPolicy("agent_worker_read", {
      for: "select",
      using: sql`(current_setting('app.agent_worker'::text, true) = 'on'::text)`,
    }),
    pgPolicy("agent_worker_update", {
      for: "update",
      using: sql`(current_setting('app.agent_worker'::text, true) = 'on'::text)`,
      withCheck: sql`(current_setting('app.agent_worker'::text, true) = 'on'::text)`,
    }),
    check(
      "agent_jobs_status_check",
      sql`(status = ANY (ARRAY['queued'::text, 'claimed'::text, 'starting'::text, 'running'::text, 'awaiting-input'::text, 'cancelling'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text, 'timed-out'::text]))`,
    ),
  ],
);

export const agentSessions = ai.table.withRLS(
  "agent_sessions",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "agent_sessions_tenant_id_fkey",
        onDelete: "cascade",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { name: "agent_sessions_user_id_fkey" }),
    runtime: text().notNull(),
    runtimeSessionId: text("runtime_session_id").notNull(),
    profileSnapshot: jsonb("profile_snapshot").notNull(),
    status: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    unique("agent_sessions_runtime_runtime_session_id_key").on(
      table.runtime,
      table.runtimeSessionId,
    ),
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
    check(
      "agent_sessions_runtime_check",
      sql`(runtime = ANY (ARRAY['codex'::text, 'claude-code'::text]))`,
    ),
  ],
);

export const modelDefinitions = ai.table(
  "model_definitions",
  {
    id: text().primaryKey(),
    providerConfigurationId: text("provider_configuration_id")
      .notNull()
      .references(() => providerConfigurations.id, {
        name: "model_definitions_provider_configuration_id_fkey",
        onDelete: "cascade",
      }),
    displayName: text("display_name").notNull(),
    providerModelId: text("provider_model_id").notNull(),
    kind: text().notNull(),
    capabilities: text().array().default([]).notNull(),
    enabled: boolean().default(true).notNull(),
    metadata: jsonb().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    check(
      "model_definitions_kind_check",
      sql`(kind = ANY (ARRAY['language'::text, 'embedding'::text, 'image'::text, 'multimodal'::text]))`,
    ),
  ],
);

export const profiles = ai.table(
  "profiles",
  {
    id: text().primaryKey(),
    displayName: text("display_name").notNull(),
    executionFamily: text("execution_family").notNull(),
    targetId: text("target_id").notNull(),
    configuration: jsonb().notNull(),
    enabled: boolean().default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    check(
      "profiles_execution_family_check",
      sql`(execution_family = ANY (ARRAY['direct-model'::text, 'workflow'::text, 'agent-runtime'::text]))`,
    ),
  ],
);

export const providerConfigurations = ai.table("provider_configurations", {
  id: text().primaryKey(),
  displayName: text("display_name").notNull(),
  adapterId: text("adapter_id").notNull(),
  enabled: boolean().default(true).notNull(),
  secretReference: text("secret_reference"),
  configuration: jsonb().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const tenantPolicies = ai.table.withRLS(
  "tenant_policies",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "tenant_policies_tenant_id_fkey",
        onDelete: "cascade",
      }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, {
        name: "tenant_policies_profile_id_fkey",
        onDelete: "cascade",
      }),
    enabled: boolean().default(true).notNull(),
    secretReference: text("secret_reference"),
    usageLimits: jsonb("usage_limits").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.profileId],
      name: "tenant_policies_pkey",
    }),

    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);

export const usageRecords = ai.table.withRLS(
  "usage_records",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "usage_records_tenant_id_fkey",
        onDelete: "cascade",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { name: "usage_records_user_id_fkey" }),
    productId: text("product_id").notNull(),
    profileId: text("profile_id").notNull(),
    executionFamily: text("execution_family").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 14, scale: 6 }),
    failureCode: text("failure_code"),
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

export const workflowThreads = ai.table.withRLS(
  "workflow_threads",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        name: "workflow_threads_tenant_id_fkey",
        onDelete: "cascade",
      }),
    productId: text("product_id").notNull(),
    subjectId: text("subject_id").notNull(),
    engine: text().notNull(),
    engineThreadId: text("engine_thread_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    unique("workflow_threads_tenant_id_product_id_subject_id_engine_key").on(
      table.tenantId,
      table.productId,
      table.subjectId,
      table.engine,
    ),
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
  ],
);
