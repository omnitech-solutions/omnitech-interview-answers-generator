// @vitest-environment node
import { getPlatformDatabase } from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const resolvePlatformContext = vi.hoisted(() => vi.fn());
vi.mock("./context", () => ({ resolvePlatformContext }));
vi.mock("./registry", () => ({
  getProductRegistry: () => ({ list: () => [] }),
}));

import { createAgentApi } from "./agent-api";

// ADR-0012 no-resume-after-end: the generic resume route must not revive the
// private job of a session, even for the job's own creator.
let pg: DisposablePostgres;
let tenantId: string;
let userId: string;

beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`
    GRANT USAGE ON SCHEMA platform, ai TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, ai TO fixture_member;`);
  const user = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.users (email, display_name) VALUES ('owner@acme.test', 'Owner') RETURNING id",
  );
  const tenant = await pg.owner.query<{ id: string }>(
    "INSERT INTO platform.tenants (slug, name) VALUES ('acme', 'Acme') RETURNING id",
  );
  userId = user.rows[0]!.id;
  tenantId = tenant.rows[0]!.id;
  process.env["DATABASE_URL"] = pg.memberUrl;
  process.env["AGENT_PAYLOAD_SECRET"] =
    "agent-api-test-secret-0123456789abcdef";
}, 60_000);
afterAll(async () => {
  await getPlatformDatabase()
    .close()
    .catch(() => undefined);
  await pg?.stop();
});

beforeEach(() => {
  resolvePlatformContext.mockResolvedValue({
    tenant: { id: tenantId },
    user: { id: userId },
    products: [],
    permissions: [],
  });
});

async function endedSessionJob(isPrivate: boolean): Promise<string> {
  return pg.owner.transaction(async (client) => {
    await client.query(
      "SELECT set_config('app.session_dispatch', 'on', true), set_config('app.actor_id', $1, true)",
      [userId],
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ai.agent_jobs (tenant_id, user_id, product_id, status,
         profile_snapshot, prompt_reference, private, session_id)
       VALUES ($1, $2, 'omnitech.interview', 'cancelled', '{}',
         'agent-payload:old', $3, 'rt-1') RETURNING id`,
      [tenantId, userId, isPrivate],
    );
    return String(inserted.rows[0]!.id);
  });
}

const resume = (jobId: string) =>
  createAgentApi().request(
    `/platform/v1/agent-jobs/${jobId}/resume?tenant=acme`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "continue" }),
    },
  );

const jobRow = async (jobId: string) =>
  (
    await pg.owner.query<{ status: string; prompt_reference: string }>(
      "SELECT status, prompt_reference FROM ai.agent_jobs WHERE id = $1",
      [jobId],
    )
  ).rows[0];

describe("POST /platform/v1/agent-jobs/:id/resume", () => {
  it("refuses to resume a private session job, as its owner, leaving it unchanged", async () => {
    const jobId = await endedSessionJob(true);
    const response = await resume(jobId);
    expect(response.status).toBe(409);
    expect(await jobRow(jobId)).toEqual({
      status: "cancelled",
      prompt_reference: "agent-payload:old",
    });
  });

  it("still resumes a job that is not private", async () => {
    const jobId = await endedSessionJob(false);
    const response = await resume(jobId);
    expect(response.status).toBe(202);
    expect((await jobRow(jobId))?.status).toBe("queued");
  });
});

describe("request bounds and content-free failures", () => {
  it("refuses an oversize resume body by streamed size, ignoring content-length", async () => {
    const jobId = await endedSessionJob(false);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"prompt":"'));
        controller.enqueue(new TextEncoder().encode("p".repeat(2_200_000)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    const response = await createAgentApi().request(
      `/platform/v1/agent-jobs/${jobId}/resume?tenant=acme`,
      {
        method: "POST",
        body: stream,
        duplex: "half",
        headers: { "content-length": "10" },
      } as RequestInit,
    );
    expect(response.status).toBe(413);
    expect((await jobRow(jobId))?.status).toBe("cancelled");
  });

  it("answers a failed resume with fixed text and logs no prompt", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const jobId = await endedSessionJob(true);
    const response = await createAgentApi().request(
      `/platform/v1/agent-jobs/${jobId}/resume?tenant=acme`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "SECRET-PROMPT-TEXT" }),
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Unable to resume job." });
    expect(JSON.stringify(logged.mock.calls)).not.toContain(
      "SECRET-PROMPT-TEXT",
    );
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("answers a failed job creation with fixed text", async () => {
    const response = await createAgentApi().request(
      "/platform/v1/agent-jobs?tenant=acme",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: "omnitech.interview",
          profileId: "coding-fast",
          prompt: "SECRET-PROMPT-TEXT",
        }),
      },
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain("SECRET-PROMPT-TEXT");
  });
});
