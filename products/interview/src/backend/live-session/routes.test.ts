// The Active Session routes through Hono's app.request on a disposable
// PostgreSQL as the member role: start, ingest and stream end to end; the
// owner check answering a same-tenant other user exactly as an unknown id;
// one refusal for every bad ingest credential; the credential never accepted
// in a URL; bounds before parsing; membership re-checked; and control state
// carried on every acknowledgement (ADR-0011, ADR-0012).
import { randomUUID } from "node:crypto";
import type { PlatformContext } from "@omnitech/platform-contracts";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Fixture,
  type Person,
  PNG_BYTES,
  screenshot,
  startFixture,
  transcript,
} from "./live-session-fixture.js";
import { createSessionRoutes } from "./routes.js";

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
  extra: { forSlug?: string; query?: string; a?: ReturnType<typeof app> } = {},
) =>
  (extra.a ?? app()).request(
    `${base(extra.forSlug)}/ingest${extra.query ?? ""}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
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
