// The per-session "Screenshots to the model" setting (D35), on a disposable
// PostgreSQL as the member role (requires Docker, like the other session
// suites): the real processor and assist stage run over a scripted fake
// engine. Asserts counts, ids, names, wire shapes and marker wording only;
// the on-screen text is a unique marker that must never reach a trace or log.
import {
  type LiveOcrBlock,
  type LiveScreenshotSend,
  liveActionSchema,
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
  createFakeEngine,
  type SessionAsk,
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
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
afterAll(() => fx?.stop());

const SECRET = "send-secret-marker";
const PROSE = `${SECRET} Tell me about a time you disagreed with a teammate.\nHow did you resolve it and what did you learn from it?\nPlease keep your answer under two minutes.`;
const CODE = `${SECRET}\nfunction twoSum(nums, target) {\nconst seen = new Map();\nfor (let i = 0; i < nums.length; i++) {\nif (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];\n}\n}`;
const metrics = (over: Record<string, number> = {}) => ({
  coverage: 0.8,
  meanConfidence: 0.97,
  largestGap: 0.05,
  boxes: 12,
  ...over,
});
const read = (
  text: string,
  over: Partial<LiveOcrBlock> = {},
): LiveOcrBlock => ({
  engine: "vision",
  text,
  confidence: 0.97,
  metrics: metrics(),
  ...over,
});

async function world(
  name: string,
  options: {
    policy?: "permitted-remote" | "device-only";
    screenshotSend?: LiveScreenshotSend;
  } = {},
) {
  const person = await fx.provision(fx.tenantA, name);
  const scope = { tenantId: fx.tenantA, actorId: person.id };
  const started = await repo.startSession(scope, {
    processingPolicy: options.policy ?? "permitted-remote",
    captureSources: ["microphone", "screen"],
    ...(options.screenshotSend
      ? { screenshotSend: options.screenshotSend }
      : {}),
  });
  const engine = createFakeEngine();
  const trace = collectTraces();
  const processor = buildProcessor(fx, {
    workerId: `worker-${name}`,
    engine,
    trace,
    visionProfileId: "vision-profile",
  });
  const sessionId = started.session.id;
  cleanups.push(async () => {
    engine.releaseAll();
    await processor.close();
    await repo.controlSession(scope, sessionId, "end");
  });
  return { person, scope, sessionId, engine, processor, trace, started };
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
const A = pngOf(640, 480, 0);
const B = pngOf(640, 480, 1);
const C = pngOf(640, 480, 2);
const sent = (request: SessionAsk | undefined) => {
  if (!request) throw new Error("no such call reached the engine");
  return request;
};
const attachmentsOf = (request: SessionAsk | undefined) =>
  sent(request).attachments;
const promptOf = (request: SessionAsk | undefined) => sent(request).prompt;
const draftActions = async (w: World) =>
  (await repo.listActions(w.scope, w.sessionId)).filter(
    (action) => action.actionKind === "draft-answer",
  );

const app = (w: World) =>
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
const url = (w: World, path: string) =>
  `http://studio.test/api/interview/t/${slug}/sessions/${w.sessionId}${path}`;
const get = async (w: World, path: string) =>
  (await app(w).request(url(w, path))).text();
const post = (w: World, path: string, body: unknown) =>
  app(w).request(url(w, path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// One capture, one model call; returns that call's request.
async function oneCall(
  w: World,
  requestId: string,
  ocr: Array<LiveOcrBlock | null>,
) {
  const before = w.engine.requests.length;
  await capture(
    w,
    { requestId, ocr },
    ocr.map((_, i) => [A, B, C][i] as Uint8Array),
  );
  await settle(w.processor);
  expect(w.engine.requests.length).toBe(before + 1);
  return w.engine.requests[before];
}

describe("always (the default)", () => {
  it("reads as always on a new session and on a row without the field, and sends the image beside its text", async () => {
    const w = await world("send-always");
    expect(w.started.session.screenshotSend).toBe("always");
    // A row recorded before the setting carries the column default.
    const stored = await fx.owner.query(
      "SELECT screenshot_send FROM interview.active_sessions WHERE id=$1",
      [w.sessionId],
    );
    expect(stored.rows[0].screenshot_send).toBe("always");
    const request = await oneCall(w, "a-1", [read(PROSE)]);
    expect(attachmentsOf(request)).toHaveLength(1);
    expect(promptOf(request)).toContain("COUNT: 1");
    expect(promptOf(request)).toContain(
      "Screenshot S1 (screenshot-1) on-screen text",
    );
    expect(promptOf(request)).not.toContain("withheld by the owner");
  });
});

describe("text-only-when-text", () => {
  it("drops the image of a clean text frame and keeps its text, telling the model", async () => {
    const w = await world("send-text", {
      screenshotSend: "text-only-when-text",
    });
    const request = await oneCall(w, "t-1", [read(PROSE)]);
    expect(attachmentsOf(request)).toHaveLength(0);
    const prompt = promptOf(request);
    expect(prompt).not.toContain("BEGIN ATTACHED IMAGES");
    expect(prompt).toContain(
      "Screenshot S1 image withheld by the owner's setting; only its on-screen text is given",
    );
    expect(prompt).toContain(SECRET);
    // The call went on the profile for a call without images.
    expect(w.trace.events.some((e) => e.outcome === "published")).toBe(true);
  });

  it.each([
    ["code", read(CODE)],
    [
      "a diagram (large uncovered region)",
      read(PROSE, { metrics: metrics({ largestGap: 0.4 }) }),
    ],
    [
      "low confidence",
      read(PROSE, {
        metrics: metrics({ meanConfidence: 0.5 }),
        confidence: 0.5,
      }),
    ],
    ["tesseract", read(PROSE, { engine: "tesseract", metrics: undefined })],
    ["missing metrics", read(PROSE, { metrics: undefined })],
    ["low coverage", read(PROSE, { metrics: metrics({ coverage: 0.2 }) })],
    ["no text read", null],
  ] as const)("keeps the image for %s", async (_name, block) => {
    const w = await world("send-keep", {
      screenshotSend: "text-only-when-text",
    });
    const request = await oneCall(w, "k-1", [block]);
    expect(attachmentsOf(request)).toHaveLength(1);
    expect(promptOf(request)).not.toContain("withheld by the owner");
  });

  it("decides each screenshot of one call on its own and renames the images that travel", async () => {
    const w = await world("send-mixed", {
      screenshotSend: "text-only-when-text",
    });
    const request = await oneCall(w, "m-1", [read(PROSE), read(CODE), null]);
    expect(attachmentsOf(request).map((a) => a.name)).toEqual([
      "screenshot-1",
      "screenshot-2",
    ]);
    const prompt = promptOf(request);
    expect(prompt).toContain("COUNT: 2");
    expect(prompt).toContain(
      "Screenshot S1 image withheld by the owner's setting",
    );
    expect(prompt).toContain("Screenshot S2 (screenshot-1) on-screen text");
    const taskId = (await draftActions(w))[0]?.taskId as string;
    const listing = liveTaskScreenshotsResponseSchema.parse(
      JSON.parse(await get(w, `/tasks/${taskId}/screenshots`)),
    );
    expect(
      listing.screenshots.map((s) => [s.ordinal, s.sentByRevision]),
    ).toEqual([
      [1, [{ revision: 1, sent: "text-only" }]],
      [2, [{ revision: 1, sent: "image" }]],
      [3, [{ revision: 1, sent: "image" }]],
    ]);
  });
});

describe("never", () => {
  it("sends no image at all: text where there is text, a note where there is none", async () => {
    const w = await world("send-never", { screenshotSend: "never" });
    const request = await oneCall(w, "n-1", [read(CODE), null]);
    expect(attachmentsOf(request)).toHaveLength(0);
    const prompt = promptOf(request);
    expect(prompt).toContain(
      "Screenshot S1 image withheld by the owner's setting; only its on-screen text is given",
    );
    expect(prompt).toContain(
      "Screenshot S2 image withheld by the owner's setting; no on-screen text is available",
    );
    const taskId = (await draftActions(w))[0]?.taskId as string;
    const listing = liveTaskScreenshotsResponseSchema.parse(
      JSON.parse(await get(w, `/tasks/${taskId}/screenshots`)),
    );
    expect(listing.screenshots.map((s) => s.sentByRevision?.[0]?.sent)).toEqual(
      ["text-only", "none"],
    );
  });

  it("is read at dispatch from the stored setting: changing it applies to the next call, and a regeneration follows it", async () => {
    const w = await world("send-change");
    await oneCall(w, "c-1", [read(PROSE)]);
    expect(attachmentsOf(w.engine.requests[0])).toHaveLength(1);
    const changed = await post(w, "/screenshot-send", {
      screenshotSend: "never",
    });
    expect(changed.status).toBe(200);
    const taskId = (await draftActions(w))[0]?.taskId as string;
    await repo.submitOwnerInput(w.scope, w.sessionId, {
      requestId: "c-2",
      operation: "regenerate",
      target: { taskId, revision: 1 },
      snapshots: [],
    });
    await settle(w.processor);
    expect(attachmentsOf(w.engine.requests[1])).toHaveLength(0);
    // Both revisions record what really left, in the browser's feed too.
    const feed = JSON.parse(await get(w, "/stream")) as { actions: unknown[] };
    const sent = feed.actions
      .map((a) => liveActionSchema.parse(a))
      .filter((a) => a.actionKind === "draft-answer")
      .sort((a, b) => a.taskRevision - b.taskRevision)
      .map((a) => a.screenshotsSent);
    expect(sent).toEqual([
      [{ ordinal: 1, sent: "image" }],
      [{ ordinal: 1, sent: "text-only" }],
    ]);
  });
});

describe("device-only is unchanged and takes precedence", () => {
  it.each(["always", "text-only-when-text", "never"] as const)(
    "refuses a screenshot dispatch under %s exactly as before and calls no model",
    async (setting) => {
      const w = await world(`send-device-${setting}`, {
        policy: "device-only",
        screenshotSend: setting,
      });
      await capture(w, { requestId: "d-1", ocr: [read(PROSE)] }, [A]);
      await settle(w.processor);
      expect(w.engine.requests).toHaveLength(0);
      expect(
        w.trace.events.some(
          (e) =>
            e.event === "dispatch.refused" &&
            e.outcome === "vision-device-only",
        ),
      ).toBe(true);
    },
  );
});

describe("the settings route", () => {
  it("accepts the three words either way, and refuses anything else, extra keys and another owner's session", async () => {
    const w = await world("send-route");
    for (const word of ["never", "text-only-when-text", "always"] as const) {
      const response = await post(w, "/screenshot-send", {
        screenshotSend: word,
      });
      expect(response.status).toBe(200);
      expect(
        ((await response.json()) as { session: { screenshotSend: string } })
          .session.screenshotSend,
      ).toBe(word);
    }
    for (const bad of [
      { screenshotSend: "sometimes" },
      { screenshotSend: "" },
      { screenshotSend: 1 },
      {},
      { screenshotSend: "never", processingPolicy: "permitted-remote" },
    ])
      expect((await post(w, "/screenshot-send", bad)).status).toBe(400);
    const stranger = await world("send-route-other");
    const crossed = await app(stranger).request(url(w, "/screenshot-send"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ screenshotSend: "never" }),
    });
    expect(crossed.status).toBe(404);
    // The session view carries it, and a start with a bad word is refused.
    const view = JSON.parse(await get(w, "")) as {
      session: { screenshotSend: string };
    };
    expect(view.session.screenshotSend).toBe("always");
    await expect(
      repo.startSession(stranger.scope, {
        processingPolicy: "permitted-remote",
        captureSources: ["screen"],
        screenshotSend: "sometimes" as never,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("the worker's claim cannot change the setting", async () => {
    const w = await world("send-claim");
    await expect(
      fx.member.transaction(async (client) => {
        await client.query(
          "SELECT set_config('app.session_worker', 'on', true)",
        );
        await client.query(
          "UPDATE interview.active_sessions SET screenshot_send='never' WHERE id=$1",
          [w.sessionId],
        );
      }),
    ).rejects.toThrow();
  });
});

describe("nothing carries the on-screen text or the metrics out", () => {
  it("records only counts in the trace, never text, and the feed never returns metrics or text", async () => {
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (name) =>
        vi.spyOn(console, name).mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(" "));
        }),
    );
    const w = await world("send-canary", {
      screenshotSend: "text-only-when-text",
    });
    await oneCall(w, "z-1", [read(PROSE), read(CODE)]);
    const events = JSON.stringify(w.trace.events);
    expect(events).not.toContain(SECRET);
    expect(events).toContain('"screenshotsTextOnly":1');
    expect(events).toContain('"screenshotsImage":1');
    expect(events).toContain('"screenshotsNone":0');
    const stream = await get(w, "/stream");
    expect(stream).not.toContain(SECRET);
    expect(stream).not.toContain("largestGap");
    expect(stream).not.toContain("meanConfidence");
    const taskId = (await draftActions(w))[0]?.taskId as string;
    const listing = await get(w, `/tasks/${taskId}/screenshots`);
    expect(listing).not.toContain(SECRET);
    expect(listing).not.toContain("largestGap");
    for (const spy of spies) spy.mockRestore();
    expect(logged.join("\n")).not.toContain(SECRET);
    // Stored with the observation (the gate's evidence), as bounded numbers.
    const row = (
      await fx.owner.query(
        `SELECT content->'ocr'->'metrics' AS m FROM interview.session_observations
         WHERE session_id=$1 AND event_id='z-1'`,
        [w.sessionId],
      )
    ).rows[0];
    expect(row.m).toEqual(metrics());
  });
});
