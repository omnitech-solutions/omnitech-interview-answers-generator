// @vitest-environment node
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getPlatformDatabase } from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import {
  AgentPayloadStore,
  PostgresAgentJobRepository,
} from "@omnitech/platform-storage";
import { PostgresAgentJobWorkerRepository } from "@omnitech/platform-storage/worker";
import type { PgBossRunQueue } from "@omnitech-assistant/storage-postgres";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// The sign-in session (NextAuth) is the identity boundary; the test plays it.
const session = vi.hoisted(() => ({
  current: null as { user?: { email?: string } } | null,
}));
vi.mock("@/auth", () => ({ auth: async () => session.current }));

const SECRET = "agent-payload-secret-of-32-chars!";
const SERVICE_TOKEN = "agent-service-token";
const storageRoot = fileURLToPath(
  new URL("../../../../../packages/platform-storage", import.meta.url),
);

let pg: DisposablePostgres;
let handlers: typeof import("./route");
let tenantId: string;
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  // The local tenant, owner and installed products, as `pnpm dev` seeds them.
  await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "src/bootstrap.ts"],
    { cwd: storageRoot, env: { ...process.env, DATABASE_URL: pg.ownerUrl } },
  );
  tenantId = (
    await pg.owner.query<{ id: string }>(
      "SELECT id FROM platform.tenants WHERE slug = 'local'",
    )
  ).rows[0]!.id;
  vi.stubEnv("DATABASE_URL", pg.ownerUrl);
  vi.stubEnv("FAKE_AUTH_ENABLED", "true");
  vi.stubEnv("AGENT_PAYLOAD_SECRET", SECRET);
  vi.stubEnv("AGENT_SERVICE_TOKEN", SERVICE_TOKEN);
  for (const name of [
    "AI_BASE_URL",
    "AI_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "LM_STUDIO_MODEL",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "CONNECTED_ACCOUNT_SECRET",
  ])
    vi.stubEnv(name, undefined);
  handlers = await import("./route");
}, 90_000);
afterAll(async () => {
  await (await globalThis.interviewRunQueue)?.stop?.().catch(() => undefined);
  globalThis.interviewRunQueue = undefined;
  globalThis.interviewStudio = undefined;
  await getPlatformDatabase()
    .close()
    .catch(() => undefined);
  await pg?.stop();
  vi.unstubAllEnvs();
});
afterEach(() => {
  session.current = null;
});

// The request Next.js hands the catch-all route.
async function call(
  path: string,
  init: { method?: string; body?: unknown; headers?: HeadersInit } = {},
) {
  const method = init.method ?? "GET";
  const handler = handlers[method as keyof typeof handlers] as (
    request: Request,
  ) => Promise<Response>;
  return handler(
    new Request(`http://studio.test${path}`, {
      method,
      headers: {
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...init.headers,
      },
      ...(init.body === undefined
        ? {}
        : {
            body:
              typeof init.body === "string"
                ? init.body
                : JSON.stringify(init.body),
          }),
    }),
  );
}

describe("the platform API", () => {
  it("resolves the signed-in member's tenant and its products", async () => {
    const response = await call("/api/platform/v1/context?tenant=local");
    expect(response.status).toBe(200);
    const context = await response.json();
    expect(context.tenant).toMatchObject({ id: tenantId, slug: "local" });
    expect(context.preferences).toEqual({ theme: "system", locale: "en" });

    const products = await (
      await call("/api/platform/v1/products?tenant=local")
    ).json();
    expect(
      products.items.map((item: { productId: string }) => item.productId),
    ).toEqual(["omnitech.interview", "omnitech.presentation"]);
  });

  it("answers 404 for a tenant the member does not belong to", async () => {
    expect((await call("/api/platform/v1/context?tenant=other")).status).toBe(
      404,
    );
    expect(
      (await call("/api/platform/v1/ai-targets?tenant=other")).status,
    ).toBe(404);
  });

  it("saves the member's preferences", async () => {
    const saved = await call("/api/platform/v1/preferences?tenant=local", {
      method: "PUT",
      body: { theme: "dark", locale: "en-GB", aiProfileId: "document-fast" },
    });
    expect(saved.status).toBe(200);
    const context = await (
      await call("/api/platform/v1/context?tenant=local")
    ).json();
    expect(context.preferences).toEqual({
      theme: "dark",
      locale: "en-GB",
      aiProfileId: "document-fast",
    });
  });

  it("lists the AI targets the member may use", async () => {
    const response = await call("/api/platform/v1/ai-targets?tenant=local");
    expect(response.status).toBe(200);
    const ids = (await response.json()).map(({ id }: { id: string }) => id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "document-fast",
        "interview-assistant",
        "image-balanced",
        "agent/claude-code",
      ]),
    );
  });
});

