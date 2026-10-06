// A Claude CLI process must never outlive the run it was started for. These
// tests drive the two ways one used to: a run cancelled after its CLI stopped
// answering (interrupt() never settles), and an idle pooled session that nothing
// closed once the worker went quiet.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Hang = { release: () => void };
const state = {
  closed: 0,
  aborted: false,
  interruptHangs: true,
  streamStarted: 0,
  hang: undefined as Hang | undefined,
};

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (params: {
    prompt: AsyncIterable<unknown>;
    options: { abortController?: AbortController };
  }) => {
    const hang = {} as Hang;
    state.hang = hang;
    const released = new Promise<void>((resolve) => {
      hang.release = resolve;
    });
    params.options.abortController?.signal.addEventListener("abort", () => {
      state.aborted = true;
    });
    return Object.assign(
      (async function* () {
        for await (const _user of params.prompt) {
          state.streamStarted += 1;
          yield { type: "system", session_id: "s1" };
          // A pooled-session scenario answers; a hung CLI never does.
          if (!state.interruptHangs) {
            yield {
              type: "result",
              subtype: "success",
              session_id: "s1",
              result: "ok",
              usage: { input_tokens: 1, output_tokens: 1 },
              total_cost_usd: 0,
            };
            continue;
          }
          // The process is stuck: only being closed ends it.
          await released;
          return;
        }
      })(),
      {
        // Closing the query ends the process, so the stream ends.
        close: () => {
          state.closed += 1;
          hang.release();
        },
        interrupt: () =>
          state.interruptHangs
            ? new Promise<void>(() => undefined)
            : Promise.resolve(),
      },
    );
  },
}));

const { createClaudeRuntimeAdapter } = await import("./index");

const profile = {
  id: "p",
  version: 1,
  runtime: "claude-code" as const,
  model: "sonnet",
  fallbackModels: [],
  effort: "medium" as const,
  tools: [],
  sandbox: "read-only" as const,
  approvalPolicy: "never" as const,
  sessionPersistence: false,
  maximumTurns: 1,
  timeoutMs: 1000,
  maximumOutputBytes: 1000,
  additionalDirectories: [],
  webSearch: false,
};
const request = (overrides: Record<string, unknown> = {}) => ({
  runId: "r1",
  profile,
  prompt: "Hi",
  workingDirectory: "/tmp",
  additionalDirectories: [],
  attachments: [],
  timeoutMs: 1000,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  state.closed = 0;
  state.aborted = false;
  state.interruptHangs = true;
  state.streamStarted = 0;
});
afterEach(() => vi.useRealTimers());

describe("a cancelled run's process does not outlive the cancel", () => {
  it("ends a CLI that never answers interrupt(): closes the query, aborts it, and finishes the run as cancelled", async () => {
    const adapter = createClaudeRuntimeAdapter();
    const events: Array<{ type: string; error?: { code: string } }> = [];
    const finished = (async () => {
      for await (const event of adapter.run(request()))
        events.push(event as never);
    })();
    await vi.advanceTimersByTimeAsync(10);
    expect(state.streamStarted).toBe(1);

    const cancelled = adapter.cancel?.("r1");
    await vi.advanceTimersByTimeAsync(10_000);
    await cancelled;
    await finished;

    expect(state.closed).toBeGreaterThanOrEqual(1);
    expect(state.aborted).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      error: { code: "cancelled" },
    });
  });
});

describe("an idle pooled session is closed by time, not by the next run", () => {
  it("closes a kept session after its idle limit with no further run", async () => {
    state.interruptHangs = false;
    const adapter = createClaudeRuntimeAdapter();
    const persistent = { ...profile, sessionPersistence: true };
    for await (const _event of adapter.run(request({ profile: persistent })));
    // Kept for a possible resume, so the process is still alive.
    expect(state.closed).toBe(0);

    await vi.advanceTimersByTimeAsync(6 * 60_000 + 61_000);
    expect(state.closed).toBe(1);
    await adapter.close?.();
  });
});
