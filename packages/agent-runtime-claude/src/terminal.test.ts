import { expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: () =>
    (async function* () {
      yield {
        type: "result",
        subtype: "success",
        session_id: "s1",
        result: "done",
        usage: { input_tokens: 1, output_tokens: 1 },
        total_cost_usd: 0,
      };
      throw new Error("iterator cleanup failed");
    })(),
}));

const { createClaudeRuntimeAdapter } = await import("./index.js");

it("emits one terminal outcome when the SDK throws after success", async () => {
  const events = [];
  for await (const event of createClaudeRuntimeAdapter().run({
    runId: "r1",
    profile: {
      id: "p",
      version: 1,
      runtime: "claude-code",
      model: "sonnet",
      fallbackModels: [],
      effort: "medium",
      tools: [],
      sandbox: "read-only",
      approvalPolicy: "never",
      sessionPersistence: false,
      maximumTurns: 1,
      timeoutMs: 1000,
      maximumOutputBytes: 1000,
      additionalDirectories: [],
      webSearch: false,
    },
    prompt: "Hi",
    workingDirectory: "/tmp",
    additionalDirectories: [],
    attachments: [],
    timeoutMs: 1000,
  }))
    events.push(event);

  expect(
    events.filter(
      (event) => event.type === "completed" || event.type === "failed",
    ),
  ).toHaveLength(1);
  expect(events.at(-1)?.type).toBe("completed");
});
