// The Active Session routes through Hono's app.request on a disposable
// PostgreSQL as the member role: start, ingest and stream end to end; the
// owner check answering a same-tenant other user exactly as an unknown id;
// one refusal for every bad ingest credential; the credential never accepted
// in a URL; bounds before parsing; membership re-checked; and control state
// carried on every acknowledgement (ADR-0011, ADR-0012).
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAiEngine } from "@omnitech/ai-engine";
import {
  liveCompanionCapabilityResponseSchema,
  liveSessionChoicesResponseSchema,
  liveSessionErrorBodySchema,
  liveSessionListResponseSchema,
  liveSessionResponseSchema,
  liveStreamResponseSchema,
} from "@omnitech/interview-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import { deriveLiveModel } from "../../frontend/studio/live/session-state";
import { createCoachContext } from "../coach/context";
import { readTranscript } from "../coach/transcript-file";
import { BRIEF, MATRIX, PREFERENCES } from "../context-pack/fixture";
import { createMemoryPackStore, packKey } from "../context-pack/prepare";
import { INTERVIEW_CONTEXT_RECIPE, KINDS } from "../context-pack/recipe";
import type { HeardLine } from "./ingest";
import {
  type Fixture,
  type Person,
  PNG_BYTES,
  pngOf,
  screenshot,
  startFixture,
  transcript,
} from "./live-session-fixture";
import { seedBriefingDraft, seedMatrixProfile } from "./processor-fixture";
import { createSessionRoutes } from "./routes";
import { createTranscriptRecordings } from "./transcript-recording";

let fx: Fixture;
let slug = "";
let otherSlug = "";
let acting: Person | null = null;
let permissions = ["interview.read", "interview.write"];
const emails = new Map<string, Person>();

beforeAll(async () => {
  fx = await startFixture();
  slug = String(
    (
      await fx.owner.query("SELECT slug FROM platform.tenants WHERE id=$1", [
        fx.tenantA,
      ])
    ).rows[0].slug,
  );
  otherSlug = String(
    (
      await fx.owner.query("SELECT slug FROM platform.tenants WHERE id=$1", [
        fx.tenantB,
      ])
    ).rows[0].slug,
  );
  for (const tenant of [fx.tenantA, fx.tenantB])
    await fx.owner.query(
      `INSERT INTO platform.product_installations(tenant_id,product_id,display_name,description,icon,configuration)
       VALUES($1,'omnitech.interview','Interview','Interview','sparkles','{}')`,
      [tenant],
    );
}, 120_000);
afterAll(() => fx?.stop());

// The signed-in member is whoever `acting` names; permissions let them write.
async function resolveContext(
  requested: string,
): Promise<PlatformContext | null> {
  const tenantId =
    requested === slug
      ? fx.tenantA
      : requested === otherSlug
        ? fx.tenantB
        : null;
  if (!acting || !tenantId) return null;
  return {
    user: {
      id: acting.id,
      email: "x@live.test",
      displayName: "x",
      avatarUrl: null,
    },
    tenant: { id: tenantId, slug: requested, name: "T" },
    membership: { tenantId, userId: acting.id, role: "member" },
    preferences: { theme: "system", locale: "en" },
    permissions,
    products: [{ productId: "omnitech.interview", enabled: true }],
  } as unknown as PlatformContext;
}

const routes = (
  limits?: Parameters<typeof createSessionRoutes>[0]["ingestLimits"],
) =>
  createSessionRoutes({
    database: fx.member,
    resolveContext,
    ...(limits ? { ingestLimits: limits } : {}),
  });
const app = () => routes();
const base = (forSlug = slug) =>
  `http://studio.test/api/interview/t/${forSlug}/sessions`;

async function member(name: string) {
  const person = await fx.provision(fx.tenantA, name);
  emails.set(person.id, person);
  return person;
}

const as = (person: Person | null) => {
  acting = person;
};
const post = (path: string, body: unknown, a = app()) =>
  a.request(`${base()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const get = (path: string, a = app()) => a.request(`${base()}${path}`);

const START = {
  processingPolicy: "permitted-remote",
  captureSources: ["microphone", "screen"],
};

async function begin(name: string) {
  const person = await member(name);
  as(person);
  const response = await post("", START);
  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    session: { id: string };
    credential: { value: string; expiresAt: string };
  };
  return { person, id: body.session.id, credential: body.credential.value };
}

const ingest = (
  credential: string | null,
  envelope: unknown,
  extra: {
    forSlug?: string;
    query?: string;
    a?: ReturnType<typeof app>;
    headers?: Record<string, string>;
  } = {},
) =>
  (extra.a ?? app()).request(
    `${base(extra.forSlug)}/ingest${extra.query ?? ""}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        ...extra.headers,
      },
      body: typeof envelope === "string" ? envelope : JSON.stringify(envelope),
    },
  );

describe("start, ingest and stream", () => {
  it("returns the credential once, accepts ingest under it alone and streams it to the owner", async () => {
    const owner = await begin("happy");
    // No user session is needed to ingest: the credential is the principal.
    as(null);
    const ack = await ingest(
      owner.credential,
      transcript("mic", 0, "hello there", "h-1"),
    );
    expect(ack.status).toBe(200);
    expect(await ack.json()).toMatchObject({
      status: "accepted",
      eventId: "h-1",
      control: { state: "active" },
    });

    as(owner.person);
    const read = await get(`/${owner.id}`);
    const readText = await read.text();
    expect(read.status).toBe(200);
    // The credential and its hash never come back from a read.
    expect(readText).not.toContain(owner.credential);
    expect(readText).not.toContain("credentialHash");

    const stream = await get(`/${owner.id}/stream`);
    const body = (await stream.json()) as {
      observations: Array<{ sequence: number; eventId: string }>;
      nextAfterSequence: number;
    };
    expect(body.observations.map((o) => o.eventId)).toEqual(["h-1"]);
    expect(body.nextAfterSequence).toBe(1);
    const next = (await (
      await get(`/${owner.id}/stream?afterSequence=1`)
    ).json()) as {
      observations: unknown[];
    };
    expect(next.observations).toEqual([]);
    expect((await get("/current")).status).toBe(200);
  });

  it("maps a second open session and bad input to fixed statuses", async () => {
    const owner = await begin("mapping");
    const again = await post("", START);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error: { code: "open_session_exists" },
    });
    // Identity in the body is refused by the strict schema.
    const smuggled = await post("", { ...START, ownerUserId: randomUUID() });
    expect(smuggled.status).toBe(400);
    expect(
      (await post(`/${owner.id}/control`, { action: "explode" })).status,
    ).toBe(400);
  });

  it("requires a signed-in member, and refuses a cross-site mutation", async () => {
    as(null);
    expect((await post("", START)).status).toBe(401);
    expect((await get("/current")).status).toBe(401);
    as(await member("csrf"));
    const response = await app().request(base(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify(START),
    });
    expect(response.status).toBe(403);
  });
});

