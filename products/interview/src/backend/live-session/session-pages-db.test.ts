// The browser's action feed on a disposable PostgreSQL as the member role
// (requires Docker, like the other session suites): `listActionChanges` runs
// the real SNAPSHOT_EVENT_IDS SQL over stored rows, so the screenshots an
// action rests on reach the browser as source and event ids only (in stored
// order, never the spoken or owner-input ids), and a stored missing-context
// list comes back sanitised on the action.
import { liveActionSchema } from "@omnitech/interview-contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Fixture, startFixture } from "./live-session-fixture";
import { snapshotProvenanceId } from "./owner-input";
import { ActiveSessionRepository } from "./repository";

let fx: Fixture;
let repo: ActiveSessionRepository;
beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 90_000);
afterAll(() => fx?.stop());

async function seeded(name: string) {
  const person = await fx.provision(fx.tenantA, name);
  const scope = { tenantId: fx.tenantA, actorId: person.id };
  const started = await repo.startSession(scope, {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
  });
  const sessionId = started.session.id;
  const insert = async (
    taskId: string,
    revision: number,
    sourceEventIds: string[] | null,
    result: unknown = null,
  ) =>
    fx.owner.query(
      `INSERT INTO interview.session_actions
         (tenant_id, owner_user_id, session_id, task_id, task_revision,
          action_kind, dispatch_status, fence_at_dispatch, source_event_ids, result)
       VALUES ($1, $2, $3, $4, $5, 'draft-answer', 'succeeded', 1, $6::text[], $7::jsonb)`,
      [
        fx.tenantA,
        person.id,
        sessionId,
        taskId,
        revision,
        sourceEventIds,
        result === null ? null : JSON.stringify(result),
      ],
    );
  const feed = async () =>
    (await repo.listActionChanges(scope, sessionId)).actions;
  return { sessionId, insert, feed };
}

describe("an action's screenshots in the browser feed", () => {
  it("lists the snapshot ids in stored order and leaves the other provenance server-side", async () => {
    const world = await seeded("snapshots-owner");
    const first = snapshotProvenanceId(world.sessionId, "screen", "evt-1");
    const second = snapshotProvenanceId(world.sessionId, "screen", "evt-2");
    await world.insert("task-a", 2, [
      "heard/segment-1",
      first,
      `input/r-9`,
      second,
      "snap/not-a-valid-id",
    ]);
    const [stored] = await world.feed();
    expect(stored?.sourceSnapshots).toEqual([
      { sourceId: "screen", eventId: "evt-1" },
      { sourceId: "screen", eventId: "evt-2" },
    ]);
    // The wire contract accepts it, and the spoken and owner-input ids and the
    // session id stay out of it.
    expect(liveActionSchema.safeParse(stored).success).toBe(true);
    const wire = JSON.stringify(stored);
    expect(wire).not.toContain("heard/segment-1");
    expect(wire).not.toContain("input/r-9");
    expect(wire).not.toContain(world.sessionId);
    expect(stored).not.toHaveProperty("sourceEventIds");
  });

  it("omits it for an action with no screenshot, and for one with no provenance at all", async () => {
    const world = await seeded("snapshots-none");
    await world.insert("task-spoken", 1, ["heard/segment-1", "input/r-1"]);
    await world.insert("task-bare", 1, null);
    const stored = await world.feed();
    expect(stored).toHaveLength(2);
    for (const action of stored)
      expect(action).not.toHaveProperty("sourceSnapshots");
  });
});

describe("a stored missing-context list in the browser feed", () => {
  it("comes back on the action, sanitised, and is absent when none survives", async () => {
    const world = await seeded("missing-owner");
    await world.insert("task-m", 1, null, {
      draft: "x",
      missingContext: [
        { kind: "examples" },
        { kind: "examples", note: "second of a kind is dropped" },
        { kind: "bogus" },
        { kind: "statement-cut-off", note: "line\nbreak" },
        { kind: "constraints", note: "the limits are cut off" },
      ],
    });
    await world.insert("task-n", 1, null, {
      draft: "y",
      missingContext: [{ kind: "bogus" }],
    });
    const stored = await world.feed();
    const of = (taskId: string) =>
      stored.find((action) => action.taskId === taskId);
    expect(of("task-m")?.missingContext).toEqual([
      { kind: "examples" },
      { kind: "constraints", note: "the limits are cut off" },
    ]);
    expect(liveActionSchema.safeParse(of("task-m")).success).toBe(true);
    expect(of("task-n")).not.toHaveProperty("missingContext");
  });
});
