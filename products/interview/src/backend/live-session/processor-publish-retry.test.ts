// A publish that throws a transient error must not strand its action in flight
// (S3): the action is recorded as failed, so the next tick retries the same
// task revision within the bound and exactly one draft is published.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, startFixture } from "./live-session-fixture";
import {
  buildProcessor,
  collectTraces,
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

describe("a transient publish error", () => {
  it("is retried within the bound and ends in one published draft", async () => {
    const started = await startSessionFor(
      fx,
      repo,
      fx.tenantA,
      "publish-retry",
    );
    let now = 5_000_000;
    let failOnce = true;
    const gateway = createFakeGateway();
    const trace = collectTraces();
    const processor = buildProcessor(fx, {
      workerId: "worker-publish-retry",
      gateway,
      trace,
      clock: { nowMs: () => now },
      options: { settleMs: 1_500 },
      wrapStore: (store) => ({
        ...store,
        publishResult: async (input) => {
          if (failOnce) {
            failOnce = false;
            throw new Error("transient database error");
          }
          return store.publishResult(input);
        },
      }),
    });
    await started.ingestor.ingest({
      eventId: "q1",
      role: "interviewer",
      startMs: 0,
      endMs: 2_000,
      text: "What is your notice period?",
    });
    for (let i = 0; i < 12; i += 1) {
      now += 2_000;
      await processor.tick(NEVER_ABORTED);
      await processor.idle();
    }
    const rows = (await repo.listActions(started.scope, started.sessionId)).map(
      (a) => [a.taskRevision, a.dispatchStatus, a.attempt],
    );
    await processor.close();
    expect(rows).toEqual([
      [1, "failed", 1],
      [1, "succeeded", 2],
    ]);
    expect(gateway.requests).toHaveLength(2);
  });
});
