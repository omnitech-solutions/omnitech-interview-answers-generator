import { describe, expect, it } from "vitest";
import { createLogger, redactFields, resolveLogConfig } from "./index";

const capture = () => {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
};
const at = () => new Date("2026-10-07T18:00:00.123Z");

describe("resolveLogConfig", () => {
  it("defaults by environment and honours LOG_LEVEL and LOG_FORMAT", () => {
    expect(resolveLogConfig({ NODE_ENV: "production" })).toEqual({
      level: "info",
      format: "json",
      content: false,
    });
    expect(resolveLogConfig({ NODE_ENV: "test" }).level).toBe("warn");
    expect(resolveLogConfig({})).toEqual({
      level: "debug",
      format: "pretty",
      content: false,
    });
    expect(
      resolveLogConfig({ LOG_LEVEL: "trace", LOG_FORMAT: "json" }),
    ).toEqual({
      level: "trace",
      format: "json",
      content: false,
    });
    expect(resolveLogConfig({ LOG_LEVEL: "loud" }).level).toBe("debug");
  });

  it("allows content only at trace with LOG_CONTENT=true", () => {
    expect(
      resolveLogConfig({ LOG_LEVEL: "trace", LOG_CONTENT: "true" }).content,
    ).toBe(true);
    expect(
      resolveLogConfig({ LOG_LEVEL: "debug", LOG_CONTENT: "true" }).content,
    ).toBe(false);
    expect(resolveLogConfig({ LOG_LEVEL: "trace" }).content).toBe(false);
  });
});

describe("redactFields", () => {
  it("replaces credential-like keys, cuts long strings, drops content by default", () => {
    const out = redactFields(
      {
        sessionId: "s1",
        authorization: "Bearer x",
        apiKey: "k",
        nested: { token: "t", ok: "a".repeat(2_500) },
        err: new Error("boom"),
        content: { prompt: "the question" },
      },
      { content: false },
    );
    expect(out["authorization"]).toBe("[redacted]");
    expect(out["apiKey"]).toBe("[redacted]");
    expect((out["nested"] as Record<string, unknown>)["token"]).toBe(
      "[redacted]",
    );
    expect(String((out["nested"] as Record<string, unknown>)["ok"])).toMatch(
      /…\[\+500\]$/,
    );
    expect(out["err"]).toEqual({ name: "Error", message: "boom" });
    expect("content" in out).toBe(false);
  });

  it("keeps content when allowed, still redacting inside it", () => {
    const out = redactFields(
      { content: { prompt: "p", token: "t" } },
      { content: true },
    );
    expect(out["content"]).toEqual({ prompt: "p", token: "[redacted]" });
  });
});

describe("createLogger", () => {
  it("writes one JSON line per event with service, level and bindings; gates by level", () => {
    const sink = capture();
    const log = createLogger({
      service: "web",
      env: { NODE_ENV: "production" },
      write: sink.write,
      now: at,
    }).child({ sessionId: "s1" });
    log.debug("hidden");
    log.info("companion.heartbeat_stop", { state: "sourceLost" });
    expect(sink.lines).toEqual([
      '{"time":"2026-10-07T18:00:00.123Z","level":"info","service":"web","event":"companion.heartbeat_stop","sessionId":"s1","state":"sourceLost"}',
    ]);
    expect(log.enabled("debug")).toBe(false);
    expect(log.enabled("info")).toBe(true);
  });

  it("pretty format is one readable line", () => {
    const sink = capture();
    createLogger({ service: "web", env: {}, write: sink.write, now: at }).warn(
      "ai.execute",
      { profileId: "p", durationMs: 12 },
    );
    expect(sink.lines).toEqual([
      "18:00:00.123 WARN  web ai.execute profileId=p durationMs=12",
    ]);
  });

  it("content rides a trace line only when the environment allows it", () => {
    const sink = capture();
    const quiet = createLogger({
      service: "ai",
      env: { LOG_LEVEL: "trace" },
      write: sink.write,
      now: at,
      format: "json",
    });
    quiet.trace("ai.execute", { content: { prompt: "p" } });
    const loud = createLogger({
      service: "ai",
      env: { LOG_LEVEL: "trace", LOG_CONTENT: "true" },
      write: sink.write,
      now: at,
      format: "json",
    });
    loud.trace("ai.execute", { content: { prompt: "p" } });
    expect(sink.lines[0]).not.toContain("prompt");
    expect(sink.lines[1]).toContain('"content":{"prompt":"p"}');
  });
});

