// Capture now on a disposable PostgreSQL as the member role (requires Docker,
// like the other session suites): the owner's one-shot request reaches the
// companion only as `control.capture`, is fulfilled only by a snapshot naming
// its exact id (the analyze input is created in the snapshot's own
// transaction), and every other snapshot stays a plain snapshot. Also the
// refusals, replacement, dedup, expiry, the purge and the two routes.
import {
  type Acknowledgement,
  captureRequestSchema,
} from "@omnitech/active-session-contracts";
import { liveCaptureStateSchema } from "@omnitech/interview-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestObservation } from "./ingest.js";
import {
  type Fixture,
  type Person,
  PNG_BYTES,
  screenshot,
  startFixture,
} from "./live-session-fixture.js";
import { ActiveSessionRepository } from "./repository.js";
import { createSessionRoutes } from "./routes.js";
import { purgeSession } from "./session-purge.js";

let fx: Fixture;
let repo: ActiveSessionRepository;
let tenant = "";
let slug = "";
let acting: Person | null = null;
const scopeOf = (person: Person) => ({ tenantId: tenant, actorId: person.id });
const instant = { waitMs: 0, pollMs: 1, sleep: async () => {} };

beforeAll(async () => {
  fx = await startFixture();
  tenant = fx.tenantA;
  repo = new ActiveSessionRepository(fx.member);
  slug = String(
    (
      await fx.owner.query("SELECT slug FROM platform.tenants WHERE id=$1", [
        tenant,
      ])
    ).rows[0].slug,
  );
  await fx.owner.query(
    `INSERT INTO platform.product_installations(tenant_id,product_id,display_name,description,icon,configuration)
     VALUES($1,'omnitech.interview','Interview','Interview','sparkles','{}')`,
    [tenant],
  );
}, 120_000);
afterAll(() => fx?.stop());

async function begin(name: string, extra: Record<string, unknown> = {}) {
  const person = await fx.provision(tenant, name);
  const started = await repo.startSession(scopeOf(person), {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
    ...extra,
  } as never);
  return {
    person,
    scope: scopeOf(person),
    id: started.session.id,
    credential: started.credential.value,
  };
}
type World = Awaited<ReturnType<typeof begin>>;

const request = (world: World, fields: Record<string, unknown> = {}) =>
  repo.submitCaptureRequest(world.scope, world.id, {
    requestId: "cap-1",
    mode: "focused-window",
    ...fields,
  });
const refusal = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

// The control state a companion would see on its next acknowledgement.
async function controlOf(world: World) {
  const ack = await ingestObservation(
    fx.member,
    world.credential,
    tenant,
    {
      version: 1,
      kind: "heartbeat",
      sourceId: "companion",
      sentAt: "2026-10-03T10:00:00.000Z",
      capturing: true,
    },
    { limits: { minHeartbeatIntervalMs: 0 } },
  );
  return ack.status === "accepted" ? ack.control : undefined;
}

let eventCounter = 0;
const snapshot = (
  requestId: string | undefined,
  eventId = `s-${(eventCounter += 1)}`,
) => {
  const base = screenshot("scr", 0, "image/png", PNG_BYTES.byteLength, eventId);
  return requestId === undefined
    ? base
    : { ...base, content: { ...base.content, requestId } };
};
const send = (world: World, message: unknown): Promise<Acknowledgement> =>
  ingestObservation(fx.member, world.credential, tenant, message, {
    payload: PNG_BYTES,
    limits: { minHeartbeatIntervalMs: 0 },
  });

const observations = async (sessionId: string) =>
  (
    await fx.owner.query(
      "SELECT * FROM interview.session_observations WHERE session_id=$1 ORDER BY sequence",
      [sessionId],
    )
  ).rows;
const inputs = async (sessionId: string) =>
  (await observations(sessionId)).filter((r) => r.kind === "owner.input");
const expire = (sessionId: string) =>
  fx.owner.query(
    `UPDATE interview.active_sessions
     SET capture_request = jsonb_set(capture_request, '{expiresAt}', to_jsonb('2000-01-01T00:00:00.000Z'::text))
     WHERE id=$1`,
    [sessionId],
  );

