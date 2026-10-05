// Apply on the answer page (D28/D30), on a disposable PostgreSQL as the member
// role (requires Docker, like the other session suites): one atomic request
// makes exactly ONE new revision of a task (target) or ONE new task (no target)
// from 0..N images, in the order sent; regenerate re-runs a task from the same
// sources. The real processor and assist stage run over a scripted fake gateway;
// only counts, ids, order and marker wording are asserted, never content.
import {
  LIVE_OCR_LIMITS,
  LIVE_OWNER_CAPTURE_MIN_SIDE,
  liveTaskScreenshotsResponseSchema,
} from "@omnitech/interview-contracts";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { type Fixture, pngOf, startFixture } from "./live-session-fixture";
import {
  buildProcessor,
  collectTraces,
  createFakeGateway,
  settle,
} from "./processor-fixture";
import { ActiveSessionRepository } from "./repository";
import { createSessionRoutes } from "./routes";

let fx: Fixture;
let repo: ActiveSessionRepository;
let slug = "";
const cleanups: Array<() => Promise<void>> = [];

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
// A processor claims any open session, so each test's session ends with it.
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
afterAll(() => fx?.stop());

async function world(
  name: string,
  policy: "permitted-remote" | "device-only" = "permitted-remote",
) {
  const person = await fx.provision(fx.tenantA, name);
  const scope = { tenantId: fx.tenantA, actorId: person.id };
  const started = await repo.startSession(scope, {
    processingPolicy: policy,
    captureSources: ["microphone", "screen"],
  });
  const gateway = createFakeGateway();
  const trace = collectTraces();
  const processor = buildProcessor(fx, {
    workerId: `worker-${name}`,
    gateway,
    trace,
    visionProfileId: "vision-profile",
  });
  const sessionId = started.session.id;
  cleanups.push(async () => {
    gateway.releaseAll();
    await processor.close();
    await repo.controlSession(scope, sessionId, "end");
  });
  return { person, scope, sessionId, gateway, processor, trace };
}
type World = Awaited<ReturnType<typeof world>>;

const capture = (
  w: World,
  fields: Record<string, unknown>,
  images: Uint8Array[],
) =>
  repo.submitOwnerCapture(
    w.scope,
    w.sessionId,
    { operation: "analyze", ...fields },
    images,
  );
const regenerate = (
  w: World,
  requestId: string,
  target: { taskId: string; revision: number },
) =>
  repo.submitOwnerInput(w.scope, w.sessionId, {
    requestId,
    operation: "regenerate",
    target,
    snapshots: [],
  });
const actions = async (w: World) =>
  (await repo.listActions(w.scope, w.sessionId)).filter(
    (action) => action.actionKind === "draft-answer",
  );
const reasons = async (w: World) =>
  (await repo.listActionChanges(w.scope, w.sessionId)).actions
    .filter((a) => a.actionKind === "draft-answer")
    .sort((a, b) => a.taskRevision - b.taskRevision)
    .map((a) => a.revisionReason ?? null);
const observationCount = async (w: World) =>
  Number(
    (
      await fx.owner.query(
        "SELECT count(*)::int AS n FROM interview.session_observations WHERE session_id=$1",
        [w.sessionId],
      )
    ).rows[0].n,
  );
const ownerShots = async (w: World) =>
  (
    await fx.owner.query(
      `SELECT event_id, sequence, content->'body'->>'byteLength' AS bytes
       FROM interview.session_observations
       WHERE session_id=$1 AND kind='screen.snapshot' ORDER BY sequence`,
      [w.sessionId],
    )
  ).rows as Array<{ event_id: string; sequence: string; bytes: string }>;
const attachmentsOf = (request: { task: unknown }) =>
  ((request.task as { attachments?: Array<{ reference: string }> })
    .attachments ?? []) as Array<{ reference: string }>;
const promptOf = (request: { task: unknown }) =>
  (request.task as { prompt: string }).prompt;
