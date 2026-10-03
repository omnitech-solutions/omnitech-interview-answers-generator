import { createPlatformAiGateway } from "./src/platform/ai";
import { createProductBackends } from "./src/platform/products";

// Node.js only (see instrumentation.ts): each product's in-process worker,
// stopped with the server.
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
