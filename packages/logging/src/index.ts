// One structured logger for every service: an event name plus fields, written
// as one line (JSON in production, readable elsewhere). Levels, format and
// whether content may be written come from the environment, so a trace is a
// configuration change, never a code change.
//
// Redaction is built in and cannot be turned off: a key that looks like a
// credential is replaced, long strings are cut, and the `content` field (a
// prompt, a model's output, a transcript) is dropped unless LOG_CONTENT=true
// AND a person chose to read it (level trace, or the story format of a local
// `pnpm dev`). That keeps the default silent about content. When content IS
// allowed it is written whole: a person who asked to see a prompt needs all
// of it, so the cut that applies to every other string does not apply to it.

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";
export type LogFields = Record<string, unknown>;
export type LogFormat = "json" | "pretty" | "story";

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
    env["LOG_FORMAT"] === "json" ||
    env["LOG_FORMAT"] === "pretty" ||
    env["LOG_FORMAT"] === "story"
      ? env["LOG_FORMAT"]
      : node === "production"
        ? "json"
        : "pretty";
  return {
    level,
    format,
    // Content needs its own switch AND a format or level a person chose to
    // read it in: trace, or the story format of a local `pnpm dev`.
    content:
      env["LOG_CONTENT"] === "true" &&
      (level === "trace" || (format === "story" && node !== "production")),
  };
}

// ---- redaction ----------------------------------------------------------------

const DENIED_KEY =
  /authorization|cookie|api[-_]?key|token|secret|password|credential|private[-_]?key|base64/i;
const TOKEN_COUNT = /tokens$/i;
const MAX_STRING = 2_000;
const MAX_DEPTH = 6;

export function redactFields(
  fields: LogFields,
  options: { content: boolean },
): LogFields {
  const seen = new WeakSet<object>();
  // `whole`: inside `content`, where a string is what a person asked to read.
  const walk = (value: unknown, depth: number, whole = false): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value === "string")
      return !whole && value.length > MAX_STRING
        ? `${value.slice(0, MAX_STRING)}…[+${value.length - MAX_STRING}]`
        : value;
    if (typeof value !== "object") return value;
    if (value instanceof Error) return errorFields(value);
    if (depth >= MAX_DEPTH) return "[depth]";
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    if (Array.isArray(value))
      return value.map((item) => walk(item, depth + 1, whole));
    const out: LogFields = {};
    for (const [key, child] of Object.entries(value)) {
      // A count of tokens (`inputTokens: 1840`) is a number, not a credential.
      if (
        DENIED_KEY.test(key) &&
        !(TOKEN_COUNT.test(key) && typeof child === "number")
      )
        out[key] = "[redacted]";
      else out[key] = walk(child, depth + 1, whole);
    }
    return out;
  };
  const { content, ...rest } = fields;
  const redacted = walk(rest, 0) as LogFields;
  if (options.content && content !== undefined)
    redacted["content"] = walk(content, 0, true);
  return redacted;
}

// An error, understood (after docx-generator-studio's logger): its class, its
// message, its code when it has one, and the first frame of this application
// it passed through. Never the whole stack.
function errorFields(error: Error): LogFields {
  const code = (error as { code?: unknown }).code;
  const frame = (error.stack ?? "")
    .split("\n")
    .slice(1)
    .find((line) => !line.includes("node_modules") && !line.includes("node:"));
  const at = frame ? /\(?([^()\s]+):(\d+):\d+\)?$/.exec(frame.trim()) : null;
  return {
    name: error.name,
    message: error.message,
    ...(typeof code === "string" ? { code } : {}),
    ...(at?.[1]
      ? {
          source: `${at[1]
            .replace(/^file:\/\//, "")
            .split("/")
            .slice(-3)
            .join("/")}:${at[2]}`,
        }
      : {}),
  };
}

// ---- formatting ---------------------------------------------------------------

// A value on a line that must stay one line: a string as it is, unless it
// holds a line break, which is then written escaped.
const oneLine = (value: unknown): string =>
  typeof value === "string" && !/[\r\n]/.test(value)
    ? value
    : JSON.stringify(value);

