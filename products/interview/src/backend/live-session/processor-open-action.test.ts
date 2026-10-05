// The action a dispatch recorded is "open" only while that dispatch runs: once
// it has settled, a LATER dispatch that throws before recording its own action
// must not settle the earlier, finished one as failed.
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Fixture, startFixture } from "./live-session-fixture";
import {
  buildProcessor,
  createFakeGateway,
  NEVER_ABORTED,
  startSessionFor,
} from "./processor-fixture";
import { ActiveSessionRepository } from "./repository";

let fx: Fixture;
let repo: ActiveSessionRepository;
beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 120_000);
afterAll(() => fx.stop());

it("does not fail a finished action when the next dispatch throws before recording", async () => {
  const session = await startSessionFor(fx, repo, fx.tenantA, "open-action");
  let now = 1_000_000;
  let recordCalls = 0;
  let failureCalls = 0;
  const processor = buildProcessor(fx, {
    workerId: "w-open-action",
    gateway: createFakeGateway(),
    clock: { nowMs: () => now },
    options: { settleMs: 1_500 },
    wrapStore: (store) => ({
      ...store,
      recordAction: (input) => {
        recordCalls += 1;
        if (recordCalls > 1) throw new Error("store unavailable");
        return store.recordAction(input);
      },
      recordFailure: (input) => {
        failureCalls += 1;
        return store.recordFailure(input);
      },
    }),
  });
  await session.ingestor.ingest({
    eventId: "q1",
    role: "interviewer",
    startMs: 0,
    endMs: 2_000,
    text: "What is your notice period?",
  });
  for (let i = 0; i < 4; i += 1) {
    now += 2_000;
    await processor.tick(NEVER_ABORTED);
    await processor.idle();
  }
  await session.ingestor.ingest({
    eventId: "q2",
    role: "interviewer",
    startMs: 20_000,
    endMs: 22_000,
    text: "How would you design a rate limiter?",
  });
  for (let i = 0; i < 4; i += 1) {
    now += 2_000;
    await processor.tick(NEVER_ABORTED);
    await processor.idle();
  }
  await processor.close();
  expect(recordCalls).toBeGreaterThan(1);
  expect(failureCalls).toBe(0);
  const actions = await repo.listActions(session.scope, session.sessionId);
  expect(actions.map((action) => action.dispatchStatus)).toEqual(["succeeded"]);
}, 120_000);
