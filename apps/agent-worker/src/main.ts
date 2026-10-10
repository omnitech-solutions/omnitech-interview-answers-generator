// The agent worker's startup: check the host, build the loops the table
// registers (worker-loops.ts), run them until the signal aborts.
import { pathToFileURL } from "node:url";
import type { AgentRuntimeAdapter } from "@omnitech/ai-engine";
import {
  createPlatformDatabase,
  verifyDatabaseRole,
  verifyMigrations,
} from "@omnitech/database";
import { agentPayloadSecret } from "@omnitech/platform-storage";
import { agentRuntimes, type Environment } from "./agent-environment";
import { runWorkerLoops, workerLoops } from "./worker-loops";

// The coach's replay and pack tools read this from here.
export { agentEnvironment } from "./agent-environment";

// The worker as configured by its environment, until the signal aborts.
// `runtimes` replaces the Codex and Claude Code adapters.
export async function runConfiguredAgentWorker(
  env: Environment,
  signal: AbortSignal,
  runtimes: Readonly<Record<string, AgentRuntimeAdapter>> = agentRuntimes(env),
  log: (line: string) => void = console.error,
): Promise<void> {
  const payloadSecret = agentPayloadSecret(env);
  if (!payloadSecret) {
    throw new Error("AGENT_PAYLOAD_SECRET is required by the agent worker.");
  }
  const database = createPlatformDatabase(env["DATABASE_URL"]);
  // Stops the process at boot when the role bypasses row-level security or
  // the database has not applied exactly this build's migrations (never run
  // here: `pnpm db:migrate` is a separate deploy step).
  await verifyDatabaseRole(database)
    .then(() => verifyMigrations(database))
    .catch(async (error: unknown) => {
      await database.close();
      throw error;
    });
  const loops = workerLoops({ env, database, payloadSecret, runtimes, log });
  try {
    await runWorkerLoops(loops, signal, database, log);
  } finally {
    await Promise.all(
      Object.values(runtimes).map((runtime) => runtime.close?.()),
    );
  }
}

// Run as the service (`pnpm --filter @omnitech/agent-worker dev`, `start`).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const controller = new AbortController();
  const stop = controller.abort.bind(controller);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await runConfiguredAgentWorker(process.env, controller.signal);
}
