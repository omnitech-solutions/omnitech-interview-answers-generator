// A rebuilt run must reach the same utterance boundaries, task ids and task
// revisions the live run reached (ADR-0011 restart safety): a stored action
// remembers the segments its revision rests on, so a handover never merges an
// answered question into the next one, never restarts a corrected task at
// revision 1, and never drops a question as a duplicate. Real processor over
// a disposable PostgreSQL, a fake gateway and a virtual clock.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, startFixture } from "./live-session-fixture";
import {
  buildProcessor,
  createFakeGateway,
  NEVER_ABORTED,
  type StartedFor,
  startSessionFor,
} from "./processor-fixture";
import { capturedText } from "./replay-evidence-fixture";
import { ActiveSessionRepository } from "./repository";

let fx: Fixture;
let repo: ActiveSessionRepository;
beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 120_000);
afterAll(() => fx.stop());

function rig() {
  let now = 1_000_000;
  const worker = (id: string) => {
    const gateway = createFakeGateway();
    const processor = buildProcessor(fx, {
      workerId: id,
      gateway,
      clock: { nowMs: () => now },
      options: { settleMs: 1_500 },
    });
    return { gateway, processor };
  };
  const settle = async (processor: ReturnType<typeof worker>["processor"]) => {
    for (let i = 0; i < 8; i += 1) {
      now += 2_000;
      const worked = await processor.tick(NEVER_ABORTED);
      await processor.idle();
      if (!worked) return;
    }
  };
  return { worker, settle };
}

const ledger = async (session: StartedFor): Promise<string[]> =>
  (await repo.listActions(session.scope, session.sessionId))
    .filter((action) => action.actionKind === "draft-answer")
    .map(
      (action) =>
        `${action.taskId}@r${action.taskRevision}:${action.dispatchStatus}`,
    )
    .sort();

const asked = (gateway: ReturnType<typeof createFakeGateway>): string =>
  gateway.requests.map(capturedText).join(" | ");

describe("a handover keeps live utterance boundaries and revisions", () => {
  it("answers a follow-up to a corrected question after a restart", async () => {
    const session = await startSessionFor(fx, repo, fx.tenantA, "rb-a");
    const { worker, settle } = rig();
    const one = worker("rb-a-1");
    await session.ingestor.ingest({
      eventId: "e1",
      role: "interviewer",
      startMs: 0,
      endMs: 2_000,
      text: "What is your notice periot?",
    });
    await settle(one.processor);
    await session.ingestor.ingest({
      eventId: "e2",
      role: "interviewer",
      startMs: 2_500,
      endMs: 4_000,
      text: "What is your notice period?",
      supersedes: "e1",
    });
    await settle(one.processor);
    await one.processor.close();

    const two = worker("rb-a-2");
    await session.ingestor.ingest({
      eventId: "e3",
      role: "interviewer",
      startMs: 8_000,
      endMs: 11_000,
      text: "Now handle the case where you would need to start sooner, part two.",
    });
    await settle(two.processor);
    await settle(two.processor);
    await two.processor.close();

    expect(asked(two.gateway)).toContain("start sooner");
    // The corrected task was r2 live; the follow-up is r3, not a second r2.
    expect(await ledger(session)).toEqual([
      "task-q-e1@r1:succeeded",
      "task-q-e1@r2:succeeded",
      "task-q-e1@r3:succeeded",
    ]);
  });

  it("answers a same-speaker question 1 s after an answered one, after a restart", async () => {
    const session = await startSessionFor(fx, repo, fx.tenantA, "rb-b");
    const { worker, settle } = rig();
    const one = worker("rb-b-1");
    await session.ingestor.ingest({
      eventId: "q1",
      role: "interviewer",
      startMs: 0,
      endMs: 2_000,
      text: "What is your notice period?",
    });
    await settle(one.processor);
    await one.processor.close();
    await session.ingestor.ingest({
      eventId: "q2",
      role: "interviewer",
      startMs: 3_000,
      endMs: 6_000,
      text: "How do you approach code review?",
    });
    const two = worker("rb-b-2");
    await settle(two.processor);
    await settle(two.processor);
    await two.processor.close();

    expect(asked(two.gateway)).toContain("code review");
    expect(await ledger(session)).toEqual([
      "task-q-q1@r1:succeeded",
      "task-q-q2@r1:succeeded",
    ]);
  });

  it("revises the question a follow-up follows, not the first one, after a restart", async () => {
    const session = await startSessionFor(fx, repo, fx.tenantA, "rb-b2");
    const { worker, settle } = rig();
    const one = worker("rb-b2-1");
    await session.ingestor.ingest({
      eventId: "q1",
      role: "interviewer",
      startMs: 0,
      endMs: 2_000,
      text: "What is your notice period?",
    });
    await settle(one.processor);
    await session.ingestor.ingest({
      eventId: "q2",
      role: "interviewer",
      startMs: 3_000,
      endMs: 6_000,
      text: "How do you approach code review?",
    });
    await settle(one.processor);
    await one.processor.close();

    const two = worker("rb-b2-2");
    await session.ingestor.ingest({
      eventId: "q3",
      role: "interviewer",
      startMs: 9_000,
      endMs: 12_000,
      text: "And what about reviewing a junior engineer's code?",
    });
    await settle(two.processor);
    await settle(two.processor);
    await two.processor.close();

    expect(await ledger(session)).toEqual([
      "task-q-q1@r1:succeeded",
      "task-q-q2@r1:succeeded",
      "task-q-q2@r2:succeeded",
    ]);
  });

  it("names tasks after their question, never a per-run counter", async () => {
    const session = await startSessionFor(fx, repo, fx.tenantA, "rb-c");
    const { worker, settle } = rig();
    const one = worker("rb-c-1");
    for (const [eventId, startMs, text] of [
      ["q1", 0, "What is your notice period?"],
      ["q2", 3_000, "How do you approach code review?"],
    ] as const) {
      await session.ingestor.ingest({
        eventId,
        role: "interviewer",
        startMs,
        endMs: startMs + 2_000,
        text,
      });
      await settle(one.processor);
    }
    await one.processor.close();

    const two = worker("rb-c-2");
    await session.ingestor.ingest({
      eventId: "q3",
      role: "interviewer",
      startMs: 12_000,
      endMs: 14_000,
      text: "Tell me about a bug you fixed recently?",
    });
    await settle(two.processor);
    await settle(two.processor);
    await two.processor.close();

    expect(await ledger(session)).toEqual([
      "task-q-q1@r1:succeeded",
      "task-q-q2@r1:succeeded",
      "task-q-q3@r1:succeeded",
    ]);
    // The rebuilt run asked only the new question.
    expect(two.gateway.requests).toHaveLength(1);
  });
});
