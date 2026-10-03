import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClaudeRuntimeAdapter } from "@omnitech/agent-runtime-claude";
import { createCodexRuntimeAdapter } from "@omnitech/agent-runtime-codex";
import type { AgentRuntimeAdapter } from "@omnitech/agent-runtime-contracts";
import { createPlatformDatabase } from "@omnitech/database";
import {
  AgentPayloadStore,
  PostgresAgentJobRepository,
} from "@omnitech/platform-storage";
import { runAgentWorker } from "./index.js";

type Environment = Readonly<Record<string, string | undefined>>;

// The person's installed Codex CLI (CODEX_PATH, else `codex` on PATH): the
// SDK's bundled binary can lag behind it, and a ChatGPT sign-in then refuses
// current models. Falls back to the bundled binary when none is installed.
function installedCodex(env: Environment): string | undefined {
  if (env["CODEX_PATH"]) return env["CODEX_PATH"];
  for (const directory of (env["PATH"] ?? "").split(delimiter)) {
    const candidate = join(directory, "codex");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

function agentRuntimes(
  env: Environment,
): Readonly<Record<string, AgentRuntimeAdapter>> {
  const codexPath = installedCodex(env);
  return {
    codex: createCodexRuntimeAdapter(
      codexPath ? { codexPathOverride: codexPath } : {},
    ),
    "claude-code": createClaudeRuntimeAdapter(),
  };
}

// The worker as configured by its environment, until the signal aborts.
// `runtimes` replaces the Codex and Claude Code adapters.
export async function runConfiguredAgentWorker(
  env: Environment,
  signal: AbortSignal,
  runtimes: Readonly<Record<string, AgentRuntimeAdapter>> = agentRuntimes(env),
): Promise<void> {
  const payloadSecret =
    env["AGENT_PAYLOAD_SECRET"] ?? env["CONNECTED_ACCOUNT_SECRET"];
  if (!payloadSecret) {
    throw new Error("AGENT_PAYLOAD_SECRET is required by the agent worker.");
  }
  const database = createPlatformDatabase(env["DATABASE_URL"]);
  const payloads = new AgentPayloadStore(database, payloadSecret);
  try {
    await runAgentWorker(
      {
        workerId: env["AGENT_WORKER_ID"] ?? crypto.randomUUID(),
        // Interactive turns (the assistant) wait on this; an idle claim is one
        // cheap indexed query.
        pollIntervalMs: Number(env["AGENT_WORKER_POLL_MS"] ?? 100),
        repository: new PostgresAgentJobRepository(database),
        loadPrompt: (reference) => payloads.load(reference),
        storeResult: (tenantId, result) =>
          payloads.save(tenantId, JSON.stringify(result)),
        runtimes,
      },
      signal,
    );
  } finally {
    await database.close();
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
