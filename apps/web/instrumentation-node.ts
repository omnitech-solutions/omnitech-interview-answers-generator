import {
  getPlatformDatabase,
  roleBypassesRowLevelSecurityMessage,
  verifyDatabaseRole,
} from "@omnitech/database";
import { createPlatformAiGateway } from "./src/platform/ai";
import { createProductBackends } from "./src/platform/products";

// Node.js only (see instrumentation.ts): each product's in-process worker,
// stopped with the server.
// A DATABASE_URL whose role bypasses row-level security stops the server here,
// not at the first tenant request. Anything else (database still starting, URL
// not set) is not this check's business and surfaces at first use as before.
try {
  await verifyDatabaseRole(getPlatformDatabase());
} catch (error) {
  if (
    error instanceof Error &&
    error.message === roleBypassesRowLevelSecurityMessage
  )
    throw error;
}

const stop = new AbortController();
process.once("SIGTERM", () => stop.abort());
process.once("SIGINT", () => stop.abort());
for (const backend of createProductBackends(createPlatformAiGateway()))
  backend.runWorker?.(stop.signal).catch((error) =>
    console.error(
      JSON.stringify({
        productWorker: error instanceof Error ? error.message : "stopped",
      }),
    ),
  );
