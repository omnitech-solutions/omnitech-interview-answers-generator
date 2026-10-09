import {
  getPlatformDatabase,
  MigrationMismatchError,
  roleBypassesRowLevelSecurityMessage,
  verifyDatabaseRole,
  verifyMigrations,
} from "@omnitech/database";
import { createPlatformAiEngine } from "./src/platform/ai";
import { resolveAuthSecret } from "./src/platform/auth-settings";
import { createProductBackends } from "./src/platform/products";

// Node.js only (see instrumentation.ts): each product's in-process worker,
// stopped with the server.

// [SAFETY] A fatal startup condition ends the process. `next start` only logs a
// throwing startup check and then answers 500 to every request forever, which a
// supervisor that checks "process alive" or "port open" would call healthy
// (verified by experiment). The messages are fixed strings: no SQL, URL or data.
function refuseToStart(message: string): never {
  console.error(JSON.stringify({ startup: "refused", reason: message }));
  return process.exit(1);
}

// [SAFETY] No session secret stops the server here, not at the first sign-in
// (and never at `next build`, which does not run this file). The committed
// development secret counts only with FAKE_AUTH_ENABLED outside production.
if (!resolveAuthSecret())
  refuseToStart(
    "AUTH_SECRET is not set. Set a random secret of 32 or more characters (openssl rand -base64 32).",
  );
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
    refuseToStart(error.message);
}

const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());
for (const backend of createProductBackends(createPlatformAiEngine()))
  backend.runWorker?.(stop.signal).catch((error) =>
    // Only the error's class is logged; its message can quote content.
    console.error(
      JSON.stringify({
        productWorker: error instanceof Error ? error.name : "stopped",
      }),
    ),
  );
