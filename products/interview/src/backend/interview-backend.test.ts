import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AiEngine,
  createAiEngine,
  type Execution,
  type ModelPort,
} from "@omnitech/ai-engine";
import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  grantApplicationRole,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import type { PlatformContext } from "@omnitech/platform-contracts";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { coachTranscript } from "./coach-transcript";
import { createInterviewBackend } from "./interview-backend";
import { pngOf } from "./live-session/live-session-fixture";

// The model is the provider boundary: it records what the product asks for
// and replies with an object that is no answer. A repair turn is the
// engine's own second call and is not counted as the product's.
type Asked = {
  profileId: string;
  scope: Execution["scope"];
  schema?: Record<string, unknown>;
};
const executed: Asked[] = [];
const model: ModelPort = {
  async *stream(scope, input) {
    const repairing = input.messages.some(
      (message) =>
        message.role === "user" &&
        message.parts.some(
          (part) =>
            part.type === "text" &&
            part.text.startsWith("That output was not accepted"),
        ),
    );
    if (!repairing)
      executed.push({
        profileId: input.profileId,
        scope,
        ...(input.schema === undefined
          ? {}
          : { schema: input.schema as Record<string, unknown> }),
      });
    yield { type: "text", text: JSON.stringify({ not: "an answer" }) };
  },
};
const authorize = vi.fn((_execution: Execution) => true as const);
const engine: AiEngine = createAiEngine({
  profiles: [
    { id: "interview-assistant", provider: "model" },
    { id: "interview-answers", provider: "model" },
    { id: "agent", provider: "agents", catalog: true },
  ],
  providers: { model, agents: { ...model, kind: "agent" } },
  catalogs: {
    agents: {
      list: async () => ({
        models: [
          {
            id: "agent/claude-code",
            name: "Claude Code",
            tags: [],
            vision: false,
            reasoning: false,
            local: false,
          },
        ],
      }),
    },
  },
  authorize,
});