describe("the request lifecycle", () => {
  it("is handed to the companion, fulfilled by its snapshot in one transaction, and reported captured", async () => {
    const world = await begin("life");
    const state = await request(world, {
      targetTaskId: "t.1",
      targetRevision: 3,
      skill: "dsa",
      language: "typescript",
    });
    expect(state).toMatchObject({ requestId: "cap-1", status: "pending" });
    expect(Date.parse(state.expiresAt) - Date.now()).toBeGreaterThan(15_000);
    expect(Date.parse(state.expiresAt) - Date.now()).toBeLessThanOrEqual(
      20_000,
    );
    expect(liveCaptureStateSchema.safeParse(state).success).toBe(true);
    expect(
      await repo.getCaptureRequest(world.scope, world.id, "cap-1"),
    ).toEqual(state);

    // The companion sees the id, the mode and nothing else.
    const control = await controlOf(world);
    expect(control?.capture).toEqual({
      requestId: "cap-1",
      mode: "focused-window",
    });
    expect(captureRequestSchema.safeParse(control?.capture).success).toBe(true);

    const ack = await send(world, snapshot("cap-1", "s-life"));
    expect(ack.status).toBe("accepted");
    // A fulfilled request is no longer live on the fresh answer.
    expect(ack.status === "accepted" && ack.control.capture).toBeFalsy();

    const stored = await observations(world.id);
    expect(
      stored.map((r) => [Number(r.sequence), r.kind, r.source_id]),
    ).toEqual([
      [1, "screen.snapshot", "scr"],
      [2, "owner.input", "studio.owner-input"],
    ]);
    // The stored acknowledgement never carries a capture request.
    expect(JSON.stringify(stored[0].ack)).not.toContain("capture");
    expect(stored[0].content.body.requestId).toBe("cap-1");
    expect(stored[1].event_id).toBe("cap-1");
    expect(stored[1].content.body).toEqual({
      operation: "analyze",
      target: { taskId: "t.1", revision: 3 },
      skill: "dsa",
      language: "typescript",
      snapshots: [{ sourceId: "scr", eventId: "s-life" }],
    });
    expect(
      (await repo.getCaptureRequest(world.scope, world.id, "cap-1")).status,
    ).toBe("captured");
    expect((await controlOf(world))?.capture).toBeUndefined();

    // A resend of the snapshot returns the original ack and analyses nothing more.
    const again = await send(world, snapshot("cap-1", "s-life"));
    expect(again.status).toBe("duplicate");
    expect(await inputs(world.id)).toHaveLength(1);
  });

  it("carries the region in the control and is deduped on the request id", async () => {
    const world = await begin("region");
    const region = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
    const first = await request(world, { mode: "region", region });
    expect((await controlOf(world))?.capture).toEqual({
      requestId: "cap-1",
      mode: "region",
      region,
    });
    expect(await request(world, { mode: "region", region })).toEqual(first);
    // The same id with different content is refused; the original stays.
    await refusal(request(world, { mode: "display" }), "invalid_input");
    await refusal(
      request(world, { mode: "region", region: { ...region, x: 0.2 } }),
      "invalid_input",
    );
    expect((await controlOf(world))?.capture?.mode).toBe("region");
  });

  it("is replaced by a newer request, whose id alone fulfils it", async () => {
    const world = await begin("replace");
    await request(world, { requestId: "old" });
    await request(world, { requestId: "new", mode: "display" });
    await refusal(
      repo.getCaptureRequest(world.scope, world.id, "old"),
      "not_found",
    );
    expect((await controlOf(world))?.capture).toMatchObject({
      requestId: "new",
      mode: "display",
    });
    // NEGATIVE: the replaced request's id analyses nothing.
    expect((await send(world, snapshot("old"))).status).toBe("accepted");
    expect(await inputs(world.id)).toHaveLength(0);
    expect(
      (await repo.getCaptureRequest(world.scope, world.id, "new")).status,
    ).toBe("pending");
    expect((await send(world, snapshot("new"))).status).toBe("accepted");
    expect(await inputs(world.id)).toHaveLength(1);
  });
});

