// The standing re-check just before a dispatch's first engine call (S2): a
// session paused between the action being recorded and the call is never sent
// to a model, and its action is suppressed as session_paused.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, startFixture } from "./live-session-fixture";
import {
  buildProcessor,
  createFakeEngine,
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

describe("pause between recording and calling", () => {
  it("makes no engine call and suppresses the action", async () => {
    const started = await startSessionFor(
      fx,
      repo,
      fx.tenantA,
      "recheck-pause",
    );
    let now = 7_000_000;
    const engine = createFakeEngine();
    const processor = buildProcessor(fx, {
      workerId: "worker-recheck-pause",
      engine,
      clock: { nowMs: () => now },
      options: { settleMs: 1_500 },
      wrapStore: (store) => ({
        ...store,
        // The owner pauses in the gap after the action is recorded.
        recordAction: async (input) => {
          const recorded = await store.recordAction(input);
          await repo.controlSession(started.scope, started.sessionId, "pause");
          return recorded;
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
    for (let i = 0; i < 4; i += 1) {
      now += 2_000;
      await processor.tick(NEVER_ABORTED);
      await processor.idle();
    }
    const rows = (await repo.listActions(started.scope, started.sessionId)).map(
      (a) => [a.dispatchStatus, a.suppressionReason],
    );
    await processor.close();
    expect(engine.requests).toHaveLength(0);
    expect(rows).toEqual([["suppressed", "session_paused"]]);
  });
});
