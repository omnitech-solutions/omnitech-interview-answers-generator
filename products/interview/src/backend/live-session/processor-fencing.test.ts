// Lease, fence, pause, end, isolation and cross-user behaviour of the session
// processor on a disposable PostgreSQL: two processors on one session (an
// older fence's late publish is refused while its successor publishes; a
// restarted worker outranks its earlier self), pause and end during in-flight
// generation (the late result is not published and jobs are cancelled), purge
// on end, per-session error isolation, and the same-tenant cross-user case.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, startFixture } from "./live-session-fixture";
import {
  buildProcessor,
  collectTraces,
  createFakeEngine,
  expireLease,
  insertSessionJob,
  NEVER_ABORTED,
  settle,
  startSessionFor,
} from "./processor-fixture";
import type { SessionClaimPort, SessionStorePort } from "./processor-ports";
import { ActiveSessionRepository } from "./repository";
import { RECRUITER_SCREEN } from "./session-replay-fixtures";

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

// The opening question's task is named after the segment that carries it.
const FIRST_TASK = "task-q-s09";
const opening = () => RECRUITER_SCREEN[0]?.segments ?? [];

async function start(name: string) {
  const world = await startSessionFor(fx, repo, fx.tenantA, name);
  cleanups.push(async () => {
    // Jobs arranged by a test never run; settle them so a purge never waits.
    await fx.owner.query(
      "UPDATE ai.agent_jobs SET status='cancelled' WHERE id IN (SELECT job_id FROM interview.session_actions WHERE session_id=$1 AND job_id IS NOT NULL) AND status NOT IN ('completed','failed','cancelled')",
      [world.sessionId],
    );
    await repo
      .controlSession(world.scope, world.sessionId, "end")
      .catch(() => undefined);
  });
  return world;
}
function processorFor(
  workerId: string,
  engine = createFakeEngine(),
  extra = {},
) {
  const trace = collectTraces();
  const processor = buildProcessor(fx, { workerId, engine, trace, ...extra });
  cleanups.unshift(async () => {
    engine.releaseAll();
    await processor.close();
  });
  return { processor, engine, trace };
}
const actionsOf = (w: {
  scope: { tenantId: string; actorId: string };
  sessionId: string;
}) => repo.listActions(w.scope, w.sessionId);
const sessionRow = async (sessionId: string) =>
  (
    await fx.owner.query(
      "SELECT fence, lease_holder_id, lease_expires_at, status, purged_at FROM interview.active_sessions WHERE id=$1",
      [sessionId],
    )
  ).rows[0];