let pg: DisposablePostgres;
let database: PlatformDatabase;
let member: { tenantId: string; userId: string };
let matrices: string;
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await grantApplicationRole(pg.owner);
  const user = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.users (email, display_name) VALUES ('local@omnitech.test', 'Local') RETURNING id",
  );
  const tenant = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.tenants (slug, name) VALUES ('local', 'Local') RETURNING id",
  );
  member = { tenantId: tenant.rows[0]!.id, userId: user.rows[0]!.id };
  await pg.owner.query(
    "INSERT INTO platform.tenant_memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')",
    [member.tenantId, member.userId],
  );
  database = createPlatformDatabase(pg.memberUrl);
  matrices = mkdtempSync(join(tmpdir(), "interview-matrix-"));
}, 60_000);
afterAll(async () => {
  await (await globalThis.interviewRunQueue)?.stop();
  globalThis.interviewRunQueue = undefined;
  globalThis.interviewStudio = undefined;
  await database?.close();
  await pg?.stop();
  rmSync(matrices, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  executed.length = 0;
});

// The signed-in member's platform context, as the shell resolves it: the
// local owner may read and write; "reader" may only read.
async function resolveContext(slug: string): Promise<PlatformContext | null> {
  if (slug !== "local" && slug !== "reader") return null;
  return {
    user: {
      id: member.userId,
      email: "local@omnitech.test",
      displayName: "Local",
      avatarUrl: null,
    },
    tenant: { id: member.tenantId, slug, name: "Local" },
    membership: { ...member, role: "owner" },
    preferences: { theme: "system", locale: "en" },
    permissions:
      slug === "local"
        ? ["interview.read", "interview.write"]
        : ["interview.read"],
    products: [
      {
        productId: "omnitech.interview",
        name: "Interview",
        description: "Interview",
        icon: "sparkles",
        enabled: true,
        routePrefix: "",
        navigation: { group: "", order: 0, hidden: false, routes: {} },
        featureFlags: {},
        settings: {},
        revision: 1,
      },
    ],
  } as PlatformContext;
}

function backend(
  overrides: {
    answersConfigured?: boolean;
    assistantDefaultModel?: string;
  } = {},
) {
  return createInterviewBackend({
    engine,
    database,
    runQueueConnectionString: pg.memberUrl,
    resolveContext,
    answersConfigured: overrides.answersConfigured ?? true,
    modelVersion: "test",
    contextCharacters: 10_000,
    onDeviceModel: true,
    assistantListing: {
      name: "Test model",
      tags: [],
      vision: false,
      reasoning: false,
      local: false,
    },
    localDefaultProfile: true,
    ...(overrides.assistantDefaultModel
      ? { assistantDefaultModel: overrides.assistantDefaultModel }
      : {}),
  });
}
const json = (body: unknown, tenant = "local") => ({
  method: "POST",
  headers: { "content-type": "application/json", "x-omnitech-tenant": tenant },
  body: JSON.stringify(body),
});

describe("Interview Studio's backend as the platform mounts it", () => {
  it("generates answers on the engine as the member of the named tenant", async () => {
    const response = await backend().app.request(
      "http://studio.test/api/v1/generate",
      json({ question: "Reverse a linked list", language: "typescript" }),
    );
    // The fake model's reply is not an answer; the product says so.
    expect(response.status).toBe(502);
    // One call, carrying the answer's schema for the engine to enforce.
    expect(executed).toEqual([
      {
        profileId: "interview-answers",
        scope: {
          tenantId: member.tenantId,
          actorId: member.userId,
          productId: "omnitech.interview",
        },
        schema: expect.objectContaining({ type: "object" }),
      },
    ]);
    // The member's permissions travel on the execution the host authorises.
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        permissions: [
          "interview.read",
          "interview.write",
          "interview.documents.write",
        ],
      }),
      expect.objectContaining({ id: "interview-answers" }),
    );
  });

  // HO-SEC-02: the /api/v1 gate accepts a browser only as a verified member of
  // the tenant it names; spoofed same-origin headers prove nothing.
  it("refuses /api/v1 for a request with no tenant, an unknown tenant or only spoofed origin headers", async () => {
    const app = backend().app;
    const spoof = {
      "sec-fetch-site": "same-origin",
      origin: "http://studio.test",
    };
    for (const headers of [
      spoof,
      { ...spoof, "x-omnitech-tenant": "nobody" },
    ]) {
      const response = await app.request("http://studio.test/api/v1/answers", {
        headers,
      });
      expect(response.status).toBe(401);
    }
    const member = await app.request("http://studio.test/api/v1/health", {
      headers: { "x-omnitech-tenant": "local" },
    });
    expect(member.status).toBe(200);
  });

  it("reports answers unavailable when no language model is configured", async () => {
    const response = await backend({ answersConfigured: false }).app.request(
      "http://studio.test/api/v1/generate",
      json({ question: "Reverse a linked list", language: "typescript" }),
    );
    expect(response.status).toBe(503);
    expect(executed).toEqual([]);
  });

  it("names the tenant by header or by ?tenant=, and refuses non-members", async () => {
    const app = backend().app;
    const drafts =
      "http://studio.test/api/interview/workspaces/interview/artifacts";
    const byHeader = await app.request(drafts, {
      headers: { "x-omnitech-tenant": "local" },
    });
    expect(byHeader.status).toBe(200);
    expect(await byHeader.json()).toEqual([]);
    expect((await app.request(`${drafts}?tenant=local`)).status).toBe(200);
    expect((await app.request(drafts)).status).toBe(401);
    expect(
      (await app.request(drafts, { headers: { "x-omnitech-tenant": "acme" } }))
        .status,
    ).toBe(401);
  }, 30_000);

  it("lets a read-only member read but not write", async () => {
    const app = backend().app;
    const plan = "http://studio.test/api/interview/plan";
    expect(
      (await app.request(plan, { headers: { "x-omnitech-tenant": "reader" } }))
        .status,
    ).toBe(200);
    const write = await app.request(
      `${plan}/items`,
      json({ kind: "task", title: "Read the job post" }, "reader"),
    );
    expect(write.status).toBe(401);
  });

  it("offers the engine's models and the on-device model in the assistant", async () => {
    const response = await backend().app.request(
      "http://studio.test/api/assistant/v1/models",
      { headers: { "x-omnitech-tenant": "local" } },
    );
    expect(response.status).toBe(200);
    const listing = await response.json();
    expect(listing.defaultModel).toBe("interview-assistant");
    expect(
      listing.models.map((model: { id: string; tags: string[] }) => [
        model.id,
        model.tags,
      ]),
    ).toEqual([
      ["interview-assistant", ["default"]],
      ["agent/claude-code", []],
      ["on-device", ["on-device"]],
    ]);
  });

  it("starts the local member's briefing packs from the bundled matrix", async () => {
    const path = join(matrices, "default-experience-matrix.json");
    writeFileSync(
      path,
      JSON.stringify({
        candidate: { name: "Synthetic Candidate" },
        roles: [
          {
            company: "Acme",
            title: "Engineer",
            technologies: ["TypeScript"],
            proof_points: ["Mentored engineers"],
          },
        ],
      }),
    );
    vi.stubEnv("INTERVIEW_DEFAULT_MATRIX_PATH", path);
    const app = backend().app;
    const profiles = await app.request(
      "http://studio.test/api/interview/briefing/profiles",
      { headers: { "x-omnitech-tenant": "local" } },
    );
    expect(profiles.status).toBe(200);
    expect(
      (await profiles.json()).profiles.map(
        (profile: { name: string }) => profile.name,
      ),
    ).toEqual(["My experience matrix"]);
  });

  it("runs queued assistant turns until the server stops", async () => {
    const controller = new AbortController();
    const running = backend().runWorker(controller.signal);
    // With nothing queued the worker idles; stopping ends it promptly.
    await new Promise((resolve) => setTimeout(resolve, 300));
    controller.abort();
    await expect(running).resolves.toBeUndefined();
  }, 30_000);

  it("reports a failing worker tick by its code only, and carries on", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = new AbortController();
    const studio = await globalThis.interviewStudio!.studio;
    const tick = vi
      .spyOn(studio.worker, "tick")
      .mockRejectedValueOnce(new TypeError("secret prompt text"))
      .mockImplementation(async () => {
        controller.abort();
        return false;
      });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const running = backend().runWorker(controller.signal);
      await vi.advanceTimersByTimeAsync(5_000);
      await running;
    } finally {
      vi.useRealTimers();
    }
    expect(tick).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledWith(
      JSON.stringify({ interviewWorker: "TypeError" }),
    );
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret");
  }, 30_000);

  it("mounts the Active Session routes ahead of the studio's catch-all", async () => {
    const app = backend().app;
    // Ingest answers with its own content-free refusal, not the studio's.
    const ingest = await app.request(
      "http://studio.test/api/interview/t/local/sessions/ingest",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(ingest.status).toBe(401);
    expect(await ingest.json()).toEqual({
      version: 1,
      status: "refused",
      code: "credential_refused",
    });
    // A user route resolves the signed-in member of the path's tenant first.
    const stranger = await app.request(
      "http://studio.test/api/interview/t/nobody/sessions/current",
    );
    expect(stranger.status).toBe(401);
    expect(await stranger.json()).toEqual({ error: { code: "unauthorized" } });
  });

  // [SAFETY] The coach writes on a remote model: what a device-only session
  // hears never reaches the coach's transcript; what a permitted-remote one
  // hears does, as that session's.
  it("gives the coach what a permitted-remote session hears, and nothing a device-only session hears", async () => {
    const app = backend().app;
    const sessions = "http://studio.test/api/interview/t/local/sessions";
    const start = async (processingPolicy: string) => {
      const response = await app.request(
        sessions,
        json({ processingPolicy, captureSources: ["microphone"] }),
      );
      expect(response.status).toBe(201);
      return ((await response.json()) as { session: { id: string } }).session
        .id;
    };
    const hear = (id: string, requestId: string, text: string) =>
      app.request(
        `${sessions}/${id}/input`,
        json({ requestId, operation: "heard", text }),
      );
    const end = (id: string) =>
      app.request(
        `${sessions}/${id}/control`,
        json({ version: 1, kind: "session.control", action: "end" }),
      );
    coachTranscript.clear();
    try {
      const onDevice = await start("device-only");
      expect(
        (await hear(onDevice, "wire-dev-0001", "words that stay on the device"))
          .status,
      ).toBe(202);
      expect(coachTranscript.since().lines).toEqual([]);
      expect((await end(onDevice)).status).toBe(200);

      const remote = await start("permitted-remote");
      expect(
        (await hear(remote, "wire-rem-0001", "words the coach may read"))
          .status,
      ).toBe(202);
      const read = coachTranscript.since();
      expect(read.lines.map((line) => [line.speaker, line.text])).toEqual([
        ["unknown", "words the coach may read"],
      ]);
      expect(read.session).toEqual({
        tenantId: member.tenantId,
        actorId: member.userId,
        sessionId: remote,
      });
      expect((await end(remote)).status).toBe(200);
    } finally {
      coachTranscript.clear();
    }
  });

  // [SAFETY] As with what is heard: the text read from a device-only
  // session's capture never reaches the coach; a permitted-remote one's is
  // the coach's screen, as that session's.
  it("gives the coach what a permitted-remote session's capture shows, and nothing a device-only session's shows", async () => {
    const app = backend().app;
    const sessions = "http://studio.test/api/interview/t/local/sessions";
    const start = async (processingPolicy: string) => {
      const response = await app.request(
        sessions,
        json({ processingPolicy, captureSources: ["microphone", "screen"] }),
      );
      expect(response.status).toBe(201);
      return ((await response.json()) as { session: { id: string } }).session
        .id;
    };
    const capture = (id: string, requestId: string, text?: string) => {
      const form = new FormData();
      form.set("requestId", requestId);
      form.set("operation", "analyze");
      form.append(
        "image",
        new File([pngOf(640, 480) as BlobPart], "shot.png", {
          type: "image/png",
        }),
      );
      if (text !== undefined)
        form.set("ocr", JSON.stringify([{ engine: "vision", text }]));
      return app.request(`${sessions}/${id}/capture`, {
        method: "POST",
        body: form,
      });
    };
    const end = (id: string) =>
      app.request(
        `${sessions}/${id}/control`,
        json({ version: 1, kind: "session.control", action: "end" }),
      );
    coachTranscript.clear();
    try {
      const onDevice = await start("device-only");
      expect(
        (await capture(onDevice, "screen-dev-0001", "a screen that stays here"))
          .status,
      ).toBe(202);
      expect(coachTranscript.since()).not.toHaveProperty("screen");
      // Nor is the coach pointed at that session.
      expect(coachTranscript.since().session?.sessionId).not.toBe(onDevice);
      expect((await end(onDevice)).status).toBe(200);

      const remote = await start("permitted-remote");
      // A capture with no text read from it leaves the coach's screen as it is.
      expect((await capture(remote, "screen-rem-0000")).status).toBe(202);
      expect(coachTranscript.since()).not.toHaveProperty("screen");
      expect(
        (await capture(remote, "screen-rem-0001", "def available_slots(day):"))
          .status,
      ).toBe(202);
      const read = coachTranscript.since();
      expect(read.screen).toEqual({
        text: "def available_slots(day):",
        at: expect.any(String),
      });
      expect(read.space).toBe("live");
      expect(read.session).toEqual({
        tenantId: member.tenantId,
        actorId: member.userId,
        sessionId: remote,
      });
      // Nothing was said: the screen adds no line.
      expect(read.lines).toEqual([]);
      expect((await end(remote)).status).toBe(200);
    } finally {
      coachTranscript.clear();
    }
  });

  // The studio is built once per process, so each default model below gets a
  // studio of its own; the last one built is the plain one other tests expect.
  it("runs a pack's one-shot generation on the default model, agent or not, in one call with the reply's schema", async () => {
    const path = join(matrices, "default-experience-matrix.json");
    writeFileSync(
      path,
      JSON.stringify({
        candidate: { name: "Synthetic Candidate" },
        roles: [{ company: "Acme", title: "Engineer" }],
      }),
    );
    vi.stubEnv("INTERVIEW_DEFAULT_MATRIX_PATH", path);
    const headers = { "x-omnitech-tenant": "local" };
    const base = "http://studio.test/api/interview/briefing";
    // What a pack's generation asked the engine for, under a default model.
    async function condensedOn(
      artifactId: string,
      assistantDefaultModel?: string,
    ) {
      globalThis.interviewStudio = undefined;
      const app = backend(
        assistantDefaultModel ? { assistantDefaultModel } : {},
      ).app;
      const { profiles } = await (
        await app.request(`${base}/profiles`, { headers })
      ).json();
      const created = await app.request(`${base}/artifacts/${artifactId}`, {
        ...json({
          expectedRevision: 0,
          briefing: {
            kind: "non-technical-briefing",
            title: "Recruiter",
            context: {
              company: "Acme",
              role: "Engineer",
              stage: "recruiter",
              profile: { id: profiles[0].id, revision: profiles[0].revision },
              jobDescription: "Own the roadmap. ".repeat(300),
            },
            questions: [],
          },
        }),
        method: "PUT",
      });
      expect(created.status).toBe(200);
      executed.length = 0;
      const condensed = await app.request(
        `${base}/artifacts/${artifactId}/condense`,
        json({
          expectedRevision: (await created.json()).origin.artifactRevision,
        }),
      );
      // The fake model's reply is not the two fields: the product reports
      // the generation failed.
      expect(condensed.status).toBe(503);
      return executed.map(({ profileId, schema }) => ({ profileId, schema }));
    }

    // The engine checks the reply against the schema and asks once more
    // itself, so the product asked once: on an agent, on another model, and
    // when no default is named.
    for (const [artifactId, model, profileId] of [
      ["on-agent", "agent/claude-code", "agent/claude-code"],
      ["on-model", "lm-studio/some-model", "interview-assistant"],
      ["on-default", undefined, "interview-assistant"],
    ] as const) {
      const asked = await condensedOn(artifactId, model);
      expect(asked).toEqual([
        {
          profileId,
          schema: expect.objectContaining({
            type: "object",
            properties: {
              jobDescription: expect.objectContaining({ type: "string" }),
              research: expect.objectContaining({ type: "string" }),
            },
            required: ["jobDescription", "research"],
          }),
        },
      ]);
      // An agent runtime's own check cannot resolve zod's draft reference.
      expect(asked[0]!.schema).not.toHaveProperty("$schema");
    }
  }, 30_000);
});
