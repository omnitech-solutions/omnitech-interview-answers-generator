// A run is rebuilt from the stored observations and actions whenever its
// session is paused and resumed or its lease changes hands. The rebuilt run must
// name every question as the last one did (M2): an answered question is not
// dispatched or published again, and a question nobody answered yet is still
// answered, exactly once. Real processor over a disposable PostgreSQL, a fake
// gateway and a virtual clock.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, startFixture } from "./live-session-fixture.js";
import {
  buildProcessor,
  createFakeGateway,
  NEVER_ABORTED,
  startSessionFor,
} from "./processor-fixture.js";
import { capturedText } from "./replay-evidence-fixture.js";
import { ActiveSessionRepository } from "./repository.js";
import type { FixtureSegment } from "./session-replay-fixtures.js";

let fx: Fixture;
let repo: ActiveSessionRepository;
beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 120_000);
afterAll(() => fx.stop());

const SETTLE_MS = 1_500;
const say = (
  eventId: string,
  role: FixtureSegment["role"],
  startMs: number,
  endMs: number,
  text: string,
): FixtureSegment => ({ eventId, role, startMs, endMs, text });

const CONTEXT = say(
  "a1",
  "interviewer",
  0,
  2_000,
  "Thanks, that is really helpful context.",
);
const BACKCHANNEL = say("a2", "candidate", 2_500, 3_000, "Yeah.");
const NOTICE = say(
  "a3",
  "interviewer",
  3_500,
  6_000,
  "What is your notice period?",
);
const ANSWER = say(
  "a4",
  "candidate",
  7_000,
  9_000,
  "I think around a month would be fine for me to wrap up.",
);
const REVIEW = say(
  "a5",
  "interviewer",
  10_000,
  12_000,
  "How do you approach code review?",
);

// A virtual clock: every settle moves it past the settle window first.
function rig(name: string, workerId: string) {
  let now = 1_000_000;
  const gateway = createFakeGateway();
  const processorFor = (id: string, g = gateway) =>
    buildProcessor(fx, {
      workerId: id,
      gateway: g,
      clock: { nowMs: () => now },
      options: { settleMs: SETTLE_MS },
    });
  const settle = async (processor: ReturnType<typeof processorFor>) => {
    for (let i = 0; i < 8; i += 1) {
      now += SETTLE_MS + 500;
      const worked = await processor.tick(NEVER_ABORTED);
      await processor.idle();
      if (!worked) return;
    }
  };
  return { name, workerId, gateway, processorFor, settle };
}

const asked = (gateway: ReturnType<typeof createFakeGateway>) =>
  gateway.requests.map((request) => capturedText(request));

describe("a rebuilt run keeps every question's identity (M2)", () => {
  it("does not answer an answered question again after pause and resume", async () => {
    const w = await startSessionFor(fx, repo, fx.tenantA, "rebuild-pause");
    const r = rig("pause", "worker-rebuild-pause");
    const p = r.processorFor("worker-rebuild-pause");
    for (const segment of [CONTEXT, BACKCHANNEL, NOTICE]) {
      await w.ingestor.ingest(segment);
      await r.settle(p);
    }
    for (const segment of [ANSWER, REVIEW]) await w.ingestor.ingest(segment);
    await r.settle(p);
    expect(r.gateway.requests).toHaveLength(2);

    await repo.controlSession(w.scope, w.sessionId, "pause");
    await r.settle(p);
    await repo.controlSession(w.scope, w.sessionId, "resume");
    await r.settle(p);
    await r.settle(p);

    // Nothing was owed after the resume: two questions, two drafts, once each.
    expect(r.gateway.requests).toHaveLength(2);
    const stored = await repo.listActions(w.scope, w.sessionId);
    expect(stored.filter((a) => a.dispatchStatus === "succeeded")).toHaveLength(
      2,
    );
    await p.close();
  });

  it("does not answer an answered question again after a worker handover", async () => {
    const w = await startSessionFor(fx, repo, fx.tenantA, "rebuild-handover");
    const first = rig("handover", "worker-rebuild-1");
    const p1 = first.processorFor("worker-rebuild-1");
    for (const segment of [CONTEXT, BACKCHANNEL, NOTICE]) {
      await w.ingestor.ingest(segment);
      await first.settle(p1);
    }
    for (const segment of [ANSWER, REVIEW]) await w.ingestor.ingest(segment);
    await first.settle(p1);
    expect(first.gateway.requests).toHaveLength(2);
    await p1.close();

    const second = rig("handover", "worker-rebuild-2");
    const p2 = second.processorFor("worker-rebuild-2");
    await second.settle(p2);
    await second.settle(p2);
    expect(asked(second.gateway)).toEqual([]);
    const stored = await repo.listActions(w.scope, w.sessionId);
    expect(stored.filter((a) => a.dispatchStatus === "succeeded")).toHaveLength(
      2,
    );
    await p2.close();
  });

  it("still answers a question the previous worker never reached, once", async () => {
    const w = await startSessionFor(fx, repo, fx.tenantA, "rebuild-lost");
    const first = rig("lost", "worker-lost-1");
    const p1 = first.processorFor("worker-lost-1");
    for (const segment of [CONTEXT, BACKCHANNEL, NOTICE]) {
      await w.ingestor.ingest(segment);
      await first.settle(p1);
    }
    expect(first.gateway.requests).toHaveLength(1);
    await p1.close();

    // The review question arrives while no worker holds the session.
    for (const segment of [ANSWER, REVIEW]) await w.ingestor.ingest(segment);

    const second = rig("lost", "worker-lost-2");
    const p2 = second.processorFor("worker-lost-2");
    await second.settle(p2);
    await second.settle(p2);
    const lines = asked(second.gateway);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("code review");
    expect(lines[0]).not.toContain("notice period");
    await p2.close();
  });
});