describe("a companion snapshot is never analysed on its own", () => {
  it("NEGATIVE: with no pending request a requestId is ignored and the snapshot is stored as today", async () => {
    const world = await begin("none");
    const ack = await send(world, snapshot("made-up"));
    expect(ack.status).toBe("accepted");
    const stored = await observations(world.id);
    expect(stored.map((r) => r.kind)).toEqual(["screen.snapshot"]);
    expect(await inputs(world.id)).toHaveLength(0);
  });

  it("NEGATIVE: a mismatching id leaves the request pending and the snapshot plain", async () => {
    const world = await begin("mismatch");
    await request(world);
    expect((await send(world, snapshot("cap-2"))).status).toBe("accepted");
    // A snapshot without any id while a request waits is plain too.
    expect((await send(world, snapshot(undefined))).status).toBe("accepted");
    expect(await inputs(world.id)).toHaveLength(0);
    expect(
      (await repo.getCaptureRequest(world.scope, world.id, "cap-1")).status,
    ).toBe("pending");
    expect((await controlOf(world))?.capture?.requestId).toBe("cap-1");
  });

  it("NEGATIVE: an expired request is not handed out, not analysed, and reads expired", async () => {
    const world = await begin("expired");
    await request(world);
    await expire(world.id);
    expect((await controlOf(world))?.capture).toBeUndefined();
    expect((await send(world, snapshot("cap-1"))).status).toBe("accepted");
    expect(await inputs(world.id)).toHaveLength(0);
    expect(
      (await repo.getCaptureRequest(world.scope, world.id, "cap-1")).status,
    ).toBe("expired");
    // A fresh request replaces the expired one.
    await request(world, { requestId: "cap-2" });
    expect((await controlOf(world))?.capture?.requestId).toBe("cap-2");
  });

  it("NEGATIVE: an already captured request analyses nothing a second time", async () => {
    const world = await begin("twice");
    await request(world);
    await send(world, snapshot("cap-1"));
    await send(world, snapshot("cap-1"));
    expect(await inputs(world.id)).toHaveLength(1);
  });

  it("does not hand a request to a paused session", async () => {
    const world = await begin("paused-control");
    await request(world);
    await repo.controlSession(world.scope, world.id, "pause");
    const ack = await ingestObservation(fx.member, world.credential, tenant, {
      version: 1,
      kind: "heartbeat",
      sourceId: "companion",
      sentAt: "2026-10-03T10:00:00.000Z",
      capturing: true,
    });
    expect(ack).toMatchObject({ status: "refused", code: "session_paused" });
    expect(JSON.stringify(ack)).not.toContain("cap-1");
  });
});