describe("owner-checked reads and control", () => {
  it("answers a same-tenant other user exactly as an unknown session", async () => {
    const owner = await begin("owned");
    const shot = await app().request(`${base()}/ingest`, {
      method: "POST",
      headers: { authorization: `Bearer ${owner.credential}` },
      body: (() => {
        const form = new FormData();
        form.set(
          "envelope",
          JSON.stringify(
            screenshot("scr", 1, "image/png", PNG_BYTES.byteLength, "o-s1"),
          ),
        );
        form.set(
          "payload",
          new File([PNG_BYTES], "p.png", { type: "image/png" }),
        );
        return form;
      })(),
    });
    expect(shot.status).toBe(200);
    as(owner.person);
    const stream = (await (await get(`/${owner.id}/stream`)).json()) as {
      observations: Array<{ screenshotArtifactId: string | null }>;
    };
    const artifact = stream.observations[0]?.screenshotArtifactId as string;
    const download = await get(`/${owner.id}/screenshots/${artifact}`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    expect(download.headers.get("content-disposition")).toBe("attachment");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PNG_BYTES);

    const intruder = await member("intruder");
    as(intruder);
    const unknown = randomUUID();
    const probes: Array<[string, string, unknown?]> = [
      ["GET", ""],
      ["GET", "/stream"],
      ["GET", `/screenshots/${artifact}`],
      [
        "POST",
        "/control",
        { version: 1, kind: "session.control", action: "end" },
      ],
      ["POST", "/credential", {}],
      ["POST", "/policy", { processingPolicy: "device-only" }],
      ["DELETE", ""],
    ];
    for (const [method, path, body] of probes) {
      const run = async (id: string) =>
        app().request(`${base()}/${id}${path}`, {
          method,
          headers: { "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      const foreign = await run(owner.id);
      const missing = await run(unknown);
      expect([method + path, foreign.status, await foreign.text()]).toEqual([
        method + path,
        missing.status,
        await missing.text(),
      ]);
      expect(foreign.status).toBe(404);
    }
    // And the owner's session is untouched.
    as(owner.person);
    const still = (await (await get(`/${owner.id}`)).json()) as {
      session: { status: string };
    };
    expect(still.session.status).toBe("active");
  });

  it("pauses and ends on control, and every acknowledgement then carries the stop", async () => {
    const owner = await begin("control");
    const control = (action: string) =>
      post(`/${owner.id}/control`, {
        version: 1,
        kind: "session.control",
        action,
      });
    expect((await control("pause")).status).toBe(200);
    as(null);
    const paused = await ingest(
      owner.credential,
      transcript("mic", 0, "words", "c-1"),
    );
    expect(paused.status).toBe(409);
    expect(await paused.json()).toMatchObject({
      status: "refused",
      code: "session_paused",
      control: { state: "paused" },
    });
    as(owner.person);
    expect((await control("resume")).status).toBe(200);
    as(null);
    expect(
      (await ingest(owner.credential, transcript("mic", 0, "words", "c-1")))
        .status,
    ).toBe(200);
    as(owner.person);
    expect((await control("end")).status).toBe(200);
    as(null);
    const ended = await ingest(
      owner.credential,
      transcript("mic", 1, "words", "c-2"),
    );
    // Ending revokes the credential (ADR-0012), so the companion learns of
    // the end as the one credential refusal, which carries no control state.
    expect(ended.status).toBe(401);
    expect(await ended.json()).toMatchObject({ code: "credential_refused" });
  });

  it("renews the credential once, replacing the old one, and tightens locality only", async () => {
    const owner = await begin("renew");
    const renewed = (await (
      await post(`/${owner.id}/credential`, {})
    ).json()) as {
      credential: { value: string };
    };
    expect(renewed.credential.value).not.toBe(owner.credential);
    as(null);
    expect(
      (await ingest(owner.credential, transcript("mic", 0, "w", "r-1"))).status,
    ).toBe(401);
    expect(
      (await ingest(renewed.credential.value, transcript("mic", 0, "w", "r-1")))
        .status,
    ).toBe(200);
    as(owner.person);
    const tightened = await post(`/${owner.id}/policy`, {
      processingPolicy: "device-only",
    });
    expect(tightened.status).toBe(200);
    const loosened = await post(`/${owner.id}/policy`, {
      processingPolicy: "permitted-remote",
    });
    expect(loosened.status).toBe(409);
    expect(
      (
        await app().request(`${base()}/${owner.id}/credential`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(204);
  });
});

describe("ingest credential handling", () => {
  it("gives one identical refusal for unknown, expired, revoked, replaced, other-tenant and missing credentials", async () => {
    const live = await begin("refusals-live");
    const expired = await begin("refusals-expired");
    await fx.owner.query(
      "UPDATE interview.active_sessions SET credential_expires_at = now() - interval '1 minute' WHERE id=$1",
      [expired.id],
    );
    const revoked = await begin("refusals-revoked");
    as(revoked.person);
    await app().request(`${base()}/${revoked.id}/credential`, {
      method: "DELETE",
    });
    as(null);
    const envelope = transcript("mic", 0, "w", "x-1");
    const unknown = `asc_${"A".repeat(43)}`;
    const attempts = await Promise.all([
      ingest(unknown, envelope),
      ingest(expired.credential, envelope),
      ingest(revoked.credential, envelope),
      ingest(live.credential, envelope, { forSlug: otherSlug }),
      ingest(live.credential, envelope, { forSlug: "no-such-tenant" }),
      ingest(null, envelope),
      ingest("not-a-credential", envelope),
    ]);
    const seen = await Promise.all(
      attempts.map(async (r) => [r.status, await r.text()]),
    );
    expect(new Set(seen.map((s) => JSON.stringify(s))).size).toBe(1);
    expect(seen[0]?.[0]).toBe(401);
    for (const [, text] of seen) {
      expect(text).not.toContain(live.credential);
      expect(text).not.toContain("control");
    }
  });

  it("never accepts a credential in the URL", async () => {
    const owner = await begin("query");
    as(null);
    for (const query of [
      `?credential=${owner.credential}`,
      `?access_token=${owner.credential}`,
      "?x=1",
    ]) {
      const response = await ingest(
        owner.credential,
        transcript("mic", 0, "w", "q-1"),
        { query },
      );
      const text = await response.text();
      expect(response.status).toBe(400);
      expect(text).not.toContain(owner.credential);
    }
    // Without a header the query credential is not read at all.
    const bare = await app().request(`${base()}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(transcript("mic", 0, "w", "q-2")),
    });
    expect(bare.status).toBe(401);
  });

  it("refuses oversize bodies before parsing", async () => {
    const owner = await begin("oversize");
    as(null);
    const big = JSON.stringify(
      transcript("mic", 0, "x".repeat(40 * 1024), "big-1"),
    );
    const response = await ingest(owner.credential, big);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "envelope_too_large" });
    // A tiny limit proves the bound is the contract's, applied to the stream.
    const limited = routes({ maxEnvelopeBytes: 64 });
    const second = await ingest(
      owner.credential,
      transcript("mic", 0, "w", "big-2"),
      { a: limited },
    );
    expect(second.status).toBe(413);
    // Nothing was stored for either.
    const count = await fx.owner.query(
      "SELECT count(*)::int AS n FROM interview.session_observations WHERE session_id=$1",
      [owner.id],
    );
    expect(count.rows[0].n).toBe(0);
  });

  it("re-checks membership on every ingest and revokes the credential of a removed member", async () => {
    const owner = await begin("removed");
    as(null);
    expect(
      (await ingest(owner.credential, transcript("mic", 0, "w", "m-1"))).status,
    ).toBe(200);
    await fx.owner.query(
      "DELETE FROM platform.tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
      [fx.tenantA, owner.person.id],
    );
    const response = await ingest(
      owner.credential,
      transcript("mic", 1, "w", "m-2"),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      version: 1,
      status: "refused",
      code: "credential_refused",
    });
    const row = await fx.owner.query(
      "SELECT credential_revoked_at FROM interview.active_sessions WHERE id=$1",
      [owner.id],
    );
    expect(row.rows[0].credential_revoked_at).not.toBeNull();
  });

  it("does not run ingest for a tenant without the product installed", async () => {
    const owner = await begin("uninstalled");
    await fx.owner.query(
      "UPDATE platform.product_installations SET enabled=false WHERE tenant_id=$1",
      [fx.tenantA],
    );
    try {
      as(null);
      const response = await ingest(
        owner.credential,
        transcript("mic", 0, "w", "u-1"),
      );
      expect(response.status).toBe(401);
    } finally {
      await fx.owner.query(
        "UPDATE platform.product_installations SET enabled=true WHERE tenant_id=$1",
        [fx.tenantA],
      );
    }
  });
});

describe("owner stop actions and header scope", () => {
  it("lets a member without interview.write stop their own session but not start or resume one", async () => {
    const { person, id } = await begin("demoted");
    as(person);
    const control = (sessionId: string, action: string) =>
      post(`/${sessionId}/control`, {
        version: 1,
        kind: "session.control",
        action,
      });
    permissions = ["interview.read"];
    try {
      expect((await post("", START)).status).toBe(401);
      expect((await control(id, "pause")).status).toBe(200);
      expect((await control(id, "resume")).status).toBe(401);
      expect((await post(`/${id}/credential`, {})).status).toBe(401);
      const revoked = await app().request(`${base()}/${id}/credential`, {
        method: "DELETE",
      });
      expect(revoked.status).toBe(204);
      expect((await control(id, "end")).status).toBe(200);
      const deleted = await app().request(`${base()}/${id}`, {
        method: "DELETE",
      });
      expect(deleted.status).toBe(202);
    } finally {
      permissions = ["interview.read", "interview.write"];
    }
  });

  it("does not leak its headers onto a route mounted after it", async () => {
    const host = new Hono();
    host.route("/", routes());
    host.get("/unrelated", (c) =>
      c.text("ok", 200, { "Cache-Control": "public, max-age=60" }),
    );
    const response = await host.request("http://studio.test/unrelated");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("x-content-type-options")).toBeNull();
    as(await member("headers"));
    const own = await host.request(`${base()}/current`);
    expect(own.headers.get("cache-control")).toBe("no-store");
    expect(own.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

// ---- Studio Live view reads (PB-0002 dev loop 3) ---------------------------

const seedAction = (
  sessionId: string,
  owner: Person,
  taskId: string,
  ageSeconds: number,
) =>
  fx.owner.query(
    `INSERT INTO interview.session_actions(tenant_id,owner_user_id,session_id,task_id,task_revision,action_kind,fence_at_dispatch,created_at,updated_at)
     VALUES($1,$2,$3,$4,1,'draft-answer',1, now() - make_interval(secs => $5), now() - make_interval(secs => $5))
     RETURNING id`,
    [fx.tenantA, owner.id, sessionId, taskId, ageSeconds],
  );

type StreamBody = {
  actions: Array<{ id: string; dispatchStatus: string; updatedAt: string }>;
  nextActionCursor: string;
  hasMoreActions: boolean;
  hasMoreObservations: boolean;
  nextAfterSequence: number;
  serverNow: string;
};

describe("session history list", () => {
  it("lists the owner's sessions newest first in pages, with summaries only", async () => {
    const owner = await begin("history");
    // End the first so a second can open (one open session per owner).
    expect(
      (
        await post(`/${owner.id}/control`, {
          version: 1,
          kind: "session.control",
          action: "end",
        })
      ).status,
    ).toBe(200);
    const second = (await (await post("", START)).json()) as {
      session: { id: string };
    };
    as(owner.person);
    const first = await get("?limit=1");
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const page1 = (await first.json()) as {
      sessions: Array<Record<string, unknown>>;
      nextCursor: string | null;
    };
    expect(page1.sessions.map((s) => s["id"])).toEqual([second.session.id]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = (await (
      await get(`?limit=1&cursor=${encodeURIComponent(page1.nextCursor ?? "")}`)
    ).json()) as { sessions: Array<Record<string, unknown>>; nextCursor: null };
    expect(page2.sessions.map((s) => s["id"])).toEqual([owner.id]);
    expect(page2.nextCursor).toBeNull();
    expect(Object.keys(page2.sessions[0] ?? {}).sort()).toEqual(
      [
        "candidacyId",
        "createdAt",
        "endedAt",
        "id",
        "interviewId",
        "processingPolicy",
        "purged",
        "rehearsal",
        "retention",
        "shownDraftCount",
        "status",
      ].sort(),
    );
    expect(page2.sessions[0]).toMatchObject({ status: "ended" });
  });

  it("returns nothing of another same-tenant user's, and refuses a bad cursor and a non-member", async () => {
    const owner = await begin("history-owner");
    const other = await member("history-other");
    as(other);
    const empty = (await (await get("")).json()) as { sessions: unknown[] };
    expect(empty.sessions).toEqual([]);
    const text = await (await get("")).text();
    expect(text).not.toContain(owner.id);
    const bad = await get("?cursor=not-a-cursor");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: { code: "invalid_input" } });
    expect((await get("?limit=0")).status).toBe(400);
    as(null);
    expect((await get("")).status).toBe(401);
    expect((await get("/choices")).status).toBe(401);
  });

  it("keeps /current and /choices from being read as a session id", async () => {
    const owner = await begin("collide");
    as(owner.person);
    const current = (await (await get("/current")).json()) as {
      session: { id: string };
    };
    expect(current.session.id).toBe(owner.id);
    const choices = await get("/choices");
    expect(choices.status).toBe(200);
    expect(await choices.json()).toHaveProperty("candidacies");
  });
});

describe("stop-work control", () => {
  it("keeps the owner's session active, and refuses it once paused", async () => {
    const owner = await begin("stop-work-route");
    const control = (action: string) =>
      post(`/${owner.id}/control`, {
        version: 1,
        kind: "session.control",
        action,
      });
    const stopped = await control("stop-work");
    expect(stopped.status).toBe(200);
    expect(
      ((await stopped.json()) as { session: { status: string } }).session
        .status,
    ).toBe("active");
    expect((await control("pause")).status).toBe(200);
    const refused = await control("stop-work");
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: { code: "status_refused" } });
  });
});

describe("after a session ends", () => {
  it("answers current as not found, and the session by id as ended, then purging", async () => {
    const owner = await begin("ending");
    const control = (action: string) =>
      post(`/${owner.id}/control`, {
        version: 1,
        kind: "session.control",
        action,
      });
    expect((await control("end")).status).toBe(200);
    const current = await get("/current");
    expect(current.status).toBe(404);
    expect(await current.json()).toEqual({ error: { code: "not_found" } });
    const ended = (await (await get(`/${owner.id}`)).json()) as {
      session: { status: string };
    };
    expect(ended.session.status).toBe("ended");
    // An ended session cannot be resumed.
    const resumed = await control("resume");
    expect(resumed.status).toBe(409);
    expect(await resumed.json()).toEqual({ error: { code: "status_refused" } });
    const deleted = await app().request(`${base()}/${owner.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(202);
    expect(
      ((await deleted.json()) as { session: { status: string } }).session
        .status,
    ).toBe("purging");
    expect((await get("/current")).status).toBe(404);
  });
});

describe("browser contract", () => {
  it("is what every read and the error body actually return", async () => {
    const owner = await begin("contract");
    await seedAction(owner.id, owner.person, "contract-task", 10);
    as(owner.person);
    const json = async (path: string) => (await get(path)).json();
    expect(
      liveSessionListResponseSchema.safeParse(await json("")).success,
    ).toBe(true);
    expect(
      liveSessionChoicesResponseSchema.safeParse(await json("/choices"))
        .success,
    ).toBe(true);
    expect(
      liveSessionResponseSchema.safeParse(await json("/current")).success,
    ).toBe(true);
    expect(
      liveStreamResponseSchema.safeParse(await json(`/${owner.id}/stream`))
        .success,
    ).toBe(true);
    const missing = await get(`/${randomUUID()}`);
    expect(
      liveSessionErrorBodySchema.safeParse(await missing.json()).success,
    ).toBe(true);
  });
});

describe("session setup choices", () => {
  it("offers the owner's candidacies, interviews and approved profile revisions without matrix text", async () => {
    const owner = await member("chooser");
    const stranger = await member("chooser-other");
    await fx.owner.query(
      `UPDATE interview.candidate_profiles SET revision = 2 WHERE tenant_id=$1 AND actor_id=$2 AND id=$3`,
      [fx.tenantA, owner.id, owner.profile],
    );
    await fx.owner.query(
      `INSERT INTO interview.candidate_profile_revisions(tenant_id,actor_id,product_id,id,revision,name,sha256,matrix)
       VALUES($1,$2,'omnitech.interview',$3,2,'Profile v2',$4,$5::jsonb)`,
      [
        fx.tenantA,
        owner.id,
        owner.profile,
        "1".repeat(64),
        JSON.stringify({
          candidate: {},
          roles: [
            { company: "SecretCorp", title: "Lead" },
            { company: "OtherSecret", title: "Dev" },
          ],
        }),
      ],
    );
    as(owner);
    const response = await get("/choices");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain("SecretCorp");
    expect(text).not.toContain(stranger.candidacy);
    const body = JSON.parse(text) as {
      candidacies: Array<{
        id: string;
        title: string;
        interviews: Array<{ id: string; label: string }>;
      }>;
      profiles: Array<{
        profileId: string;
        revision: number;
        entryCount: number;
        latest: boolean;
      }>;
    };
    expect(body.candidacies.map((c) => c.id)).toEqual([owner.candidacy]);
    expect(body.candidacies[0]?.interviews.map((i) => i.id)).toEqual([
      owner.interview,
    ]);
    // Newest first; only revision 2 is the one a start would pin.
    expect(
      body.profiles.map((p) => [p.revision, p.latest, p.entryCount]),
    ).toEqual([
      [2, true, 2],
      [1, false, 0],
    ]);
    expect(body.profiles.every((p) => p.profileId === owner.profile)).toBe(
      true,
    );
  });

  it("offers a member nothing that belongs to someone else, and nothing without membership", async () => {
    const lonely = await fx.provision(fx.tenantA, "lonely");
    await fx.owner.query(
      "DELETE FROM interview.member_people WHERE tenant_id=$1 AND user_id=$2",
      [fx.tenantA, lonely.id],
    );
    as(lonely);
    const body = (await (await get("/choices")).json()) as {
      candidacies: unknown[];
    };
    expect(body.candidacies).toEqual([]);
    as(null);
    expect((await get("/choices")).status).toBe(401);
  });
});

describe("action cursor", () => {
  it("reads every action created or changed after a cursor, across pages, including an early row that settles late", async () => {
    const owner = await begin("cursor");
    // Five old rows, backdated so the caught-up overlap does not re-read them.
    const ids: string[] = [];
    for (const [index, age] of [5000, 4000, 3000, 2000, 1000].entries()) {
      const inserted = await seedAction(
        owner.id,
        owner.person,
        `t${index}`,
        age,
      );
      ids.push(String(inserted.rows[0].id));
    }
    as(owner.person);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const query = `?limit=2${cursor ? `&actionCursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = (await (
        await get(`/${owner.id}/stream${query}`)
      ).json()) as StreamBody;
      seen.push(...page.actions.map((a) => a.id));
      cursor = page.nextActionCursor;
      pages += 1;
      expect(Number.isNaN(Date.parse(page.serverNow))).toBe(false);
      if (!page.hasMoreActions) break;
    }
    expect(pages).toBe(3);
    expect(seen).toEqual(ids);

    // The earliest row settles after the cap-sized reads are done.
    await fx.owner.query(
      "UPDATE interview.session_actions SET dispatch_status='succeeded', result='{}'::jsonb WHERE id=$1",
      [ids[0]],
    );
    const after = (await (
      await get(
        `/${owner.id}/stream?limit=2&actionCursor=${encodeURIComponent(cursor ?? "")}`,
      )
    ).json()) as StreamBody;
    expect(after.actions.map((a) => [a.id, a.dispatchStatus])).toEqual([
      [ids[0], "succeeded"],
    ]);
    expect(after.hasMoreActions).toBe(false);
    // Nothing new: a caught-up reader re-reads only the last moments (the
    // overlap), so the settled row may repeat and nothing else appears.
    const quiet = (await (
      await get(
        `/${owner.id}/stream?actionCursor=${encodeURIComponent(after.nextActionCursor)}`,
      )
    ).json()) as StreamBody;
    expect(quiet.actions.every((a) => a.id === ids[0])).toBe(true);
  });

  it("restarts a caught-up reader from the overlap margin, never from the exact last row of a paged read", async () => {
    const owner = await begin("cursor-overlap");
    as(owner.person);
    // A cursor sitting at "now": the row a hasMore page ended on. A transaction
    // that started before it and commits after would be skipped by keeping it.
    const now = new Date().toISOString().replace("Z", "000Z");
    const held = Buffer.from(
      JSON.stringify([now, "00000000-0000-0000-0000-000000000001"]),
    ).toString("base64url");
    const page = (await (
      await get(`/${owner.id}/stream?actionCursor=${held}`)
    ).json()) as StreamBody;
    expect(page.hasMoreActions).toBe(false);
    const [next] = JSON.parse(
      Buffer.from(page.nextActionCursor, "base64url").toString("utf8"),
    ) as [string, string];
    expect(next < now).toBe(true);
  });

  it("still serves the existing parameters, reports observation paging and rejects a malformed cursor", async () => {
    const owner = await begin("cursor-compat");
    as(null);
    for (const sequence of [0, 1, 2])
      await ingest(
        owner.credential,
        transcript("mic", sequence, "w", `cc-${sequence}`),
      );
    as(owner.person);
    const page = (await (
      await get(`/${owner.id}/stream?afterSequence=2&limit=1`)
    ).json()) as StreamBody & { observations: Array<{ sequence: number }> };
    expect(page.observations.map((o) => o.sequence)).toEqual([3]);
    expect(page.nextAfterSequence).toBe(3);
    expect(page.hasMoreObservations).toBe(false);
    const more = (await (
      await get(`/${owner.id}/stream?limit=2`)
    ).json()) as StreamBody;
    expect(more.hasMoreObservations).toBe(true);
    const bad = await get(`/${owner.id}/stream?actionCursor=nope`);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: { code: "invalid_input" } });
  });

  it("answers another same-tenant user's stream with the unknown-session error, content-free", async () => {
    const owner = await begin("cursor-owner");
    await seedAction(owner.id, owner.person, "secret-task", 10);
    as(await member("cursor-intruder"));
    const response = await get(`/${owner.id}/stream?actionCursor=x`);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "not_found" } });
  });
});

// The Live view reads the stream exactly as the server stores it: this feeds a
// REAL stream page of every observation kind through the browser's derivation,
// so a mismatch between what ingest stores and what the parsers expect (an
// empty transcript, a revoked source shown as Receiving) cannot hide behind
// hand-written fixtures.
describe("the stream as the Live view reads it", () => {
  const signal = (
    kind: "source.disconnected" | "capture.gap",
    sourceId: string,
    sequence: number,
    eventId: string,
    content: Record<string, unknown>,
  ) => ({
    version: 1,
    kind,
    sourceId,
    eventId,
    occurredAt: "2026-10-03T10:00:00.000Z",
    sequence,
    content,
  });

  it("shows transcript rows, stats, lost permission and banners from stored observations", async () => {
    const owner = await begin("ui-stream");
    const shot = new FormData();
    shot.set(
      "envelope",
      JSON.stringify(
        screenshot("screen", 1, "image/png", PNG_BYTES.byteLength, "ui-s1"),
      ),
    );
    shot.set("payload", new File([PNG_BYTES], "p.png", { type: "image/png" }));
    expect(
      (
        await app().request(`${base()}/ingest`, {
          method: "POST",
          headers: { authorization: `Bearer ${owner.credential}` },
          body: shot,
        })
      ).status,
    ).toBe(200);
    for (const envelope of [
      transcript("microphone", 0, "A real question.", "ui-t1"),
      signal("capture.gap", "screen", 2, "ui-g1", {
        source: "screen",
        durationMs: 4000,
        reason: "source-interrupted",
      }),
      signal("source.disconnected", "microphone", 1, "ui-d1", {
        source: "microphone",
        reason: "permission-revoked",
      }),
    ])
      expect((await ingest(owner.credential, envelope)).status).toBe(200);

    as(owner.person);
    const page = liveStreamResponseSchema.parse(
      await (await get(`/${owner.id}/stream`)).json(),
    );
    const model = deriveLiveModel({
      session: page.session,
      observations: page.observations,
      actions: page.actions,
      serverClockOffsetMs: 0,
      nowMs: Date.parse(page.serverNow),
    });

    expect(
      model.transcript.map((row) =>
        row.type === "utterance" ? row.text : row.type,
      ),
    ).toEqual(["screenshot", "A real question.", "gap", "disconnect"]);
    const shotRow = model.transcript.find((row) => row.type === "screenshot");
    expect(shotRow).toMatchObject({
      type: "screenshot",
      windowLabel: "Shared window",
      artifactId: page.observations[0]?.screenshotArtifactId,
    });
    expect(shotRow?.type === "screenshot" && shotRow.artifactId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(model.stats).toMatchObject({
      utterances: 1,
      screenshots: 1,
      gaps: 1,
    });
    expect(model.sources.find((s) => s.source === "microphone")).toMatchObject({
      health: "lost-permission",
      lost: true,
    });
    expect(model.sources.find((s) => s.source === "screen")).toMatchObject({
      health: "gap",
    });
    expect(model.banners.map((b) => b.kind)).toEqual(
      expect.arrayContaining(["permission-revoked"]),
    );
  });
});

describe("companion capability and ingest hardening over HTTP", () => {
  const report = (locale = "en-US") => ({
    version: 1,
    kind: "capability.report",
    sourceId: "companion",
    sentAt: "2026-10-03T10:00:00.000Z",
    speech: {
      locale,
      onDeviceAvailable: true,
      recognizerAvailable: false,
      authorizationStatus: "authorized",
    },
    permissions: { microphone: "granted", screen: "not-determined" },
  });

  it("answers null before any report, then the member's own latest report", async () => {
    const owner = await begin("cap-owner");
    as(owner.person);
    const before = await get("/companion-capability");
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ capability: null });

    const ack = await ingest(owner.credential, report());
    expect(ack.status).toBe(200);
    expect(await ack.json()).toMatchObject({
      status: "accepted",
      eventId: "capability",
    });
    const after = await get("/companion-capability");
    const body = await after.json();
    expect(body).toEqual({
      capability: {
        reportedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        speech: {
          locale: "en-US",
          onDeviceAvailable: true,
          recognizerAvailable: false,
          authorizationStatus: "authorized",
        },
        permissions: { microphone: "granted", screen: "not-determined" },
        // No declaration headers on this report: an older companion.
        captureRequests: false,
      },
    });
    expect(liveCompanionCapabilityResponseSchema.safeParse(body).success).toBe(
      true,
    );
  });

  it("reads the companion's declaration headers and shows them in its own capability", async () => {
    const owner = await begin("cap-declared");
    as(owner.person);
    const ack = await ingest(owner.credential, report(), {
      headers: {
        "x-companion-features": "capture-request.v1",
        "x-companion-screen": "disp-1.3",
      },
    });
    expect(ack.status).toBe(200);
    const body = await (await get("/companion-capability")).json();
    expect(body.capability).toMatchObject({
      captureRequests: true,
      screenSelection: "disp-1.3",
    });
  });

  it("never shows one member's capability to another member, in or out of the tenant", async () => {
    const owner = await begin("cap-private");
    await ingest(owner.credential, report("de-DE"));
    const sameTenantOther = await member("cap-peer");
    as(sameTenantOther);
    expect(await (await get("/companion-capability")).json()).toEqual({
      capability: null,
    });
    // The owner reading under the OTHER tenant's scope sees nothing: the row is
    // bound to its own tenant as well as its owner.
    as(owner.person);
    const crossTenant = await app().request(
      `${base(otherSlug)}/companion-capability`,
    );
    expect(await crossTenant.json()).toEqual({ capability: null });
    as(null);
    expect((await get("/companion-capability")).status).toBe(401);
  });

  it("needs only interview.read, and is not read as a session id", async () => {
    const owner = await begin("cap-reader");
    await ingest(owner.credential, report());
    as(owner.person);
    permissions = ["interview.read"];
    try {
      const response = await get("/companion-capability");
      expect(response.status).toBe(200);
      expect(
        ((await response.json()) as { capability: unknown }).capability,
      ).not.toBeNull();
    } finally {
      permissions = ["interview.read", "interview.write"];
    }
  });

  it("answers a too-soon heartbeat 429 with Retry-After of the spacing and a changed resend 409", async () => {
    const owner = await begin("hb-http");
    const beat = {
      version: 1,
      kind: "heartbeat",
      sourceId: "companion",
      sentAt: "2026-10-03T10:00:00.000Z",
      capturing: true,
    };
    expect((await ingest(owner.credential, beat)).status).toBe(200);
    const tooSoon = await ingest(owner.credential, beat);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.headers.get("retry-after")).toBe("1");
    expect(await tooSoon.json()).toMatchObject({
      status: "refused",
      code: "rate_limited",
      control: { state: "active" },
    });

    const first = transcript("mic", 0, "first version", "http-c-1");
    expect((await ingest(owner.credential, first)).status).toBe(200);
    const changed = await ingest(
      owner.credential,
      transcript("mic", 0, "second version", "http-c-1"),
    );
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({
      status: "refused",
      code: "event_conflict",
    });
  });
});

