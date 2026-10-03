import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClaudeRuntimeAdapter } from "@omnitech/agent-runtime-claude";
import { createCodexRuntimeAdapter } from "@omnitech/agent-runtime-codex";
import type { AgentRuntimeAdapter } from "@omnitech/agent-runtime-contracts";
import { DockerCodeRunner } from "@omnitech/code-runner";
import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "@omnitech/database";
import { AgentPayloadStore } from "@omnitech/platform-storage";
import { PostgresAgentJobWorkerRepository } from "@omnitech/platform-storage/worker";
import { resolveAgentProfiles } from "@omnitech/ai-runtime/config";
import {
  type AgentEscalationPort,
  createSessionWorker,
  type SessionCodeRunner,
} from "@omnitech/product-interview/session-worker";
import { runAgentWorker } from "./index.js";
import { createSessionGateway } from "./session-gateway.js";
import { runSessionLoop, sessionWorkerId } from "./session-loop.js";

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

// [SAFETY] What a Codex or Claude Code process may inherit: the account and
// shell basics the CLIs need and their own CODEX_* / ANTHROPIC_* / CLAUDE_*
// settings. The database URL, payload and connected-account secrets and the
// worker's model keys never reach an agent process, except that the Codex
// adapter alone also inherits OPENAI_API_KEY, the key its CLI signs in with.
const AGENT_ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "TMPDIR",
  "TZ",
  "TERM",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
]);
const AGENT_ENV_PREFIXES = ["LC_", "CODEX_", "ANTHROPIC_", "CLAUDE_"];

const CODEX_ENV_NAMES = new Set(["OPENAI_API_KEY"]);

export function agentEnvironment(
  env: Environment,
  runtime?: "codex" | "claude-code",
): Record<string, string> {
  const allowed: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (
      value !== undefined &&
      (AGENT_ENV_NAMES.has(name) ||
        (runtime === "codex" && CODEX_ENV_NAMES.has(name)) ||
        AGENT_ENV_PREFIXES.some((prefix) => name.startsWith(prefix)))
    )
      allowed[name] = value;
  }
  return allowed;
}

