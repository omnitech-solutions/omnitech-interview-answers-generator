// The owner's "stop work" (control command `stop-work`) through the real
// repository, processor and fenced writes on a disposable PostgreSQL: it
// abandons the dispatch in flight and every revision pending at that moment,
// keeps the session ACTIVE, never lets the abandoned revisions dispatch again
// (not on later ticks, not in a rebuilt run), and leaves later questions and
// new task revisions to dispatch normally.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
const cleanups: Array<() => Promise<void>> = [];

beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 120_000);
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
afterAll(() => fx.stop());

const QUESTIONS = [
  "What is your notice period?",
  "How would you design a rate limiter?",
  "Why do you want to join our company?",
];

async function world(name: string) {
  const started = await startSessionFor(fx, repo, fx.tenantA, name);
  const gateway = createFakeGateway();
  let now = 1_000_000;
  const build = (workerId: string) =>
    buildProcessor(fx, {
      workerId,
      gateway,
      clock: { nowMs: () => now },
      options: { settleMs: 1_500 },
    });
  const processor = build(`w-${name}`);
  cleanups.push(async () => {
    gateway.releaseAll();
    await processor.close();
    await repo
      .controlSession(started.scope, started.sessionId, "end")
      .catch(() => undefined);
  });
  const ask = (index: number) =>
    started.ingestor.ingest({
      eventId: `q${index}`,
      role: "interviewer",
      startMs: index * 20_000,
      endMs: index * 20_000 + 2_000,
      text: QUESTIONS[index] as string,
    });
  // `drain` waits for started dispatches; a held gateway never drains.
  const tick = async (proc = processor, times = 3, drain = true) => {
    for (let i = 0; i < times; i += 1) {
      now += 2_000;
      await proc.tick(NEVER_ABORTED);
      if (drain) await proc.idle();
    }
  };
  const stored = () => repo.listActions(started.scope, started.sessionId);
  return { ...started, gateway, processor, build, ask, tick, stored };
}

describe("owner stop work", () => {
  it("cancels in-flight and pending work, keeps the session active, and does not re-dispatch", async () => {
    const w = await world("stop-work-main");
    await w.ask(0);
    await w.ask(1);
    const hold = w.gateway.hold();
    // Question 0 is in the air (held in the gateway); question 1 waits for the
    // assist slot.
    await w.tick(w.processor, 2, false);
    await w.gateway.called(1);
    expect(w.gateway.requests).toHaveLength(1);

    const view = await repo.stopWork(w.scope, w.sessionId);
    expect(view.status).toBe("active");
    await w.tick(w.processor, 1, false);
    // The result that was in flight must not publish.
    hold.release();
    await w.tick(w.processor, 4);

    expect(w.gateway.requests).toHaveLength(1);
    const rows = await w.stored();
    expect(rows.some((row) => row.dispatchStatus === "succeeded")).toBe(false);
    expect(rows.some((row) => row.dispatchStatus === "in_flight")).toBe(false);
    expect(
      rows.filter((row) => row.suppressionReason === "owner_stopped").length,
    ).toBeGreaterThanOrEqual(2);
    const after = await repo.getSession(w.scope, w.sessionId);
    expect(after?.status).toBe("active");

    // A later heard question is new work and dispatches normally.
    await w.ask(2);
    await w.tick(w.processor, 4);
    expect(w.gateway.requests).toHaveLength(2);
    const later = await w.stored();
    expect(
      later.filter((row) => row.dispatchStatus === "succeeded"),
    ).toHaveLength(1);
  }, 60_000);

  it("does not re-dispatch abandoned revisions in a rebuilt run, and a new revision still dispatches", async () => {
    const w = await world("stop-work-rebuild");
    await w.ask(0);
    const hold = w.gateway.hold();
    await w.tick(w.processor, 2, false);
    await w.gateway.called(1);
    await repo.stopWork(w.scope, w.sessionId);
    await w.tick(w.processor, 1, false);
    hold.release();
    await w.tick(w.processor, 2);
    await w.processor.close();

    // A fresh holder rebuilds from the stored actions and stream.
    const rebuilt = w.build("w-stop-work-rebuild-2");
    cleanups.push(() => rebuilt.close());
    await w.tick(rebuilt, 5);
    expect(w.gateway.requests).toHaveLength(1);

    // A newer question after the stop is its own task and answers.
    await w.ask(1);
    await w.tick(rebuilt, 4);
    expect(w.gateway.requests).toHaveLength(2);
  }, 60_000);

  it("refuses a paused or ended session and another owner's session without a side effect", async () => {
    const w = await world("stop-work-refusals");
    const stranger = await fx.provision(fx.tenantA, "stop-work-stranger");
    await expect(
      repo.stopWork(
        { tenantId: fx.tenantA, actorId: stranger.id },
        w.sessionId,
      ),
    ).rejects.toMatchObject({ code: "not_found" });

    await repo.controlSession(w.scope, w.sessionId, "pause");
    await expect(repo.stopWork(w.scope, w.sessionId)).rejects.toMatchObject({
      code: "status_refused",
    });
    expect((await repo.getSession(w.scope, w.sessionId))?.status).toBe(
      "paused",
    );

    await repo.controlSession(w.scope, w.sessionId, "end");
    await expect(repo.stopWork(w.scope, w.sessionId)).rejects.toMatchObject({
      code: "status_refused",
    });
    const stops = await fx.owner.query(
      "SELECT count(*)::int AS n FROM interview.session_observations WHERE session_id=$1 AND kind='owner.input'",
      [w.sessionId],
    );
    expect(stops.rows[0].n).toBe(0);
  }, 60_000);
});