describe("owner input route (ADR-0016)", () => {
  const input = (overrides: Record<string, unknown> = {}) => ({
    requestId: `r-${randomUUID().slice(0, 8)}`,
    operation: "follow-up",
    text: "and the cost?",
    snapshots: [],
    ...overrides,
  });

  it("accepts the owner's input with 202 and never echoes it on the stream", async () => {
    const owner = await begin("input-ok");
    as(null);
    await ingest(owner.credential, transcript("mic", 0, "hello", "i-1"));
    as(owner.person);
    const body = input();
    const response = await post(`/${owner.id}/input`, body);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      input: { requestId: body.requestId, sequence: 2 },
    });
    // A resend is acknowledged with the original.
    expect(await (await post(`/${owner.id}/input`, body)).json()).toEqual({
      input: { requestId: body.requestId, sequence: 2 },
    });
    // The owner's own words are not sent back down the stream.
    const stream = await get(`/${owner.id}/stream`);
    const text = await stream.text();
    expect(text).not.toContain("and the cost?");
    expect(text).not.toContain("owner.input");
  });

  it("needs a signed-in member with interview.write, same-origin, and the owner's own session", async () => {
    const owner = await begin("input-auth");
    as(null);
    expect((await post(`/${owner.id}/input`, input())).status).toBe(401);
    as(await member("input-other"));
    expect((await post(`/${owner.id}/input`, input())).status).toBe(404);
    as(owner.person);
    permissions = ["interview.read"];
    try {
      expect((await post(`/${owner.id}/input`, input())).status).toBe(401);
    } finally {
      permissions = ["interview.read", "interview.write"];
    }
    const crossSite = await app().request(`${base()}/${owner.id}/input`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify(input()),
    });
    expect(crossSite.status).toBe(403);
  });

  it("maps a bad body, an unknown snapshot and an ended session to fixed codes", async () => {
    const owner = await begin("input-errors");
    expect(
      (await post(`/${owner.id}/input`, { operation: "analyze" })).status,
    ).toBe(400);
    const unknown = await post(
      `/${owner.id}/input`,
      input({
        operation: "analyze",
        text: undefined,
        snapshots: [{ sourceId: "scr", eventId: "ghost" }],
      }),
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: { code: "invalid_input" } });
    await post(`/${owner.id}/control`, {
      version: 1,
      kind: "session.control",
      action: "end",
    });
    const ended = await post(`/${owner.id}/input`, input());
    expect(ended.status).toBe(409);
    expect(await ended.json()).toEqual({ error: { code: "status_refused" } });
  });
});

