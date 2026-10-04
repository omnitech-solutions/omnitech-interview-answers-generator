import { pgSchema, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrateDatabase } from "./migrate.js";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "./test-support/postgres.js";
import { schemaDrift } from "./test-support/schema.js";

let pg: DisposablePostgres;
beforeAll(async () => {
  pg = await startDisposablePostgres();
}, 30_000);
afterAll(async () => pg?.stop());

const rows = async (sql: string) =>
  (await pg.owner.query(sql)).rows.map((row) => Object.values(row).join("."));

it("migrates a fresh database to the current schema and re-runs as a no-op", async () => {
  await migrateDatabase(pg.owner);
  const applied = () =>
    rows("SELECT name FROM drizzle.__drizzle_migrations ORDER BY id");
  const first = await applied();
  expect(first.map((name) => name.replace(/^\d+_/, ""))).toEqual([
    "initial",
    "forced_rls_and_immutability",
    "foreign_key_indexes",
    "remove_presentation_import",
    "force_rls_platform_ai_presentation",
    "worker_and_link_lookup_policies",
    "remove_workflow_seam",
    "agent_job_tenant_rows_and_composite_keys",
    "forced_rls_job_identity_and_catalog_tenancy",
    "document_artifact_payloads_and_interview_documents",
    "agent_job_private_marker",
    "active_sessions",
    "companion_capabilities",
    "agent_job_child_insert_guard",
    "action_source_event_ids",
    "session_processed_through",
    "document-generation-requests",
    "agent-execution-identities",
    "document-generation-batches",
    "document-generation-batch-usage",
    "owner_input_observation",
  ]);

  // No workflow engine exists: no thread table, no conversation link to one,
  // and profiles name only the execution families the runtime can dispatch.
  expect(
    await rows(
      `SELECT table_schema || '.' || table_name || '.' || column_name
         FROM information_schema.columns
        WHERE (table_schema, table_name) = ('ai', 'workflow_threads')
           OR column_name = 'workflow_thread_id'`,
    ),
  ).toEqual([]);
  expect(
    await rows(
      `SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conname = 'profiles_execution_family_check'`,
    ),
  ).toEqual([
    "CHECK ((execution_family = ANY (ARRAY['direct-model'::text, 'agent-runtime'::text])))",
  ]);

  // Every schema the app owns, plus the assistant package's own.
  expect(
    await rows(
      `SELECT nspname FROM pg_namespace
        WHERE nspname IN ('platform', 'ai', 'presentation', 'interview', 'practice', 'assistant')
        ORDER BY nspname`,
    ),
  ).toEqual([
    "ai",
    "assistant",
    "interview",
    "platform",
    "practice",
    "presentation",
  ]);

  // Interview and practice tables enforce row-level security; the assistant's
  // tables admit the run worker.
  expect(
    await rows(
      `SELECT n.nspname || '.' || c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('interview', 'practice') AND c.relkind = 'r'
          AND NOT c.relrowsecurity`,
    ),
  ).toEqual([]);
  // The app role owns every table, and PostgreSQL exempts an owner from
  // row-level security unless it is forced, so every policy-bearing table in
  // every schema must force it or its policies never bind the app.
  expect(
    await rows(
      `SELECT n.nspname || '.' || c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
        ORDER BY 1`,
    ),
  ).toEqual([]);
  // Every tenant-owned table, in any schema, has row-level security enabled
  // and forced (ADR-0005 Decision 3), so its policies bind the app role.
  expect(
    await rows(
      `SELECT DISTINCT n.nspname || '.' || c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE c.relkind = 'r' AND a.attname = 'tenant_id' AND NOT a.attisdropped
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
        ORDER BY 1`,
    ),
  ).toEqual([]);
  // Every reference between two tenant-owned tables is a composite
  // (tenant_id, …) foreign key, so a row can never reference another
  // workspace's row (ADR-0005 Decision 3). A theme or an exercise may be a
  // tenant-less shared catalog row, which a composite key cannot reach; those
  // references keep their single-column key, and a catalog_in_tenant trigger
  // admits only a shared row or one of the referencing row's own tenant.
  expect(
    await rows(
      `SELECT c.conname FROM pg_constraint c
        WHERE c.contype = 'f'
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.conrelid
                AND a.attname = 'tenant_id' AND NOT a.attisdropped)
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.confrelid
                AND a.attname = 'tenant_id' AND NOT a.attisdropped)
          AND NOT EXISTS (
            SELECT 1 FROM unnest(c.conkey, c.confkey) AS k(child, parent)
              JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = k.child
              JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = k.parent
             WHERE ca.attname = 'tenant_id' AND pa.attname = 'tenant_id')
        ORDER BY 1`,
    ),
  ).toEqual([
    "exercise_attempts_exercise_id_exercises_id_fkey",
    "presentations_theme_fk",
    "theme_favorites_theme_id_fkey",
    "theme_likes_theme_id_fkey",
  ]);
  expect(
    await rows(
      `SELECT t.tgrelid::regclass::text FROM pg_trigger t
        WHERE t.tgname = 'catalog_in_tenant' ORDER BY 1`,
    ),
  ).toEqual([
    "practice.exercise_attempts",
    "presentation.presentations",
    "presentation.theme_favorites",
    "presentation.theme_likes",
  ]);
  // A job's events and artifacts are tenant-owned rows too; only the shared
  // model and profile catalog has no tenant.
  expect(
    await rows(
      `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'ai' AND c.relkind = 'r'
          AND NOT EXISTS (SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
              AND NOT a.attisdropped)
        ORDER BY 1`,
    ),
  ).toEqual(["model_definitions", "profiles", "provider_configurations"]);
  expect(
    await rows(
      `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'assistant' AND c.relkind = 'r' AND c.relrowsecurity
          AND NOT EXISTS (SELECT 1 FROM pg_policies p
            WHERE p.schemaname = 'assistant' AND p.tablename = c.relname
              AND p.policyname = 'run_worker')`,
    ),
  ).toEqual([]);

  // Immutable records refuse updates and deletes.
  expect(
    await rows(
      `SELECT DISTINCT tgname FROM pg_trigger
        WHERE tgname IN ('assistant_immutable', 'assistant_effect_immutable')
        ORDER BY tgname`,
    ),
  ).toEqual(["assistant_effect_immutable", "assistant_immutable"]);

  await migrateDatabase(pg.owner);
  expect(await applied()).toEqual(first);
});