const refusedWith = async (
  promise: Promise<unknown>,
  code: string,
  reason?: string,
) =>
  expect(promise).rejects.toMatchObject({
    code,
    ...(reason ? { reason } : {}),
  });

// Three images with distinct sizes so their order can be read back.
const A = pngOf(640, 480, 0);
const B = pngOf(640, 480, 1);
const C = pngOf(640, 480, 2);

describe("apply without a target: one new task from N images, in order", () => {
  it("creates exactly one task, stores the images in the order sent, and sends them oldest-first with the successive wording", async () => {
    const w = await world("apply-new");
    const ack = await capture(w, { requestId: "n-1" }, [A, B, C]);
    expect(ack.snapshots.map((s) => s.eventId)).toEqual([
      "n-1",
      "n-1.2",
      "n-1.3",
    ]);
    const shots = await ownerShots(w);
    expect(shots.map((s) => s.event_id)).toEqual(["n-1", "n-1.2", "n-1.3"]);
    const sequences = shots.map((s) => Number(s.sequence));
    expect(sequences).toEqual([
      sequences[0],
      (sequences[0] as number) + 1,
      (sequences[0] as number) + 2,
    ]);
    expect(shots.map((s) => Number(s.bytes))).toEqual([
      A.byteLength,
      B.byteLength,
      C.byteLength,
    ]);

    await settle(w.processor);
    expect(new Set((await actions(w)).map((a) => a.taskId)).size).toBe(1);
    expect(w.gateway.requests).toHaveLength(1);
    const request = w.gateway.requests[0] as never;
    expect(attachmentsOf(request).map((a) => a.reference)).toEqual(
      ["n-1", "n-1.2", "n-1.3"].map(
        (id) => `snap/${w.sessionId}/studio.owner-capture/${id}`,
      ),
    );
    expect(promptOf(request)).toContain("COUNT: 3");
    expect(promptOf(request)).toContain("successive screenshots");
  });

  it("follows the order of the request: a reordered request stores and sends the other order", async () => {
    const w = await world("apply-reorder");
    await capture(w, { requestId: "o-1" }, [C, A, B]);
    expect((await ownerShots(w)).map((s) => Number(s.bytes))).toEqual([
      C.byteLength,
      A.byteLength,
      B.byteLength,
    ]);
    await settle(w.processor);
    expect(
      attachmentsOf(w.gateway.requests[0] as never).map((a) => a.reference),
    ).toEqual(
      ["o-1", "o-1.2", "o-1.3"].map(
        (id) => `snap/${w.sessionId}/studio.owner-capture/${id}`,
      ),
    );
  });

  it("is today's behaviour for one image: one snapshot named by the request id, one task", async () => {
    const w = await world("apply-one");
    const ack = await capture(w, { requestId: "s-1" }, [A]);
    expect(ack.snapshots).toEqual([
      { sourceId: "studio.owner-capture", eventId: "s-1" },
    ]);
    await settle(w.processor);
    expect(w.gateway.requests).toHaveLength(1);
    expect(attachmentsOf(w.gateway.requests[0] as never)).toHaveLength(1);
    expect(promptOf(w.gateway.requests[0] as never)).not.toContain(
      "successive screenshots",
    );
  });

  it("refuses the whole request when any image is bad, over the count, or too small, and stores nothing", async () => {
    const w = await world("apply-refuse");
    const before = await observationCount(w);
    const tooSmall = pngOf(
      LIVE_OWNER_CAPTURE_MIN_SIDE - 1,
      LIVE_OWNER_CAPTURE_MIN_SIDE,
    );
    await refusedWith(
      capture(w, { requestId: "r-1" }, [A, tooSmall]),
      "invalid_input",
      "image_dimensions",
    );
    await refusedWith(
      capture(w, { requestId: "r-2" }, [A, new Uint8Array([1, 2, 3])]),
      "invalid_input",
      "image_type",
    );
    await refusedWith(
      capture(w, { requestId: "r-3" }, [A, new Uint8Array()]),
      "invalid_input",
      "image_empty",
    );
    await refusedWith(
      capture(w, { requestId: "r-4" }, [A, B, C, A, B]),
      "invalid_input",
      "image_count",
    );
    await refusedWith(
      capture(w, { requestId: "r-5" }, []),
      "invalid_input",
      "no_image",
    );
    expect(await observationCount(w)).toBe(before);
    // A small crop at the minimum is accepted.
    await capture(w, { requestId: "r-6" }, [
      pngOf(120, 80),
      pngOf(LIVE_OWNER_CAPTURE_MIN_SIDE, LIVE_OWNER_CAPTURE_MIN_SIDE),
    ]);
    expect(await ownerShots(w)).toHaveLength(2);
  });

  it("is idempotent per request id: an identical resend stores nothing more, a changed one is refused", async () => {
    const w = await world("apply-idem");
    const first = await capture(w, { requestId: "i-1" }, [A, B]);
    const count = await observationCount(w);
    expect(await capture(w, { requestId: "i-1" }, [A, B])).toEqual(first);
    expect(await observationCount(w)).toBe(count);
    await refusedWith(
      capture(w, { requestId: "i-1" }, [B, A]),
      "invalid_input",
    );
    await refusedWith(capture(w, { requestId: "i-1" }, [A]), "invalid_input");
    expect(await observationCount(w)).toBe(count);
  });
});

