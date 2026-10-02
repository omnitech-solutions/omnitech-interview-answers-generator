import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { type PlatformDatabase, withPoolClient } from "./connection.js";

// The Drizzle stream ships beside dist (package "files": ["dist", "drizzle"]).
const migrationsFolder = new URL("../drizzle", import.meta.url).pathname;

// Applies Drizzle migrations not yet recorded (by name) in
// drizzle.__drizzle_migrations. Run after the legacy SQL.
export async function runDrizzleMigrations(
  database: PlatformDatabase,
): Promise<void> {
  await withPoolClient(database, (client) =>
    migrate(drizzle({ client }), {
      migrationsFolder,
      migrationsSchema: "drizzle",
      migrationsTable: "__drizzle_migrations",
    }).then(() => undefined),
  );
}