it("refuses a row that references another workspace's row", async () => {
  // The fixture owner is a superuser, so row-level security is out of the
  // way: only the keys and triggers themselves stand between the tenants.
  const one = async (sql: string, values: unknown[] = []) =>
    (await pg.owner.query<{ id: string }>(sql, values)).rows[0]!.id;
  const user = await one(
    "INSERT INTO platform.users (email, display_name) VALUES ('fk@example.test', 'Fk') RETURNING id",
  );
  const north = await one(
    "INSERT INTO platform.tenants (slug, name) VALUES ('fk-north', 'North') RETURNING id",
  );
  const south = await one(
    "INSERT INTO platform.tenants (slug, name) VALUES ('fk-south', 'South') RETURNING id",
  );
  const northDocument = await one(
    "INSERT INTO presentation.documents (tenant_id, owner_user_id, title) VALUES ($1, $2, 'Plan') RETURNING id",
    [north, user],
  );
  const northTheme = await one(
    "INSERT INTO presentation.themes (tenant_id, name, definition) VALUES ($1, 'Private', '{}') RETURNING id",
    [north],
  );
  const builtIn = await one(
    "INSERT INTO presentation.themes (tenant_id, name, definition, built_in) VALUES (NULL, 'Built-in', '{}', true) RETURNING id",
  );
  const northJob = await one(
    `INSERT INTO ai.agent_jobs (tenant_id, user_id, product_id, status, profile_snapshot, prompt_reference)
     VALUES ($1, $2, 'omnitech.presentation', 'queued', '{}', 'agent-payload:x') RETURNING id`,
    [north, user],
  );

  await expect(
    pg.owner.query(
      "INSERT INTO presentation.shares (tenant_id, document_id, token_hash, created_by) VALUES ($1, $2, 'h', $3)",
      [south, northDocument, user],
    ),
  ).rejects.toThrow("foreign key");
  await expect(
    pg.owner.query(
      "INSERT INTO ai.agent_job_events (tenant_id, job_id, sequence, event) VALUES ($1, $2, 1, '{}')",
      [south, northJob],
    ),
  ).rejects.toThrow("foreign key");
  await expect(
    pg.owner.query(
      "INSERT INTO presentation.theme_favorites (tenant_id, user_id, theme_id) VALUES ($1, $2, $3)",
      [south, user, northTheme],
    ),
  ).rejects.toThrow("another workspace");
  // A shared built-in theme stays reachable from every workspace.
  await pg.owner.query(
    "INSERT INTO presentation.theme_favorites (tenant_id, user_id, theme_id) VALUES ($1, $2, $3)",
    [south, user, builtIn],
  );
  // A job's identity is fixed once it exists, whoever updates it.
  await expect(
    pg.owner.query("UPDATE ai.agent_jobs SET tenant_id = $2 WHERE id = $1", [
      northJob,
      south,
    ]),
  ).rejects.toThrow("immutable");
});

it("reports a schema file that no longer matches the migrated database", async () => {
  const users = pgSchema("platform").table("users", {
    id: uuid().primaryKey(),
    nickname: text(),
  });
  expect(await schemaDrift(pg.owner, [users])).toEqual([
    "platform.users.nickname: column missing",
  ]);
});