describe("apply with a target: one new revision of the same task", () => {
  async function answered(name: string, policy?: "device-only") {
    const w = await world(name, policy);
    await capture(w, { requestId: "t-1" }, [A, B, C]);
    await settle(w.processor);
    const first = (await actions(w))[0];
    return { w, taskId: first?.taskId as string };
  }

  it("adds screenshots as ONE revision with all of the task's images (newest four), keeping the earlier answer", async () => {
    const { w, taskId } = await answered("apply-target");
    await capture(
      w,
      { requestId: "t-2", targetTaskId: taskId, targetRevision: 1 },
      [pngOf(300, 200, 3), pngOf(300, 200, 4)],
    );
    await settle(w.processor);
    const rows = await actions(w);
    expect(rows.map((a) => [a.taskId, a.taskRevision])).toEqual([
      [taskId, 1],
      [taskId, 2],
    ]);
    expect(rows[0]?.dispatchStatus).toBe("succeeded");
    expect(await reasons(w)).toEqual([null, "added-screenshot"]);
    expect(w.gateway.requests).toHaveLength(2);
    const second = w.gateway.requests[1] as never;
    // Three existing and two new: the newest four, oldest first.
    expect(attachmentsOf(second).map((a) => a.reference)).toEqual(
      ["t-1.2", "t-1.3", "t-2", "t-2.2"].map(
        (id) => `snap/${w.sessionId}/studio.owner-capture/${id}`,
      ),
    );
    expect(promptOf(second)).toContain("COUNT: 4");
    // The listing is what each revision rests on (cumulative): the first
    // three fed both revisions even though only the newest four were sent.
    const listed = await repo.listTaskScreenshots(w.scope, w.sessionId, taskId);
    expect(listed.map((s) => [s.eventId, s.revisions])).toEqual([
      ["t-1", [1, 2]],
      ["t-1.2", [1, 2]],
      ["t-1.3", [1, 2]],
      ["t-2", [2]],
      ["t-2.2", [2]],
    ]);
  });

  it("regenerates: rev+1 of the same task from the same images, idempotent by request id", async () => {
    const { w, taskId } = await answered("apply-regen");
    const first = await regenerate(w, "g-1", { taskId, revision: 1 });
    expect(await regenerate(w, "g-1", { taskId, revision: 1 })).toEqual(first);
    await settle(w.processor);
    const rows = await actions(w);
    expect(rows.map((a) => [a.taskId, a.taskRevision])).toEqual([
      [taskId, 1],
      [taskId, 2],
    ]);
    expect(rows[0]?.dispatchStatus).toBe("succeeded");
    expect(await reasons(w)).toEqual([null, "regenerate"]);
    expect(attachmentsOf(w.gateway.requests[1] as never)).toHaveLength(3);
    // The same id for a different target is refused.
    await refusedWith(
      regenerate(w, "g-1", { taskId, revision: 2 }),
      "invalid_input",
    );
  });

  it("refuses a stale target, an unknown task and another owner's task, storing nothing", async () => {
    const { w, taskId } = await answered("apply-stale");
    await regenerate(w, "g-1", { taskId, revision: 1 });
    await settle(w.processor);
    const count = await observationCount(w);
    await refusedWith(
      regenerate(w, "g-2", { taskId, revision: 1 }),
      "status_refused",
      "stale_target",
    );
    await refusedWith(
      capture(
        w,
        { requestId: "g-3", targetTaskId: taskId, targetRevision: 1 },
        [A],
      ),
      "status_refused",
      "stale_target",
    );
    await refusedWith(
      regenerate(w, "g-4", { taskId: "task-nope", revision: 1 }),
      "not_found",
    );
    const other = await world("apply-other");
    await refusedWith(
      repo.submitOwnerInput(other.scope, other.sessionId, {
        requestId: "g-5",
        operation: "regenerate",
        target: { taskId, revision: 2 },
        snapshots: [],
      }),
      "not_found",
    );
    expect(await observationCount(w)).toBe(count);
  });

  it("refuses a regenerate or solve aimed at a revision the task never had", async () => {
    const { w, taskId } = await answered("apply-ahead");
    const count = await observationCount(w);
    await refusedWith(
      regenerate(w, "h-1", { taskId, revision: 999 }),
      "not_found",
    );
    await refusedWith(
      repo.submitOwnerInput(w.scope, w.sessionId, {
        requestId: "h-2",
        operation: "solve",
        target: { taskId, revision: 999 },
        snapshots: [],
      }),
      "not_found",
    );
    expect(await observationCount(w)).toBe(count);
  });

  it("cannot name a request id that collides with another capture's extra-image event id", async () => {
    const w = await world("apply-collide");
    await capture(w, { requestId: "abc" }, [A, B]);
    await refusedWith(capture(w, { requestId: "abc.2" }, [C]), "invalid_input");
  });

  it("is not dispatched while the session is paused", async () => {
    const { w, taskId } = await answered("apply-paused");
    await repo.controlSession(w.scope, w.sessionId, "pause");
    await regenerate(w, "p-1", { taskId, revision: 1 });
    await settle(w.processor);
    expect(w.gateway.requests).toHaveLength(1);
    expect(await actions(w)).toHaveLength(1);
  });

  it("refuses a regeneration that rests on a screenshot in a device-only session, but regenerates a spoken-only task", async () => {
    const w = await world("apply-device", "device-only");
    const seed = (taskId: string, ids: string[]) =>
      fx.owner.query(
        `INSERT INTO interview.session_actions
           (tenant_id, owner_user_id, session_id, task_id, task_revision,
            action_kind, dispatch_status, fence_at_dispatch, source_event_ids)
         VALUES ($1,$2,$3,$4,1,'draft-answer','succeeded',1,$5::text[])`,
        [fx.tenantA, w.person.id, w.sessionId, taskId, ids],
      );
    await seed("task-shot", [
      `snap/${w.sessionId}/studio.owner-capture/x`,
      "input/x",
    ]);
    await seed("task-spoken", ["heard/seg-1"]);
    await refusedWith(
      regenerate(w, "d-1", { taskId: "task-shot", revision: 1 }),
      "status_refused",
      "vision_device_only",
    );
    const ack = await regenerate(w, "d-2", {
      taskId: "task-spoken",
      revision: 1,
    });
    expect(ack.requestId).toBe("d-2");
  });
});

