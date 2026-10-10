// Where this worker's AI runs are kept (ADR-0037). One decision for both
// loops: the session loop's model calls and the job loop's agent runs are kept
// the same way, in the same place, or not at all.
import {
  combineTraces,
  createOtelTrace,
  type EngineLogger,
  keepTraceIn,
  type TraceConfig,
} from "@omnitech/ai-engine";
import { engineLog } from "@omnitech/platform-runtime/ai-log";

type Environment = Readonly<Record<string, string | undefined>>;

// A Postgres with the engine's tables (`ai-engine db setup`). Absent: runs are
// timed, logged and exported as telemetry spans, and none is kept.
export const ENGINE_DATABASE_ENV = "AI_ENGINE_DATABASE_URL";
// "full" keeps prompts and answers with each step, for development. Any other
// value keeps ids, timing and usage, and no content (AGENTS.md rule 8).
export const ENGINE_CAPTURE_ENV = "AI_ENGINE_CAPTURE";

// [DOMAIN] The engine's own log, for every engine, job worker and runtime this
// worker builds: the Studio's logger as its sink, the same defaults as the web
// server (everything in development; nothing in production unless
// AI_ENGINE_LOG_LEVEL asks; content only where LOG_CONTENT allows).
export const workerEngineLog = (env: Environment): EngineLogger =>
  engineLog({ service: "agent-worker", env });

export type EngineTrace = {
  trace: TraceConfig;
  // Ends the connection the runs are kept through.
  close(): Promise<void>;
};

export function engineTrace(
  env: Environment,
  log?: (line: string) => void,
): EngineTrace {
  const url = env[ENGINE_DATABASE_ENV]?.trim();
  const kept = url ? keepTraceIn(url) : undefined;
  // Said once, so a store that does not answer is seen and not guessed at.
  void kept
    ?.ready()
    .then((ready) =>
      log?.(
        ready
          ? "ai engine: runs are kept in the engine's database"
          : "ai engine: the engine's database did not answer; runs are not kept",
      ),
    );
  return {
    trace: {
      // A telemetry span for every step; it does nothing until the host
      // registers an OpenTelemetry SDK.
      sink: kept ? combineTraces(kept, createOtelTrace()) : createOtelTrace(),
      capture: env[ENGINE_CAPTURE_ENV] === "full" ? "full" : "metadata",
    },
    close: async () => {
      await kept?.close().catch(() => undefined);
    },
  };
}
