// The session processor over the synthetic recruiter-screen script, with the
// real ingest path, the real repository and fenced writes on a disposable
// PostgreSQL, and a fake gateway returning canned closed-schema output:
// no task from backchannel or monologue, one logical task per question,
// revisions that make the earlier answer stale, a deferred topic kept, an ASR
// correction that supersedes an earlier segment, nothing published for stale
// work, and dispatch deduplicated by session, task, revision and action kind.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ingestObservation } from "./ingest.js";
import { type Fixture, startFixture } from "./live-session-fixture.js";
import {
  buildProcessor,
  createFakeGateway,
  NEVER_ABORTED,
  settle,
  startSessionFor,
} from "./processor-fixture.js";
import { ActiveSessionRepository } from "./repository.js";
import {
  FIXTURE_SOURCES,
  RECRUITER_SCREEN,
} from "./session-replay-fixtures.js";

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

async function world(name: string, options = {}) {
  const started = await startSessionFor(fx, repo, fx.tenantA, name);
  const gateway = createFakeGateway();
  const workerId = `worker-${name}`;
  const processor = buildProcessor(fx, { workerId, gateway, ...options });
  cleanups.push(async () => {
    await processor.close();
    await repo.controlSession(started.scope, started.sessionId, "end");
  });
  return { ...started, gateway, processor };
}

const actions = (w: {
  scope: { tenantId: string; actorId: string };
  sessionId: string;
}) => repo.listActions(w.scope, w.sessionId);

// A task is named after the segment that carries its question.
const Q1 = "task-q-s09";
const Q2 = "task-q-s16";