describe("POST .../capture with several images", () => {
  const app = (personId: string) =>
    createSessionRoutes({
      database: fx.member,
      resolveContext: async (requested) =>
        requested === slug
          ? ({
              user: {
                id: personId,
                email: "x@live.test",
                displayName: "x",
                avatarUrl: null,
              },
              tenant: { id: fx.tenantA, slug, name: "T" },
              membership: {
                tenantId: fx.tenantA,
                userId: personId,
                role: "member",
              },
              preferences: { theme: "system", locale: "en" },
              permissions: ["interview.read", "interview.write"],
              products: [{ productId: "omnitech.interview", enabled: true }],
            } as never)
          : null,
    });
  const form = (requestId: string, images: Uint8Array[]) => {
    const body = new FormData();
    body.set("requestId", requestId);
    body.set("operation", "analyze");
    for (const image of images)
      body.append("image", new File([image as BlobPart], "c.png"));
    return body;
  };

  it("accepts up to the limit as one request with the stored ids in order, and refuses one more with a fixed reason", async () => {
    const w = await world("apply-route");
    const send = (body: FormData) =>
      app(w.person.id).request(
        `http://studio.test/api/interview/t/${slug}/sessions/${w.sessionId}/capture`,
        { method: "POST", body },
      );
    const ok = await send(form("m-1", [A, B, C, pngOf(200, 100)]));
    expect(ok.status).toBe(202);
    expect(
      ((await ok.json()) as { snapshots: unknown[] }).snapshots,
    ).toHaveLength(4);
    const count = await observationCount(w);
    const over = await send(form("m-2", [A, B, C, A, B]));
    expect(over.status).toBe(400);
    expect(over.headers.get("x-refusal-reason")).toBe("image_count");
    expect(await observationCount(w)).toBe(count);
  });
});

