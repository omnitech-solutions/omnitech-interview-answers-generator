// The platform's AI execution tables: provider configuration, profiles,
// usage and agent jobs.
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
import { tenantReference, tenantUnique } from "@omnitech/database";
import { tenants, users } from "./platform.js";

export const ai = pgSchema("ai");

// ADR-0012 Agent jobs: a private job's row belongs to its creator (user_id is
// the creator) and the agent worker; every other job is unchanged.
const privateJobAdmitted = sql`(NOT private OR user_id = nullif(current_setting('app.actor_id', true), '')::uuid OR current_setting('app.agent_worker', true) = 'on')`;

// A child row of a private job is admitted only when its parent job is: the
// subquery runs under the parent's own policies, so the rule is stated once.
const parentJobVisible = (child: string) =>
  sql.raw(
    `(EXISTS (SELECT 1 FROM ai.agent_jobs j WHERE j.tenant_id = ${child}.tenant_id AND j.id = ${child}.job_id))`,
  );

// A job's artifacts and events are tenant-owned rows: each carries its job's
// tenant, and the composite (tenant_id, job_id) key keeps the two equal.
export const agentArtifacts = ai.table.withRLS(
  "agent_artifacts",
  {
    id: uuid().defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    jobId: uuid("job_id").notNull(),
    artifactReference: text("artifact_reference").notNull(),
    kind: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    ...tenantReference(
      "agent_artifacts_job_id_fkey",
      [table.tenantId, table.jobId],
      [agentJobs.tenantId, agentJobs.id],
      { onDelete: "cascade" },
    ),
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
    pgPolicy("agent_artifacts_private_parent_select", {
      as: "restrictive",
      for: "select",
      using: parentJobVisible("agent_artifacts"),
    }),
    pgPolicy("agent_artifacts_private_parent_insert", {
      as: "restrictive",
      for: "insert",
      withCheck: parentJobVisible("agent_artifacts"),
    }),
    pgPolicy("agent_artifacts_private_parent_update", {
      as: "restrictive",
      for: "update",
      using: parentJobVisible("agent_artifacts"),
      withCheck: parentJobVisible("agent_artifacts"),
    }),
    pgPolicy("agent_artifacts_private_parent_delete", {
      as: "restrictive",
      for: "delete",
      using: parentJobVisible("agent_artifacts"),
    }),
  ],
);

export const agentJobEvents = ai.table.withRLS(
  "agent_job_events",
  {
    tenantId: uuid("tenant_id").notNull(),
    jobId: uuid("job_id").notNull(),
    sequence: integer().notNull(),
    executionId: uuid("execution_id").notNull(),
    attemptId: text("attempt_id"),
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
    ...tenantReference(
      "agent_job_events_job_id_fkey",
      [table.tenantId, table.jobId],
      [agentJobs.tenantId, agentJobs.id],
      { onDelete: "cascade" },
    ),
    pgPolicy("tenant_scope", {
      using: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
      withCheck: sql`(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`,
    }),
    // The worker appends a job's events before it is in the job's tenant
    // (agent-job-worker-repository.ts); it never reads or changes them.
    pgPolicy("agent_worker_append", {
      for: "insert",
      withCheck: sql`(current_setting('app.agent_worker'::text, true) = 'on'::text)`,
    }),
    pgPolicy("agent_job_events_private_parent_select", {
      as: "restrictive",
      for: "select",
      using: parentJobVisible("agent_job_events"),
    }),
    pgPolicy("agent_job_events_private_parent_insert", {
      as: "restrictive",
      for: "insert",
      withCheck: parentJobVisible("agent_job_events"),
    }),
    pgPolicy("agent_job_events_private_parent_update", {
      as: "restrictive",
      for: "update",
      using: parentJobVisible("agent_job_events"),
      withCheck: parentJobVisible("agent_job_events"),
    }),
    pgPolicy("agent_job_events_private_parent_delete", {
      as: "restrictive",
      for: "delete",
      using: parentJobVisible("agent_job_events"),
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
    executionId: uuid("execution_id").defaultRandom().notNull(),
    profileSnapshot: jsonb("profile_snapshot").notNull(),
    promptReference: text("prompt_reference").notNull(),
    resultReference: text("result_reference"),
    sessionId: text("session_id"),
    // Immutable and set only by the session dispatch path (ADR-0012 Agent
    // jobs); the ai.guard_agent_job_private_marker trigger enforces both.
    private: boolean().default(false).notNull(),
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
    tenantUnique("agent_jobs", table.tenantId, table.id),
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
    // A private job's row is admitted only to its creator or the worker; a
    // caller with no actor sees none. RESTRICTIVE, so it narrows the
    // permissive tenant and worker policies above and never widens them.
    pgPolicy("agent_job_private_select", {
      as: "restrictive",
      for: "select",
      using: privateJobAdmitted,
    }),
    pgPolicy("agent_job_private_update", {
      as: "restrictive",
      for: "update",
      using: privateJobAdmitted,
      withCheck: privateJobAdmitted,
    }),
    pgPolicy("agent_job_private_delete", {
      as: "restrictive",
      for: "delete",
      using: privateJobAdmitted,
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
      sql`(execution_family = ANY (ARRAY['direct-model'::text, 'agent-runtime'::text]))`,
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
