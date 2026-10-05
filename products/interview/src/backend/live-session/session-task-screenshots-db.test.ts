// Which screenshots belong to a task, on a disposable PostgreSQL as the member
// role (requires Docker, like the other session suites): the repository read
// and its route. The link is session_actions.source_event_ids joined to the
// session's screen.snapshot observations; nothing but ids, ordinals and times
// leaves the read.
import {
  type LiveObservation,
  liveTaskScreenshotsResponseSchema,
} from "@omnitech/interview-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { snapshotOrdinals } from "../../frontend/studio/live/shared/task-card-model";
import { ingestObservation } from "./ingest";
import {
  type Fixture,
  type Person,
  PNG_BYTES,
  screenshot,
  startFixture,
} from "./live-session-fixture";
import { snapshotProvenanceId } from "./owner-input";
import { ActiveSessionRepository } from "./repository";
import { createSessionRoutes } from "./routes";

let fx: Fixture;
let repo: ActiveSessionRepository;
let slug = "";
let acting: Person | null = null;
beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
  slug = String(
    (
      await fx.owner.query("SELECT slug FROM platform.tenants WHERE id=$1", [
        fx.tenantA,
      ])
    ).rows[0].slug,
  );
  await fx.owner.query(
    `INSERT INTO platform.product_installations(tenant_id,product_id,display_name,description,icon,configuration)
     VALUES($1,'omnitech.interview','Interview','Interview','sparkles','{}')`,
    [fx.tenantA],
  );
}, 120_000);
afterAll(() => fx?.stop());

async function resolveContext(
  requested: string,
): Promise<PlatformContext | null> {
  if (!acting || requested !== slug) return null;
  return {
    user: { id: acting.id, email: "x@live.test", displayName: "x" },
    tenant: { id: fx.tenantA, slug, name: "T" },
    membership: { tenantId: fx.tenantA, userId: acting.id, role: "member" },
    preferences: { theme: "system", locale: "en" },
    permissions: ["interview.read", "interview.write"],
    products: [{ productId: "omnitech.interview", enabled: true }],
  } as unknown as PlatformContext;
}
const app = () => createSessionRoutes({ database: fx.member, resolveContext });
const url = (sessionId: string, taskId: string) =>
  `http://studio.test/api/interview/t/${slug}/sessions/${sessionId}/tasks/${taskId}/screenshots`;

// A session with three screenshots (S1..S3, in sequence order) and helpers to
// store an action that rests on chosen ones.
async function seeded(name: string) {
  const person = await fx.provision(fx.tenantA, name);
  const scope = { tenantId: fx.tenantA, actorId: person.id };
  const started = await repo.startSession(scope, {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
  });
  const sessionId = started.session.id;
  for (const [index, eventId] of ["shot-1", "shot-2", "shot-3"].entries()) {
    const ack = await ingestObservation(
      fx.member,
      started.credential.value,
      fx.tenantA,
      screenshot("scr", index, "image/png", PNG_BYTES.byteLength, eventId),
      { payload: PNG_BYTES },
    );
    expect(ack.status).toBe("accepted");
  }
  const rests = async (
    taskId: string,
    revision: number,
    eventIds: string[],
    extra: string[] = [],
  ) =>
    fx.owner.query(
      `INSERT INTO interview.session_actions
         (tenant_id, owner_user_id, session_id, task_id, task_revision,
          action_kind, dispatch_status, fence_at_dispatch, source_event_ids)
       VALUES ($1, $2, $3, $4, $5, 'draft-answer', 'succeeded', 1, $6::text[])`,
      [
        fx.tenantA,
        person.id,
        sessionId,
        taskId,
        revision,
        [
          ...extra,
          ...eventIds.map((id) => snapshotProvenanceId(sessionId, "scr", id)),
        ],
      ],
    );
  return { person, scope, sessionId, rests };
}

