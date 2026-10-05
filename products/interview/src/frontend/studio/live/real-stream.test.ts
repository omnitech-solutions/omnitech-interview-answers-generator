// @vitest-environment node
// REQUIRED: the Live view reads what the real backend stores. A stream page and
// a capability report are produced through the real routes over a disposable
// PostgreSQL (the loop-3 routes harness: Hono app.request, the member role,
// forced row security), read back by the browser's own SessionClient, and fed to
// the real derivations. No hand-written fixture stands in for the server, so an
// envelope or shape drift (loop 3's F1: stored content is {occurredAt,
// sourceSequence, body}, not the wire shape) cannot hide here.
import {
  liveCompanionCapabilitySchema,
  liveStreamResponseSchema,
} from "@omnitech/interview-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Fixture,
  type Person,
  startFixture,
  transcript,
} from "../../../backend/live-session/live-session-fixture";
import { createSessionRoutes } from "../../../backend/live-session/routes";
import {
  capabilityAdvisories,
  permissionLines,
  speechState,
} from "./companion-capability";
import { sourceChips, stateView } from "./session-bar-model";
import { createSessionClient } from "./session-client";
import { deriveLiveModel } from "./session-state";

let fx: Fixture;
let slug = "";
let app: Hono;
let acting: Person | null = null;

beforeAll(async () => {
  fx = await startFixture();
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
  app = createSessionRoutes({
    database: fx.member,
    resolveContext: async (requested: string) =>
      acting && requested === slug
        ? ({
            user: {
              id: acting.id,
              email: "x@live.test",
              displayName: "x",
              avatarUrl: null,
            },
            tenant: { id: fx.tenantA, slug, name: "T" },
            membership: {
              tenantId: fx.tenantA,
              userId: acting.id,
              role: "member",
            },
            preferences: { theme: "system", locale: "en" },
            permissions: ["interview.read", "interview.write"],
            products: [{ productId: "omnitech.interview", enabled: true }],
          } as unknown as PlatformContext)
        : null,
  }) as unknown as Hono;
}, 120_000);
afterAll(() => fx?.stop());

const base = () => `/api/interview/t/${slug}/sessions`;
// The browser's own client, over the real routes.
const client = () =>
  createSessionClient(slug, async (url, init) =>
    app.request(`http://studio.test${url}`, init),
  );

async function begin(name: string) {
  acting = await fx.provision(fx.tenantA, name);
  const started = await client().start({
    processingPolicy: "device-only",
    captureSources: ["microphone", "application-audio", "screen"],
  });
  return { id: started.session.id, credential: started.credential.value };
}

const ingest = (credential: string, envelope: unknown) =>
  app.request(`http://studio.test${base()}/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credential}`,
    },
    body: JSON.stringify(envelope),
  });

const report = (
  speech: Partial<{
    locale: string;
    onDeviceAvailable: boolean;
    recognizerAvailable: boolean;
    authorizationStatus: string;
  }> = {},
  permissions: Partial<{ microphone: string; screen: string }> = {},
) => ({
  version: 1,
  kind: "capability.report",
  sourceId: "companion",
  sentAt: "2026-10-03T10:00:00.000Z",
  speech: {
    locale: "en-GB",
    onDeviceAvailable: true,
    recognizerAvailable: true,
    authorizationStatus: "authorized",
    ...speech,
  },
  permissions: { microphone: "granted", screen: "granted", ...permissions },
});

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

// What the Live view derives from the stream the client really reads.
async function modelOf(sessionId: string) {
  const page = await client().stream(sessionId);
  // The client already parsed it; parse the raw route answer too, so a client
  // that ever loosened its schema could not hide a drift.
  expect(
    liveStreamResponseSchema.safeParse(
      await (
        await app.request(`http://studio.test${base()}/${sessionId}/stream`)
      ).json(),
    ).success,
  ).toBe(true);
  return deriveLiveModel({
    session: page.session,
    observations: page.observations,
    actions: page.actions,
    serverClockOffsetMs: 0,
    nowMs: Date.parse(page.serverNow),
  });
}

