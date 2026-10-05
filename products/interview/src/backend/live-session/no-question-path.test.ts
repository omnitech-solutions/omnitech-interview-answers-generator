// D36 on a disposable PostgreSQL (requires Docker, like the other session
// suites): a capture whose result is the closed category no-question is stored
// as a normal published result, never owes a solution or an escalation, is
// flagged noQuestion in the browser feed, and a typed follow-up on it still
// makes a real task revision whose own action carries no flag. Only categories,
// counts and ids are asserted, never content.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, pngOf, startFixture } from "./live-session-fixture";
import {
  buildProcessor,
  collectTraces,
  createFakeGateway,
  settle,
} from "./processor-fixture";
import { ActiveSessionRepository } from "./repository";

let fx: Fixture;
let repo: ActiveSessionRepository;
const cleanups: Array<() => Promise<void>> = [];

beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 120_000);
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
afterAll(() => fx?.stop());

const reply = (category: string, draft: string) => ({
  category,
  draft,
  claims: [],
  star: null,
  logistics: null,
  codingBrief: null,
});

async function world(name: string) {
  const person = await fx.provision(fx.tenantA, name);
  const scope = { tenantId: fx.tenantA, actorId: person.id };
  const started = await repo.startSession(scope, {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
  });
  const sessionId = started.session.id;
  // The first call sees an editor; every later call finds a question.
  const gateway = createFakeGateway({
    result: () =>
      gateway.requests.length <= 1
        ? reply(
            "no-question",
            "The screen shows a code editor with no question.",
          )
        : reply("technical-concept", "A short spoken outline."),
    generatedBy: { runtime: "claude-code", model: "claude-sonnet-5-5" },
  });
  const processor = buildProcessor(fx, {
    workerId: `worker-${name}`,
    gateway,
    trace: collectTraces(),
    visionProfileId: "vision-profile",
  });
  cleanups.push(async () => {
    gateway.releaseAll();
    await processor.close();
    await repo.controlSession(scope, sessionId, "end");
  });
  const feed = async () =>
    (await repo.listActionChanges(scope, sessionId)).actions.sort(
      (a, b) => a.taskRevision - b.taskRevision,
    );
  return { scope, sessionId, gateway, processor, feed };
}

describe("a no-question capture is a published observation, not a task", () => {
  it("is stored as a succeeded draft, flagged noQuestion, and owes no solution, escalation or missing context", async () => {
    const w = await world("nq-published");
    await repo.submitOwnerCapture(
      w.scope,
      w.sessionId,
      { operation: "analyze", requestId: "nq-1" },
      [pngOf(640, 480, 0)],
    );
    await settle(w.processor);

    const feed = await w.feed();
    expect(feed.map((a) => a.actionKind)).toEqual(["draft-answer"]);
    expect(feed[0]).toMatchObject({
      dispatchStatus: "succeeded",
      noQuestion: true,
    });
    expect(feed[0]).not.toHaveProperty("missingContext");
    expect(feed[0]?.result).toMatchObject({
      category: "no-question",
      claims: [],
      codingBrief: null,
    });
    // One model call only: no coding or escalation dispatch followed.
    expect(w.gateway.requests).toHaveLength(1);
  }, 60_000);

  it("lets a typed follow-up make a real revision, whose action clears the flag", async () => {
    const w = await world("nq-follow-up");
    await repo.submitOwnerCapture(
      w.scope,
      w.sessionId,
      { operation: "analyze", requestId: "nq-2" },
      [pngOf(640, 480, 1)],
    );
    await settle(w.processor);
    const first = (await w.feed())[0];
    expect(first?.noQuestion).toBe(true);

    await repo.submitOwnerInput(w.scope, w.sessionId, {
      requestId: "nq-2-follow",
      operation: "follow-up",
      target: { taskId: first?.taskId as string, revision: 1 },
      text: "Explain how a hash map handles collisions.",
      snapshots: [],
    });
    await settle(w.processor);

    const feed = await w.feed();
    expect(feed.map((a) => [a.taskRevision, a.noQuestion ?? false])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(feed[1]).toMatchObject({
      taskId: first?.taskId,
      dispatchStatus: "succeeded",
    });
    expect(feed[1]?.result).toMatchObject({ category: "technical-concept" });
  }, 60_000);
});
