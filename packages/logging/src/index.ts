// One structured logger for every service: an event name plus fields, written
// as one line (JSON in production, readable elsewhere). Levels, format and
// whether content may be written come from the environment, so a trace is a
// configuration change, never a code change.
//
// Redaction is built in and cannot be turned off: a key that looks like a
// credential is replaced, long strings are cut, and the `content` field (a
// prompt, a model's output, a transcript) is dropped unless LOG_CONTENT=true
// AND the level is trace. That keeps the default silent about content.

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";
export type LogFields = Record<string, unknown>;
export type LogFormat = "json" | "pretty";

export interface LogConfig {
  level: LogLevel;
  format: LogFormat;
  content: boolean;
}

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
  format?: LogFormat;
  content?: boolean;
  bindings?: LogFields;
  env?: Record<string, string | undefined>;
  write?: (line: string) => void;
  now?: () => Date;
}

export interface Logger {
  readonly service: string;
  readonly config: LogConfig;
  enabled(level: LogLevel): boolean;
  error(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  debug(event: string, fields?: LogFields): void;
  trace(event: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

const LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug", "trace"];
const rank = (level: LogLevel): number => LEVELS.indexOf(level);
const isLevel = (value: string | undefined): value is LogLevel =>
  LEVELS.includes(value as LogLevel);

export function resolveLogConfig(
  env: Record<string, string | undefined> = process.env,
): LogConfig {
  const node = env["NODE_ENV"];
  const level = isLevel(env["LOG_LEVEL"])
    ? env["LOG_LEVEL"]
    : node === "production"
      ? "info"
      : node === "test"
        ? "warn"
        : "debug";
  const format: LogFormat =
    env["LOG_FORMAT"] === "json" || env["LOG_FORMAT"] === "pretty"
      ? env["LOG_FORMAT"]
      : node === "production"
        ? "json"
        : "pretty";
  return {
    level,
    format,
    content: env["LOG_CONTENT"] === "true" && level === "trace",
  };
}

// ---- redaction ----------------------------------------------------------------

const DENIED_KEY =
  /authorization|cookie|api[-_]?key|token|secret|password|credential|private[-_]?key|base64/i;
const MAX_STRING = 2_000;
const MAX_DEPTH = 6;

export function redactFields(
  fields: LogFields,
  options: { content: boolean },
): LogFields {
  const seen = new WeakSet<object>();
  const walk = (value: unknown, depth: number): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value === "string")
      return value.length > MAX_STRING
        ? `${value.slice(0, MAX_STRING)}…[+${value.length - MAX_STRING}]`
        : value;
    if (typeof value !== "object") return value;
    if (value instanceof Error)
      return { name: value.name, message: value.message };
    if (depth >= MAX_DEPTH) return "[depth]";
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1));
    const out: LogFields = {};
    for (const [key, child] of Object.entries(value)) {
      if (DENIED_KEY.test(key)) out[key] = "[redacted]";
      else out[key] = walk(child, depth + 1);
    }
    return out;
  };
  const { content, ...rest } = fields;
  const redacted = walk(rest, 0) as LogFields;
  if (options.content && content !== undefined)
    redacted["content"] = walk(content, 0);
  return redacted;
}

// ---- formatting ---------------------------------------------------------------

function pretty(
  time: Date,
  level: LogLevel,
  service: string,
  event: string,
  fields: LogFields,
): string {
  const clock = time.toISOString().slice(11, 23);
  const pairs = Object.entries(fields)
    .map(
      ([key, value]) =>
        `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`,
    )
    .join(" ");
  return `${clock} ${level.toUpperCase().padEnd(5)} ${service} ${event}${pairs ? ` ${pairs}` : ""}`;
}

// ---- the logger ---------------------------------------------------------------

export function createLogger(options: LoggerOptions): Logger {
  const fromEnv = resolveLogConfig(options.env);
  const config: LogConfig = {
    level: options.level ?? fromEnv.level,
    format: options.format ?? fromEnv.format,
    content:
      options.content ??
      (fromEnv.content && (options.level ?? fromEnv.level) === "trace"),
  };
  const write =
    options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const bindings = options.bindings ?? {};

  const emit = (level: LogLevel, event: string, fields: LogFields = {}) => {
    if (rank(level) > rank(config.level)) return;
    const time = now();
    const merged = redactFields(
      { ...bindings, ...fields },
      { content: config.content },
    );
    if (config.format === "json") {
      write(
        JSON.stringify({
          time: time.toISOString(),
          level,
          service: options.service,
          event,
          ...merged,
        }),
      );
    } else write(pretty(time, level, options.service, event, merged));
  };

  return {
    service: options.service,
    config,
    enabled: (level) => rank(level) <= rank(config.level),
    error: (event, fields) => emit("error", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    info: (event, fields) => emit("info", event, fields),
    debug: (event, fields) => emit("debug", event, fields),
    trace: (event, fields) => emit("trace", event, fields),
    child: (more) =>
      createLogger({
        ...options,
        level: config.level,
        format: config.format,
        content: config.content,
        bindings: { ...bindings, ...more },
      }),
  };
}