describe("lease and fence", () => {
  it("renews the lease each tick while healthy, keeping the fence", async () => {
    const w = await start("fence-renew");
    const a = processorFor("worker-renew");
    await a.processor.tick(NEVER_ABORTED);
    const first = await sessionRow(w.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await a.processor.tick(NEVER_ABORTED);
    const second = await sessionRow(w.sessionId);

    expect(Number(first.fence)).toBe(Number(second.fence));
    expect(second.lease_holder_id).toBe("worker-renew");
    expect(new Date(second.lease_expires_at).getTime()).toBeGreaterThan(
      new Date(first.lease_expires_at).getTime(),
    );
  });

  it("refuses an older fence's late publish while the successor publishes", async () => {
    const w = await start("fence-successor");
    for (const segment of opening()) await w.ingestor.ingest(segment);
    const older = processorFor("worker-older");
    const hold = older.engine.hold();
    await older.processor.tick(NEVER_ABORTED);
    await older.engine.called(1);
    expect(older.processor.snapshot(w.sessionId)?.fence).toBe(1);

    // The older lease expires; a successor claims at a higher fence.
    await expireLease(fx, w.sessionId);
    const newer = processorFor("worker-newer");
    await settle(newer.processor);
    expect(newer.processor.snapshot(w.sessionId)?.fence).toBe(2);
    expect(Number((await sessionRow(w.sessionId)).fence)).toBe(2);
    const afterSuccessor = await actionsOf(w);
    expect(afterSuccessor.map((a) => [a.attempt, a.dispatchStatus])).toEqual([
      [1, "failed"],
      [2, "succeeded"],
    ]);

    // The older holder's model call returns late: its publish is refused and
    // it writes nothing - no result, no suppression row.
    hold.release();
    await older.processor.idle();
    expect(await actionsOf(w)).toEqual(afterSuccessor);
    expect(
      older.trace.events.find((e) => e.event === "dispatch.stopped"),
    ).toMatchObject({ outcome: "fence_superseded", fence: 1 });
    expect(older.processor.snapshot(w.sessionId)?.mode).toBe("superseded");

    // Its next tick finds the newer fence on renewal and stops immediately.
    await older.processor.tick(NEVER_ABORTED);
    expect(older.processor.snapshot(w.sessionId)).toBeUndefined();
    expect(await actionsOf(w)).toEqual(afterSuccessor);
    expect(newer.engine.requests).toHaveLength(1);
    expect(older.engine.requests).toHaveLength(1);
  });

  it("makes a restarted worker outrank its earlier self under the same id", async () => {
    const w = await start("fence-restart");
    for (const segment of opening()) await w.ingestor.ingest(segment);
    const earlier = processorFor("worker-same");
    const hold = earlier.engine.hold();
    await earlier.processor.tick(NEVER_ABORTED);
    await earlier.engine.called(1);

    // A restarted process reuses the id and re-acquires its own live lease.
    const restarted = processorFor("worker-same");
    await settle(restarted.processor);
    expect(restarted.processor.snapshot(w.sessionId)?.fence).toBe(2);

    hold.release();
    await earlier.processor.idle();
    const rows = await actionsOf(w);
    expect(rows.filter((a) => a.result !== null)).toHaveLength(1);
    expect(rows.map((a) => a.dispatchStatus)).toEqual(["failed", "succeeded"]);
    expect(
      earlier.trace.events.find((e) => e.event === "dispatch.stopped"),
    ).toMatchObject({ outcome: "fence_superseded" });
  });
});

describe("pause and end suppression", () => {
  it("does not publish a result that returns after a pause, and cancels in-flight jobs", async () => {
    const w = await start("pause-inflight");
    for (const segment of opening()) await w.ingestor.ingest(segment);
    const jobId = await insertSessionJob(fx, w, fx.tenantA);
    const p = processorFor("worker-pause");
    const hold = p.engine.hold();
    await p.processor.tick(NEVER_ABORTED);
    await p.engine.called(1);

    await repo.controlSession(w.scope, w.sessionId, "pause");
    hold.release();
    await p.processor.idle();

    const rows = (await actionsOf(w)).filter((a) => a.taskId === FIRST_TASK);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dispatchStatus: "suppressed",
      suppressionReason: "session_paused",
      result: null,
    });
    expect(
      (
        await fx.owner.query("SELECT status FROM ai.agent_jobs WHERE id=$1", [
          jobId,
        ])
      ).rows[0].status,
    ).toBe("cancelling");

    // The processor sees the pause, refuses new dispatch and lets the run go.
    await p.processor.tick(NEVER_ABORTED);
    expect(p.processor.snapshot(w.sessionId)).toBeUndefined();
    expect(p.engine.requests).toHaveLength(1);
  });

  it("never publishes a result dispatched before a pause, even after a resume, and answers the resumed session", async () => {
    const w = await start("pause-resume-inflight");
    for (const segment of opening()) await w.ingestor.ingest(segment);
    const p = processorFor("worker-resume");
    const hold = p.engine.hold();
    await p.processor.tick(NEVER_ABORTED);
    await p.engine.called(1);

    // Pause and resume land while the model call is still in flight.
    await repo.controlSession(w.scope, w.sessionId, "pause");
    await repo.controlSession(w.scope, w.sessionId, "resume");
    hold.release();
    await p.processor.idle();

    const afterRelease = await actionsOf(w);
    expect(afterRelease.filter((a) => a.result !== null)).toHaveLength(0);
    expect(afterRelease[0]).toMatchObject({
      dispatchStatus: "suppressed",
      suppressionReason: "session_paused",
    });

    // The resumed session is processed again and its question is answered once.
    await settle(p.processor);
    const rows = await actionsOf(w);
    expect(rows.filter((a) => a.dispatchStatus === "succeeded")).toHaveLength(
      1,
    );
    expect((await sessionRow(w.sessionId)).status).toBe("active");
  });

  it("answers a question whose dispatch a pause suppressed once the session resumes", async () => {
    const w = await start("pause-suppressed-retry");
    for (const segment of opening()) await w.ingestor.ingest(segment);
    let paused = false;
    const p = processorFor("worker-retry", createFakeEngine(), {
      wrapStore: (store: SessionStorePort): SessionStorePort => ({
        ...store,
        recordAction: async (input) => {
          if (!paused) {
            paused = true;
            await repo.controlSession(w.scope, w.sessionId, "pause");
          }
          return store.recordAction(input);
        },
      }),
    });
    await p.processor.tick(NEVER_ABORTED);
    await p.processor.idle();
    expect(p.engine.requests).toHaveLength(0);
    await p.processor.tick(NEVER_ABORTED);
    expect(p.processor.snapshot(w.sessionId)).toBeUndefined();

    await repo.controlSession(w.scope, w.sessionId, "resume");
    await settle(p.processor);
    await settle(p.processor);
    expect(p.engine.requests).toHaveLength(1);
    const rows = await actionsOf(w);
    expect(rows.filter((a) => a.dispatchStatus === "succeeded")).toHaveLength(
      1,
    );
    // Dedup intact: more ticks do not answer it again.
    await settle(p.processor);
    expect(p.engine.requests).toHaveLength(1);
  });

  it("pauses a session whose credential expired, cancelling its jobs, and publishes nothing late", async () => {
    const w = await start("pause-expiry");
    for (const segment of opening()) await w.ingestor.ingest(segment);
    const jobId = await insertSessionJob(fx, w, fx.tenantA);
    const p = processorFor("worker-expiry");
    const hold = p.engine.hold();
    await p.processor.tick(NEVER_ABORTED);
    await p.engine.called(1);

    await fx.owner.query(
      "UPDATE interview.active_sessions SET credential_expires_at = now() - interval '1 second' WHERE id=$1",
      [w.sessionId],
    );
    await p.processor.tick(NEVER_ABORTED);
    expect((await sessionRow(w.sessionId)).status).toBe("paused");
    expect(p.processor.snapshot(w.sessionId)?.mode).toBe("quiescing");
    hold.release();
    await p.processor.idle();

    expect(
      (await actionsOf(w)).filter((a) => a.taskId === FIRST_TASK)[0],
    ).toMatchObject({ dispatchStatus: "suppressed", result: null });
    expect(
      (
        await fx.owner.query("SELECT status FROM ai.agent_jobs WHERE id=$1", [
          jobId,
        ])
      ).rows[0].status,
    ).toBe("cancelling");
    await p.processor.tick(NEVER_ABORTED);
    expect(p.processor.snapshot(w.sessionId)).toBeUndefined();
  });

  it("does not publish a result that returns after the session ended, then purges it", async () => {
    const w = await start("end-inflight");
    for (const segment of opening()) await w.ingestor.ingest(segment);
    const p = processorFor("worker-end", createFakeEngine(), {
      sweeps: true,
      options: { sweepEveryMs: 0 },
    });
    const hold = p.engine.hold();
    await p.processor.tick(NEVER_ABORTED);
    await p.engine.called(1);

    await repo.controlSession(w.scope, w.sessionId, "end");
    hold.release();
    await p.processor.idle();
    // Nothing is published. The late result is recorded as suppressed, unless
    // the sweep the first tick started (it runs beside the held call) already
    // saw the ended session and purged its rows: on a slow machine that sweep
    // wins the race, and no row at all is also "nothing published".
    const rows = (await actionsOf(w)).filter((a) => a.taskId === FIRST_TASK);
    expect(rows.every((row) => row.dispatchStatus !== "succeeded")).toBe(true);
    if (rows[0])
      expect(rows[0]).toMatchObject({
        dispatchStatus: "suppressed",
        suppressionReason: "session_ended",
        result: null,
      });

    // The sweep purges an ended session that deletes at end.
    await p.processor.tick(NEVER_ABORTED);
    await p.processor.idle();
    await p.processor.tick(NEVER_ABORTED);
    await p.processor.idle();
    const row = await sessionRow(w.sessionId);
    expect(row.purged_at).not.toBeNull();
    expect(
      (
        await fx.owner.query(
          "SELECT count(*)::int AS n FROM interview.session_observations WHERE session_id=$1",
          [w.sessionId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(p.processor.snapshot(w.sessionId)).toBeUndefined();
    expect(p.trace.events.some((e) => e.event === "session.purge")).toBe(true);
  });

  it("refuses new dispatch for a session paused just before the dispatch is recorded", async () => {
    const w = await start("pause-before-dispatch");
    for (const segment of opening()) await w.ingestor.ingest(segment);
    let paused = false;
    const p = processorFor("worker-prepause", createFakeEngine(), {
      wrapStore: (store: SessionStorePort): SessionStorePort => ({
        ...store,
        recordAction: async (input) => {
          if (!paused) {
            paused = true;
            await repo.controlSession(w.scope, w.sessionId, "pause");
          }
          return store.recordAction(input);
        },
      }),
    });
    await p.processor.tick(NEVER_ABORTED);
    await p.processor.idle();

    expect(p.engine.requests).toHaveLength(0);
    expect(await actionsOf(w)).toMatchObject([
      { dispatchStatus: "suppressed", suppressionReason: "session_paused" },
    ]);
  });
});

describe("isolation", () => {
  it("traces a failing session by id and code and keeps the others and the loop going", async () => {
    const bad = await start("iso-bad");
    const good = await start("iso-good");
    for (const w of [bad, good])
      for (const segment of opening()) await w.ingestor.ingest(segment);
    const p = processorFor("worker-iso", createFakeEngine(), {
      wrapStore: (store: SessionStorePort): SessionStorePort => ({
        ...store,
        reconcile: async (scope, sessionId) => {
          if (sessionId === bad.sessionId)
            throw new Error("boom CANARY-ISOLATION-MESSAGE");
          return store.reconcile(scope, sessionId);
        },
      }),
    });

    await settle(p.processor);

    expect(
      (await actionsOf(good)).map((a) => [a.taskId, a.dispatchStatus]),
    ).toEqual([[FIRST_TASK, "succeeded"]]);
    expect(await actionsOf(bad)).toHaveLength(0);
    const failure = p.trace.events.find((e) => e.event === "session.error");
    expect(failure).toMatchObject({
      sessionId: bad.sessionId,
      outcome: "unexpected_error",
    });
    expect(JSON.stringify(p.trace.events)).not.toContain("CANARY");
  });

  it("never lets a throwing trace sink stop the loop", async () => {
    const w = await start("iso-sink");
    for (const segment of opening()) await w.ingestor.ingest(segment);
    const p = processorFor("worker-sink", createFakeEngine(), {
      trace: {
        emit: () => {
          throw new Error("sink down");
        },
      },
    });
    await settle(p.processor);
    expect((await actionsOf(w))[0]?.dispatchStatus).toBe("succeeded");
  });
});

describe("cross-user (same tenant)", () => {
  it("reads and writes each session only as its own owner and never mixes their text", async () => {
    const a = await start("owner-a");
    const b = await start("owner-b");
    const base = opening().at(-1);
    if (!base) throw new Error("fixture");
    await a.ingestor.ingest(base, "Tell me about CANARY-OWNER-A-TOPIC please?");
    await b.ingestor.ingest(base, "Tell me about CANARY-OWNER-B-TOPIC please?");

    const seen: Array<[string, string]> = [];
    const p = processorFor("worker-cross", createFakeEngine(), {
      wrapStore: (store: SessionStorePort): SessionStorePort => ({
        ...store,
        observationsAfter: (scope, sessionId, ...rest) => {
          seen.push([scope.actorId, sessionId]);
          return store.observationsAfter(scope, sessionId, ...rest);
        },
      }),
    });
    await settle(p.processor);

    expect(seen).toContainEqual([a.person.id, a.sessionId]);
    expect(seen).toContainEqual([b.person.id, b.sessionId]);
    for (const [actor, session] of seen) {
      const owner = [a, b].find((w) => w.person.id === actor);
      expect(owner?.sessionId).toBe(session);
    }
    expect(p.engine.requests).toHaveLength(2);
    for (const request of p.engine.requests) {
      const mine = request.scope.actorId === a.person.id ? "A" : "B";
      const theirs = mine === "A" ? "B" : "A";
      expect(request.prompt).toContain(`CANARY-OWNER-${mine}-TOPIC`);
      expect(request.prompt).not.toContain(`CANARY-OWNER-${theirs}-TOPIC`);
      expect(request.scope.tenantId).toBe(fx.tenantA);
    }
  });

  it("finds nothing when a claim names another owner's session", async () => {
    const a = await start("claim-a");
    const b = await start("claim-b");
    for (const segment of opening()) await b.ingestor.ingest(segment);
    const p = processorFor("worker-forged", createFakeEngine(), {
      // A forged claim: owner A's identity on owner B's session id.
      wrapClaim: (claim: SessionClaimPort) => ({
        ...claim,
        claim: async () => [
          {
            tenantId: fx.tenantA,
            ownerUserId: a.person.id,
            sessionId: b.sessionId,
            fence: 1,
          },
        ],
      }),
    });
    await p.processor.tick(NEVER_ABORTED);
    await p.processor.idle();

    expect(p.engine.requests).toHaveLength(0);
    expect(await actionsOf(b)).toHaveLength(0);
    expect(
      p.trace.events.find((e) => e.event === "session.error"),
    ).toMatchObject({ sessionId: b.sessionId, outcome: "not_found" });
    expect(p.processor.snapshot(b.sessionId)).toBeUndefined();
  });
});
