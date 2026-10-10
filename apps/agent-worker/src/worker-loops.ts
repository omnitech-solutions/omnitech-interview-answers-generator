// The loops the worker runs side by side: how each is built from the host's
// shared things, the table that registers them, and the runner that keeps one
// loop's failure from stopping the others.
import { type AgentRuntimeAdapter, runAgentWorker } from "@omnitech/ai-engine";
import { DockerCodeRunner } from "@omnitech/code-runner";
import type { PlatformDatabase } from "@omnitech/database";
import { resolveAgentProfiles } from "@omnitech/platform-runtime/ai-config";
import {
  AgentPayloadStore,
  agentPayloadSecret,
} from "@omnitech/platform-storage";
import { PostgresAgentJobWorkerRepository } from "@omnitech/platform-storage/worker";
import {
  type AgentEscalationPort,
  createSessionScreenshotLoader,
  createSessionStillPermitted,
  createSessionSweeper,
  createSessionWorker,
  type SessionCodeRunner,
} from "@omnitech/product-interview/session-worker";
import { agentRuntimes, type Environment } from "./agent-environment";
import { coachLoop } from "./coach-loop";
import { engineTrace, workerEngineLog } from "./engine-trace";
import { flaggedLoop } from "./flagged-loop";
import { defaultStagingBase, sweepStagingBase } from "./session-agent-port";
import { createSessionEngine, SESSION_AGENT_FLAG } from "./session-engine";
import { runSessionLoop, sessionWorkerId } from "./session-loop";

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
    run: async (signal) => {
      // Each job's run is kept like any other AI interaction (ADR-0037).
      const kept = engineTrace(env);
      try {
        await runAgentWorker(
          {
            workerId: `${env["AGENT_WORKER_ID"] ?? "worker"}:${crypto.randomUUID()}`,
            // Interactive turns (the assistant) wait on this; an idle claim is
            // one cheap indexed query.
            ...workerSettings(env),
            repository: new PostgresAgentJobWorkerRepository(database),
            loadPrompt: (reference) => payloads.load(reference),
            storeResult: (tenantId, result) =>
              payloads.save(tenantId, JSON.stringify(result)),
            runtimes,
            // What the worker says of each job: claimed, ended, a lease lost.
            log: workerEngineLog(env),
            trace: kept.trace,
          },
          signal,
        );
      } finally {
        await kept.close();
      }
    },
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
  const secret = agentPayloadSecret(env);
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

// The Active Session loop (ADR-0011) with its own AI engine; null (loop not
// started, job loop unaffected) when no language model is configured.
export function sessionLoop(
  env: Environment,
  database: PlatformDatabase,
  log: (line: string) => void,
  runtimes?: Readonly<Record<string, AgentRuntimeAdapter>>,
): WorkerLoop | null {
  let session: ReturnType<typeof createSessionEngine>;
  try {
    // The agent port is off unless the explicit flag is set (ADR-0016).
    session = createSessionEngine(env, {
      log,
      ...(env[SESSION_AGENT_FLAG] === "on"
        ? {
            runtimes: runtimes ?? agentRuntimes(env),
            // Screenshots reach a runtime only through the product's loader:
            // observation ids joined to the owner's session, verified, capped.
            attachmentSource: createSessionScreenshotLoader(database),
            // After any capacity wait the port re-reads the session row.
            stillPermitted: createSessionStillPermitted(database),
          }
        : {}),
    });
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
    run: async (signal) => {
      // Staged screenshots left by a previous process are removed first.
      if (session.agentStaging)
        await sweepStagingAtStartup(session.agentStaging.sweep, log);
      try {
        await runSessionLoop({
          processor: createSessionWorker({
            database,
            engine: session.engine,
            answeredBy: session.answeredBy,
            workerId: sessionWorkerId(env),
            log,
            ...sessionRunnerOptions(env),
            ...(escalation ? { agentEscalation: escalation } : {}),
            ...(session.visionProfileId
              ? { visionProfileId: session.visionProfileId }
              : {}),
            // Content staged outside the database goes with every purge.
            afterPurge: async () => session?.agentStaging?.sweepIdle(),
          }),
          signal,
          log,
        });
      } finally {
        // What the engine kept is written before its connection is closed.
        await session?.close();
      }
    },
  };
}

// The startup sweep of staged screenshots. A staging directory this worker
// cannot trust (a link, another owner's, open to others) is refused: the worker
// keeps running and says so, naming no path and no id.
export async function sweepStagingAtStartup(
  sweep: () => Promise<void>,
  log: (line: string) => void,
): Promise<void> {
  try {
    await sweep();
  } catch {
    log("session staging sweep refused: staging directory is not private");
  }
}

// The cap and purge sweeps for a host with no language model (ADR-0016): ended
// sessions still delete their observations, owner inputs and artifacts, and
// staged screenshots left by any earlier process are removed. It claims no
// session and calls no model.
export function sessionSweepLoop(
  env: Environment,
  database: PlatformDatabase,
  log: (line: string) => void,
): WorkerLoop {
  const stagingBase =
    env["ACTIVE_SESSION_AGENT_STAGING_DIR"] ?? defaultStagingBase();
  return {
    name: "session-sweep",
    run: async (signal) => {
      await sweepStagingAtStartup(() => sweepStagingBase(stagingBase), log);
      await runSessionLoop({
        processor: createSessionSweeper({
          database,
          workerId: sessionWorkerId(env),
          log,
          afterPurge: () => sweepStagingBase(stagingBase),
        }),
        signal,
        log,
      });
    },
  };
}

/** What every loop is built from; the database outlives all of them. */
export interface WorkerHost {
  env: Environment;
  database: PlatformDatabase;
  payloadSecret: string;
  runtimes: Readonly<Record<string, AgentRuntimeAdapter>>;
  log: (line: string) => void;
}

// The worker's loops, in start order. An entry that builds nothing (null) is
// not run. Adding a loop to the worker is a row here.
export const WORKER_LOOPS: readonly {
  name: string;
  create(host: WorkerHost): WorkerLoop | null;
}[] = [
  {
    name: "agent-job",
    create: ({ env, database, payloadSecret, runtimes }) =>
      agentJobLoop(env, database, payloadSecret, runtimes),
  },
  {
    // Without a usable model there is no session loop, but ended sessions are
    // still purged (their observations, owner inputs and staged images).
    name: "session",
    create: ({ env, database, log, runtimes }) =>
      sessionLoop(env, database, log, runtimes) ??
      sessionSweepLoop(env, database, log),
  },
  {
    // The live coach, when the host or Settings names a runtime for it. Its
    // flags are followed while the worker runs (flagged-loop.ts): a change
    // in Settings starts, stops or restarts it without restarting the worker.
    name: "coach",
    create: ({ env, database, log, runtimes }) =>
      flaggedLoop(
        "coach",
        env,
        (flagged) => coachLoop(flagged, runtimes, log, database),
        log,
      ),
  },
];

export function workerLoops(host: WorkerHost): WorkerLoop[] {
  return WORKER_LOOPS.map((entry) => entry.create(host)).filter(
    (loop): loop is WorkerLoop => loop !== null,
  );
}