describe("text read from a screenshot on the device (OCR)", () => {
  const SECRET = "ocr-secret-marker";
  const read = (text: string) => ({ engine: "vision" as const, text });
  const feed = (w: World) =>
    createSessionRoutes({
      database: fx.member,
      resolveContext: async (requested) =>
        requested === slug
          ? ({
              user: { id: w.person.id, email: "x@live.test", displayName: "x" },
              tenant: { id: fx.tenantA, slug, name: "T" },
              membership: {
                tenantId: fx.tenantA,
                userId: w.person.id,
                role: "member",
              },
              preferences: { theme: "system", locale: "en" },
              permissions: ["interview.read", "interview.write"],
              products: [{ productId: "omnitech.interview", enabled: true }],
            } as never)
          : null,
    });
  const get = async (w: World, path: string) =>
    (
      await feed(w).request(
        `http://studio.test/api/interview/t/${slug}/sessions/${w.sessionId}${path}`,
      )
    ).text();

  it("stores the normalised text on the observation, sends it beside its image only, and never returns it to the browser", async () => {
    const w = await world("ocr-store");
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (level) =>
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(" "));
        }),
    );
    await capture(
      w,
      {
        requestId: "x-2",
        ocr: [read(`${SECRET}  one\r\n\r\n\r\nreturn the sum of the`), null],
      },
      [A, B],
    );
    await settle(w.processor);
    const row = (
      await fx.owner.query(
        `SELECT content FROM interview.session_observations
         WHERE session_id=$1 AND event_id='x-2'`,
        [w.sessionId],
      )
    ).rows[0].content;
    expect(row.ocr).toEqual({
      engine: "vision",
      text: `${SECRET} one\n\nreturn the sum of the`,
    });
    const other = (
      await fx.owner.query(
        `SELECT content FROM interview.session_observations
         WHERE session_id=$1 AND event_id='x-2.2'`,
        [w.sessionId],
      )
    ).rows[0].content;
    expect(other.ocr).toBeUndefined();

    // The call: the labelled text for the image that has some, a hint for the
    // cut-off one, nothing for the image without.
    const request = w.gateway.requests.at(-1) as never;
    const prompt = promptOf(request);
    const labels = [
      ...prompt.matchAll(/Screenshot (S\d+) \((screenshot-\d)\)/g),
    ];
    expect(labels.map((m) => m[2])).toEqual(["screenshot-1"]);
    expect(prompt).toContain("BEGIN SCREENSHOT TEXT");
    expect(prompt).toMatch(/the text of S\d+ appears to end mid-sentence/);

    // The browser's feed and the per-task listing carry the engine only.
    const stream = await get(w, "/stream");
    expect(stream).not.toContain(SECRET);
    expect(stream).toContain('"ocr":{"engine":"vision"}');
    const taskId = (await actions(w))[0]?.taskId as string;
    const listing = await get(w, `/tasks/${taskId}/screenshots`);
    expect(listing).not.toContain(SECRET);
    const parsed = JSON.parse(listing) as {
      screenshots: Array<{ eventId: string; ocrEngine: string | null }>;
    };
    expect(parsed.screenshots.map((x) => [x.eventId, x.ocrEngine])).toEqual([
      ["x-2", "vision"],
      ["x-2.2", null],
    ]);

    // Nothing logged: no trace and no console line carries the text.
    expect(JSON.stringify(w.trace.events)).not.toContain(SECRET);
    for (const spy of spies) spy.mockRestore();
    expect(logged.join("\n")).not.toContain(SECRET);
  });

  it("is image only when no text was read", async () => {
    const w = await world("ocr-none");
    await capture(w, { requestId: "y-1" }, [A, B]);
    await settle(w.processor);
    const prompt = promptOf(w.gateway.requests[0] as never);
    expect(prompt).not.toContain("SCREENSHOT TEXT");
    expect(prompt).not.toContain("on-screen text");
  });

  it("keeps a regeneration's text beside the same images", async () => {
    const w = await world("ocr-regen");
    await capture(w, { requestId: "z-1", ocr: [read(`${SECRET} alpha.`)] }, [
      A,
    ]);
    await settle(w.processor);
    const taskId = (await actions(w))[0]?.taskId as string;
    await regenerate(w, "z-2", { taskId, revision: 1 });
    await settle(w.processor);
    expect(promptOf(w.gateway.requests[1] as never)).toContain(
      "Screenshot S1 (screenshot-1) on-screen text",
    );
  });

  it("refuses the whole request, storing nothing, for an over-long text, an over-long total, a bad block or a misaligned list", async () => {
    const w = await world("ocr-bounds");
    const before = await observationCount(w);
    const per = LIVE_OCR_LIMITS.maxTextPerImage;
    const bad: unknown[] = [
      [read("x".repeat(per + 1))],
      [
        read("x".repeat(per)),
        read("x".repeat(per)),
        read("x".repeat(per)),
        read("y".repeat(per)),
      ].slice(0, 4),
      [{ engine: "other", text: "x" }],
      [{ engine: "vision", text: "x", confidence: 2 }],
      [read("one")],
      [read("one"), read("two"), read("three")],
    ];
    for (const [index, ocr] of bad.entries())
      await refusedWith(
        capture(w, { requestId: `b-${index}`, ocr }, [A, B]),
        "invalid_input",
      );
    // A text that is empty after normalising is no text, and is accepted.
    await capture(w, { requestId: "b-ok", ocr: [read("  \n "), null] }, [A, B]);
    const empty = (
      await fx.owner.query(
        `SELECT content FROM interview.session_observations
         WHERE session_id=$1 AND event_id='b-ok'`,
        [w.sessionId],
      )
    ).rows[0].content;
    expect(empty.ocr).toBeUndefined();
    expect(await observationCount(w)).toBe(before + 3);
  });

  it("refuses the same request id with different text, and accepts an identical resend", async () => {
    const w = await world("ocr-idem");
    const first = await capture(w, { requestId: "k-1", ocr: [read("one.")] }, [
      A,
    ]);
    expect(
      await capture(w, { requestId: "k-1", ocr: [read("one.")] }, [A]),
    ).toEqual(first);
    await refusedWith(
      capture(w, { requestId: "k-1", ocr: [read("two.")] }, [A]),
      "invalid_input",
    );
    await refusedWith(capture(w, { requestId: "k-1" }, [A]), "invalid_input");
  });

  it("sends no image and no text from a device-only session", async () => {
    const w = await world("ocr-device", "device-only");
    await capture(w, { requestId: "d-1", ocr: [read(`${SECRET} text.`)] }, [A]);
    await settle(w.processor);
    expect(w.gateway.requests).toHaveLength(0);
  });

  it("accepts the ocr field on the multipart route and refuses malformed JSON", async () => {
    const w = await world("ocr-route");
    const send = (ocr: string) => {
      const body = new FormData();
      body.set("requestId", `m-${ocr.length}`);
      body.set("operation", "analyze");
      body.set("ocr", ocr);
      body.append("image", new File([A as BlobPart], "c.png"));
      return feed(w).request(
        `http://studio.test/api/interview/t/${slug}/sessions/${w.sessionId}/capture`,
        { method: "POST", body },
      );
    };
    expect((await send(JSON.stringify([read("route text.")]))).status).toBe(
      202,
    );
    const bad = await send("{not json");
    expect(bad.status).toBe(400);
    expect(bad.headers.get("x-refusal-reason")).toBe("ocr");
  });
});

