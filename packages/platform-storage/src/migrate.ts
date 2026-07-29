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
} finally {
  await database.close();
}
