// A rebuilt run (pause then resume, lease handover) behaves exactly like the
// live run did: statements the live run ignored are not judged again against
// task state they never saw, and a revision retried after a handover still
// carries the whole question. Real processor over a disposable PostgreSQL, a
// fake gateway and a virtual clock.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, startFixture } from "./live-session-fixture.js";
import {
  buildProcessor,
  createFakeGateway,
  NEVER_ABORTED,
  type StartedFor,
  startSessionFor,
} from "./processor-fixture.js";
import { capturedText } from "./replay-evidence-fixture.js";
import { ActiveSessionRepository } from "./repository.js";

let fx: Fixture;
let repo: ActiveSessionRepository;
beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 120_000);
afterAll(() => fx.stop());

function rig() {
  let now = 1_000_000;
  const worker = (id: string, gateway = createFakeGateway()) => ({
    gateway,
    processor: buildProcessor(fx, {
      workerId: id,
      gateway,
      clock: { nowMs: () => now },
      options: { settleMs: 1_500 },
    }),
  });
  const settle = async (
    processor: ReturnType<typeof worker>["processor"],
    rounds = 8,
  ) => {
    for (let i = 0; i < rounds; i += 1) {
      now += 2_000;
      const worked = await processor.tick(NEVER_ABORTED);
      await processor.idle();
      if (!worked) return;
    }
  };
  return { worker, settle, advance: (ms: number) => (now += ms) };
}

const ledger = async (session: StartedFor): Promise<string[]> =>
  (await repo.listActions(session.scope, session.sessionId))
    .map(
      (action) =>
        `${action.taskId}@r${action.taskRevision}:${action.dispatchStatus}`,
    )
    .sort();

describe("a rebuilt run does not re-judge what the live run ignored", () => {
  it("keeps an ignored statement ignored after a handover (no task open yet)", async () => {
    const session = await startSessionFor(fx, repo, fx.tenantA, "rs-p1");
    const { worker, settle } = rig();
    const one = worker("rs-p1-1");
    await session.ingestor.ingest({
      eventId: "s1",
      role: "interviewer",
      startMs: 0,
      endMs: 2_000,
      text: "Instead of the usual format we will keep this informal today.",
    });
    await settle(one.processor);
    await session.ingestor.ingest({
      eventId: "q1",
      role: "interviewer",
      startMs: 6_000,
      endMs: 8_000,
      text: "What is your notice period?",
    });
    await settle(one.processor);
    await one.processor.close();
    const before = await ledger(session);

    const two = worker("rs-p1-2");
    await settle(two.processor);
    await settle(two.processor);
    await two.processor.close();
    expect(two.gateway.requests).toHaveLength(0);
    expect(await ledger(session)).toEqual(before);
  });

  it("keeps an ignored statement after the last answer ignored too", async () => {
    const session = await startSessionFor(fx, repo, fx.tenantA, "rs-p1b");
    const { worker, settle } = rig();
    const one = worker("rs-p1b-1");
    await session.ingestor.ingest({
      eventId: "q1",
      role: "interviewer",
      startMs: 0,
      endMs: 2_000,
      text: "What is your notice period?",
    });
    await settle(one.processor);
    await session.ingestor.ingest({
      eventId: "x1",
      role: "interviewer",
      startMs: 8_000,
      endMs: 10_000,
      text: "Instead of the usual format we will keep this informal today.",
    });
    await settle(one.processor);
    await one.processor.close();
    const before = await ledger(session);

    const two = worker("rs-p1b-2");
    await settle(two.processor);
    await settle(two.processor);
    await two.processor.close();
    expect(two.gateway.requests).toHaveLength(0);
    expect(await ledger(session)).toEqual(before);
  });

  it("does not turn two same-tick follow-ups into a spurious revision", async () => {
    const session = await startSessionFor(fx, repo, fx.tenantA, "rs-p2");
    const { worker, settle } = rig();
    const one = worker("rs-p2-1");
    await session.ingestor.ingest({
      eventId: "q1",
      role: "interviewer",
      startMs: 0,
      endMs: 2_000,
      text: "How would you paginate a large result set?",
    });
    await settle(one.processor);
    await session.ingestor.ingest({
      eventId: "u2",
      role: "interviewer",
      startMs: 5_000,
      endMs: 7_000,
      text: "Part two, make it cursor based.",
    });
    await session.ingestor.ingest({
      eventId: "u3",
      role: "interviewer",
      startMs: 9_000,
      endMs: 11_000,
      text: "Now handle deleted rows between pages.",
    });
    await settle(one.processor);
    await one.processor.close();
    const before = await ledger(session);

    const two = worker("rs-p2-2");
    await settle(two.processor);
    await settle(two.processor);
    await two.processor.close();
    expect(two.gateway.requests).toHaveLength(0);
    expect(await ledger(session)).toEqual(before);
  });

  it("still answers a question that was opened but never dispatched", async () => {
    const session = await startSessionFor(fx, repo, fx.tenantA, "rs-hold");
    const { worker, settle } = rig();
    const one = worker("rs-hold-1");
    // The holder processes the question and is gone before it dispatches.
    await session.ingestor.ingest({
      eventId: "q1",
      role: "interviewer",
      startMs: 0,
      endMs: 2_000,
      text: "How would you design a rate limiter?",
    });
    await one.processor.tick(NEVER_ABORTED);
    await one.processor.close();

    const two = worker("rs-hold-2");
    await settle(two.processor);
    await two.processor.close();
    expect(two.gateway.requests.map(capturedText).join(" ")).toContain(
      "rate limiter",
    );
  });
});