describe("taskScreenshots", () => {
  it("lists one screenshot for a task built on one", async () => {
    const world = await seeded("one-shot");
    await world.rests("task-one", 1, ["shot-2"], ["heard/seg-1", "input/r-1"]);
    const found = await repo.listTaskScreenshots(
      world.scope,
      world.sessionId,
      "task-one",
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      ordinal: 2,
      sourceId: "scr",
      eventId: "shot-2",
      revisions: [1],
    });
    expect(found[0]?.artifactId).toEqual(expect.any(String));
    expect(Date.parse(found[0]?.capturedAt ?? "")).not.toBeNaN();
  });

  it("gathers a follow-up's added screenshot across revisions, oldest first", async () => {
    const world = await seeded("follow-up");
    await world.rests("task-a", 1, ["shot-1"]);
    await world.rests("task-a", 2, ["shot-3", "shot-1"]);
    await world.rests("task-b", 1, ["shot-2"]);
    const found = await repo.listTaskScreenshots(
      world.scope,
      world.sessionId,
      "task-a",
    );
    expect(
      found.map((shot) => [shot.ordinal, shot.eventId, shot.revisions]),
    ).toEqual([
      [1, "shot-1", [1, 2]],
      [3, "shot-3", [2]],
    ]);
    expect(found[0]?.sequence).toBeLessThan(found[1]?.sequence ?? 0);
  });

  it("uses the same ordinals as the browser's task card model", async () => {
    const world = await seeded("ordinals");
    await world.rests("task-c", 1, ["shot-1", "shot-2", "shot-3"]);
    const observations = (await repo.listObservations(
      world.scope,
      world.sessionId,
    )) as unknown as LiveObservation[];
    const client = snapshotOrdinals(observations);
    const found = await repo.listTaskScreenshots(
      world.scope,
      world.sessionId,
      "task-c",
    );
    expect(found).toHaveLength(3);
    for (const shot of found)
      expect(shot.ordinal).toBe(
        client.get(`${shot.sourceId}\u0000${shot.eventId}`),
      );
  });

  it("is empty for a spoken-only task and for an unknown one", async () => {
    const world = await seeded("spoken");
    await world.rests("task-spoken", 1, [], ["heard/seg-1"]);
    for (const taskId of ["task-spoken", "task-nope"])
      expect(
        await repo.listTaskScreenshots(world.scope, world.sessionId, taskId),
      ).toEqual([]);
  });

  it("keeps a screenshot listed with a null artifact when no image was stored", async () => {
    const world = await seeded("withheld");
    // A snapshot observation stored without an image (observations are
    // append-only, so it is arranged as stored, not emptied afterwards).
    await fx.owner.query(
      `INSERT INTO interview.session_observations
         (tenant_id, owner_user_id, session_id, source_id, event_id, sequence,
          kind, content, ack)
       VALUES ($1, $2, $3, 'scr', 'shot-bare', 99, 'screen.snapshot',
               '{"occurredAt":"x","sourceSequence":0,"body":{}}', '{}')`,
      [fx.tenantA, world.person.id, world.sessionId],
    );
    await world.rests("task-p", 1, ["shot-bare"]);
    const found = await repo.listTaskScreenshots(
      world.scope,
      world.sessionId,
      "task-p",
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ ordinal: 4, artifactId: null });
  });

  it("does not find another owner's session", async () => {
    const world = await seeded("victim");
    await world.rests("task-v", 1, ["shot-1"]);
    const intruder = await fx.provision(fx.tenantA, "intruder");
    await expect(
      repo.listTaskScreenshots(
        { tenantId: fx.tenantA, actorId: intruder.id },
        world.sessionId,
        "task-v",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("GET .../tasks/:taskId/screenshots", () => {
  it("answers 200 with ids only, 400 for a malformed task id and 404 for another owner", async () => {
    const world = await seeded("route");
    await world.rests("task-r", 1, ["shot-1"], ["heard/seg-1"]);
    await world.rests("task-r", 2, ["shot-2"]);
    acting = world.person;

    const ok = await app().request(url(world.sessionId, "task-r"));
    expect(ok.status).toBe(200);
    const text = await ok.text();
    const body = liveTaskScreenshotsResponseSchema.parse(JSON.parse(text));
    expect(body.screenshots.map((shot) => shot.revisions)).toEqual([[1], [2]]);
    // Ids, ordinals, times and the display label only: no content, no provenance, no session id.
    expect(Object.keys(JSON.parse(text).screenshots[0]).sort()).toEqual([
      "artifactId",
      "capturedAt",
      "display",
      "eventId",
      "ocrEngine",
      "ordinal",
      "revisions",
      "sequence",
      "sourceId",
    ]);
    expect(text).not.toContain("heard/seg-1");
    expect(text).not.toContain("snap/");
    expect(text).not.toContain(world.sessionId);

    // The artifact id fetches the image through the existing route.
    const artifact = body.screenshots[0]?.artifactId;
    const image = await app().request(
      `http://studio.test/api/interview/t/${slug}/sessions/${world.sessionId}/screenshots/${artifact}`,
    );
    expect(image.status).toBe(200);

    const bad = await app().request(url(world.sessionId, "bad%20id"));
    expect(bad.status).toBe(400);
    const badSession = await app().request(url("not-a-uuid", "task-r"));
    // A malformed session id is an unknown one, as on every neighbouring route.
    expect(badSession.status).toBe(404);

    acting = await fx.provision(fx.tenantA, "route-intruder");
    const foreign = await app().request(url(world.sessionId, "task-r"));
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: { code: "not_found" } });
  });
});
