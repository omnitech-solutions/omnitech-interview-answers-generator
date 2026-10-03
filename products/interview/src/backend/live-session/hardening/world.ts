// Shared test support for the operational hardening suites (PB-0002 slice 3).
// A world is a disposable PostgreSQL migrated to head, the REAL Hono session
// routes over the member role, and a way to attach a fixture companion whose
// fetch is `app.request`, so every companion message crosses the real ingest
// route, the real credential check and the real stores. Tests, not production
// code, import this.
import { liveStreamResponseSchema } from "@omnitech/interview-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import type { CaptureSource } from "@omnitech/active-session-contracts";
import { deriveLiveModel } from "../../../frontend/studio/live/session-state.js";
import {
  type Fixture,
  type Person,
  startFixture,
} from "../live-session-fixture.js";
import { createSessionRoutes } from "../routes.js";

// The fixture companion arrives as an argument: only TEST files may import
// @omnitech/capture-companion/fixture (scripts/package-boundaries.test.ts), so
// every suite imports it and hands the module in. The types flow from it.
export type CompanionKit = {
  createFixtureCompanion: (options: any) => { companion: any; capture: any };
  VirtualClock: new (startMs?: number) => any;
};
type CompanionOf<K extends CompanionKit> = ReturnType<
  K["createFixtureCompanion"]
>;
type CompanionOptions<K extends CompanionKit> = Parameters<
  K["createFixtureCompanion"]
>[0];

export type Started = {
  person: Person;
  id: string;
  credential: string;
  scope: { tenantId: string; actorId: string };
};

export type StartBody = {
  processingPolicy: "device-only" | "permitted-remote";
  captureSources: readonly CaptureSource[];
  retention?: "delete-at-end" | "thirty-days" | "until-deleted";
  [key: string]: unknown;
};

export const DEFAULT_START: StartBody = {
  processingPolicy: "permitted-remote",
  captureSources: ["microphone", "application-audio"],
};

export type World<K extends CompanionKit = CompanionKit> = {
  fx: Fixture;
  slug: string;
  app: ReturnType<typeof createSessionRoutes>;
  base: string;
  // Who the signed-in member is for the user routes (null: nobody).
  as(person: Person | null): void;
  // Starts a session for a new member (by name) or an existing one.
  begin(who: string | Person, body?: StartBody): Promise<Started>;
  get(path: string): Promise<Response>;
  send(path: string, body?: unknown, method?: string): Promise<Response>;
  // The owner's stream page, parsed with the browser contract.
  page(
    started: Started,
    query?: string,
  ): Promise<ReturnType<typeof liveStreamResponseSchema.parse>>;
  // The Live view's model from a REAL stream page.
  model(started: Started): Promise<ReturnType<typeof deriveLiveModel>>;
  // A fixture companion whose transport is the real routes.
  companion(
    started: Started,
    options?: Partial<
      Pick<
        CompanionOptions<K>,
        "sources" | "probeCapability" | "outboxCapacity" | "maxScreenshots"
      >
    > & {
      clock?: InstanceType<K["VirtualClock"]>;
      fetch?: CompanionOptions<K>["fetch"];
    },
  ): {
    companion: CompanionOf<K>["companion"];
    capture: CompanionOf<K>["capture"];
    clock: InstanceType<K["VirtualClock"]>;
    // Starts the companion (capability report, first heartbeat) and lets the
    // virtual clock pass Studio's heartbeat spacing, which answers a heartbeat
    // sent right behind the report with 429 Retry-After 1.
    open(): Promise<void>;
  };
  stop(): Promise<void>;
};

export async function startWorld<K extends CompanionKit>(
  kit: K,
  ingestLimits?: Parameters<typeof createSessionRoutes>[0]["ingestLimits"],
): Promise<World<K>> {
  const fx = await startFixture();
  const slug = String(
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
  let acting: Person | null = null;
  const resolveContext = async (
    requested: string,
  ): Promise<PlatformContext | null> => {
    if (!acting || requested !== slug) return null;
    return {
      user: {
        id: acting.id,
        email: "x@live.test",
        displayName: "x",
        avatarUrl: null,
      },
      tenant: { id: fx.tenantA, slug, name: "T" },
      membership: { tenantId: fx.tenantA, userId: acting.id, role: "member" },
      preferences: { theme: "system", locale: "en" },
      permissions: ["interview.read", "interview.write"],
      products: [{ productId: "omnitech.interview", enabled: true }],
    } as unknown as PlatformContext;
  };
  const app = createSessionRoutes({
    database: fx.member,
    resolveContext,
    ...(ingestLimits ? { ingestLimits } : {}),
  });
  const base = `http://studio.test/api/interview/t/${slug}/sessions`;
  const world: World<K> = {
    fx,
    slug,
    app,
    base,
    as(person) {
      acting = person;
    },
    get: async (path) => await app.request(`${base}${path}`),
    send: async (path, body = {}, method = "POST") =>
      await app.request(`${base}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "DELETE" ? {} : { body: JSON.stringify(body) }),
      }),
    async begin(who, body = DEFAULT_START) {
      const person =
        typeof who === "string" ? await fx.provision(fx.tenantA, who) : who;
      acting = person;
      const response = await world.send("", body);
      if (response.status !== 201)
        throw new Error(`start refused: ${response.status}`);
      const started = (await response.json()) as {
        session: { id: string };
        credential: { value: string };
      };
      return {
        person,
        id: started.session.id,
        credential: started.credential.value,
        scope: { tenantId: fx.tenantA, actorId: person.id },
      };
    },
    async page(started, query = "") {
      acting = started.person;
      return liveStreamResponseSchema.parse(
        await (await world.get(`/${started.id}/stream${query}`)).json(),
      );
    },
    async model(started) {
      const page = await world.page(started);
      return deriveLiveModel({
        session: page.session,
        observations: page.observations,
        actions: page.actions,
        serverClockOffsetMs: 0,
        nowMs: Date.parse(page.serverNow),
      });
    },
    companion(started, options = {}) {
      const clock = options.clock ?? new kit.VirtualClock(Date.now());
      const { companion, capture } = kit.createFixtureCompanion({
        baseUrl: "http://studio.test",
        tenantSlug: slug,
        credential: started.credential,
        fetch:
          options.fetch ??
          (async (url: string, init: RequestInit) =>
            await app.request(url, init)),
        clock,
        ...(options.sources ? { sources: options.sources } : {}),
        ...(options.probeCapability
          ? { probeCapability: options.probeCapability }
          : {}),
        ...(options.outboxCapacity
          ? { outboxCapacity: options.outboxCapacity }
          : {}),
        ...(options.maxScreenshots
          ? { maxScreenshots: options.maxScreenshots }
          : {}),
      });
      return {
        companion,
        capture,
        clock,
        async open() {
          await companion.start();
          await clock.advance(1_500);
          await companion.flush();
        },
      };
    },
    stop: () => fx.stop(),
  };
  return world;
}
