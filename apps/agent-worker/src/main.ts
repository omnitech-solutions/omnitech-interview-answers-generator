import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClaudeRuntimeAdapter } from "@omnitech/agent-runtime-claude";
import { createCodexRuntimeAdapter } from "@omnitech/agent-runtime-codex";
import type { AgentRuntimeAdapter } from "@omnitech/agent-runtime-contracts";
import { createPlatformDatabase } from "@omnitech/database";
import { AgentPayloadStore } from "@omnitech/platform-storage";
import { PostgresAgentJobWorkerRepository } from "@omnitech/platform-storage/worker";
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

function whole(
  env: Environment,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return value;
}

/**
 * How many jobs run at once, how soon a waiting worker looks again, and how
 * long a running job's lease lasts between heartbeats. Documents are written
 * in several parallel calls, so the default runs six at a time.
 */
export function workerSettings(env: Environment) {
  return {
    pollIntervalMs: whole(env, "AGENT_WORKER_POLL_MS", 100, 10, 60_000),
    concurrency: whole(env, "AGENT_WORKER_CONCURRENCY", 6, 1, 16),
    leaseMs: whole(env, "AGENT_WORKER_LEASE_MS", 30_000, 3_000, 600_000),
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
        ...workerSettings(env),
        repository: new PostgresAgentJobWorkerRepository(database),
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
