// Review round 5: a deferred topic ("put a pin in it") must not stop the
// handled-through marker, or a LATER statement the live run ignored is judged
// again after a rebuild and can open a spurious revision. A rebuilt run
// (handover, or pause then resume) matches the live run: same drafts, same
// task revisions.
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

let now = 1_000_000;
const worker = (id: string) => {
  const gateway = createFakeGateway();
  return {
    gateway,
    processor: buildProcessor(fx, {
      workerId: id,
      gateway,
      clock: { nowMs: () => now },
      options: { settleMs: 1_500 },
    }),
  };
};
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
const ledger = async (session: StartedFor): Promise<string[]> =>
  (await repo.listActions(session.scope, session.sessionId))
    .map(
      (action) =>
        `${action.taskId}@r${action.taskRevision}:${action.actionKind}:${action.dispatchStatus}`,
    )
    .sort();
const seg = (eventId: string, startMs: number, text: string) => ({
  eventId,
  role: "interviewer" as const,
  startMs,
  endMs: startMs + 2_000,
  text,
});
const STEPS = [
  seg("d0", 0, "Let us put a pin in team structure and come back to it later."),
  seg(
    "s1",
    6_000,
    "Instead of the usual format we will keep this informal today.",
  ),
  seg("q1", 12_000, "What is your notice period?"),
];

async function run(name: string, rebuild: "none" | "handover" | "pause") {
  const session = await startSessionFor(fx, repo, fx.tenantA, name);
  let current = worker(`${name}-1`);
  const requests: string[] = [];
  for (const step of STEPS) {
    await session.ingestor.ingest(step);
    await settle(current.processor);
  }
  if (rebuild === "handover") {
    requests.push(...current.gateway.requests.map(capturedText));
    await current.processor.close();
    current = worker(`${name}-2`);
    await settle(current.processor);
  }
  if (rebuild === "pause") {
    await repo.controlSession(session.scope, session.sessionId, "pause");
    await settle(current.processor);
    await repo.controlSession(session.scope, session.sessionId, "resume");
    await settle(current.processor);
    await settle(current.processor);
  }
  requests.push(...current.gateway.requests.map(capturedText));
  const result = { requests, ledger: await ledger(session) };
  await current.processor.close();
  await repo.controlSession(session.scope, session.sessionId, "end");
  return result;
}

describe("rebuild after a deferred topic and an ignored cue", () => {
  it("handover: the rebuilt holder dispatches nothing new and opens no revision", async () => {
    const live = await run("rd-live", "none");
    const handover = await run("rd-ho", "handover");
    expect(handover.requests).toEqual(live.requests);
    expect(handover.ledger).toEqual(live.ledger);
    expect(live.ledger).toHaveLength(1);
  });

  it("pause then resume on the same worker: no re-dispatch, same ledger", async () => {
    const live = await run("rd-live2", "none");
    const paused = await run("rd-pause", "pause");
    expect(paused.requests).toEqual(live.requests);
    expect(paused.ledger).toEqual(live.ledger);
  });

  it("handover after a question, a deferral, then a follow-up: same drafts and revisions", async () => {
    const steps = [
      seg("q0", 0, "How do you approach code review?"),
      seg(
        "d0",
        6_000,
        "Let us put a pin in team structure and come back to it later.",
      ),
      seg("q1", 12_000, "What is your notice period?"),
      seg("f1", 18_000, "Part two, what if you needed to start sooner?"),
    ];
    const play = async (name: string, handovers: boolean) => {
      const session = await startSessionFor(fx, repo, fx.tenantA, name);
      let current = worker(`${name}-1`);
      const requests: string[][] = [];
      let n = 1;
      for (const step of steps) {
        await session.ingestor.ingest(step);
        await settle(current.processor);
        if (handovers) {
          requests.push(current.gateway.requests.map(capturedText));
          await current.processor.close();
          n += 1;
          current = worker(`${name}-${n}`);
          await settle(current.processor);
        }
      }
      requests.push(current.gateway.requests.map(capturedText));
      const result = {
        requests: requests.flat(),
        ledger: await ledger(session),
      };
      await current.processor.close();
      await repo.controlSession(session.scope, session.sessionId, "end");
      return result;
    };
    const live = await play("rd-d1b-live", false);
    const handed = await play("rd-d1b-ho", true);
    expect(handed.requests).toEqual(live.requests);
    expect(handed.ledger).toEqual(live.ledger);
  });
});
