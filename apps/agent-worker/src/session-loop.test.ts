import { describe, expect, it } from "vitest";
import { runSessionLoop, sessionWorkerId } from "./session-loop.js";

const CANARY = "canary-question-text";

function harness(tick: (n: number) => Promise<boolean>) {
  const controller = new AbortController();
  const lines: string[] = [];
  const sleeps: number[] = [];
  const calls: string[] = [];
  let n = 0;
  const processor = {
    tick: async () => {
      calls.push("tick");
      return tick(++n);
    },
    close: async () => {
      calls.push("close");
    },
  };
  return { controller, lines, sleeps, calls, processor };
}

describe("session loop", () => {
  it("backs off exponentially on errors, resets on success and logs no content", async () => {
    const h = harness(async (n) => {
      if (n <= 3) throw new TypeError(CANARY);
      if (n === 4) return true;
      if (n === 5) throw new Error(CANARY);
      h.controller.abort();
      return false;
    });
    await runSessionLoop({
      processor: h.processor,
      signal: h.controller.signal,
      backoffMs: 100,
      maxBackoffMs: 300,
      pollIntervalMs: 7,
      log: (line) => h.lines.push(line),
      sleep: async (ms) => {
        h.sleeps.push(ms);
      },
    });
    // 100, 200, 300 (capped), reset -> 100, then the idle poll.
    expect(h.sleeps).toEqual([100, 200, 300, 100, 7]);
    expect(h.lines.join("\n")).toContain("TypeError");
    expect(h.lines.join("\n")).not.toContain(CANARY);
    // Stops on abort and closes the processor last.
    expect(h.calls.at(-1)).toBe("close");
  });

  it("sleeps the poll interval only when idle", async () => {
    const h = harness(async (n) => {
      if (n === 2) h.controller.abort();
      return n === 1;
    });
    await runSessionLoop({
      processor: h.processor,
      signal: h.controller.signal,
      pollIntervalMs: 11,
      sleep: async (ms) => {
        h.sleeps.push(ms);
      },
    });
    expect(h.sleeps).toEqual([11]);
  });

  it("closes the processor when already aborted and survives a failing close", async () => {
    const controller = new AbortController();
    controller.abort();
    const lines: string[] = [];
    await runSessionLoop({
      processor: {
        tick: async () => true,
        close: async () => {
          throw new Error(CANARY);
        },
      },
      signal: controller.signal,
      log: (line) => lines.push(line),
    });
    expect(lines.join("")).not.toContain(CANARY);
  });

  it("derives a unique session worker id from the same base as the job loop", () => {
    const a = sessionWorkerId({ AGENT_WORKER_ID: "w1" });
    const b = sessionWorkerId({ AGENT_WORKER_ID: "w1" });
    expect(a).toMatch(/^w1:[0-9a-f-]{36}:session$/);
    expect(a).not.toBe(b);
    expect(sessionWorkerId({})).toMatch(/^worker:[0-9a-f-]{36}:session$/);
  });
});
