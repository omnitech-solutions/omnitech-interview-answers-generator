import { createAiEngine, type ModelPort } from "@omnitech/ai-engine";
import { createLogger } from "@omnitech/logging";
import { describe, expect, it } from "vitest";
import { engineLog, engineLogLevel } from "./ai-log";

const at = () => new Date("2026-10-10T18:00:00.000Z");
const scope = {
  tenantId: "t1",
  actorId: "u1",
  productId: "omnitech.interview",
};
const answers = {
  async *stream() {
    yield { type: "text", text: "SECRET-ANSWER" };
  },
} as ModelPort;
// One generate through an engine that logs with the given environment.
async function run(env: Record<string, string | undefined>) {
  const lines: string[] = [];
  const logger = createLogger({
    service: "interview-web",
    env,
    write: (line) => lines.push(line),
    now: at,
  });
  const engine = createAiEngine({
    profiles: [{ id: "answer", provider: "p", model: "m-1" }],
    providers: { p: answers },
    log: engineLog({ service: "interview-web", env, logger }),
  });
  await engine.generate(
    {
      profileId: "answer",
      messages: [
        { role: "user", parts: [{ type: "text", text: "SECRET-PROMPT" }] },
      ],
    },
    {
      scope,
      signal: new AbortController().signal,
      for: { kind: "document", id: "d-1" },
    },
  );
  return lines;
}

describe("engineLogLevel", () => {
  it("says everything in development, nothing in a test run or production, unless asked", () => {
    // With no NODE_ENV of its own, the process's decides: this is a test run.
    expect(engineLogLevel({})).toBe("silent");
    expect(engineLogLevel({ NODE_ENV: "development" })).toBe("trace");
    expect(engineLogLevel({ NODE_ENV: "test" })).toBe("silent");
    expect(engineLogLevel({ NODE_ENV: "production" })).toBe("silent");
    expect(
      engineLogLevel({ NODE_ENV: "production", AI_ENGINE_LOG_LEVEL: "info" }),
    ).toBe("info");
    expect(
      engineLogLevel({
        NODE_ENV: "development",
        AI_ENGINE_LOG_LEVEL: "silent",
      }),
    ).toBe("silent");
    expect(
      engineLogLevel({ NODE_ENV: "development", AI_ENGINE_LOG_LEVEL: "loud" }),
    ).toBe("trace");
  });
});

describe("engineLog", () => {
  it("in production the engine says nothing unless asked, and then never content", async () => {
    expect(await run({ NODE_ENV: "production" })).toEqual([]);
    const asked = await run({
      NODE_ENV: "production",
      AI_ENGINE_LOG_LEVEL: "trace",
      LOG_LEVEL: "trace",
    });
    const events = asked.map(
      (line) => (JSON.parse(line) as { event: string }).event,
    );
    expect(events).toEqual([
      "ai.engine.ready",
      "ai.call.started",
      "ai.attempt.started",
      "ai.attempt.ended",
      "ai.call.ended",
    ]);
    expect(asked.join("\n")).not.toContain("SECRET");
    // The Studio's line: its own service, the engine's event and sentence.
    expect(JSON.parse(asked.at(-1) ?? "{}")).toMatchObject({
      service: "interview-web",
      process: "interview-web",
      event: "ai.call.ended",
      level: "info",
      forKind: "document",
      forId: "d-1",
      profileId: "answer",
      outcome: "done",
    });
  });

  it("in development with the Studio's content switch on, the whole prompt and answer are written", async () => {
    const lines = await run({
      NODE_ENV: "development",
      LOG_FORMAT: "json",
      LOG_LEVEL: "trace",
      LOG_CONTENT: "true",
    });
    const said = lines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    expect(said.find((line) => line["event"] === "ai.prompt")).toMatchObject({
      level: "trace",
      content: { prompt: "[user]\nSECRET-PROMPT" },
    });
    expect(
      said.find((line) => line["event"] === "ai.completion"),
    ).toMatchObject({ content: { completion: "SECRET-ANSWER" } });
    // Only those two lines carry it.
    const others = said.filter(
      (line) => !["ai.prompt", "ai.completion"].includes(String(line["event"])),
    );
    expect(JSON.stringify(others)).not.toContain("SECRET");
  });

  it("with the Studio's content switch off, nothing that was said is written, in any mode", async () => {
    for (const env of [
      { NODE_ENV: "development", LOG_LEVEL: "trace" },
      { NODE_ENV: "development", LOG_LEVEL: "trace", LOG_CONTENT: "false" },
      // The switch alone is not enough: a person must have chosen to read it.
      {
        NODE_ENV: "production",
        AI_ENGINE_LOG_LEVEL: "trace",
        LOG_CONTENT: "true",
      },
    ]) {
      const lines = await run(env);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).not.toContain("SECRET");
      expect(lines.join("\n")).not.toContain("ai.prompt");
    }
  });
});