describe("refusals", () => {
  it("refuses a paused or ended session, has no screen source or no live assistance", async () => {
    const paused = await begin("paused");
    await repo.controlSession(paused.scope, paused.id, "pause");
    await refusal(request(paused), "status_refused");

    const ended = await begin("ended");
    await repo.controlSession(ended.scope, ended.id, "end");
    await refusal(request(ended), "status_refused");

    const audioOnly = await begin("audio", { captureSources: ["microphone"] });
    await refusal(request(audioOnly), "status_refused");

    const quiet = await begin("quiet", { liveAssistance: false });
    await refusal(request(quiet), "status_refused");
  });

  it("refuses early in a device-only session with the dispatcher's reason, and never asks the companion", async () => {
    const world = await begin("device", { processingPolicy: "device-only" });
    const state = await request(world);
    expect(state).toMatchObject({
      requestId: "cap-1",
      status: "refused",
      reason: "vision_device_only",
    });
    expect(
      await repo.getCaptureRequest(world.scope, world.id, "cap-1"),
    ).toEqual(state);
    expect((await controlOf(world))?.capture).toBeUndefined();
    expect((await send(world, snapshot("cap-1"))).status).toBe("accepted");
    expect(await inputs(world.id)).toHaveLength(0);
  });

  it("answers a foreign or unknown session as not_found and a bad body as invalid_input", async () => {
    const owner = await begin("own");
    const other = await begin("foreign");
    await expect(
      repo.submitCaptureRequest(other.scope, owner.id, {
        requestId: "x",
        mode: "display",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await refusal(
      repo.getCaptureRequest(other.scope, owner.id, "cap-1"),
      "not_found",
    );
    for (const body of [
      { requestId: "x", mode: "region" },
      {
        requestId: "x",
        mode: "display",
        region: { x: 0, y: 0, width: 1, height: 1 },
      },
      {
        requestId: "x",
        mode: "region",
        region: { x: 0.5, y: 0, width: 0.6, height: 1 },
      },
      { requestId: "x", mode: "window" },
      { requestId: "bad id", mode: "display" },
      { requestId: "x", mode: "display", targetTaskId: "t" },
      { requestId: "x", mode: "display", skill: "cooking" },
      { requestId: "x", mode: "display", sessionId: owner.id },
    ])
      await refusal(
        repo.submitCaptureRequest(owner.scope, owner.id, body),
        "invalid_input",
      );
    expect((await controlOf(owner))?.capture).toBeUndefined();
  });

  it("refuses a request id the owner already used for an input", async () => {
    const world = await begin("collide");
    await repo.submitOwnerInput(world.scope, world.id, {
      requestId: "cap-1",
      operation: "follow-up",
      text: "hello",
      snapshots: [],
    });
    await refusal(request(world), "invalid_input");
  });
});

describe("the purge", () => {
  it("clears the pending request with the session's other content", async () => {
    const world = await begin("purge");
    await request(world, { skill: "dsa" });
    const result = await purgeSession(
      fx.member,
      {
        tenantId: tenant,
        ownerUserId: world.person.id,
        sessionId: world.id,
      },
      { ...instant, trigger: "owner-delete" },
    );
    expect(result.outcome).toBe("complete");
    const row = await fx.owner.query(
      "SELECT capture_request FROM interview.active_sessions WHERE id=$1",
      [world.id],
    );
    expect(row.rows[0].capture_request).toBeNull();
  });
});

describe("the routes", () => {
  const app = () =>
    createSessionRoutes({
      database: fx.member,
      resolveContext: async (requested): Promise<PlatformContext | null> =>
        acting && requested === slug
          ? ({
              user: {
                id: acting.id,
                email: "x@live.test",
                displayName: "x",
                avatarUrl: null,
              },
              tenant: { id: tenant, slug, name: "T" },
              membership: {
                tenantId: tenant,
                userId: acting.id,
                role: "member",
              },
              preferences: { theme: "system", locale: "en" },
              permissions: ["interview.read", "interview.write"],
              products: [{ productId: "omnitech.interview", enabled: true }],
            } as unknown as PlatformContext)
          : null,
    });
  const base = (id: string) =>
    `http://studio.test/api/interview/t/${slug}/sessions/${id}/capture-request`;
  const post = (id: string, body: unknown) =>
    app().request(base(id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("accepts with 202 and the state, then reports the request until it is captured", async () => {
    const world = await begin("route");
    acting = world.person;
    const response = await post(world.id, {
      requestId: "rt-1",
      mode: "region",
      region: { x: 0, y: 0, width: 0.5, height: 0.5 },
    });
    expect(response.status).toBe(202);
    const body = liveCaptureStateSchema.parse(await response.json());
    expect(body).toMatchObject({ requestId: "rt-1", status: "pending" });
    expect(
      (
        await post(world.id, {
          requestId: "rt-1",
          mode: "region",
          region: { x: 0, y: 0, width: 0.5, height: 0.5 },
        })
      ).status,
    ).toBe(202);

    const read = await app().request(`${base(world.id)}/rt-1`);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(body);
    await send(world, snapshot("rt-1"));
    const done = await app().request(`${base(world.id)}/rt-1`);
    expect(await done.json()).toMatchObject({ status: "captured" });
  });

  it("answers fixed error bodies: invalid_input 400, status_refused 409, unknown 404, no membership 404", async () => {
    const world = await begin("route-bad");
    acting = world.person;
    expect((await post(world.id, { requestId: "x" })).status).toBe(400);
    expect(await (await post(world.id, { requestId: "x" })).json()).toEqual({
      error: { code: "invalid_input" },
    });
    const unknown = await app().request(`${base(world.id)}/nope`);
    expect(unknown.status).toBe(404);
    const paused = await begin("route-paused");
    await repo.controlSession(paused.scope, paused.id, "pause");
    acting = paused.person;
    const refused = await post(paused.id, { requestId: "x", mode: "display" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: { code: "status_refused" } });
    acting = null;
    expect(
      (await post(world.id, { requestId: "x", mode: "display" })).status,
    ).not.toBe(202);
  });
});