// What a session hears is told to whoever listens (the coach, a recording):
// a line the companion ingested, and a phrase the window's own microphone
// heard, each once, with whether the session may be processed off the device.
describe("what a session hears, told to a listener", () => {
  const phrase = (text = "and how would you roll that back") => ({
    requestId: `h-${randomUUID().slice(0, 8)}`,
    operation: "heard",
    text,
  });
  const listening = (onHeard: (line: HeardLine) => void) =>
    createSessionRoutes({ database: fx.member, resolveContext, onHeard });
  async function beginWith(name: string, processingPolicy: string) {
    const person = await member(name);
    as(person);
    const response = await post("", { ...START, processingPolicy });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      session: { id: string };
      credential: { value: string };
    };
    return { person, id: body.session.id, credential: body.credential.value };
  }

  it("tells a heard phrase once: its text, when, the session and its owner, that it may leave the device, and no speaker", async () => {
    const owner = await begin("heard-phrase");
    const heard: HeardLine[] = [];
    const a = listening((line) => heard.push(line));
    const body = phrase();
    const before = Date.now();
    const first = await post(`/${owner.id}/input`, body, a);
    expect(first.status).toBe(202);
    expect(heard).toEqual([
      {
        text: "and how would you roll that back",
        occurredAt: expect.any(String),
        session: {
          tenantId: fx.tenantA,
          actorId: owner.person.id,
          sessionId: owner.id,
        },
        remote: true,
      },
    ]);
    expect(heard[0]).not.toHaveProperty("source");
    const at = Date.parse(heard[0]?.occurredAt ?? "");
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
    // A resend with the same request id is acknowledged as the original and
    // tells no one again.
    const again = await post(`/${owner.id}/input`, body, a);
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual(await first.json());
    expect(heard).toHaveLength(1);
    // Another phrase is another line.
    await post(`/${owner.id}/input`, phrase("then the next phrase"), a);
    expect(heard.map((line) => line.text)).toEqual([
      "and how would you roll that back",
      "then the next phrase",
    ]);
  });

  it("marks a device-only session's phrase, and its ingested line, as not to leave the device", async () => {
    const owner = await beginWith("heard-device-only", "device-only");
    const heard: HeardLine[] = [];
    const a = listening((line) => heard.push(line));
    expect((await post(`/${owner.id}/input`, phrase(), a)).status).toBe(202);
    as(null);
    expect(
      (
        await ingest(
          owner.credential,
          transcript("mic", 0, "heard by the companion", "d-1"),
          { a },
        )
      ).status,
    ).toBe(200);
    expect(heard.map((line) => [line.text, line.remote])).toEqual([
      ["and how would you roll that back", false],
      ["heard by the companion", false],
    ]);
  });

  it("tells a line the companion ingested with the session's remote, through the same listener", async () => {
    const owner = await begin("heard-ingested");
    const heard: HeardLine[] = [];
    const a = listening((line) => heard.push(line));
    as(null);
    await ingest(owner.credential, transcript("mic", 0, "hello there", "i-1"), {
      a,
    });
    expect(heard).toEqual([
      expect.objectContaining({
        text: "hello there",
        remote: true,
        session: {
          tenantId: fx.tenantA,
          actorId: owner.person.id,
          sessionId: owner.id,
        },
      }),
    ]);
  });

  it("tells nothing for input that is not a heard phrase, or that was refused", async () => {
    const owner = await begin("heard-not");
    const heard: HeardLine[] = [];
    const a = listening((line) => heard.push(line));
    expect(
      (
        await post(
          `/${owner.id}/input`,
          {
            requestId: `r-${randomUUID().slice(0, 8)}`,
            operation: "follow-up",
            text: "and the cost?",
            snapshots: [],
          },
          a,
        )
      ).status,
    ).toBe(202);
    // A heard phrase with no text, and one with a field it may not carry.
    for (const bad of [
      { ...phrase(), text: "" },
      { ...phrase(), source: "microphone" },
    ])
      expect((await post(`/${owner.id}/input`, bad, a)).status).toBe(400);
    // Another member's session, then the owner's own once it has ended.
    const stranger = await member("heard-not-other");
    as(stranger);
    expect((await post(`/${owner.id}/input`, phrase(), a)).status).toBe(404);
    as(owner.person);
    await post(`/${owner.id}/control`, {
      version: 1,
      kind: "session.control",
      action: "end",
    });
    expect((await post(`/${owner.id}/input`, phrase(), a)).status).toBe(409);
    expect(heard).toEqual([]);
  });

  it("acknowledges the phrase whatever the listener does", async () => {
    const owner = await begin("heard-throws");
    let told = 0;
    const a = listening(() => {
      told += 1;
      throw new Error("the listener broke");
    });
    const body = phrase();
    const response = await post(`/${owner.id}/input`, body, a);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      input: { requestId: body.requestId },
    });
    expect(told).toBe(1);
  });

  it("answers as before with no listener", async () => {
    const owner = await begin("heard-nobody");
    expect((await post(`/${owner.id}/input`, phrase())).status).toBe(202);
  });
});

