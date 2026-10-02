import { readFile } from "node:fs/promises";
import { assistantMigrations } from "@omnitech-assistant/storage-postgres";
import { createPlatformDatabase, migrateDatabase } from "./database.js";

const database = createPlatformDatabase();

// Every migration is written to be re-run; `pnpm dev` applies them on start.
try {
  for (const file of [
    "0001_platform.sql",
    "0002_ai_presentation.sql",
    "0003_ai_profile_preference.sql",
  ])
    await migrateDatabase(
      database,
      new URL(`../migrations/${file}`, import.meta.url),
    );
  // The interview assistant's runs, then the interview product's tables.
  for (const migration of assistantMigrations)
    await database.query(await readFile(migration, "utf8"));
  for (const file of [
    "0004_assistant_interview.sql",
    "0005_assistant_provenance.sql",
    "0006_interview_briefings.sql",
    "0007_assistant_reverts.sql",
    "0008_interview_plans.sql",
    "0009_concept_briefs.sql",
    "0010_rehearsal_sessions.sql",
    "0011_assistant_run_worker.sql",
  ])
    await migrateDatabase(
      database,
      new URL(`../migrations/${file}`, import.meta.url),
    );
} finally {
  await database.close();
}