describe("a retried revision keeps the whole question", () => {
  it("retries r2 after a handover with the captured text of the question", async () => {
    const session = await startSessionFor(fx, repo, fx.tenantA, "rs-p4");
    const { worker, settle, advance } = rig();
    let calls = 0;
    const one = worker(
      "rs-p4-1",
      createFakeGateway({
        fail: () => {
          calls += 1;
          return calls === 1 ? new Error("boom") : undefined;
        },
      }),
    );
    await session.ingestor.ingest({
      eventId: "q2",
      role: "interviewer",
      startMs: 0,
      endMs: 2_000,
      text: "How would you design a rate limiter?",
    });
    await session.ingestor.ingest({
      eventId: "u2",
      role: "interviewer",
      startMs: 5_000,
      endMs: 7_000,
      text: "Part two, make it distributed.",
    });
    await one.processor.tick(NEVER_ABORTED);
    await one.processor.idle();
    advance(2_000);
    await one.processor.tick(NEVER_ABORTED);
    await one.processor.idle();
    await one.processor.close();

    const two = worker("rs-p4-2");
    await settle(two.processor);
    await two.processor.close();
    const asked = two.gateway.requests.map(capturedText).join(" | ");
    expect(asked).toContain("rate limiter");
    expect(asked).toContain("distributed");
  });
});

describe("a rebuilt run is seeded from the newest actions", () => {
  it("restores the latest task when the session has more actions than the seed reads", async () => {
    const session = await startSessionFor(fx, repo, fx.tenantA, "rs-cap");
    const { worker, settle } = rig();
    const one = worker("rs-cap-1");
    const questions = [
      "What is your notice period?",
      "How would you paginate a large result set?",
      "Why do you want to leave your current employer?",
      "How would you design a rate limiter?",
    ];
    for (const [index, text] of questions.entries()) {
      await session.ingestor.ingest({
        eventId: `c${index}`,
        role: "interviewer",
        startMs: index * 10_000,
        endMs: index * 10_000 + 2_000,
        text,
      });
      await settle(one.processor);
    }
    await one.processor.close();
    await session.ingestor.ingest({
      eventId: "c-follow",
      role: "interviewer",
      startMs: 50_000,
      endMs: 52_000,
      text: "Part two, make it distributed.",
    });

    // Seeded from only the two newest actions: the oldest are not needed.
    const gateway = createFakeGateway();
    let now = 5_000_000;
    const two = buildProcessor(fx, {
      workerId: "rs-cap-2",
      gateway,
      clock: { nowMs: () => now },
      options: { settleMs: 1_500 },
      actionLimit: 2,
    });
    for (let i = 0; i < 6; i += 1) {
      now += 2_000;
      await two.tick(NEVER_ABORTED);
      await two.idle();
    }
    await two.close();
    const asked = gateway.requests.map(capturedText).join(" | ");
    expect(asked).toContain("rate limiter");
    expect(asked).toContain("distributed");
    expect(
      (await ledger(session)).filter((entry) => entry.includes("@r2")),
    ).toHaveLength(1);
  });
});