function agentRuntimes(
  env: Environment,
): Readonly<Record<string, AgentRuntimeAdapter>> {
  const codexPath = installedCodex(env);
  return {
    codex: createCodexRuntimeAdapter({
      environment: agentEnvironment(env, "codex"),
      ...(codexPath ? { codexPathOverride: codexPath } : {}),
    }),
    "claude-code": createClaudeRuntimeAdapter({
      environment: agentEnvironment(env, "claude-code"),
    }),
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

// A named loop the worker runs beside the others. Each loop owns its error
// handling; the shared database outlives all of them.
export type WorkerLoop = {
  name: string;
  run(signal: AbortSignal): Promise<void>;
};

// Runs every loop to its end. A loop that rejects is logged by name only (never
// a message) and the others keep running; `shared` (the database) is released
// only after ALL loops settled, then the failed loops are reported.
export async function runWorkerLoops(
  loops: readonly WorkerLoop[],
  signal: AbortSignal,
  shared: { close(): Promise<void> },
  log: (line: string) => void = console.error,
): Promise<void> {
  try {
    const settled = await Promise.allSettled(
      loops.map(async (loop) => {
        try {
          await loop.run(signal);
        } catch (error) {
          log(
            `worker loop failed: ${loop.name} (${error instanceof Error && /^[A-Za-z0-9_.-]{1,64}$/.test(error.name) ? error.name : "Error"})`,
          );
          throw error;
        }
      }),
    );
    const failed = loops
      .filter((_, index) => settled[index]?.status === "rejected")
      .map(({ name }) => name);
    if (failed.length > 0)
      throw new Error(`Worker loops failed: ${failed.join(", ")}.`);
  } finally {
    await shared.close();
  }
}

function agentJobLoop(
  env: Environment,
  database: PlatformDatabase,
  payloadSecret: string,
  runtimes: Readonly<Record<string, AgentRuntimeAdapter>>,
): WorkerLoop {
  const payloads = new AgentPayloadStore(database, payloadSecret);
  return {
    name: "agent-job",
    run: (signal) =>
      runAgentWorker(
        {
          workerId: `${env["AGENT_WORKER_ID"] ?? "worker"}:${crypto.randomUUID()}`,
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
      ),
  };
}

// The test runner of the coding path (ADR-0011): a sandboxed DockerCodeRunner,
// only when the host asks for it. Without it a solution still publishes, with
// tests never claimed passed. A device-only session may use the runner only if
// the host also declares it runs on this device.
export function sessionRunnerOptions(env: Environment): {
  codeRunner?: SessionCodeRunner;
  runnerDeviceLocal?: boolean;
} {
  if (env["ACTIVE_SESSION_CODE_RUNNER"] !== "docker") return {};
  return {
    codeRunner: new DockerCodeRunner(),
    ...(env["ACTIVE_SESSION_RUNNER_DEVICE_LOCAL"] === "true"
      ? { runnerDeviceLocal: true }
      : {}),
  };
}

// Agent jobs for a validated escalation (ADR-0011 D7): opt in with
// ACTIVE_SESSION_AGENT_ESCALATION=on. The profile is a typed, versioned,
// bounded one chosen by the host from the validated kind; the job carries only
// a reference to its encrypted prompt payload.
export function sessionAgentEscalation(
  env: Environment,
  database: PlatformDatabase,
): AgentEscalationPort | undefined {
  if (env["ACTIVE_SESSION_AGENT_ESCALATION"] !== "on") return undefined;
  const secret = env["AGENT_PAYLOAD_SECRET"] ?? env["CONNECTED_ACCOUNT_SECRET"];
  if (!secret) return undefined;
  const profiles = resolveAgentProfiles(env);
  const payloads = new AgentPayloadStore(database, secret);
  return {
    profileFor: () => profiles.get("coding-quality"),
    savePrompt: (tenantId, prompt) => payloads.save(tenantId, prompt),
    discardPrompt: (tenantId, reference) =>
      payloads.delete(tenantId, reference),
  };
}

// The Active Session loop (ADR-0011) with its own gateway; null (loop not
// started, job loop unaffected) when no language model is configured.
export function sessionLoop(
  env: Environment,
  database: PlatformDatabase,
  log: (line: string) => void,
): WorkerLoop | null {
  let session: ReturnType<typeof createSessionGateway>;
  try {
    session = createSessionGateway(env);
  } catch {
    // A misconfigured model must not take the job loop down with it.
    log("session loop disabled: language model unusable");
    return null;
  }
  if (!session) {
    log("session loop disabled: no language model configured");
    return null;
  }
  const escalation = sessionAgentEscalation(env, database);
  return {
    name: "session",
    run: (signal) =>
      runSessionLoop({
        processor: createSessionWorker({
          database,
          gateway: session.gateway,
          workerId: sessionWorkerId(env),
          log,
          ...sessionRunnerOptions(env),
          ...(escalation ? { agentEscalation: escalation } : {}),
        }),
        signal,
        log,
      }),
  };
}

// The worker as configured by its environment, until the signal aborts.
// `runtimes` replaces the Codex and Claude Code adapters.
export async function runConfiguredAgentWorker(
  env: Environment,
  signal: AbortSignal,
  runtimes: Readonly<Record<string, AgentRuntimeAdapter>> = agentRuntimes(env),
  log: (line: string) => void = console.error,
): Promise<void> {
  const payloadSecret =
    env["AGENT_PAYLOAD_SECRET"] ?? env["CONNECTED_ACCOUNT_SECRET"];
  if (!payloadSecret) {
    throw new Error("AGENT_PAYLOAD_SECRET is required by the agent worker.");
  }
  const database = createPlatformDatabase(env["DATABASE_URL"]);
  const loops = [
    agentJobLoop(env, database, payloadSecret, runtimes),
    sessionLoop(env, database, log),
  ].filter((loop): loop is WorkerLoop => loop !== null);
  await runWorkerLoops(loops, signal, database, log);
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
