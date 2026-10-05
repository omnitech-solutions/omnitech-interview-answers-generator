import {
  getPlatformDatabase,
  MigrationMismatchError,
  roleBypassesRowLevelSecurityMessage,
  verifyDatabaseRole,
  verifyMigrations,
} from "@omnitech/database";
import { createPlatformAiGateway } from "./src/platform/ai";
import { createProductBackends } from "./src/platform/products";

// Node.js only (see instrumentation.ts): each product's in-process worker,
// stopped with the server.
// A DATABASE_URL whose role bypasses row-level security stops the server here,
// not at the first tenant request, and so does a database that has not applied
// exactly this build's migrations (pending, ahead or mismatched; `pnpm
// db:migrate` is a separate deploy step, never run here). Anything else
// (database still starting, URL not set) is not this check's business and
// surfaces at first use as before.
try {
  const database = getPlatformDatabase();
  await verifyDatabaseRole(database);
  await verifyMigrations(database);
} catch (error) {
  if (
    error instanceof MigrationMismatchError ||
    (error instanceof Error &&
      error.message === roleBypassesRowLevelSecurityMessage)
  )
    throw error;
}

const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());
for (const backend of createProductBackends(createPlatformAiGateway()))
  backend.runWorker?.(stop.signal).catch((error) =>
    // Only the error's class is logged; its message can quote content.
    console.error(
      JSON.stringify({
        productWorker: error instanceof Error ? error.name : "stopped",
      }),
    ),
  );
