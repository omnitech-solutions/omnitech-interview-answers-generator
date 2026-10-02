import { createPlatformDatabase, migrateDatabase } from "./database.js";

const database = createPlatformDatabase();

try {
  await migrateDatabase(
    database,
    new URL("../migrations/0001_platform.sql", import.meta.url),
  );
  await migrateDatabase(
    database,
    new URL("../migrations/0002_ai_presentation.sql", import.meta.url),
  );
  await migrateDatabase(
    database,
    new URL("../migrations/0003_ai_profile_preference.sql", import.meta.url),
  );
  for (const file of [
    "0004_assistant_interview.sql",
    "0005_assistant_provenance.sql",
    "0006_interview_briefings.sql",
  ]) {
    await migrateDatabase(
      database,
      new URL(`../migrations/${file}`, import.meta.url),
    );
  }
} finally {
  await database.close();
}