// What a capture shows, as the text read from it on the device: whoever
// coaches is told it, with the session and whether it may leave the device.
describe("what a capture shows, told to a listener", () => {
  type Screen = {
    text: string;
    session: { tenantId: string; actorId: string; sessionId: string };
    remote: boolean;
  };
  const read = (text: string) => ({ engine: "vision" as const, text });
  const watching = (onScreen: (screen: Screen) => void) =>
    createSessionRoutes({ database: fx.member, resolveContext, onScreen });
  // One capture as the window sends it: multipart, an image per `image`
  // field and the on-device text of the images as one JSON list.
  const capture = (
    sessionId: string,
    a: ReturnType<typeof app>,
    ocr?: unknown,
    images = 1,
  ) => {
    const form = new FormData();
    form.set("requestId", `c-${randomUUID().slice(0, 8)}`);
    form.set("operation", "analyze");
    for (let at = 0; at < images; at += 1)
      form.append(
        "image",
        new File([pngOf(640, 480, at) as BlobPart], `shot-${at}.png`, {
          type: "image/png",
        }),
      );
    if (ocr !== undefined) form.set("ocr", JSON.stringify(ocr));
    return a.request(`${base()}/${sessionId}/capture`, {
      method: "POST",
      body: form,
    });
  };
  async function beginWith(name: string, processingPolicy: string) {
    const person = await member(name);
    as(person);
    const response = await post("", { ...START, processingPolicy });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { session: { id: string } };
    return { person, id: body.session.id };
  }

  it("tells the text read from the capture's images, joined in order, with the session and that it may leave the device", async () => {
    const owner = await begin("screen-told");
    const told: Screen[] = [];
    const a = watching((screen) => told.push(screen));
    const response = await capture(
      owner.id,
      a,
      [
        read("def available_slots(day):"),
        read("FAILED test_slots.py::test_overlap"),
      ],
      2,
    );
    expect(response.status).toBe(202);
    expect(told).toEqual([
      {
        text: "def available_slots(day):\n\nFAILED test_slots.py::test_overlap",
        session: {
          tenantId: fx.tenantA,
          actorId: owner.person.id,
          sessionId: owner.id,
        },
        remote: true,
      },
    ]);
  });

  it("leaves out an image with no text read from it", async () => {
    const owner = await begin("screen-gaps");
    const told: Screen[] = [];
    const a = watching((screen) => told.push(screen));
    expect(
      (
        await capture(
          owner.id,
          a,
          [null, read("the only text on show"), read("")],
          3,
        )
      ).status,
    ).toBe(202);
    expect(told.map((screen) => screen.text)).toEqual([
      "the only text on show",
    ]);
  });

  it("tells nothing for a capture with no text: none sent, or none read from any image", async () => {
    const owner = await begin("screen-none");
    const told: Screen[] = [];
    const a = watching((screen) => told.push(screen));
    expect((await capture(owner.id, a)).status).toBe(202);
    expect((await capture(owner.id, a, [null])).status).toBe(202);
    expect((await capture(owner.id, a, [read("")])).status).toBe(202);
    expect(told).toEqual([]);
  });

  it("marks a device-only session's screen as not to leave the device", async () => {
    const owner = await beginWith("screen-device-only", "device-only");
    const told: Screen[] = [];
    const a = watching((screen) => told.push(screen));
    expect(
      (await capture(owner.id, a, [read("kept on this machine")])).status,
    ).toBe(202);
    expect(told.map((screen) => [screen.text, screen.remote])).toEqual([
      ["kept on this machine", false],
    ]);
  });

  it("tells nothing for a capture that was refused, or that is not the owner's", async () => {
    const owner = await begin("screen-refused");
    const told: Screen[] = [];
    const a = watching((screen) => told.push(screen));
    // No image, and a text list that is not one.
    expect(
      (await capture(owner.id, a, [read("text with no image")], 0)).status,
    ).toBe(400);
    expect((await capture(owner.id, a, [{ engine: "vision" }])).status).toBe(
      400,
    );
    const stranger = await member("screen-refused-other");
    as(stranger);
    expect(
      (await capture(owner.id, a, [read("another member's look")])).status,
    ).toBe(404);
    expect(told).toEqual([]);
  });

  it("accepts the capture whatever the listener does, and with no listener", async () => {
    const owner = await begin("screen-throws");
    let told = 0;
    const a = watching(() => {
      told += 1;
      throw new Error("the listener broke");
    });
    expect((await capture(owner.id, a, [read("on the screen")])).status).toBe(
      202,
    );
    expect(told).toBe(1);
    expect(
      (await capture(owner.id, app(), [read("on the screen")])).status,
    ).toBe(202);
  });
});

