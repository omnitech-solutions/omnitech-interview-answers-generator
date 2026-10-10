// The AI engine's log, in the Studio's own format. PROBLEM: the engine has a
// logger of its own, and every process that builds an engine (the web server,
// the agent worker's session loop, its coach, its job loop) must say the same
// lines the same way, through the Studio's one logger, with the same defaults.
// STRATEGY: one function turns the process's environment into the engine's
// logger: the Studio's logger as its sink, the process as its context, the
// mode from NODE_ENV, the level from AI_ENGINE_LOG_LEVEL, and content only
// where the Studio's own switch allows it.
// COMPLEXITY: O(1) to build; O(fields) per line.
// [SAFETY] Content (a whole prompt, a whole answer) is the engine's two
// content events only, and they are written only when the Studio's logger
// allows content (LOG_CONTENT=true, read by a person: `pnpm dev`). Even then
// it travels in the logger's `content` field, which the logger drops by itself
// everywhere else, so rule 8 holds twice over.
import {
  createEngineLogger,
  type EngineLogger,
  type EngineLogSink,
} from "@omnitech/ai-engine";
import { createLogger, type LogFields, type Logger } from "@omnitech/logging";

type EngineLogEnvironment = Readonly<Record<string, string | undefined>>;

// How much the engine says: trace, debug, info, warn, error, or silent.
const ENGINE_LOG_LEVEL_ENV = "AI_ENGINE_LOG_LEVEL";
const LEVELS = ["trace", "debug", "info", "warn", "error", "silent"] as const;
type Level = (typeof LEVELS)[number];

// What the engine's content events say, moved under the logger's own
// `content` field so its switch governs them.
const CONTENT_FIELDS = ["prompt", "schema", "completion", "reasoning"] as const;

export type EngineLogOptions = Readonly<{
  // The process the engine runs in: "interview-web", "agent-worker".
  service: string;
  env?: EngineLogEnvironment;
  // The Studio logger the lines go to. Default: one made for `service`.
  logger?: Logger;
}>;

// [DOMAIN] What each mode says without being asked. Development: everything,
// whole prompts and answers included when the logger allows content. Test:
// nothing, so a test run stays quiet. Production: nothing unless
// AI_ENGINE_LOG_LEVEL asks, and never content unless LOG_CONTENT does too.
export function engineLogLevel(env: EngineLogEnvironment): Level {
  const asked = env[ENGINE_LOG_LEVEL_ENV]?.trim().toLowerCase();
  const level = LEVELS.find((each) => each === asked);
  if (level) return level;
  // A caller that hands over a part of the environment (a test's own, a
  // worker's settings) still runs in this process: its mode is the fallback.
  const mode = env["NODE_ENV"] ?? process.env["NODE_ENV"];
  return mode === "production" || mode === "test" ? "silent" : "trace";
}

// The engine's lines as the Studio's logger writes them: the event as
// `ai.<event>`, the engine's sentence as `message`, and its fields.
export function engineLogSink(logger: Logger): EngineLogSink {
  const line =
    (level: "trace" | "debug" | "info" | "warn" | "error") =>
    (context: object, message: string): void => {
      // `service` is the engine's own name for itself; the logger already
      // says which process this is.
      const { event, service: _engine, ...fields } = context as LogFields;
      const content: LogFields = {};
      for (const key of CONTENT_FIELDS)
        if (key in fields) {
          content[key] = fields[key];
          delete fields[key];
        }
      const name = typeof event === "string" ? event : "line";
      // The engine's content events are already named `ai.*`.
      logger[level](name.startsWith("ai.") ? name : `ai.${name}`, {
        message,
        ...fields,
        ...(Object.keys(content).length > 0 ? { content } : {}),
      });
    };
  return {
    trace: line("trace"),
    debug: line("debug"),
    info: line("info"),
    warn: line("warn"),
    error: line("error"),
  };
}

// The logger every engine, job worker and runtime of this process is given.
export function engineLog(options: EngineLogOptions): EngineLogger {
  const env = options.env ?? process.env;
  const logger =
    options.logger ?? createLogger({ service: options.service, env });
  return createEngineLogger({
    mode:
      (env["NODE_ENV"] ?? process.env["NODE_ENV"]) === "production"
        ? "production"
        : "development",
    level: engineLogLevel(env),
    // The Studio's switch decides, whatever the mode.
    content: logger.config.content,
    sink: engineLogSink(logger),
    bindings: { process: options.service },
  });
}
