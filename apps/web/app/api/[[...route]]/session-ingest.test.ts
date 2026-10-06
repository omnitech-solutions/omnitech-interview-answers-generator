// @vitest-environment node
// ADR-0011 / ADR-0012: the capture companion's ingest route is reached through
// the shell with a credential alone (no sign-in session), every other session
// route needs tenant membership first (ADR-0004), and the shell adds nothing
// that would reject or reshape a credential-only request.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getPlatformDatabase } from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  grantApplicationRole,
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

// No sign-in session at all: the companion has no cookie.
vi.mock("@/auth", () => ({ auth: async () => null }));

const storageRoot = fileURLToPath(
  new URL("../../../../../packages/platform-storage", import.meta.url),
);

const REFUSED = {
  version: expect.any(Number),
  status: "refused",
  code: "credential_refused",
};

let pg: DisposablePostgres;
let handlers: typeof import("./route");
// unstubEnvs undoes stubs after every test, so this runs before each one (and
// once in beforeAll, before the route module is imported).
function stubEnvironment() {
  vi.stubEnv("DATABASE_URL", pg.memberUrl);
  // Real sign-in rules: no fake local owner stands in for the missing session.
  vi.stubEnv("FAKE_AUTH_ENABLED", "false");
  vi.stubEnv("AGENT_PAYLOAD_SECRET", "agent-payload-secret-of-32-chars!");
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
}
beforeEach(stubEnvironment);
beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await grantApplicationRole(pg.owner);
  await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "src/bootstrap.ts"],
    { cwd: storageRoot, env: { ...process.env, DATABASE_URL: pg.memberUrl } },
  );
  stubEnvironment();
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

const base = (slug = "local") => `/api/interview/t/${slug}/sessions`;
const envelope = JSON.stringify({ version: 1, kind: "transcript.final" });

// What the companion sends: no cookie, a non-browser User-Agent, no Origin.
function companion(
  path: string,
  init: { headers?: Record<string, string>; body?: BodyInit } = {},
) {
  return handlers.POST(
    new Request(`http://studio.test${path}`, {
      method: "POST",
      headers: {
        "user-agent": "OmnitechCaptureCompanion/1",
        "content-type": "application/json",
        ...init.headers,
      },
      body: init.body ?? envelope,
    }),
  );
}

describe("the capture companion's ingest route", () => {
  it("reaches the ingest handler with a credential alone and refuses an unknown credential", async () => {
    const response = await companion(`${base()}/ingest`, {
      headers: { authorization: "Bearer not-a-real-credential" },
    });
    // The ingest handler's own acknowledgement, not the shell's or the
    // studio catch-all's: it was forwarded without a user session.
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(REFUSED);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a missing credential, a wrong scheme and an unknown tenant with the same body", async () => {
    const bodies = [];
    for (const [slug, headers] of [
      ["local", {}],
      ["local", { authorization: "Basic abc" }],
      ["no-such-tenant", { authorization: "Bearer not-a-real-credential" }],
    ] as const) {
      const response = await companion(`${base(slug)}/ingest`, { headers });
      expect(response.status).toBe(401);
      bodies.push(await response.json());
    }
    expect(bodies).toEqual([REFUSED, REFUSED, REFUSED]);
  });

  it("does not honour a tenant or user identity in the body", async () => {
    const response = await companion(`${base()}/ingest`, {
      body: JSON.stringify({
        tenantId: "00000000-0000-4000-8000-000000000002",
        actorId: "00000000-0000-4000-8000-000000000001",
      }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(REFUSED);
  });

  it("never honours a credential in the query string", async () => {
    const response = await companion(
      `${base()}/ingest?credential=not-a-real-credential`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "query_not_allowed" },
    });
  });

  it("accepts a multipart body without a browser origin and still refuses an unknown credential", async () => {
    const form = new FormData();
    form.set("envelope", envelope);
    form.set("payload", new File([new Uint8Array(4)], "shot.png"));
    const response = await handlers.POST(
      new Request(`http://studio.test${base()}/ingest`, {
        method: "POST",
        headers: { authorization: "Bearer not-a-real-credential" },
        body: form,
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(REFUSED);
  });
});

describe("the user-session routes under the same prefix", () => {
  it("refuse a request with no membership before any domain work", async () => {
    const current = await handlers.GET(
      new Request(`http://studio.test${base()}/current`),
    );
    expect(current.status).toBe(401);
    expect(await current.json()).toEqual({ error: { code: "unauthorized" } });

    const other = await handlers.GET(
      new Request(`http://studio.test${base("other")}/current`),
    );
    expect(other.status).toBe(401);
  });

  it("do not let a credential header or a body-named identity stand in for a session", async () => {
    for (const path of [base(), `${base()}/current`]) {
      const response = await handlers.POST(
        new Request(`http://studio.test${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer not-a-real-credential",
          },
          body: JSON.stringify({
            tenantId: "00000000-0000-4000-8000-000000000002",
            actorId: "00000000-0000-4000-8000-000000000001",
          }),
        }),
      );
      expect([401, 404, 405]).toContain(response.status);
    }
    // The start route in particular is membership-first.
    const start = await handlers.POST(
      new Request(`http://studio.test${base()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: "x", actorId: "y" }),
      }),
    );
    expect(start.status).toBe(401);
  });
});
