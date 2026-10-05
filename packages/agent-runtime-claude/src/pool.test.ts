import { describe, expect, it, vi } from "vitest";

const queryMock = vi.fn(
  ({ prompt }: { prompt: AsyncIterable<{ message: { content: string } }> }) =>
    Object.assign(
      (async function* () {
        for await (const user of prompt) {
          yield { type: "system", session_id: "session-1" };
          yield {
            type: "result",
            subtype: "success",
            session_id: "session-1",
            result: user.message.content,
            usage: { input_tokens: 1, output_tokens: 1 },
            total_cost_usd: 0,
          };
        }
      })(),
      { close: () => {}, interrupt: async () => {} },
    ),
);
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: queryMock }));
const { createClaudeRuntimeAdapter } = await import("./index");
const profile = {
  id: "test",
  version: 1,
  runtime: "claude-code" as const,
  model: "sonnet",
  fallbackModels: [],
  effort: "medium" as const,
  tools: [],
  sandbox: "read-only" as const,
  approvalPolicy: "never" as const,
  sessionPersistence: true,
  maximumTurns: 1,
  timeoutMs: 1000,
  maximumOutputBytes: 1000,
  additionalDirectories: [],
  webSearch: false,
};
async function collect(source: AsyncIterable<unknown>) {
  const events = [];
  for await (const event of source) events.push(event);
  return events;
}
describe("Claude persistent client pool", () => {
  it("uses one SDK process for two bound turns", async () => {
    const adapter = createClaudeRuntimeAdapter();
    const first = await collect(
      adapter.run({
        runId: "one",
        profile,
        prompt: "first",
        workingDirectory: "/tmp",
        additionalDirectories: [],
        attachments: [],
        timeoutMs: 1000,
      }),
    );
    const second = await collect(
      adapter.resume({
        runId: "one",
        sessionId: "session-1",
        prompt: "second",
        profile,
        workingDirectory: "/tmp",
      }),
    );
    expect(first.at(-1)).toMatchObject({
      type: "completed",
      result: { output: "first" },
    });
    expect(second.at(-1)).toMatchObject({
      type: "completed",
      result: { output: "second" },
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
  it("rejoins a provider session in a new isolated workspace", async () => {
    const adapter = createClaudeRuntimeAdapter();
    await collect(
      adapter.run({
        runId: "one",
        profile,
        prompt: "first",
        workingDirectory: "/tmp",
        additionalDirectories: [],
        attachments: [],
        timeoutMs: 1000,
      }),
    );
    const events = await collect(
      adapter.resume({
        runId: "one",
        sessionId: "session-1",
        prompt: "second",
        profile,
        workingDirectory: "/other",
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      result: { output: "second" },
    });
  });
  it("refuses to reuse another run's live session", async () => {
    const adapter = createClaudeRuntimeAdapter();
    await collect(
      adapter.run({
        runId: "one",
        profile,
        prompt: "first",
        workingDirectory: "/tmp",
        additionalDirectories: [],
        attachments: [],
        timeoutMs: 1000,
      }),
    );
    const events = await collect(
      adapter.resume({
        runId: "another-job",
        sessionId: "session-1",
        prompt: "second",
        profile,
        workingDirectory: "/tmp",
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      error: { message: "Claude session binding changed." },
    });
    await adapter.close?.();
  });
});