// The owner's own recording of what a session hears: off until asked for,
// the owner's alone, never started on an ended session, stopped by its end.
describe("the recording routes", () => {
  const directory = mkdtempSync(join(tmpdir(), "routes-recording-"));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  // Wired as the backend wires it: what is heard goes to the recorder.
  const recording = () => {
    const recordings = createTranscriptRecordings(directory);
    return {
      recordings,
      a: createSessionRoutes({
        database: fx.member,
        resolveContext,
        recordings,
        onHeard: (line) => recordings.heard(line),
      }),
    };
  };
  type Answer = {
    recording: {
      on: boolean;
      lines: number;
      file?: string;
      startedAt?: string;
    };
  };
  const state = async (response: Response) => {
    expect(response.status).toBe(200);
    return ((await response.json()) as Answer).recording;
  };
  const end = (id: string, a: ReturnType<typeof app>) =>
    post(
      `/${id}/control`,
      { version: 1, kind: "session.control", action: "end" },
      a,
    );

  it("is off until asked for, starts and stops on {on}, and counts what the session hears meanwhile", async () => {
    const owner = await begin("rec-happy");
    const { a } = recording();
    const path = `/${owner.id}/recording`;
    expect(await state(await get(path, a))).toEqual({ on: false, lines: 0 });
    // Heard before the press: not recorded.
    await post(
      `/${owner.id}/input`,
      {
        requestId: "h-before-01",
        operation: "heard",
        text: "before the press",
      },
      a,
    );
    const started = await state(await post(path, { on: true }, a));
    expect(started).toEqual({
      on: true,
      startedAt: expect.any(String),
      file: expect.stringMatching(
        new RegExp(`^[\\dT-]{23}-${owner.id.slice(0, 8)}\\.txt$`),
      ),
      lines: 0,
    });
    // A second press is the same recording.
    expect(await state(await post(path, { on: true }, a))).toEqual(started);
    await post(
      `/${owner.id}/input`,
      {
        requestId: "h-during-01",
        operation: "heard",
        text: "heard by the window",
      },
      a,
    );
    as(null);
    await ingest(
      owner.credential,
      {
        ...transcript("mic", 0, "heard by the companion", "rec-1"),
        content: {
          ...transcript("mic", 0, "heard by the companion", "rec-1").content,
          source: "microphone",
        },
      },
      { a },
    );
    as(owner.person);
    expect(await state(await get(path, a))).toEqual({ ...started, lines: 2 });
    const stopped = await state(await post(path, { on: false }, a));
    expect(stopped).toEqual({ on: false, file: started.file, lines: 2 });
    expect(await state(await get(path, a))).toEqual(stopped);
    // The file is one the replay reads: who and what, nothing from before.
    const blocks = readTranscript(
      readFileSync(join(directory, started.file as string), "utf8"),
    );
    expect(blocks.map((block) => [block.label, block.text])).toEqual([
      ["Heard", "heard by the window"],
      ["Me", "heard by the companion"],
    ]);
    // The answers carry the same no-store header as every session read.
    expect((await get(path, a)).headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["no body", undefined],
    ["an empty object", {}],
    ["a word for on", { on: "true" }],
    ["a number for on", { on: 1 }],
    ["null for on", { on: null }],
    ["null", null],
  ])(
    "requires {on: boolean}: %s is 400 invalid_input, and nothing starts",
    async (_name, body) => {
      const owner = await begin(`rec-bad-${randomUUID().slice(0, 6)}`);
      const { a, recordings } = recording();
      const response = await a.request(`${base()}/${owner.id}/recording`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "invalid_input" },
      });
      expect(recordings.state(owner.id)).toEqual({ on: false, lines: 0 });
    },
  );

  it("answers 404 when the routes were given no recorder, to read or to press", async () => {
    const owner = await begin("rec-none");
    const unknown = await get(`/${randomUUID()}`);
    const read = await get(`/${owner.id}/recording`);
    const press = await post(`/${owner.id}/recording`, { on: true });
    for (const response of [read, press]) {
      expect(response.status).toBe(404);
      expect(await response.clone().json()).toEqual(
        await unknown.clone().json(),
      );
    }
  });

  it("answers another member's session exactly as an unknown one, and leaves the owner's recording as it was", async () => {
    const owner = await begin("rec-owned");
    const { a, recordings } = recording();
    const started = await state(
      await post(`/${owner.id}/recording`, { on: true }, a),
    );
    as(await member("rec-other"));
    const unknownRead = await get(`/${randomUUID()}/recording`, a);
    const unknownPress = await post(
      `/${randomUUID()}/recording`,
      { on: false },
      a,
    );
    expect([unknownRead.status, unknownPress.status]).toEqual([404, 404]);
    const read = await get(`/${owner.id}/recording`, a);
    const stop = await post(`/${owner.id}/recording`, { on: false }, a);
    const start = await post(`/${owner.id}/recording`, { on: true }, a);
    for (const response of [read, stop, start]) {
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe(await unknownRead.clone().text());
      expect(text).not.toContain(started.file as string);
    }
    expect(recordings.state(owner.id)).toEqual(started);
    // Signed out: refused before anything is read.
    as(null);
    expect((await get(`/${owner.id}/recording`, a)).status).toBe(401);
    expect(
      (await post(`/${owner.id}/recording`, { on: false }, a)).status,
    ).toBe(401);
    expect(recordings.state(owner.id)).toEqual(started);
  });

  it("is stopped when the session is ended by its control, and not by a pause", async () => {
    const owner = await begin("rec-ended");
    const { a, recordings } = recording();
    const path = `/${owner.id}/recording`;
    const started = await state(await post(path, { on: true }, a));
    await post(
      `/${owner.id}/input`,
      { requestId: "h-ended-001", operation: "heard", text: "one line" },
      a,
    );
    expect(
      (
        await post(
          `/${owner.id}/control`,
          { version: 1, kind: "session.control", action: "pause" },
          a,
        )
      ).status,
    ).toBe(200);
    expect(recordings.state(owner.id).on).toBe(true);
    expect((await end(owner.id, a)).status).toBe(200);
    expect(recordings.state(owner.id)).toEqual({
      on: false,
      file: started.file,
      lines: 1,
    });
    expect(await state(await get(path, a))).toEqual({
      on: false,
      file: started.file,
      lines: 1,
    });
  });

  it("cannot be started on a session that has ended, and can still be read and stopped", async () => {
    const owner = await begin("rec-after-end");
    const { a, recordings } = recording();
    const path = `/${owner.id}/recording`;
    expect((await end(owner.id, a)).status).toBe(200);
    const refused = await post(path, { on: true }, a);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: { code: "invalid_input" } });
    expect(recordings.state(owner.id)).toEqual({ on: false, lines: 0 });
    expect(await state(await post(path, { on: false }, a))).toEqual({
      on: false,
      lines: 0,
    });
    expect(await state(await get(path, a))).toEqual({ on: false, lines: 0 });
  });

  it("an end without a recorder is the end it always was", async () => {
    const owner = await begin("rec-end-plain");
    expect((await end(owner.id, app())).status).toBe(200);
  });
});