function pretty(
  time: Date,
  level: LogLevel,
  service: string,
  event: string,
  fields: LogFields,
): string {
  const clock = time.toISOString().slice(11, 23);
  const pairs = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${oneLine(value)}`)
    .join(" ");
  return `${clock} ${level.toUpperCase().padEnd(5)} ${service} ${event}${pairs ? ` ${pairs}` : ""}`;
}

// ---- the story format -----------------------------------------------------------
//
// What a person reads while a session runs (`pnpm dev`): the few events that
// tell the story of a session stand out, each on a labelled line with its
// words when content is enabled; everything else is one dim line, still there
// for whoever needs it. Colours are ANSI and off under NO_COLOR.

const colour = (code: string, text: string): string =>
  process.env["NO_COLOR"] ? text : `\x1b[${code}m${text}\x1b[0m`;
const dim = (text: string) => colour("2", text);
const bold = (text: string) => colour("1", text);

const short = (value: unknown, keep = 8): string =>
  typeof value === "string" ? value.slice(0, keep) : "";
// "task-q-a154e8058b20-microphone-0" reads as "a154e805·mic·0".
const taskName = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const spoken =
    /^task-q-(?:h-)?([a-f0-9]{4,})[a-f0-9-]*?-?(microphone|application-audio)?-?(\d+)?$/.exec(
      value,
    );
  if (!spoken) return value.replace(/^task-/, "").slice(0, 14);
  const source =
    spoken[2] === "microphone" ? "mic" : spoken[2] ? "app" : "typed";
  return `${spoken[1]?.slice(0, 8)}·${source}${spoken[3] ? `·${spoken[3]}` : ""}`;
};
const seconds = (ms: unknown): string =>
  typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "";
const quoted = (content: unknown): string =>
  typeof content === "string" && content !== ""
    ? `"${content.replace(/\s+/g, " ").trim()}"`
    : dim("(words hidden: set LOG_CONTENT=true)");
const indented = (content: unknown): string =>
  typeof content === "string" && content !== ""
    ? `\n${content
        .split("\n")
        .map((line) => `              ${line}`)
        .join("\n")}`
    : "";

type StoryLine = { label: string; code: string; text: string };

// ---- the AI engine's lines ------------------------------------------------------
//
// The engine says each of its lines as an event with a sentence (`message`).
// In the story they read as that sentence: a call that ended, a retry, a
// failure, and, when content is on, the whole prompt and the whole answer.
const block = (text: unknown): string =>
  typeof text === "string" && text !== ""
    ? `\n${text
        .split("\n")
        .map((line) => `              ${line}`)
        .join("\n")}`
    : "";
const usageOf = (f: LogFields): string => {
  const said = [
    typeof f["inputTokens"] === "number" ||
    typeof f["outputTokens"] === "number"
      ? `${String(f["inputTokens"] ?? "?")} in / ${String(f["outputTokens"] ?? "?")} out`
      : "",
    typeof f["cost"] === "number"
      ? `${f["costStatus"] === "estimated" ? "~" : ""}${f["cost"].toFixed(4)} ${String(f["costCurrency"] ?? "")}`.trim()
      : "",
    f["provider"]
      ? `${String(f["provider"])}${f["model"] ? ` ${String(f["model"])}` : ""}`
      : "",
    f["trace_id"] ? `trace ${short(f["trace_id"])}` : "",
  ].filter(Boolean);
  return said.length ? `  ${dim(said.join(" · "))}` : "";
};
function aiStoryOf(
  level: LogLevel,
  event: string,
  f: LogFields,
): StoryLine | null {
  if (!event.startsWith("ai.") || typeof f["message"] !== "string") return null;
  const said = f["message"];
  const content = (f["content"] ?? {}) as Record<string, unknown>;
  if (event === "ai.prompt")
    return {
      label: "PROMPT",
      code: "34",
      text: `${said}${block(content["prompt"])}${content["schema"] ? `\n              ${dim("schema")}${block(content["schema"])}` : ""}`,
    };
  if (event === "ai.completion")
    return {
      label: "REPLY",
      code: "32",
      text: `${said}${block(content["completion"])}`,
    };
  if (level === "error")
    return { label: "AI ERROR", code: "31;1", text: `${said}${usageOf(f)}` };
  if (level === "warn")
    return { label: "AI WARN", code: "33", text: `${said}${usageOf(f)}` };
  if (level === "info")
    return { label: "AI", code: "36", text: `${said}${usageOf(f)}` };
  return null;
}

// The events that tell the story. Anything not here is written dim.
function storyOf(event: string, f: LogFields): StoryLine | null {
  const who =
    f["speaker"] === "microphone"
      ? "You (mic)"
      : f["speaker"] === "application-audio"
        ? "Interviewer (app audio)"
        : String(f["speaker"] ?? "");
  switch (event) {
    case "observation.stored":
      if (f["kind"] === "transcript.final")
        return {
          label: "HEARD",
          code: "36",
          text: `${bold(who)}  ${quoted(f["content"])}`,
        };
      if (f["kind"] === "screen.snapshot")
        return { label: "SCREEN", code: "35", text: "screenshot captured" };
      if (f["kind"] === "owner.input")
        return {
          label: "YOU",
          code: "35",
          text: `${String(f["operation"] ?? "input")}  ${f["content"] ? quoted(f["content"]) : ""}`,
        };
      return null;
    case "session.decision": {
      const task = f["taskId"] ? ` ${dim(taskName(f["taskId"]))}` : "";
      if (f["decision"] === "opened")
        return {
          label: "QUESTION",
          code: "32",
          text: `new task${task}  ${quoted(f["content"])}`,
        };
      if (f["decision"] === "revised")
        return {
          label: "FOLLOW-UP",
          code: "32",
          text: `revises${task}  ${quoted(f["content"])}`,
        };
      return {
        label: "SKIPPED",
        code: "33",
        text: `${String(f["decision"])} (${String(f["reason"] ?? "not a question")})  ${quoted(f["content"])}`,
      };
    }
    case "session.answer":
      return {
        label: "ANSWER",
        code: "32;1",
        text: `${dim(taskName(f["taskId"]))} rev ${String(f["revision"])}  ${String(f["category"] ?? "")} in ${seconds(f["durationMs"])}  ${dim(String(f["claims"] ?? ""))}${indented(f["content"])}`,
      };
    case "session.withheld":
      return {
        label: "NO ANSWER",
        code: "31;1",
        text: `${dim(taskName(f["taskId"]))} rev ${String(f["revision"])}  ${String(f["reason"] ?? "")}`,
      };
    case "companion.heartbeat_stop":
      return {
        label: "PAUSED",
        code: "33",
        text: `the app stopped capturing (${String(f["state"] ?? "")})`,
      };
    default:
      return null;
  }
}

// Fields nobody reads on a dim line.
const DIM_DROPPED = new Set([
  "tenantId",
  "byteCounts",
  "localityDecision",
  "fence",
  "content",
]);

function story(
  time: Date,
  level: LogLevel,
  service: string,
  event: string,
  fields: LogFields,
): string {
  const clock = time.toISOString().slice(11, 19);
  const session = fields["sessionId"]
    ? ` ${dim(`#${short(fields["sessionId"])}`)}`
    : "";
  const told = aiStoryOf(level, event, fields) ?? storyOf(event, fields);
  if (told)
    return `${dim(clock)}${session}  ${colour(told.code, told.label.padEnd(9))} ${told.text}`;
  // What explains an engine line (a call starting, an attempt, a guard): its
  // sentence, dimmed, and the trace it belongs to.
  if (event.startsWith("ai.") && typeof fields["message"] === "string")
    return dim(
      `${clock}  ai ${fields["message"]}${fields["trace_id"] ? ` · trace ${short(fields["trace_id"])}` : ""}`,
    );
  const pairs = Object.entries(fields)
    .filter(
      ([key, value]) =>
        !DIM_DROPPED.has(key) && key !== "sessionId" && value !== undefined,
    )
    .map(
      ([key, value]) =>
        `${key}=${key === "taskId" ? taskName(value) : oneLine(value)}`,
    )
    .join(" ");
  const line = `${clock}${fields["sessionId"] ? ` #${short(fields["sessionId"])}` : ""}  ${service} ${event}${pairs ? ` ${pairs}` : ""}`;
  if (level === "error") return colour("31", line);
  if (level === "warn") return colour("33", line);
  return dim(line);
}

// ---- the logger ---------------------------------------------------------------

export function createLogger(options: LoggerOptions): Logger {
  const fromEnv = resolveLogConfig(options.env);
  const config: LogConfig = {
    level: options.level ?? fromEnv.level,
    format: options.format ?? fromEnv.format,
    content: options.content ?? fromEnv.content,
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
    } else if (config.format === "story")
      write(story(time, level, options.service, event, merged));
    else write(pretty(time, level, options.service, event, merged));
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
