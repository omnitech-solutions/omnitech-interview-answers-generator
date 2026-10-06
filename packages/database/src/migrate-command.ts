import { createPlatformDatabase } from "./connection";
import { migrateDatabase } from "./migrate";

// Migrations run as the schema owner (DATABASE_OWNER_URL) when one is set: the
// runtime role (DATABASE_URL) holds DML grants only and cannot run DDL. With no
// owner URL, a single-role database migrates as DATABASE_URL.
const database = createPlatformDatabase(
  process.env["DATABASE_OWNER_URL"] || process.env["DATABASE_URL"],
);
try {
  await migrateDatabase(database);
} finally {
  await database.close();
}
