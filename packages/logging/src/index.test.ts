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
