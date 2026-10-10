import { describe, expect, it } from "vitest";
import { workerSettings } from "./worker-loops";

describe("workerSettings", () => {
  it("runs six jobs at once with a 30 s lease unless told otherwise", () => {
    expect(workerSettings({})).toEqual({
      pollIntervalMs: 100,
      concurrency: 6,
      leaseMs: 30_000,
    });
  });

  it("reads each setting from the environment", () => {
    expect(
      workerSettings({
        AGENT_WORKER_POLL_MS: "250",
        AGENT_WORKER_CONCURRENCY: "8",
        AGENT_WORKER_LEASE_MS: "60000",
      }),
    ).toEqual({ pollIntervalMs: 250, concurrency: 8, leaseMs: 60_000 });
  });

  it.each([
    ["AGENT_WORKER_CONCURRENCY", "0"],
    ["AGENT_WORKER_CONCURRENCY", "99"],
    ["AGENT_WORKER_LEASE_MS", "100"],
    ["AGENT_WORKER_POLL_MS", "soon"],
  ])("refuses %s=%s, naming it", (name, value) => {
    expect(() => workerSettings({ [name]: value })).toThrow(
      new RegExp(`^${name} must be a whole number`),
    );
  });
});

// The loop table is the worker's registration: these loops, in this order.
describe("WORKER_LOOPS", () => {
  it("registers the agent-job, session and coach loops in start order", async () => {
    const { WORKER_LOOPS } = await import("./worker-loops");
    expect(WORKER_LOOPS.map(({ name }) => name)).toEqual([
      "agent-job",
      "session",
      "coach",
    ]);
  });
});
