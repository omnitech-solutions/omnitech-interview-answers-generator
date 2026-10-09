// Bounded lease renewal (ADR-0011): a session whose renewals keep throwing is
// dropped after maxRenewFailures consecutive failures, writes nothing, and a
// renewal that answers resets the count. In-memory ports; no database.
import { describe, expect, it } from "vitest";
import type { SessionEngine } from "./engine-call";
import { createInterviewSessionPolicy } from "./interview-policy";
import { createSessionProcessor } from "./processor";
import type { SessionClaimPort, SessionStorePort } from "./processor-ports";
import type { SessionTraceEvent } from "./trace";

const CLAIM = { tenantId: "t1", ownerUserId: "u1", sessionId: "s1", fence: 1 };
const ACTIVE_VIEW = {
  status: "active",
  purged: false,
  liveAssistance: true,
} as never;

function harness(renew: SessionClaimPort["renew"], maxRenewFailures?: number) {
  const events: SessionTraceEvent[] = [];
  let claimed = false;
  const written: string[] = [];
  const claim: SessionClaimPort = {
    claim: async () => {
      if (claimed) return [];
      claimed = true;
      return [CLAIM];
    },
    renew,
    release: async () => true,
    purgeCandidates: async () => [],
    capExpired: async () => [],
  };
  const store = {
    reconcile: async () => ACTIVE_VIEW,
    actions: async () => [],
    observationsAfter: async () => [],
    cancelJobs: async () => ({}),
    purge: async () => ({ outcome: "already-purged" }),
    recordAction: async () => written.push("recordAction"),
    publishResult: async () => written.push("publishResult"),
    recordFailure: async () => written.push("recordFailure"),
    abandonAction: async () => written.push("abandonAction"),
    readDispatchStanding: async () => ({}),
  } as unknown as SessionStorePort;
  const processor = createSessionProcessor(
    {
      claim,
      store,
      engine: {} as SessionEngine,
      policy: createInterviewSessionPolicy(),
      clock: { nowMs: () => 0 },
      trace: { emit: (event) => events.push(event) },
    },
    {
      workerId: "w",
      sweepEveryMs: 1e12,
      ...(maxRenewFailures === undefined ? {} : { maxRenewFailures }),
    },
  );
  return { processor, events, written };
}

const signal = new AbortController().signal;
const outcomes = (events: SessionTraceEvent[]) =>
  events.map((event) => `${event.event}:${event.outcome}`);

describe("bounded lease renewal", () => {
  it("drops the session after 3 consecutive failed renewals and writes nothing", async () => {
    const { processor, events, written } = harness(async () => {
      throw new Error("canary-question-text");
    });
    await processor.tick(signal); // claim (renewal is skipped once)
    for (let i = 0; i < 2; i++) {
      await processor.tick(signal);
      expect(processor.snapshot("s1")).toBeDefined(); // still held, retrying
    }
    await processor.tick(signal);
    expect(processor.snapshot("s1")).toBeUndefined();
    expect(outcomes(events)).toContain("session.stopped:renewal_failed");
    expect(JSON.stringify(events)).not.toContain("canary");
    expect(written).toEqual([]);
  });

  it("resets the count when a renewal answers", async () => {
    let call = 0;
    const { processor } = harness(async () => {
      call += 1;
      if (call % 3 !== 0) throw new Error("transient");
      return { renewed: true } as never;
    });
    for (let i = 0; i < 9; i++) await processor.tick(signal);
    expect(processor.snapshot("s1")).toBeDefined();
  });

  it("honours a custom bound", async () => {
    const { processor } = harness(async () => {
      throw new Error("down");
    }, 1);
    await processor.tick(signal);
    await processor.tick(signal);
    expect(processor.snapshot("s1")).toBeUndefined();
  });
});
