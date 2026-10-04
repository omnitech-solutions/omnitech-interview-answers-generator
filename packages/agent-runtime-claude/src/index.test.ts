import { describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: () =>
    Object.assign(
      (async function* () {
        yield { type: "system", session_id: "s1" };
        for (const text of ["Hel", "lo"])
          yield {
            type: "stream_event",
            session_id: "s1",
            event: {
              type: "content_block_delta",
              delta: { type: "text_delta", text },
            },
          };
        yield {
          type: "assistant",
          session_id: "s1",
          message: { content: [{ type: "text", text: "Hello" }] },
        };
        yield {
          type: "result",
          subtype: "success",
          session_id: "s1",
          result: "Hello",
          usage: { input_tokens: 3, output_tokens: 2 },
          total_cost_usd: 0,
        };
      })(),
      { close: () => {} },
    ),
}));

const { createClaudeRuntimeAdapter } = await import("./index.js");

describe("Claude runtime", () => {
  it("streams text as it is written and does not repeat it from the finished message", async () => {
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
    expect(events.filter((event) => event.type === "text-delta")).toEqual([
      { type: "text-delta", text: "Hel" },
      { type: "text-delta", text: "lo" },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      result: { output: "Hello" },
    });
  });
});