describe("the display a screenshot was captured on", () => {
  const NAME = "Display-name-secret-marker";
  const disp = (index: number, count = 3, name = `${NAME} ${index}`) => ({
    name,
    index,
    count,
  });
  const routes = (w: World) =>
    createSessionRoutes({
      database: fx.member,
      resolveContext: async (requested) =>
        requested === slug
          ? ({
              user: { id: w.person.id, email: "x@live.test", displayName: "x" },
              tenant: { id: fx.tenantA, slug, name: "T" },
              membership: {
                tenantId: fx.tenantA,
                userId: w.person.id,
                role: "member",
              },
              preferences: { theme: "system", locale: "en" },
              permissions: ["interview.read", "interview.write"],
              products: [{ productId: "omnitech.interview", enabled: true }],
            } as never)
          : null,
    });
  const get = async (w: World, path: string) =>
    (
      await routes(w).request(
        `http://studio.test/api/interview/t/${slug}/sessions/${w.sessionId}${path}`,
      )
    ).text();
  const stored = async (w: World, eventId: string) =>
    (
      await fx.owner.query(
        `SELECT content FROM interview.session_observations
         WHERE session_id=$1 AND event_id=$2`,
        [w.sessionId, eventId],
      )
    ).rows[0].content;

  it("stores the label per image in order (null entries allowed), returns it from the feed and the screenshots route, and never logs or prompts it", async () => {
    const w = await world("display-store");
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (level) =>
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(" "));
        }),
    );
    await capture(w, { requestId: "p-1", display: [disp(2), null, disp(3)] }, [
      A,
      B,
      C,
    ]);
    await settle(w.processor);
    expect((await stored(w, "p-1")).display).toEqual(disp(2));
    expect((await stored(w, "p-1.2")).display).toBeUndefined();
    expect((await stored(w, "p-1.3")).display).toEqual(disp(3));

    const stream = JSON.parse(await get(w, "/stream")) as {
      observations: Array<{
        eventId: string;
        content: { display?: unknown };
      }>;
    };
    expect(
      stream.observations
        .filter((o) => o.eventId.startsWith("p-1"))
        .map((o) => [o.eventId, o.content.display ?? null]),
    ).toEqual([
      ["p-1", disp(2)],
      ["p-1.2", null],
      ["p-1.3", disp(3)],
    ]);
    const taskId = (await actions(w))[0]?.taskId as string;
    const listing = liveTaskScreenshotsResponseSchema.parse(
      JSON.parse(await get(w, `/tasks/${taskId}/screenshots`)),
    );
    expect(listing.screenshots.map((x) => [x.eventId, x.display])).toEqual([
      ["p-1", disp(2)],
      ["p-1.2", null],
      ["p-1.3", disp(3)],
    ]);

    // Not in the model's prompt, not in a trace, not in a console line.
    for (const request of w.gateway.requests)
      expect(promptOf(request as never)).not.toContain(NAME);
    expect(JSON.stringify(w.trace.events)).not.toContain(NAME);
    for (const spy of spies) spy.mockRestore();
    expect(logged.join("\n")).not.toContain(NAME);
  });

  it("carries no display when none was sent", async () => {
    const w = await world("display-none");
    await capture(w, { requestId: "n-1" }, [A]);
    await settle(w.processor);
    const taskId = (await actions(w))[0]?.taskId as string;
    const listing = liveTaskScreenshotsResponseSchema.parse(
      JSON.parse(await get(w, `/tasks/${taskId}/screenshots`)),
    );
    expect(listing.screenshots.map((x) => x.display)).toEqual([null]);
  });

  it("refuses the whole request with reason display, storing nothing, for a bad shape or a misaligned list", async () => {
    const w = await world("display-bad");
    const before = await observationCount(w);
    const bad: unknown[] = [
      [disp(1)],
      [disp(1), disp(2), disp(3)],
      [disp(4, 3), null],
      [disp(0), null],
      [disp(1, 0), null],
      [{ ...disp(1), id: 7 }, null],
      [{ name: "", index: 1, count: 1 }, null],
      [{ name: "x".repeat(65), index: 1, count: 1 }, null],
      [{ name: "bad\u0007name", index: 1, count: 1 }, null],
      [{ name: "ok", index: 1.5, count: 2 }, null],
      "not a list",
    ];
    for (const [index, display] of bad.entries())
      await refusedWith(
        capture(w, { requestId: `q-${index}`, display }, [A, B]),
        "invalid_input",
      );
    expect(await observationCount(w)).toBe(before);
    // The name is trimmed.
    await capture(
      w,
      {
        requestId: "q-ok",
        display: [{ name: "  Studio  ", index: 1, count: 1 }, null],
      },
      [A, B],
    );
    expect((await stored(w, "q-ok")).display).toEqual({
      name: "Studio",
      index: 1,
      count: 1,
    });
  });

  it("keeps the original on an identical resend and refuses a different display under the same request id", async () => {
    const w = await world("display-idem");
    const first = await capture(w, { requestId: "k-1", display: [disp(1)] }, [
      A,
    ]);
    expect(
      await capture(w, { requestId: "k-1", display: [disp(1)] }, [A]),
    ).toEqual(first);
    await refusedWith(
      capture(w, { requestId: "k-1", display: [disp(2)] }, [A]),
      "invalid_input",
    );
    await refusedWith(capture(w, { requestId: "k-1" }, [A]), "invalid_input");
    expect((await stored(w, "k-1")).display).toEqual(disp(1));
  });

  it("accepts the display field on the multipart route and refuses malformed JSON with reason display", async () => {
    const w = await world("display-route");
    const send = (display: string) => {
      const body = new FormData();
      body.set("requestId", `m-${display.length}`);
      body.set("operation", "analyze");
      body.set("display", display);
      body.append("image", new File([A as BlobPart], "c.png"));
      return routes(w).request(
        `http://studio.test/api/interview/t/${slug}/sessions/${w.sessionId}/capture`,
        { method: "POST", body },
      );
    };
    expect((await send(JSON.stringify([disp(1)]))).status).toBe(202);
    const bad = await send("{not json");
    expect(bad.status).toBe(400);
    expect(bad.headers.get("x-refusal-reason")).toBe("display");
    const wrong = await send(JSON.stringify([{ name: "x" }]));
    expect(wrong.status).toBe(400);
    expect(wrong.headers.get("x-refusal-reason")).toBe("fields");
  });
});
