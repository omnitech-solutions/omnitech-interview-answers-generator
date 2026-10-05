// Hardening case 2 (PB-0002 slice 3): a worker lost mid-action while the
// companion keeps speaking through the real routes. The lease expires, a
// successor claims at a higher fence and replays the stored observations, the
// superseded worker's late publish is refused, and no draft is published twice.
import * as fixture from "@omnitech/capture-companion/fixture";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  buildProcessor,
  collectTraces,
  createFakeGateway,
  expireLease,
  NEVER_ABORTED,
  settle,
} from "../processor-fixture";
import { ActiveSessionRepository } from "../repository";
import { RECRUITER_SCREEN } from "../session-replay-fixtures";
import { startWorld, type World } from "./world";

let world: World;
let repo: ActiveSessionRepository;
const cleanups: Array<() => Promise<void>> = [];
beforeAll(async () => {
  world = await startWorld(fixture);
  repo = new ActiveSessionRepository(world.fx.member);
}, 120_000);
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
afterAll(() => world?.stop());

const phase = (index: number) => RECRUITER_SCREEN[index]?.segments ?? [];
const inputOf = (segment: ReturnType<typeof phase>[number]) => ({
  eventId: segment.eventId,
  source: (segment.role === "interviewer"
    ? "application-audio"
    : "microphone") as "application-audio" | "microphone",
  text: segment.text,
  startMs: segment.startMs,
  endMs: segment.endMs,
});

function processorFor(workerId: string, gateway = createFakeGateway()) {
  const trace = collectTraces();
  const processor = buildProcessor(world.fx, { workerId, gateway, trace });
  cleanups.unshift(async () => {
    gateway.releaseAll();
    await processor.close();
  });
  return { processor, gateway, trace };
}

const fenceRows = async (sessionId: string) =>
  (
    await world.fx.owner.query(
      `SELECT task_id, task_revision, action_kind, dispatch_status, fence_at_dispatch::int AS fence, (result IS NOT NULL) AS has_result
       FROM interview.session_actions WHERE session_id=$1 ORDER BY created_at, id`,
      [sessionId],
    )
  ).rows;

describe("a worker lost mid-action while the companion keeps speaking (case 2)", () => {
  it("refuses the superseded worker's late publish and publishes each result once under the successor", async () => {
    const owner = await world.begin("restart-inflight");
    const run = world.companion(owner);
    await run.open();
    for (const segment of phase(0))
      await run.companion.observeTranscript(inputOf(segment));

    // Worker A takes the question and is stuck inside the model call.
    const a = processorFor("worker-a");
    const hold = a.gateway.hold();
    await a.processor.tick(NEVER_ABORTED);
    await a.gateway.called(1);
    expect(a.processor.snapshot(owner.id)?.fence).toBe(1);

    // The call goes on: the companion sends the follow-up while nobody can
    // publish, and every message is acknowledged and stored.
    for (const segment of phase(1))
      await run.companion.observeTranscript(inputOf(segment));
    expect(run.companion.pending).toBe(0);

    // A's lease lapses; B claims at the next fence and replays the stored
    // observations, including the ones that arrived during the outage.
    await expireLease(world.fx, owner.id);
    const b = processorFor("worker-b");
    await settle(b.processor);
    expect(b.processor.snapshot(owner.id)?.fence).toBe(2);
    const afterSuccessor = await fenceRows(owner.id);
    const publishedByB = afterSuccessor.filter((row) => row.has_result);
    expect(publishedByB.length).toBeGreaterThan(0);
    expect(publishedByB.every((row) => row.fence === 2)).toBe(true);

    // A's model call returns late: the publish is refused and writes nothing.
    hold.release();
    await a.processor.idle();
    expect(await fenceRows(owner.id)).toEqual(afterSuccessor);
    expect(
      a.trace.events.find((event) => event.event === "dispatch.stopped"),
    ).toMatchObject({ outcome: "fence_superseded", fence: 1 });
    // Its next tick finds the newer fence on renewal and lets the session go.
    await a.processor.tick(NEVER_ABORTED);
    expect(a.processor.snapshot(owner.id)).toBeUndefined();
    expect(await fenceRows(owner.id)).toEqual(afterSuccessor);

    // No draft is published twice, and nothing was published at the old fence.
    const keys = publishedByB.map(
      (row) => `${row.task_id}/${row.task_revision}/${row.action_kind}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      afterSuccessor.some((row) => row.fence === 1 && row.has_result),
    ).toBe(false);
    // The Live view reads the same single published result per revision.
    const model = await world.model(owner);
    const published = model.runs.filter((entry) => entry.state === "published");
    expect(new Set(published.map((entry) => entry.id)).size).toBe(
      published.length,
    );
  }, 60_000);

  it("answers a question spoken while no worker held the session, once, and does not repeat earlier answers", async () => {
    const owner = await world.begin("restart-outage");
    const run = world.companion(owner);
    await run.open();
    for (const segment of phase(0))
      await run.companion.observeTranscript(inputOf(segment));

    const a = processorFor("worker-outage-a");
    await settle(a.processor);
    const answeredBefore = (
      await repo.listActions(owner.scope, owner.id)
    ).filter((action) => action.dispatchStatus === "succeeded");
    expect(answeredBefore.length).toBeGreaterThan(0);

    // Worker A dies without releasing its lease: it never ticks again. The
    // companion keeps sending through the outage.
    for (const segment of phase(1))
      await run.companion.observeTranscript(inputOf(segment));
    await expireLease(world.fx, owner.id);

    const b = processorFor("worker-outage-b");
    await settle(b.processor);
    expect(b.processor.snapshot(owner.id)?.fence).toBe(2);

    const rows = await fenceRows(owner.id);
    const keys = rows
      .filter((row) => row.dispatch_status === "succeeded")
      .map((row) => `${row.task_id}/${row.task_revision}/${row.action_kind}`);
    // Each result exists once across both fences.
    expect(new Set(keys).size).toBe(keys.length);
    // The successor answered something new and repeated nothing: it never
    // dispatched a key the first worker had already published.
    const beforeKeys = new Set(
      answeredBefore.map(
        (action) =>
          `${action.taskId}/${action.taskRevision}/${action.actionKind}`,
      ),
    );
    expect(keys.length).toBeGreaterThan(beforeKeys.size);
    const bRequests = b.gateway.requests.length;
    expect(bRequests).toBe(keys.length - beforeKeys.size);
  }, 60_000);
});
