// Owner capture and analyze on a disposable PostgreSQL as the member role
// (requires Docker, like the other session suites): the owner's browser image
// is stored like a companion screenshot under the reserved owner-capture
// source, analysed by an `owner.input` in one transaction, deduped on the
// request id, exempt from the capture caps, refused by the wire, and deleted
// by the purge. Also the route (multipart) and the shared hint fields of the
// typed follow-up.
import { createHash, randomUUID } from "node:crypto";
import {
  ACTIVE_SESSION_LIMITS,
  type Acknowledgement,
} from "@omnitech/active-session-contracts";
import {
  LIVE_OWNER_LANGUAGES,
  LIVE_OWNER_SKILLS,
  liveOwnerCaptureResponseSchema,
} from "@omnitech/interview-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OWNER_CAPTURE_SOURCE_ID } from "../db/live-session.js";
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

// A header-valid PNG of the given size (the loader reads dimensions only).
export function pngOf(width: number, height: number, salt = 0): Uint8Array {
  const bytes = new Uint8Array(33 + salt);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}
const IMAGE = pngOf(640, 480);

let fx: Fixture;
let repo: ActiveSessionRepository;
let tenant = "";
let slug = "";
let acting: Person | null = null;
const scopeOf = (person: Person) => ({ tenantId: tenant, actorId: person.id });

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

async function begin(name: string) {
  const person = await fx.provision(tenant, name);
  const started = await repo.startSession(scopeOf(person), {
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
  });
  return {
    person,
    scope: scopeOf(person),
    id: started.session.id,
    credential: started.credential.value,
  };
}
type World = Awaited<ReturnType<typeof begin>>;

const rows = async (sessionId: string, extra = "") =>
  (
    await fx.owner.query(
      `SELECT * FROM interview.session_observations WHERE session_id=$1 ${extra} ORDER BY sequence`,
      [sessionId],
    )
  ).rows;
const artifacts = async (sessionId: string) =>
  (
    await fx.owner.query(
      `SELECT * FROM platform.artifacts WHERE metadata->>'session_id'=$1`,
      [sessionId],
    )
  ).rows;
const capture = (
  world: World,
  fields: Record<string, unknown> = {},
  image: Uint8Array = IMAGE,
) =>
  repo.submitOwnerCapture(
    world.scope,
    world.id,
    { requestId: "c-1", operation: "analyze", ...fields },
    image,
  );
const refused = async (promise: Promise<unknown>) => {
  await expect(promise).rejects.toMatchObject({ code: "invalid_input" });
};

describe("the hint enums", () => {
  it("offer nine skills and the one supported-language list the stages import", () => {
    expect(LIVE_OWNER_LANGUAGES).toEqual(["typescript", "react"]);
    expect(LIVE_OWNER_SKILLS).toHaveLength(9);
  });
});