describe("recruiter-screen replay through the real processor", () => {
  it("opens no task for backchannel or monologue and one per question, with revisions", async () => {
    const w = await world("replay-full");
    const [opening, followUp, deferred, correction] = RECRUITER_SCREEN;

    // 1. Opening: greeting, a monologue interleaved with backchannels, then a
    // compound question. Exactly one logical task.
    for (const segment of opening?.segments ?? [])
      await w.ingestor.ingest(segment);
    await settle(w.processor);
    let snapshot = w.processor.snapshot(w.sessionId);
    expect(snapshot?.tasks.map((t) => [t.taskId, t.revision])).toEqual([
      [Q1, 1],
    ]);
    expect(w.gateway.requests).toHaveLength(1);

    // 2. A filler, a long answer, then "part two": revision 2, the earlier
    // answer is stale (outdated), and a second answer is produced.
    for (const segment of followUp?.segments ?? [])
      await w.ingestor.ingest(segment);
    await settle(w.processor);
    snapshot = w.processor.snapshot(w.sessionId);
    expect(snapshot?.tasks).toEqual([
      {
        taskId: Q1,
        revision: 2,
        standing: { 1: "outdated", 2: "current" },
      },
    ]);

    // 3. A deferred topic stays in task state; a second question opens its own task.
    for (const segment of deferred?.segments ?? [])
      await w.ingestor.ingest(segment);
    await settle(w.processor);
    snapshot = w.processor.snapshot(w.sessionId);
    expect(snapshot?.deferred).toHaveLength(1);
    expect(snapshot?.tasks.map((t) => t.taskId)).toEqual([Q1, Q2]);

    // 4. An ASR correction supersedes the second question's segment: the answer
    // built on it is marked stale and the corrected text becomes revision 2.
    for (const segment of correction?.segments ?? [])
      await w.ingestor.ingest(segment);
    await settle(w.processor);
    snapshot = w.processor.snapshot(w.sessionId);
    const second = snapshot?.tasks.find((t) => t.taskId === Q2);
    expect(second?.revision).toBe(2);
    expect(second?.standing[1]).toBe("outdated");
    expect(second?.standing[2]).toBe("current");

    // Four questions-worth of work: Q1 r1, Q1 r2, Q2 r1, Q2 r2 - and nothing
    // for the greeting, backchannels, filler, monologue or the deferred topic.
    expect(w.gateway.requests).toHaveLength(4);
    const stored = await actions(w);
    expect(
      stored.map((a) => [a.taskId, a.taskRevision, a.dispatchStatus]),
    ).toEqual([
      [Q1, 1, "succeeded"],
      [Q1, 2, "succeeded"],
      [Q2, 1, "succeeded"],
      [Q2, 2, "succeeded"],
    ]);
    // Published results live in session_actions.result only and carry the
    // closed draft shape, the profile and the policy - no matrix write.
    expect(stored[0]?.result).toMatchObject({
      version: 1,
      stage: "draft-answer",
      meta: { processingPolicy: "permitted-remote" },
    });
    const promoted = await fx.owner.query(
      "SELECT count(*)::int AS n FROM interview.candidate_profile_revisions WHERE matrix::text <> '{}'",
    );
    expect(promoted.rows[0].n).toBe(0);
  }, 60_000);

  it("records the executor's runtime and model on the published action", async () => {
    const generatedBy = { runtime: "claude-code", model: "claude-sonnet-5-5" };
    const started = await startSessionFor(fx, repo, fx.tenantA, "replay-by");
    const gateway = createFakeGateway({ generatedBy });
    const processor = buildProcessor(fx, {
      workerId: "worker-replay-by",
      gateway,
    });
    cleanups.push(async () => {
      await processor.close();
      await repo.controlSession(started.scope, started.sessionId, "end");
    });
    for (const segment of RECRUITER_SCREEN[0]?.segments ?? [])
      await started.ingestor.ingest(segment);
    await settle(processor);
    const stored = await actions(started);
    const published = stored.filter((a) => a.result !== null);
    expect(published.length).toBeGreaterThan(0);
    for (const action of published) {
      expect(action.generatedBy).toEqual(generatedBy);
      expect(action.result).toMatchObject({ generatedBy });
    }
  }, 60_000);

  it("puts captured text only in the labelled data block of each request", async () => {
    const w = await world("replay-block");
    for (const segment of RECRUITER_SCREEN[0]?.segments ?? [])
      await w.ingestor.ingest(segment);
    await settle(w.processor);
    const request = w.gateway.requests[0];
    expect(request?.task.type).toBe("structured-generation");
    expect(request?.task.system).not.toContain("migration");
    expect(request?.task.prompt).toContain("BEGIN CAPTURED DATA");
    expect(request?.task.prompt).toContain("migration");
    // The fast path has no tools and its output schema is closed.
    expect(request).not.toHaveProperty("tools");
    expect(request?.task.schema).toMatchObject({ additionalProperties: false });
    expect(request?.profileId).toBe("interview-session-fast");
    expect(request?.processingPolicy).toBe("permitted-remote");
  });

  it("publishes nothing for a revision that went stale while it was generating", async () => {
    const w = await world("replay-stale");
    const [opening, followUp] = RECRUITER_SCREEN;
    for (const segment of opening?.segments ?? [])
      await w.ingestor.ingest(segment);
    const hold = w.gateway.hold();
    await w.processor.tick(NEVER_ABORTED);
    await w.gateway.called(1);

    // While revision 1 is being generated the follow-up arrives: revision 2.
    for (const segment of followUp?.segments ?? [])
      await w.ingestor.ingest(segment);
    await w.processor.tick(NEVER_ABORTED);
    hold.release();
    await w.processor.idle();

    let stored = await actions(w);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      taskRevision: 1,
      dispatchStatus: "suppressed",
      suppressionReason: "revision_stale",
      result: null,
    });

    await settle(w.processor);
    stored = await actions(w);
    expect(stored.map((a) => [a.taskRevision, a.dispatchStatus])).toEqual([
      [1, "suppressed"],
      [2, "succeeded"],
    ]);
    expect(stored.filter((a) => a.result !== null)).toHaveLength(1);
  });
});