describe("the agent jobs API", () => {
  const job = async (body: unknown, tenant = "local") =>
    call(`/api/platform/v1/agent-jobs?tenant=${tenant}`, {
      method: "POST",
      body,
    });

  // INV-0004: a job is started for a product the member has installed and may
  // use; anything else is a 404 before a payload or job is written.
  it("refuses a job for a product that is not installed", async () => {
    const jobsBefore = (await pg.owner.query("SELECT 1 FROM ai.agent_jobs"))
      .rowCount;
    const response = await job({
      productId: "omnitech.not-installed",
      profileId: "coding-fast",
      prompt: "Fix the build.",
    });
    expect(response.status).toBe(404);
    expect((await pg.owner.query("SELECT 1 FROM ai.agent_jobs")).rowCount).toBe(
      jobsBefore,
    );
  });

  it("lists the profiles a product may start a job with", async () => {
    const response = await call("/api/platform/v1/agent-profiles?tenant=local");
    expect((await response.json()).map(({ id }: { id: string }) => id)).toEqual(
      [
        "coding-fast",
        "coding-quality",
        "document-quality",
        "presentation-editor",
      ],
    );
    expect(
      (await call("/api/platform/v1/agent-profiles?tenant=other")).status,
    ).toBe(401);
  });

  it("queues a job, reports it, and cancels it", async () => {
    const created = await job({
      productId: "omnitech.presentation",
      profileId: "presentation-editor",
      prompt: "Tighten slide three.",
    });
    expect(created.status).toBe(201);
    const { id, status } = await created.json();
    expect(status).toBe("queued");

    expect(
      await (
        await call(`/api/platform/v1/agent-jobs/${id}?tenant=local`)
      ).json(),
    ).toEqual({ id, status: "queued" });
    expect(
      (await call(`/api/platform/v1/agent-jobs/${id}?tenant=other`)).status,
    ).toBe(401);

    const cancelled = await call(
      `/api/platform/v1/agent-jobs/${id}?tenant=local`,
      { method: "DELETE" },
    );
    expect(cancelled.status).toBe(204);
    expect(
      (
        await (
          await call(`/api/platform/v1/agent-jobs/${id}?tenant=local`)
        ).json()
      ).status,
    ).toBe("cancelling");
    expect(
      (
        await call(`/api/platform/v1/agent-jobs/${id}?tenant=other`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(401);
  });

  it("returns a finished job's result", async () => {
    const { id } = await (
      await job({
        productId: "omnitech.presentation",
        profileId: "document-quality",
        prompt: "Summarise the deck.",
      })
    ).json();
    // The worker stores the result and points the job at it.
    const reference = await new AgentPayloadStore(pg.owner, SECRET).save(
      tenantId,
      JSON.stringify({ summary: "Three points." }),
    );
    await new PostgresAgentJobWorkerRepository(pg.owner).setResultReference(
      id,
      reference,
    );
    expect(
      await (
        await call(`/api/platform/v1/agent-jobs/${id}?tenant=local`)
      ).json(),
    ).toEqual({ id, status: "queued", result: { summary: "Three points." } });

    // A result that is not JSON is left out rather than failing the read.
    await new PostgresAgentJobWorkerRepository(pg.owner).setResultReference(
      id,
      await new AgentPayloadStore(pg.owner, SECRET).save(tenantId, "not json"),
    );
    expect(
      await (
        await call(`/api/platform/v1/agent-jobs/${id}?tenant=local`)
      ).json(),
    ).toEqual({ id, status: "queued" });
  });

  it("refuses unknown jobs, profiles and malformed requests", async () => {
    expect(
      (
        await call(
          "/api/platform/v1/agent-jobs/00000000-0000-4000-8000-0000000000aa?tenant=local",
        )
      ).status,
    ).toBe(404);
    const unknown = await job({
      productId: "omnitech.presentation",
      profileId: "assistant-codex",
      prompt: "Hi",
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "Unknown profile." });
    const malformed = await job({ productId: "", profileId: "x", prompt: "" });
    expect(await malformed.json()).toEqual({
      error: "Invalid agent job request.",
    });
    const broken = await job("{not json");
    expect(broken.status).toBe(400);
    expect(
      (
        await job(
          {
            productId: "omnitech.presentation",
            profileId: "coding-fast",
            prompt: "Hi",
          },
          "other",
        )
      ).status,
    ).toBe(401);
  });

  it("streams a job's events to its tenant and to the agent worker", async () => {
    const { id } = await (
      await job({
        productId: "omnitech.presentation",
        profileId: "coding-fast",
        prompt: "Fix the build.",
      })
    ).json();
    await new PostgresAgentJobWorkerRepository(pg.owner).appendEvent(id, {
      type: "text-delta",
      text: "Working",
    });
    const member = await (
      await call(`/api/platform/v1/agent-jobs/${id}/events?tenant=local`)
    ).json();
    expect(member.map(({ event }: { event: unknown }) => event)).toEqual([
      { type: "text-delta", text: "Working" },
    ]);

    // The event gateway names the job's tenant: events are tenant-owned rows.
    const tenantId = (
      await pg.owner.query<{ id: string }>(
        "SELECT id FROM platform.tenants WHERE slug = 'local'",
      )
    ).rows[0]!.id;
    const worker = await (
      await call(
        `/api/platform/v1/agent-jobs/${id}/events?after=1&tenantId=${tenantId}`,
        { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } },
      )
    ).json();
    expect(worker).toEqual([]);
    expect(
      (
        await call(`/api/platform/v1/agent-jobs/${id}/events?after=1`, {
          headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(`/api/platform/v1/agent-jobs/${id}/events`, {
          headers: { authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(401);
  });

  it("resumes only a job with an agent session", async () => {
    const { id } = await (
      await job({
        productId: "omnitech.presentation",
        profileId: "coding-quality",
        prompt: "Refactor.",
      })
    ).json();
    const resume = (body: unknown, tenant = "local") =>
      call(`/api/platform/v1/agent-jobs/${id}/resume?tenant=${tenant}`, {
        method: "POST",
        body,
      });
    expect((await resume({ prompt: "" })).status).toBe(400);
    const refused = await resume({ prompt: "Continue." });
    expect(refused.status).toBe(409);

    const repository = new PostgresAgentJobWorkerRepository(pg.owner);
    await repository.setSessionId(id, "session-1");
    await repository.transition(id, ["queued"], "awaiting-input");
    const resumed = await resume({ prompt: "Continue." });
    expect(resumed.status).toBe(202);
    expect(await resumed.json()).toEqual({ status: "queued" });
    expect((await resume({ prompt: "x" }, "other")).status).toBe(401);
  });

  it("refuses to queue jobs without a payload secret", async () => {
    vi.stubEnv("AGENT_PAYLOAD_SECRET", undefined);
    try {
      const { createApplicationApi } = await import("@/src/platform/api");
      const response = await createApplicationApi().request(
        "/api/platform/v1/agent-jobs?tenant=local",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            productId: "omnitech.presentation",
            profileId: "coding-fast",
            prompt: "Hi",
          }),
        },
      );
      expect(response.status).toBe(503);
    } finally {
      vi.stubEnv("AGENT_PAYLOAD_SECRET", SECRET);
    }
  });
});

describe("registered product routers", () => {
  it("serves Interview Studio to a member of the tenant", async () => {
    const drafts = await call("/api/interview/workspaces/interview/artifacts", {
      headers: { "x-omnitech-tenant": "local" },
    });
    expect(drafts.status).toBe(200);
    expect(await drafts.json()).toEqual([]);
  }, 30_000);

  it("refuses a product API call without tenant membership", async () => {
    const drafts = await call("/api/interview/workspaces/interview/artifacts", {
      headers: { "x-omnitech-tenant": "other" },
    });
    expect(drafts.status).toBe(401);
  });

  it("serves Presentations to a member of the tenant", async () => {
    const response = await call("/api/presentation/v1/ai-targets?tenant=local");
    expect(response.status).toBe(200);
  });
});

describe("signed-in members outside local development", () => {
  it("resolves the session's member from the platform database", async () => {
    vi.stubEnv("FAKE_AUTH_ENABLED", "false");
    try {
      session.current = { user: { email: "local@omnitech.test" } };
      const context = await (
        await call("/api/platform/v1/context?tenant=local")
      ).json();
      expect(context.user.email).toBe("local@omnitech.test");
      expect(context.membership.role).toBe("owner");

      session.current = null;
      expect((await call("/api/platform/v1/context?tenant=local")).status).toBe(
        404,
      );
    } finally {
      vi.stubEnv("FAKE_AUTH_ENABLED", "true");
    }
  });
});