describe("the story format (a local pnpm dev)", () => {
  const env = {
    LOG_FORMAT: "story",
    LOG_CONTENT: "true",
    LOG_LEVEL: "debug",
    NO_COLOR: "1",
  };
  const story = (service = "session") => {
    const sink = capture();
    process.env["NO_COLOR"] = "1";
    return {
      sink,
      log: createLogger({ service, env, write: sink.write, now: at }),
    };
  };
  const S = "d49f5e74-bb9e-4efc-8c33-602bf4a63e29";
  const T = "task-q-a154e8058b20-microphone-0";

  it("allows content with LOG_CONTENT=true below trace, never in production", () => {
    expect(resolveLogConfig(env).content).toBe(true);
    expect(resolveLogConfig({ ...env, LOG_CONTENT: "false" }).content).toBe(
      false,
    );
    expect(resolveLogConfig({ ...env, NODE_ENV: "production" }).content).toBe(
      false,
    );
  });

  it("tells what was heard, with the speaker and the words", () => {
    const { sink, log } = story("interview-web");
    log.info("observation.stored", {
      sessionId: S,
      kind: "transcript.final",
      speaker: "application-audio",
      chars: 33,
      content: "Number one tell me about yourself",
    });
    expect(sink.lines).toEqual([
      '18:00:00 #d49f5e74  HEARD     Interviewer (app audio)  "Number one tell me about yourself"',
    ]);
  });

  it("tells the decision, the answer and a missing answer, each with the short task name", () => {
    const { sink, log } = story();
    log.info("session.decision", {
      sessionId: S,
      decision: "opened",
      taskId: T,
      content: "Tell me about yourself",
    });
    log.info("session.decision", {
      sessionId: S,
      decision: "ignored",
      reason: "no question heard in it",
      content: "okay sure",
    });
    log.info("session.answer", {
      sessionId: S,
      taskId: T,
      revision: 1,
      category: "background",
      durationMs: 18686,
      claims: "5 backed, 1 suggested",
      content: "- one\n- two",
    });
    log.warn("session.withheld", {
      sessionId: S,
      taskId: T,
      revision: 2,
      reason: "owner_stopped",
    });
    expect(sink.lines).toEqual([
      '18:00:00 #d49f5e74  QUESTION  new task a154e805·mic·0  "Tell me about yourself"',
      '18:00:00 #d49f5e74  SKIPPED   ignored (no question heard in it)  "okay sure"',
      "18:00:00 #d49f5e74  ANSWER    a154e805·mic·0 rev 1  background in 18.7s  5 backed, 1 suggested\n              - one\n              - two",
      "18:00:00 #d49f5e74  NO ANSWER a154e805·mic·0 rev 2  owner_stopped",
    ]);
  });

  it("writes every other event as one compact line without the noise fields or the words", () => {
    const { sink, log } = story("worker");
    log.debug("task.opened", {
      sessionId: S,
      tenantId: "t",
      taskId: T,
      revision: 1,
      fence: 5,
      localityDecision: "none",
      byteCounts: { input: 0, output: 0 },
      outcome: "ok",
      content: "secret words",
    });
    expect(sink.lines).toEqual([
      "18:00:00 #d49f5e74  worker task.opened taskId=a154e805·mic·0 revision=1 outcome=ok",
    ]);
  });

  it("says the words are hidden when content is off", () => {
    const sink = capture();
    process.env["NO_COLOR"] = "1";
    createLogger({
      service: "interview-web",
      env: { ...env, LOG_CONTENT: "false" },
      write: sink.write,
      now: at,
    }).info("observation.stored", {
      sessionId: S,
      kind: "transcript.final",
      speaker: "microphone",
      content: "private",
    });
    expect(sink.lines[0]).toBe(
      "18:00:00 #d49f5e74  HEARD     You (mic)  (words hidden: set LOG_CONTENT=true)",
    );
  });
});