describe("the projection view (ADR-0038)", () => {
  // An engine with a model behind it that must never be asked: the view is
  // prepared from structured material and resolved, and neither calls one.
  let modelCalls = 0;
  const engine = createAiEngine({
    profiles: [{ id: "never-asked", provider: "scripted" }],
    providers: {
      scripted: {
        // biome-ignore lint/correctness/useYield: it refuses before any chunk.
        async *stream() {
          modelCalls += 1;
          throw new Error("the projection view asked a model");
        },
      },
    },
  });
  const viewing = () =>
    createSessionRoutes({
      database: fx.member,
      resolveContext,
      contextEngine: engine,
    });
  const view = (id: string, query = "", a = viewing()) =>
    a.request(`${base()}/${id}/context${query}`);

  type View = {
    projection: string;
    spoken: string;
    terms: string;
    records: number;
    selected: Array<{
      id: string;
      pointer: string;
      text: string;
      kind: string;
      about: string;
      slot: string;
      exact: boolean;
      stage?: number;
    }>;
    excluded: Array<{
      id: string;
      text: string;
      slot: string;
      reason: string;
      stage?: number;
    }>;
    slots: Array<{ slot: string; state: string; count: number }>;
    digest: string;
    sources: Array<{ id: string; revision: string }>;
    stage?: { id: string; ordinal: number; label: string; kind: string } | null;
    stages?: Array<{ ordinal: number; label: string }>;
  };
  const viewOf = async (response: Response) => {
    expect(response.status).toBe(200);
    const body = (await response.json()) as { view: View };
    expect(Object.keys(body)).toEqual(["view"]);
    return body.view;
  };

  // A member whose session pins an invented matrix, a candidacy with a
  // cleaned employer brief, and a draft holding their preferences.
  async function prepared(name: string) {
    const person = await member(name);
    const profile = await seedMatrixProfile(fx, fx.tenantA, person.id, {
      matrix: MATRIX,
    });
    await fx.owner.query(
      "UPDATE interview.candidacies SET employer_brief = $1::jsonb WHERE id = $2",
      [JSON.stringify(BRIEF), person.candidacy],
    );
    const workspaceDraft = await seedBriefingDraft(
      fx,
      fx.tenantA,
      person.id,
      profile,
      { candidatePreferences: PREFERENCES },
      7,
    );
    as(person);
    const response = await post("", {
      ...START,
      candidacyId: person.candidacy,
      profile: { id: profile.id },
      workspaceDraft,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { session: { id: string } };
    return { person, id: body.session.id, profile };
  }

  it("is not there when the routes were given no engine to prepare with", async () => {
    const owner = await prepared("view-no-engine");
    const absent = await view(owner.id, "", app());
    expect(absent.status).toBe(404);
    expect(await absent.json()).toEqual({ error: { code: "not_found" } });
    expect(absent.headers.get("cache-control")).toBe("no-store");
    // Whatever is asked of it, and for a session that does not exist too.
    expect((await view(owner.id, "?projection=coach&q=Go", app())).status).toBe(
      404,
    );
    expect((await view(randomUUID(), "", app())).status).toBe(404);
  });

  it("answers another member's session exactly as an unknown one, and needs a signed-in member", async () => {
    const owner = await prepared("view-owned");
    as(await member("view-intruder"));
    const foreign = await view(owner.id, "?q=Have+you+used+Go");
    const missing = await view(randomUUID(), "?q=Have+you+used+Go");
    expect(foreign.status).toBe(404);
    const body = await foreign.text();
    expect([foreign.status, body]).toEqual([
      missing.status,
      await missing.text(),
    ]);
    expect(JSON.parse(body)).toEqual({ error: { code: "not_found" } });
    // Nothing of the owner's material rides along.
    for (const said of ["Mira", "Harbourline", "Larkspur", "salary"])
      expect(body).not.toContain(said);
    as(null);
    expect((await view(owner.id)).status).toBe(401);
    // A member of another tenant asking under their own tenant's address.
    const outsider = await fx.provision(fx.tenantB, "view-outsider");
    as(outsider);
    const elsewhere = await viewing().request(
      `${base(otherSlug)}/${owner.id}/context`,
    );
    expect(elsewhere.status).toBe(404);
    expect(await elsewhere.json()).toEqual({ error: { code: "not_found" } });
  });

  it("refuses a projection it does not have, before reading anything", async () => {
    const owner = await prepared("view-projection");
    for (const projection of ["everything", "", "Coach", "inspect,coach"]) {
      const refused = await view(
        owner.id,
        `?projection=${encodeURIComponent(projection)}`,
      );
      expect(refused.status, projection).toBe(400);
      expect(await refused.json(), projection).toEqual({
        error: { code: "invalid_input" },
      });
    }
    // The same answer for a session that is not there: the projection is
    // checked first, so it says nothing about the session.
    const unknown = await view(randomUUID(), "?projection=everything");
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: { code: "invalid_input" } });
  });

  it("answers a session id that is not one as an unknown session", async () => {
    await prepared("view-bad-id");
    const response = await view("not-a-uuid");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found" } });
  });

  // [DOMAIN] A session started for an interview knows its stage: that
  // stage's records lead, an earlier stage's follow, and the view says which
  // stage it was resolved for. Another stage can be asked for by its place.
  it("resolves for the stage the session was started for, and for another when asked", async () => {
    const person = await member("view-stage");
    const profile = await seedMatrixProfile(fx, fx.tenantA, person.id, {
      matrix: MATRIX,
    });
    await fx.owner.query(
      "UPDATE interview.interviews SET notes = $1 WHERE id = $2",
      ["Go: the first round's line on Go.", person.interview],
    );
    const second = await fx.one(
      `INSERT INTO interview.interviews(tenant_id,candidacy_id,ordinal,kind,label,notes)
       VALUES($1,$2,2,'technical','Round 2',$3) RETURNING id`,
      [fx.tenantA, person.candidacy, "Go: the second round's line on Go."],
    );
    as(person);
    const started = await post("", {
      ...START,
      candidacyId: person.candidacy,
      interviewId: second,
      profile: { id: profile.id },
    });
    expect(started.status).toBe(201);
    const id = ((await started.json()) as { session: { id: string } }).session
      .id;
    const ask = async (query: string) =>
      viewOf(
        await view(
          id,
          `?projection=inspect&q=${encodeURIComponent("Have you used Go?")}${query}`,
        ),
      );
    const prepOf = (seen: Awaited<ReturnType<typeof ask>>) =>
      seen.selected
        .filter((fact) => fact.slot === "prep")
        .map((fact) => [fact.stage, fact.text]);

    const own = await ask("");
    expect(own.stage).toEqual({
      id: second,
      ordinal: 2,
      label: "Round 2",
      kind: "technical",
    });
    expect(own.stages?.map((stage) => [stage.ordinal, stage.label])).toEqual([
      [1, "Round 1"],
      [2, "Round 2"],
    ]);
    expect(prepOf(own)).toEqual([
      [2, "Go: the second round's line on Go."],
      [1, "Go: the first round's line on Go."],
    ]);
    expect(own.digest).toMatch(/\+stage:2$/);
    expect(own.sources.slice(-2)).toEqual([
      {
        id: `stage:${person.interview}:notes`,
        revision: expect.stringMatching(/^[0-9a-f]{16}$/),
        kind: "candidate-notes",
        stage: 1,
        records: 1,
        sendable: true,
      },
      {
        id: `stage:${second}:notes`,
        revision: expect.stringMatching(/^[0-9a-f]{16}$/),
        kind: "candidate-notes",
        stage: 2,
        records: 1,
        sendable: true,
      },
    ]);

    // The first stage does not read the second's notes: left out, and said.
    const first = await ask("&stage=1");
    expect(first.stage).toMatchObject({ ordinal: 1 });
    expect(prepOf(first)).toEqual([[1, "Go: the first round's line on Go."]]);
    expect(
      first.excluded
        .filter((fact) => fact.reason === "scope")
        .map((fact) => [fact.stage, fact.slot, fact.text]),
    ).toEqual([[2, "prep", "Go: the second round's line on Go."]]);
    expect(first.records).toBe(own.records);

    // Every stage, none leading; a place the application does not have.
    const whole = await ask("&stage=all");
    expect(whole.stage).toBeNull();
    expect(
      prepOf(whole)
        .map(([stage]) => stage)
        .sort(),
    ).toEqual([1, 2]);
    expect((await ask("&stage=9")).stage).toBeNull();
    for (const bad of ["0", "-1", "1.5", "two"]) {
      const refused = await view(id, `?stage=${bad}`);
      expect(refused.status, bad).toBe(400);
      expect(await refused.json(), bad).toEqual({
        error: { code: "invalid_input" },
      });
    }
  });

  // [SAFETY] This route is the one reader of a pack that is the person's own
  // screen (`reader: "device"`). A call recorded under a device-only policy,
  // and what a model that runs here extracted from it, is shown here and is
  // given to no reader whose prompt leaves this machine: the coach reads the
  // same session and the same kept pack and is given none of it.
  it("shows a device-only transcript's question on the person's own screen, and the coach of the same session nothing of it", async () => {
    const person = await member("view-device-only");
    const profile = await seedMatrixProfile(fx, fx.tenantA, person.id, {
      matrix: MATRIX,
    });
    const second = await fx.one(
      `INSERT INTO interview.interviews(tenant_id,candidacy_id,ordinal,kind,label)
       VALUES($1,$2,2,'technical','Round 2') RETURNING id`,
      [fx.tenantA, person.candidacy],
    );
    // The first round, recorded on this device and kept on it.
    const said = "which team should own the tide ledger";
    const text = `10:02:10 --> 10:02:24\nDana: ${said}\n\n10:02:27 --> 10:02:40\nMe: the harbour team, it writes every row\n`;
    const sha256 = createHash("sha256").update(text).digest("hex");
    const transcript = await fx.one(
      `INSERT INTO interview.interview_transcripts(tenant_id,owner_user_id,interview_id,title,origin,capture_policy,content,content_sha256,chars,turns)
       VALUES($1,$2,$3,'Round 1 call','recorded','device-only',$4,$5,$6,2) RETURNING id`,
      [fx.tenantA, person.id, person.interview, text, sha256, text.length],
    );
    const sourceId = `stage:${person.interview}:transcript:${transcript}`;
    const revision = sha256.slice(0, 16);
    // The application's pack as a model that runs here prepared and kept it:
    // one question it read from that call.
    const QUESTION = "Which team should own the tide ledger?";
    const packs = createMemoryPackStore();
    await packs.save?.(
      { tenantId: fx.tenantA, productId: INTERVIEW_PRODUCT_ID },
      {
        key: packKey(person.candidacy, person.id),
        recipeId: INTERVIEW_CONTEXT_RECIPE.id,
      },
      {
        recipe: {
          id: INTERVIEW_CONTEXT_RECIPE.id,
          version: INTERVIEW_CONTEXT_RECIPE.version,
        },
        sources: [{ id: sourceId, revision }],
        records: [
          {
            id: `${sourceId}:0000000000000001`,
            kind: KINDS.asked,
            text: QUESTION,
            fields: { askedBy: "Dana" },
            source: {
              id: sourceId,
              revision,
              locator: "10:02:10-10:02:24",
              quote: said,
            },
            hash: "0000000000000001",
            by: "model",
            verified: "quote-found",
            themes: ["ownership", "ledger"],
            scope: "stage:1",
          },
        ],
        rejected: [],
        links: [],
      },
    );
    as(person);
    const started = await post("", {
      ...START,
      candidacyId: person.candidacy,
      interviewId: second,
      profile: { id: profile.id },
    });
    expect(started.status).toBe(201);
    const id = ((await started.json()) as { session: { id: string } }).session
      .id;
    const ASKED = "Who should own the tide ledger?";
    const query = `?projection=coach&q=${encodeURIComponent(ASKED)}`;
    const withPacks = createSessionRoutes({
      database: fx.member,
      resolveContext,
      contextEngine: engine,
      packs,
    });

    // The person's own screen: the question, and where it was said.
    const before = modelCalls;
    const shown = await viewOf(await view(id, query, withPacks));
    expect(
      shown.selected
        .filter((fact) => fact.slot === "asked")
        .map((fact) => [fact.text, fact.pointer]),
    ).toEqual([[QUESTION, `${sourceId}@10:02:10-10:02:24`]]);
    expect(shown.sources.find((source) => source.id === sourceId)).toEqual({
      id: sourceId,
      revision,
      kind: "transcript",
      stage: 1,
      records: 2,
      sendable: false,
    });
    expect(modelCalls).toBe(before);
    // With no pack kept the screen has the call's turns and no question.
    const bare = await viewOf(await view(id, query));
    expect(bare.selected.filter((fact) => fact.slot === "asked")).toEqual([]);
    expect(bare.sources.find((source) => source.id === sourceId)).toMatchObject(
      { sendable: false, records: 2 },
    );

    // The coach of the same session, reading the same kept pack: its prompt
    // is sent to a model that does not run here, so none of it is given.
    const facts = await createCoachContext(
      fx.member,
      engine,
      Date.now,
      packs,
    ).facts({ tenantId: fx.tenantA, actorId: person.id, sessionId: id }, ASKED);
    expect(facts.length).toBeGreaterThan(0);
    const given = JSON.stringify(facts).toLowerCase();
    for (const words of ["tide ledger", "harbour team", "10:02:10", sourceId])
      expect(given, words).not.toContain(words);
    // And the view did hold those words: the test would see them.
    expect(JSON.stringify(shown).toLowerCase()).toContain("tide ledger?");
    expect(modelCalls).toBe(before);
  });

  it("returns the view of the owner's material for a question, and asks no model", async () => {
    const owner = await prepared("view-ok");
    const before = modelCalls;
    const response = await view(
      owner.id,
      `?projection=inspect&q=${encodeURIComponent("Have you used Go?")}`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const seen = await viewOf(response);
    expect(Object.keys(seen).sort()).toEqual([
      "digest",
      "excluded",
      "projection",
      "records",
      "selected",
      "slots",
      "sources",
      "spoken",
      "stage",
      "stages",
      "terms",
    ]);
    expect(seen).toMatchObject({
      projection: "inspect",
      spoken: "Have you used Go?",
      terms: "go",
      digest: expect.stringMatching(/^[0-9a-f]{8,}$/),
      sources: [
        { id: `matrix:${owner.profile.id}`, revision: "1" },
        {
          id: `brief:${owner.person.candidacy}`,
          revision: expect.stringMatching(/^[0-9a-f]{16}$/),
        },
        { id: "preferences:draft", revision: "7" },
      ],
    });
    expect(seen.records).toBeGreaterThan(20);

    // What was selected: the exact fields, then the role that used Go.
    expect(
      seen.selected
        .filter((fact) => fact.exact)
        .map((fact) => [fact.slot, fact.text]),
    ).toEqual([
      ["candidate.name", "Mira Okonjo"],
      ["candidate.headline", "Platform engineer"],
      ["candidate.location", "Lisbon"],
      ["employer.company", "Larkspur Analytics"],
      ["employer.role", "Principal Engineer"],
    ]);
    const ranked = seen.selected.filter((fact) => !fact.exact);
    // An achievement is given whole: who, where, when and what.
    expect(ranked.map((fact) => fact.text)).toContain(
      "At Harbourline (2022 to 2025, Staff Engineer): Rewrote the berth scheduler in Go for the harbour pilots. Stack: Go, PostgreSQL, Kafka.",
    );
    for (const fact of ranked) {
      expect(fact.id).toMatch(/^role:harbourline:staff-engineer/);
      expect(fact.pointer).toMatch(/^\/roles\/0/);
      expect(fact.about).toBe("candidate");
    }
    // What was left out, each with its reason.
    expect(seen.excluded).toContainEqual({
      id: expect.stringMatching(/^role:tidewater-labs:engineer:proof_points:/),
      pointer: "/roles/2/proof_points/0",
      text: "At Tidewater Labs (Engineer): Shipped a Rails booking flow for ferry crews. Stack: Ruby, Rails.",
      kind: "candidate-achievement",
      about: "candidate",
      slot: "evidence",
      reason: "relevance",
    });
    for (const fact of seen.excluded)
      expect(fact.reason, fact.id).toMatch(/^[a-z-]+$/);
    // And what each slot came to.
    expect(seen.slots.map((slot) => slot.slot)).toEqual([
      "candidate.name",
      "candidate.headline",
      "candidate.location",
      "employer.company",
      "employer.role",
      "stories",
      "requirements",
      "prep",
      // What a stage's transcript gives, once a model has read one.
      "asked",
      "signals",
      // What the person answered and promised there (PackFlags.said).
      "answered",
      "commitments",
      // After the slots whose ties it follows.
      "evidence",
      "roles",
      "preferences",
      "employer",
    ]);
    // The role's five achievements: a metric its proof point states is
    // part of that proof point.
    expect(seen.slots).toContainEqual({
      slot: "evidence",
      state: "covered",
      count: 5,
    });
    expect(seen.slots).toContainEqual({
      slot: "preferences",
      state: "no-such-fact",
      count: 0,
    });
    expect(modelCalls).toBe(before);
  });

  it("inspects by default, selects by priority when nothing is asked, and reads each named projection", async () => {
    const owner = await prepared("view-defaults");
    const plain = await viewOf(await view(owner.id));
    expect(plain).toMatchObject({
      projection: "inspect",
      spoken: "",
      terms: "",
    });
    expect(plain.selected.length).toBeGreaterThan(10);

    const question = `&q=${encodeURIComponent("Which of these have you used in production: NestJS, Go, PostgreSQL?")}`;
    const digests = new Set<string>();
    const evidence: Record<string, number> = {};
    for (const projection of ["coach", "answer", "inspect"]) {
      const seen = await viewOf(
        await view(owner.id, `?projection=${projection}${question}`),
      );
      expect(seen.projection).toBe(projection);
      digests.add(seen.digest);
      evidence[projection] = seen.selected.filter(
        (fact) => fact.slot === "evidence",
      ).length;
      // The employer's requirement is there as the employer's, never the
      // candidate's.
      expect(
        seen.selected
          .filter((fact) => fact.slot === "requirements")
          .map((fact) => [fact.text, fact.about]),
      ).toContainEqual(["Five years of NestJS in production", "employer"]);
    }
    expect(digests.size).toBe(3);
    // The coach has four places for evidence and an answer six, over two
    // roles; the inspecting view shows all that bears on the question.
    expect(evidence).toEqual({ coach: 4, answer: 6, inspect: 8 });
  });

  it("gives the same view for the same question, and another for another", async () => {
    const owner = await prepared("view-digest");
    const ask = async (q: string) =>
      viewOf(
        await view(owner.id, `?projection=coach&q=${encodeURIComponent(q)}`),
      );
    const first = await ask("What are your salary expectations?");
    expect(await ask("What are your salary expectations?")).toEqual(first);
    expect(
      first.selected
        .filter((fact) => fact.slot === "preferences")
        .map((fact) => [fact.text, fact.about, fact.pointer]),
    ).toEqual([
      [
        "Base salary: 140k minimum.",
        "preference",
        "/context/candidatePreferences/0",
      ],
    ]);
    expect((await ask("What is your notice period?")).digest).not.toBe(
      first.digest,
    );
  });

  it("reads no more than the first 2,000 characters of what was asked", async () => {
    const owner = await prepared("view-long");
    const long = `${"x".repeat(1_998)} Go Rails`;
    const seen = await viewOf(
      await view(owner.id, `?q=${encodeURIComponent(long)}`),
    );
    expect(seen.spoken.length).toBe(2_000);
    expect(seen.spoken.endsWith(" G")).toBe(true);
    expect(seen.terms).not.toContain("rails");
  });

  it("needs only interview.read, and writes nothing", async () => {
    const owner = await prepared("view-read-only");
    const counts = async () =>
      (
        await fx.owner.query(
          `SELECT (SELECT count(*) FROM interview.session_observations WHERE session_id = $1) AS observations,
                  (SELECT count(*) FROM interview.session_actions WHERE session_id = $1) AS actions`,
          [owner.id],
        )
      ).rows[0];
    const before = await counts();
    permissions = ["interview.read"];
    try {
      expect((await view(owner.id, "?q=Go")).status).toBe(200);
    } finally {
      permissions = ["interview.read", "interview.write"];
    }
    expect(await counts()).toEqual(before);
  });

  it("gives an empty view for a session that pinned and linked nothing", async () => {
    const owner = await begin("view-empty");
    as(owner.person);
    const seen = await viewOf(await view(owner.id, "?q=Have+you+used+Go"));
    expect(seen).toMatchObject({
      projection: "inspect",
      spoken: "Have you used Go",
      terms: "go",
      records: 0,
      selected: [],
      excluded: [],
      sources: [],
    });
    expect(seen.slots.every((slot) => slot.count === 0)).toBe(true);
    expect(seen.slots.find((slot) => slot.slot === "candidate.name")).toEqual({
      slot: "candidate.name",
      state: "known-empty",
      count: 0,
    });
  });

  it("answers a pinned profile that no longer verifies with a code alone", async () => {
    // The fixture's own profile revision holds a matrix that is not one.
    const person = await member("view-unverified");
    as(person);
    const started = await post("", {
      ...START,
      profile: { id: person.profile },
    });
    expect(started.status).toBe(201);
    const { session } = (await started.json()) as { session: { id: string } };
    const response = await view(session.id, "?q=Go");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "invalid_input" } });
  });

  it("still answers once the session has ended", async () => {
    const owner = await prepared("view-ended");
    await post(`/${owner.id}/control`, {
      version: 1,
      kind: "session.control",
      action: "end",
    });
    const response = await view(owner.id, "?q=Go");
    // The material is still the owner's to inspect after the interview.
    expect((await viewOf(response)).selected.length).toBeGreaterThan(5);
  });
});
