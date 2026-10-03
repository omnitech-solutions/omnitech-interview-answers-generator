import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assistantMigrations } from "@omnitech-assistant/storage-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { type PlatformDatabase, withPoolClient } from "./connection.js";

// The Drizzle stream ships beside dist (package "files": ["dist", "drizzle"]).
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

// The interview assistant's run worker leases queued runs across members: its
// own transactions set app.run_worker, and only those may read and update the
// assistant's tables without a member scope. Applied after every assistant
// migration, so a table a newer assistant release adds gets the policy too.
const runWorkerPolicies = `DO $$
DECLARE table_name text;
BEGIN
  FOR table_name IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'assistant' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'assistant' AND tablename = table_name AND policyname = 'run_worker'
    ) THEN
      EXECUTE format(
        'CREATE POLICY run_worker ON assistant.%I USING (current_setting(''app.run_worker'', true) = ''on'') WITH CHECK (current_setting(''app.run_worker'', true) = ''on'')',
        table_name
      );
    END IF;
  END LOOP;
END $$`;

// Brings a database to the current schema. The assistant package ships its own
// idempotent migrations for its `assistant` schema, and the run worker's
// policies follow them. The Drizzle stream owns every other schema and records
// each migration by name in drizzle.__drizzle_migrations, so re-running
// applies only what is new.
export async function migrateDatabase(
  database: PlatformDatabase,
): Promise<void> {
  for (const file of assistantMigrations)
    await database.query(await readFile(file, "utf8"));
  await database.query(runWorkerPolicies);
  await withPoolClient(database, (client) =>
    migrate(drizzle({ client }), {
      migrationsFolder,
      migrationsSchema: "drizzle",
      migrationsTable: "__drizzle_migrations",
    }).then(() => undefined),
  );
}
