import { createPlatformAiGateway } from "./src/platform/ai";
import { runInterviewWorker } from "./src/platform/interview-studio";

// Node.js only (see instrumentation.ts): the assistant's run worker, stopped
// with the server.
if (process.env["DATABASE_URL"]) {
  const stop = new AbortController();
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  runInterviewWorker(createPlatformAiGateway(), stop.signal).catch((error) =>
    console.error(
      JSON.stringify({
        interviewWorker: error instanceof Error ? error.message : "stopped",
      }),
    ),
  );
}