describe("dispatch deduplication", () => {
  const firstQuestion = () => RECRUITER_SCREEN[0]?.segments ?? [];

  it("never dispatches twice for a resent observation", async () => {
    const w = await world("dedup-resend");
    for (const segment of firstQuestion()) await w.ingestor.ingest(segment);
    // The companion resends the question's segment: the original ack returns.
    const question = firstQuestion().at(-1);
    // A true resend carries the SAME source and sequence; a different body
    // under the same event id would be an event_conflict, not a duplicate.
    const source = FIXTURE_SOURCES[question?.role ?? "interviewer"];
    const sequence = firstQuestion().filter(
      (segment) => FIXTURE_SOURCES[segment.role].sourceId === source.sourceId,
    ).length;
    const resent = await ingestObservation(
      fx.member,
      w.ingestor.credential,
      fx.tenantA,
      {
        version: 1,
        kind: "transcript.final",
        sourceId: source.sourceId,
        eventId: question?.eventId,
        occurredAt: "2026-10-03T10:00:00.000Z",
        sequence,
        content: {
          speaker: source.speaker,
          text: question?.text,
          startMs: question?.startMs,
          endMs: question?.endMs,
        },
      },
    );
    expect(resent.status).toBe("duplicate");

    await settle(w.processor);
    await settle(w.processor);
    expect(w.gateway.requests).toHaveLength(1);
    expect(await actions(w)).toHaveLength(1);
  });

  it("dispatches a (task, revision, kind) once however many ticks run, including while in flight", async () => {
    const w = await world("dedup-ticks");
    for (const segment of firstQuestion()) await w.ingestor.ingest(segment);
    const hold = w.gateway.hold();
    await w.processor.tick(NEVER_ABORTED);
    await w.gateway.called(1);
    // Ticks while the first call is in flight start nothing.
    await w.processor.tick(NEVER_ABORTED);
    await w.processor.tick(NEVER_ABORTED);
    hold.release();
    await w.processor.idle();
    for (let i = 0; i < 3; i += 1) await settle(w.processor);

    expect(w.gateway.requests).toHaveLength(1);
    expect(await actions(w)).toHaveLength(1);
  });

  it("retries a failed dispatch, deduplicated only against succeeded or in-flight work", async () => {
    let calls = 0;
    const w = await world("dedup-retry");
    const failing = createFakeGateway({
      fail: () =>
        (calls += 1) === 1 ? new Error("model unavailable") : undefined,
    });
    const processor = buildProcessor(fx, {
      workerId: "worker-dedup-retry-2",
      gateway: failing,
    });
    cleanups.push(() => processor.close());
    // Only the retrying processor may hold this session.
    await w.processor.close();

    for (const segment of firstQuestion()) await w.ingestor.ingest(segment);
    await settle(processor);

    expect(failing.requests).toHaveLength(2);
    const stored = await actions(w);
    expect(stored.map((a) => [a.attempt, a.dispatchStatus])).toEqual([
      [1, "failed"],
      [2, "succeeded"],
    ]);
    // A third tick finds the succeeded dispatch and dispatches nothing.
    await settle(processor);
    expect(failing.requests).toHaveLength(2);
  });

  it("stops retrying after the bound on failed dispatches", async () => {
    const w = await world("dedup-bound");
    const failing = createFakeGateway({ fail: () => new Error("down") });
    const processor = buildProcessor(fx, {
      workerId: "worker-dedup-bound-2",
      gateway: failing,
      options: { maxAttempts: 3 },
    });
    cleanups.push(() => processor.close());
    await w.processor.close();
    for (const segment of firstQuestion()) await w.ingestor.ingest(segment);

    await settle(processor, 12);

    expect(failing.requests).toHaveLength(3);
    expect((await actions(w)).map((a) => a.dispatchStatus)).toEqual([
      "failed",
      "failed",
      "failed",
    ]);
  });
});