describe("storing a capture", () => {
  it("stores the image, a snapshot under the owner-capture source and the analyze input in order", async () => {
    const world = await begin("store");
    const ack = await capture(world, {
      skill: "dsa",
      language: "typescript",
      label: "Chrome · region",
      targetTaskId: undefined,
    });
    expect(ack).toEqual({
      input: { requestId: "c-1", sequence: 2 },
      snapshot: { sourceId: OWNER_CAPTURE_SOURCE_ID, eventId: "c-1" },
    });
    const stored = await rows(world.id);
    expect(
      stored.map((r) => [Number(r.sequence), r.kind, r.source_id]),
    ).toEqual([
      [1, "screen.snapshot", OWNER_CAPTURE_SOURCE_ID],
      [2, "owner.input", "studio.owner-input"],
    ]);
    expect(stored[0].content.body).toEqual({
      payloadRef: "c-1",
      mediaType: "image/png",
      byteLength: IMAGE.byteLength,
      windowLabel: "Chrome · region",
    });
    expect(stored[1].content.body).toEqual({
      operation: "analyze",
      skill: "dsa",
      language: "typescript",
      snapshots: [{ sourceId: OWNER_CAPTURE_SOURCE_ID, eventId: "c-1" }],
    });
    // The artifact is the companion kind: private, session-bound, with digest.
    const [artifact] = await artifacts(world.id);
    expect(artifact.id).toBe(stored[0].screenshot_artifact_id);
    expect(artifact.metadata).toMatchObject({
      session_id: world.id,
      media_type: "image/png",
      sha256: createHash("sha256").update(IMAGE).digest("hex"),
    });
  });

  it("attaches to a task and dedups on the request id", async () => {
    const world = await begin("dedup");
    const fields = { targetTaskId: "t.1", targetRevision: 2, skill: "devops" };
    const first = await capture(world, fields);
    const again = await capture(world, fields);
    expect(again).toEqual(first);
    expect(await rows(world.id)).toHaveLength(2);
    expect(
      (await rows(world.id, "AND kind='owner.input'"))[0].content.body.target,
    ).toEqual({ taskId: "t.1", revision: 2 });
    // Different content under the same id is refused; the original stays.
    await refused(capture(world, fields, pngOf(641, 480)));
    await refused(capture(world, { ...fields, skill: "dsa" }));
    await refused(capture(world, { ...fields, label: "other" }));
    await refused(capture(world, { skill: "devops" }));
    expect(await rows(world.id)).toHaveLength(2);
  });

  it("refuses every bad image or field with one invalid_input and stores nothing", async () => {
    const world = await begin("refuse");
    const webpHuge = new Uint8Array(40);
    webpHuge.set([0x52, 0x49, 0x46, 0x46], 0);
    webpHuge.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8);
    webpHuge.set([0xff, 0xff, 0x7f], 24);
    const cases: Array<Promise<unknown>> = [
      capture(world, {}, new TextEncoder().encode("<svg onload=1/>")),
      capture(world, {}, new Uint8Array()),
      capture(world, {}, PNG_BYTES),
      capture(world, {}, pngOf(9_000, 100)),
      capture(world, {}, pngOf(8_000, 8_000)),
      capture(world, {}, webpHuge),
      capture(
        world,
        {},
        pngOf(10, 10, ACTIVE_SESSION_LIMITS.maxScreenshotBytes),
      ),
      capture(world, { language: "php" }),
      capture(world, { skill: "cooking" }),
      capture(world, { label: "x".repeat(81) }),
      capture(world, { label: "bad\u0007label" }),
      capture(world, { operation: "follow-up" }),
      capture(world, { requestId: "bad id!" }),
      capture(world, { requestId: "r".repeat(65) }),
      capture(world, { targetTaskId: "t.1" }),
      capture(world, { targetRevision: 1 }),
      capture(world, { extra: "x" }),
    ];
    for (const attempt of cases) await refused(attempt);
    expect(await rows(world.id)).toHaveLength(0);
    expect(await artifacts(world.id)).toHaveLength(0);
  });

  it("answers an unknown or foreign session as not_found and an ended one as status_refused", async () => {
    const owner = await begin("status-owner");
    const other = await begin("status-other");
    await expect(
      repo.submitOwnerCapture(
        other.scope,
        owner.id,
        { requestId: "c-1", operation: "analyze" },
        IMAGE,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await repo.controlSession(owner.scope, owner.id, "end");
    await expect(capture(owner)).rejects.toMatchObject({
      code: "status_refused",
    });
  });
});

describe("the owner-capture source is the owner route's alone", () => {
  it("is refused as a wire source id and stores nothing", async () => {
    const world = await begin("wire");
    const ack: Acknowledgement = await ingestObservation(
      fx.member,
      world.credential,
      tenant,
      {
        ...screenshot("scr", 0, "image/png", PNG_BYTES.byteLength, "w-1"),
        sourceId: OWNER_CAPTURE_SOURCE_ID,
      },
      { payload: PNG_BYTES },
    );
    expect(ack).toMatchObject({
      status: "refused",
      code: "invalid_observation",
      issues: [{ path: ["sourceId"], code: "invalid_value" }],
    });
    expect(await rows(world.id)).toHaveLength(0);
    // The owner's capture with that event id still stores.
    await capture(world, {});
  });

  it("is paired by the database with a stored screen snapshot", async () => {
    const world = await begin("check");
    const insert = (kind: string, artifact: string | null) =>
      fx.owner.query(
        `INSERT INTO interview.session_observations
           (tenant_id, owner_user_id, session_id, source_id, event_id, sequence, kind, content, ack, screenshot_artifact_id)
         VALUES ($1,$2,$3,$4,'e-pair',900,$5,'{}','{}',$6)`,
        [
          tenant,
          world.person.id,
          world.id,
          OWNER_CAPTURE_SOURCE_ID,
          kind,
          artifact,
        ],
      );
    await expect(insert("transcript.final", null)).rejects.toThrow(
      /session_observations_owner_capture_check/,
    );
    await expect(insert("screen.snapshot", null)).rejects.toThrow(
      /session_observations_owner_capture_check/,
    );
  });

  it("is exempt from the capture caps and rate counters", async () => {
    const world = await begin("caps");
    await capture(world, {});
    await capture(world, { requestId: "c-2" });
    const ack = await ingestObservation(
      fx.member,
      world.credential,
      tenant,
      screenshot("scr", 0, "image/png", PNG_BYTES.byteLength, "cap-1"),
      {
        payload: PNG_BYTES,
        limits: {
          maxScreenshotsPerSession: 1,
          maxObservationsPerSession: 1,
          maxIngestPerMinute: 1,
        },
      },
    );
    expect(ack.status).toBe("accepted");
  });
});

describe("retention and the vision locality gate", () => {
  it("accepts a capture in a device-only session and the purge deletes the artifact", async () => {
    const person = await fx.provision(tenant, "purge");
    const started = await repo.startSession(scopeOf(person), {
      processingPolicy: "device-only",
      captureSources: ["microphone", "screen"],
    });
    const world: World = {
      person,
      scope: scopeOf(person),
      id: started.session.id,
      credential: started.credential.value,
    };
    await capture(world, { label: "canary-label" });
    const [artifact] = await artifacts(world.id);
    const result = await purgeSession(
      fx.member,
      { tenantId: tenant, ownerUserId: person.id, sessionId: world.id },
      { waitMs: 0, pollMs: 1, sleep: async () => {}, trigger: "owner-delete" },
    );
    expect(result.outcome).toBe("complete");
    expect(await rows(world.id)).toHaveLength(0);
    expect(await artifacts(world.id)).toHaveLength(0);
    const payloads = await fx.owner.query(
      "SELECT 1 FROM platform.artifact_payloads WHERE tenant_id=$1 AND artifact_id=$2",
      [tenant, artifact.id],
    );
    expect(payloads.rows).toHaveLength(0);
  });
});

describe("the typed follow-up shares the hint fields", () => {
  it("stores skill and language on the owner.input and refuses unknown values", async () => {
    const world = await begin("followup");
    await repo.submitOwnerInput(world.scope, world.id, {
      requestId: "f-1",
      operation: "follow-up",
      text: "and the cost?",
      skill: "system-design",
      language: "react",
      snapshots: [],
    });
    const [row] = await rows(world.id, "AND kind='owner.input'");
    expect(row.content.body).toMatchObject({
      skill: "system-design",
      language: "react",
    });
    for (const bad of [{ language: "ruby" }, { skill: "x" }])
      await refused(
        repo.submitOwnerInput(world.scope, world.id, {
          requestId: "f-2",
          operation: "follow-up",
          text: "q",
          snapshots: [],
          ...bad,
        }),
      );
  });
});

describe("POST .../capture", () => {
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
  const url = (id: string) =>
    `http://studio.test/api/interview/t/${slug}/sessions/${id}/capture`;
  const form = (
    fields: Record<string, string>,
    image: Uint8Array | null = IMAGE,
    mime = "image/png",
  ) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    if (image)
      body.set("image", new File([image as BlobPart], "c.png", { type: mime }));
    return body;
  };
  const send = (
    id: string,
    body: FormData | string,
    headers: Record<string, string> = {},
  ) => app().request(url(id), { method: "POST", headers, body });

  it("accepts a browser-style multipart body whose boundary is mixed case", async () => {
    // Chrome's boundary is mixed case (`----WebKitFormBoundary…`) and boundaries
    // are case-sensitive: the route must hand the header to the parser as sent.
    const world = await begin("route-boundary");
    acting = world.person;
    const boundary = "----WebKitFormBoundaryAbCdEfGh123XyZ";
    const encoder = new TextEncoder();
    const parts: Uint8Array[] = [];
    const text = (name: string, value: string) =>
      parts.push(
        encoder.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        ),
      );
    text("requestId", "rt-boundary");
    text("operation", "analyze");
    parts.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="capture.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      IMAGE,
      encoder.encode(`\r\n--${boundary}--\r\n`),
    );
    const bytes = new Uint8Array(
      parts.reduce((total, part) => total + part.byteLength, 0),
    );
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    const response = await app().request(url(world.id), {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: bytes,
    });
    expect(response.status).toBe(202);
  });

  it("accepts a multipart capture with 202 and the ack with the snapshot", async () => {
    const world = await begin("route");
    acting = world.person;
    const response = await send(
      world.id,
      form({
        requestId: "rt-1",
        operation: "analyze",
        skill: "dsa",
        language: "react",
        label: "Chrome · region",
      }),
    );
    expect(response.status).toBe(202);
    const body = liveOwnerCaptureResponseSchema.parse(await response.json());
    expect(body).toEqual({
      input: { requestId: "rt-1", sequence: 2 },
      snapshot: { sourceId: OWNER_CAPTURE_SOURCE_ID, eventId: "rt-1" },
    });
    const again = await send(
      world.id,
      form({
        requestId: "rt-1",
        operation: "analyze",
        skill: "dsa",
        language: "react",
        label: "Chrome · region",
      }),
    );
    expect(await again.json()).toEqual(body);
    // The stream shows the snapshot (so the owner can see it) but not the input.
    const stream = (await (
      await app().request(
        `http://studio.test/api/interview/t/${slug}/sessions/${world.id}/stream`,
      )
    ).json()) as { observations: Array<{ kind: string; sourceId: string }> };
    expect(stream.observations.map((o) => o.kind)).toEqual(["screen.snapshot"]);
  });

  it("refuses with one invalid_input: wrong media type, missing image, bad field, oversize body", async () => {
    const world = await begin("route-bad");
    acting = world.person;
    const fixed = { error: { code: "invalid_input" } };
    for (const body of [
      form({ requestId: "b-1", operation: "analyze" }, null),
      form(
        { requestId: "b-2", operation: "analyze" },
        new TextEncoder().encode("<svg/>"),
        "image/svg+xml",
      ),
      form({ requestId: "b-3", operation: "analyze", language: "php" }),
      form({ requestId: "b-4", operation: "analyze", extra: "1" }),
      form({
        requestId: "b-5",
        operation: "analyze",
        targetRevision: "abc",
        targetTaskId: "t",
      }),
    ]) {
      const response = await send(world.id, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(fixed);
    }
    const json = await send(world.id, JSON.stringify({}), {
      "content-type": "application/json",
    });
    expect(json.status).toBe(400);
    const huge = await send(
      world.id,
      form(
        { requestId: "b-6", operation: "analyze" },
        new Uint8Array(ACTIVE_SESSION_LIMITS.maxScreenshotBytes + 64 * 1024),
      ),
    );
    expect(huge.status).toBe(400);
    expect(await huge.json()).toEqual(fixed);
    expect(await rows(world.id)).toHaveLength(0);
  });

  it("requires owner, write permission and same origin", async () => {
    const world = await begin("route-auth");
    const intruder = await fx.provision(tenant, "route-intruder");
    const good = () => form({ requestId: "a-1", operation: "analyze" });
    acting = intruder;
    expect((await send(world.id, good())).status).toBe(404);
    acting = null;
    expect((await send(world.id, good())).status).toBe(401);
    acting = world.person;
    expect(
      (await send(world.id, good(), { "sec-fetch-site": "cross-site" })).status,
    ).toBe(403);
    expect((await send(randomUUID(), good())).status).toBe(404);
    expect(await rows(world.id)).toHaveLength(0);
  });
});
