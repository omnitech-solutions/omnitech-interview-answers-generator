import { readFile } from "node:fs/promises";
import { runDrizzleMigrations } from "@omnitech/database";
import { createPlatformDatabase } from "./database.js";
import { legacyMigrations } from "./legacy-migrations.js";

const database = createPlatformDatabase();

// Legacy idempotent SQL first, then the Drizzle stream (applied once each).
try {
  for (const file of legacyMigrations())
    await database.query(await readFile(file, "utf8"));
  await runDrizzleMigrations(database);
} finally {
  await database.close();
}