describe("a real stream page through the Live view's derivations", () => {
  it("derives the transcript, a revoked microphone and a lost screen from stored observations", async () => {
    const owner = await begin("stream-a");
    for (const envelope of [
      transcript("microphone", 0, "Tell me about a migration.", "rs-t1"),
      transcript("application-audio", 0, "And what went wrong?", "rs-t2"),
      signal("source.disconnected", "microphone", 1, "rs-d1", {
        source: "microphone",
        reason: "permission-revoked",
      }),
      signal("source.disconnected", "screen", 0, "rs-d2", {
        source: "screen",
        reason: "device-lost",
      }),
    ])
      expect((await ingest(owner.credential, envelope)).status).toBe(200);

    const model = await modelOf(owner.id);
    expect(
      model.transcript.flatMap((row) =>
        row.type === "utterance" ? [row.text] : [],
      ),
    ).toEqual(["Tell me about a migration.", "And what went wrong?"]);
    expect(model.sources.find((s) => s.source === "microphone")).toMatchObject({
      health: "lost-permission",
      lost: true,
    });
    expect(model.sources.find((s) => s.source === "screen")).toMatchObject({
      health: "lost",
      lost: true,
    });
    // The bar, from the same real data: revoked permission outranks a lost
    // source, and the lost screen's chip says so.
    expect(stateView(model).key).toBe("permission-revoked");
    expect(
      sourceChips(model).find((chip) => chip.source === "screen")?.state,
    ).toMatch(/capture lost/);
    // Never "listening" for a source that is gone.
    expect(model.barState).toBe("source-lost");
  });
});

describe("a real capability report through the client and the screen state", () => {
  it("answers null before any report, and the screens say nothing is known", async () => {
    await begin("cap-none");
    const capability = await client().companionCapability();
    expect(capability).toBeNull();
    expect(speechState(capability).key).toBe("no-report");
    expect(capabilityAdvisories(capability)).toEqual([]);
  });

  const cases = [
    {
      name: "ready",
      envelope: report(),
      key: "ready",
      blocked: false,
    },
    {
      name: "speech unavailable on this Mac",
      envelope: report({ onDeviceAvailable: false, locale: "en-GB" }),
      key: "on-device-unavailable",
      blocked: true,
    },
    {
      name: "speech denied",
      envelope: report({ authorizationStatus: "denied" }),
      key: "denied",
      blocked: true,
    },
    {
      name: "speech restricted",
      envelope: report({ authorizationStatus: "restricted" }),
      key: "denied",
      blocked: true,
    },
    {
      name: "recognizer down",
      envelope: report({ recognizerAvailable: false }),
      key: "recognizer-unavailable",
      blocked: true,
    },
  ] as const;

  it.each(cases)(
    "$name: the route's report drives the screen state",
    async ({ envelope, key, blocked }) => {
      const owner = await begin(`cap-${key}`);
      expect((await ingest(owner.credential, envelope)).status).toBe(200);
      const capability = await client().companionCapability();
      // The shape the client parsed is the contract's, not a looser one.
      expect(liveCompanionCapabilitySchema.safeParse(capability).success).toBe(
        true,
      );
      expect(capability?.speech.locale).toBe("en-GB");
      expect(speechState(capability).key).toBe(key);
      expect(capabilityAdvisories(capability).length > 0).toBe(blocked);
    },
  );

  it("carries the permission states the companion reported", async () => {
    const owner = await begin("cap-perms");
    expect(
      (
        await ingest(
          owner.credential,
          report({}, { microphone: "denied", screen: "not-determined" }),
        )
      ).status,
    ).toBe(200);
    const capability = await client().companionCapability();
    expect(
      permissionLines(capability).map((line) => [line.source, line.state]),
    ).toEqual([
      ["microphone", "denied"],
      ["screen", "not-determined"],
    ]);
  });

  it("a report-driven state and a stream-driven state meet in one session", async () => {
    const owner = await begin("cap-and-stream");
    await ingest(owner.credential, report({ onDeviceAvailable: false }));
    await ingest(
      owner.credential,
      signal("source.disconnected", "microphone", 0, "cs-d1", {
        source: "microphone",
        reason: "permission-revoked",
      }),
    );
    const model = await modelOf(owner.id);
    const capability = await client().companionCapability();
    // The speech state is the companion's own report; the permission state is
    // the stream's. Neither is derived from the other, and neither says Live.
    expect(speechState(capability).blocksSpeech).toBe(true);
    expect(stateView(model).key).toBe("permission-revoked");
  });

  it("is private to the member: another member of the same workspace reads null", async () => {
    const owner = await begin("cap-owner");
    await ingest(owner.credential, report({ onDeviceAvailable: false }));
    expect(await client().companionCapability()).not.toBeNull();
    acting = await fx.provision(fx.tenantA, "cap-peer");
    expect(await client().companionCapability()).toBeNull();
  });
});
