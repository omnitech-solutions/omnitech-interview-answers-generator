import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AiExecutionGateway,
  AiExecutionRequest,
} from "@omnitech/ai-contracts";
import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
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
import { createInterviewBackend } from "./interview-backend.js";

// The AI gateway is the provider boundary: it records what the product asks
// for and answers with a listing of one model.
const executed: AiExecutionRequest[] = [];
const ai: AiExecutionGateway = {
  async execute(request) {
    executed.push(request);
    return {
      executionId: "e",
      family: "direct-model",
      targetId: "fake",
      result: { not: "an answer" },
    } as never;
  },
  async *stream() {},
  async *streamStructured() {},
  async cancel() {},
  async *resume() {},
  async listAvailableTargets() {
    return [
      {
        id: "interview-assistant",
        label: "Interview assistant",
        family: "direct-model",
        kind: "language",
        capabilities: ["structured-chat"],
        listing: {
          id: "interview-assistant",
          name: "Test model",
          tags: [],
          vision: false,
          reasoning: false,
        },
      },
    ] as never;
  },
};

let pg: DisposablePostgres;
let database: PlatformDatabase;
let member: { tenantId: string; userId: string };
let matrices: string;
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
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
  database = createPlatformDatabase(pg.ownerUrl);
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

function backend(overrides: { answersConfigured?: boolean } = {}) {
  return createInterviewBackend({
    ai,
    database,
    runQueueConnectionString: pg.ownerUrl,
    resolveContext,
    answersConfigured: overrides.answersConfigured ?? true,
    modelVersion: "test",
    contextCharacters: 10_000,
    onDeviceModel: true,
    localDefaultProfile: true,
  });
}
const json = (body: unknown, tenant = "local") => ({
  method: "POST",
  headers: { "content-type": "application/json", "x-omnitech-tenant": tenant },
  body: JSON.stringify(body),
});

describe("Interview Studio's backend as the platform mounts it", () => {
  it("generates answers on the gateway as the member of the named tenant", async () => {
    const response = await backend().app.request(
      "http://studio.test/api/v1/generate",
      json({ question: "Reverse a linked list", language: "typescript" }),
    );
    // The fake model's reply is not an answer; the product says so.
    expect(response.status).toBe(502);
    expect(executed[0]).toMatchObject({
      profileId: "interview-answers",
      context: {
        tenantId: member.tenantId,
        userId: member.userId,
        productId: "omnitech.interview",
        permissions: [
          "interview.read",
          "interview.write",
          "interview.documents.write",
        ],
      },
      task: { type: "structured-generation" },
    });
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

  it("offers the gateway's models and the on-device model in the assistant", async () => {
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
});
