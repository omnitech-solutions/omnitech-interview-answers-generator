// An application's context pack over HTTP, end to end: a real PostgreSQL
// (migrated to head, the application's own NOSUPERUSER NOBYPASSRLS role), the
// documents API's real guard, the real AI engine with a SCRIPTED model behind
// one profile, and the engine's own store for prepared packs. The fixture's
// application is stored through the brief's routes, then its pack is
// reviewed, prepared, corrected and prepared again as its owner, and asked
// for as another member, as a read-only member and from another workspace.
// Then what a briefing and a document read of it. Every name and figure is
// invented.
import type { ModelPort, PreparedStore } from "@omnitech/ai-engine";
import {
  createPlatformDatabase,
  type PlatformDatabase,
} from "@omnitech/database";
import { migrateDatabase } from "@omnitech/database/migrate";
import {
  type DisposablePostgres,
  startDisposablePostgres,
} from "@omnitech/database/test-support";
import {
  type PackProgress,
  type PackReview,
  packProgressSchema,
  packReviewSchema,
} from "@omnitech/interview-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDocumentsApi, resolveDocumentsScope } from "../documents/api";
import { createApplicationPacks } from "./application";
import {
  BENCH_PROFILE,
  readPreparedFixture,
  type ScriptedModel,
  scriptedEngine,
  scriptedModel,
} from "./bench-prepared";
import { createMemoryPackStore, loadKeptPack } from "./prepare";
import { KINDS } from "./recipe";

const fixture = readPreparedFixture("kestrel-freight-pay");

let pg: DisposablePostgres;
let database: PlatformDatabase;
const ids = { tenant: "", elsewhere: "", owner: "", other: "", outsider: "" };
const made = {
  candidacy: "",
  first: "",
  second: "",
  empty: "",
  transcript: "",
};

const url = "http://studio.test/api/interview/documents";
function context(
  tenant: { id: string; slug: string },
  actorId: string,
  permissions: string[],
): PlatformContext {
  return {
    user: {
      id: actorId,
      email: `${actorId}@example.invalid`,
      displayName: "Member",
      avatarUrl: null,
    },
    tenant: { ...tenant, name: tenant.slug },
    membership: { tenantId: tenant.id, userId: actorId, role: "member" },
    preferences: { theme: "system", locale: "en" },
    permissions,
    products: [
      {
        productId: "omnitech.interview",
        name: "Interview",
        description: "",
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

// One Studio: a scripted model behind the pack-preparation profile, and the
// store the engine keeps packs in. `gate` holds every model call until it is
// opened, so a preparation can be caught while it runs.
function studio(
  options: {
    onDevice?: boolean;
    packProfile?: string;
    misbehave?: boolean;
    store?: PreparedStore;
  } = {},
) {
  const model: ScriptedModel = scriptedModel(fixture, {
    ...(options.misbehave ? { misbehave: true } : {}),
  });
  let open: Promise<void> = Promise.resolve();
  const gated: ModelPort = {
    async *stream(scope, input, signal) {
      await open;
      yield* model.port.stream(scope, input, signal);
    },
  };
  const store = options.store ?? createMemoryPackStore();
  const engine = scriptedEngine(
    { port: gated, calls: model.calls },
    { onDevice: options.onDevice ?? true, store },
  );
  // The API as one member of one workspace calls it.
  const as = (
    actorId: string,
    who: { permissions?: string[]; slug?: string; tenantId?: string } = {},
  ) => {
    const slug = who.slug ?? "local";
    const api = createDocumentsApi({
      database,
      engine,
      packs: store,
      packProfile: options.packProfile ?? BENCH_PROFILE,
      loadMatrix: async () => ({
        matrix: fixture.material.matrix,
        id: "bench",
        revision: 1,
      }),
      resolveScope: async (request) =>
        resolveDocumentsScope(
          context(
            { id: who.tenantId ?? ids.tenant, slug },
            actorId,
            who.permissions ?? ["interview.read", "interview.documents.write"],
          ),
          request.headers.get("x-omnitech-tenant") ?? "",
          request.method,
        ),
    });
    const headers = { "x-omnitech-tenant": slug };
    const send = (
      method: string,
      path: string,
      body?: unknown,
      signal?: AbortSignal,
    ) =>
      api.request(`${url}${path}`, {
        method,
        headers:
          body === undefined
            ? headers
            : { ...headers, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal ? { signal } : {}),
      });
    return {
      get: (path: string) => send("GET", path),
      post: (path: string, body: unknown = {}, signal?: AbortSignal) =>
        send("POST", path, body, signal),
      patch: (path: string, body: unknown) => send("PATCH", path, body),
    };
  };
  return {
    model,
    store,
    engine,
    as,
    hold() {
      let release = () => {};
      open = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}
const pack = (candidacy = made.candidacy) =>
  `/candidacies/${candidacy}/context-pack`;
const codeOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;
const reviewOf = async (response: Response): Promise<PackReview> =>
  packReviewSchema.parse(await response.json());
// A preparation's lines, each as the contract states it.
const linesOf = async (response: Response): Promise<PackProgress[]> =>
  (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => packProgressSchema.parse(JSON.parse(line)));
const doneOf = (lines: readonly PackProgress[]): PackReview => {
  const last = lines.at(-1);
  if (last?.t !== "done") throw new Error(`Ended with ${JSON.stringify(last)}`);
  return last.review;
};

const one = async (sql: string, values: unknown[] = []) =>
  String((await pg.owner.query<{ id: string }>(sql, values)).rows[0]?.id);

beforeAll(async () => {
  pg = await startDisposablePostgres();
  await migrateDatabase(pg.owner);
  await pg.owner.query(`GRANT USAGE ON SCHEMA platform, interview TO fixture_member;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, interview TO fixture_member;`);
  ids.tenant = await one(
    "INSERT INTO platform.tenants(slug,name) VALUES ('local','Local') RETURNING id",
  );
  ids.elsewhere = await one(
    "INSERT INTO platform.tenants(slug,name) VALUES ('elsewhere','Elsewhere') RETURNING id",
  );
  const user = (name: string) =>
    one(
      "INSERT INTO platform.users(email,display_name) VALUES ($1,$2) RETURNING id",
      [`${name}@example.invalid`, name],
    );
  ids.owner = await user("owner");
  ids.other = await user("other");
  ids.outsider = await user("outsider");
  for (const [tenant, member] of [
    [ids.tenant, ids.owner],
    [ids.tenant, ids.other],
    [ids.elsewhere, ids.outsider],
  ])
    await pg.owner.query(
      "INSERT INTO platform.tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
      [tenant, member],
    );
  database = createPlatformDatabase(pg.memberUrl);

  // The fixture's application, stored as a person would enter it.
  const mine = studio().as(ids.owner);
  const [first, second] = fixture.brief.stages;
  if (!first || !second) throw new Error("The fixture has two stages.");
  const created = (await (
    await mine.post("/candidacies", {
      companyName: fixture.material.brief.company,
      title: fixture.material.brief.role,
      jobDescription: fixture.brief.posting,
      interview: { kind: first.kind, label: first.label },
    })
  ).json()) as { candidacyId: string; interviewId: string };
  made.candidacy = created.candidacyId;
  made.first = created.interviewId;
  const base = `/candidacies/${made.candidacy}`;
  const added = (await (
    await mine.post(`${base}/stages`, {
      kind: second.kind,
      label: second.label,
    })
  ).json()) as { stages: { id: string }[] };
  made.second = added.stages[1]?.id ?? "";
  for (const [id, stage] of [
    [made.first, first],
    [made.second, second],
  ] as const)
    expect(
      (
        await mine.patch(`${base}/stages/${id}`, {
          notes: stage.notes,
          outcome: stage.outcome,
          nextSteps: stage.nextSteps,
          people: stage.people,
        })
      ).status,
    ).toBe(200);
  const transcript = first.transcripts[0];
  const attached = await mine.post(`${base}/stages/${made.first}/transcripts`, {
    title: transcript?.title,
    text: transcript?.text,
    capturePolicy: "device-only",
  });
  expect(attached.status).toBe(201);
  made.transcript = (
    (await attached.json()) as { transcript: { id: string } }
  ).transcript.id;
  for (const entry of fixture.brief.employerSaid)
    expect(
      (
        await mine.post(`${base}/employer-said`, {
          said: entry.said,
          ...(entry.saidBy ? { saidBy: entry.saidBy } : {}),
          ...(entry.channel ? { channel: entry.channel } : {}),
          ...(entry.saidOn ? { saidOn: entry.saidOn } : {}),
        })
      ).status,
    ).toBe(201);
  for (const document of fixture.brief.research)
    expect(
      (
        await mine.post(`${base}/research`, {
          scope: document.scope,
          title: document.title,
          text: document.text,
        })
      ).status,
    ).toBe(201);
  // A second application of the same member, with nothing in it.
  made.empty = (
    (await (
      await mine.post("/candidacies", {
        companyName: "Saltmarsh Robotics",
        title: "Staff Engineer",
        interview: { kind: "other", label: "Interview" },
      })
    ).json()) as { candidacyId: string }
  ).candidacyId;
}, 90_000);
afterAll(async () => {
  await database?.close();
  await pg?.stop();
});

describe("the review of a pack", () => {
  it("says, before any preparation, that nothing is prepared and what a model would read", async () => {
    const { as, model } = studio();
    const response = await as(ids.owner).get(pack());
    expect(response.status).toBe(200);
    const review = await reviewOf(response);
    expect(review).toMatchObject({
      candidacyId: made.candidacy,
      prepared: false,
      current: true,
      recipe: { id: "interview-context", version: "3" },
      profile: { id: BENCH_PROFILE, onDevice: true },
      records: [],
      rejected: [],
      holes: [],
      withheld: [],
    });
    const readable = review.sources.filter((each) => each.readable);
    expect(readable.map((each) => each.state)).toEqual(
      Array.from({ length: 8 }, () => "unread"),
    );
    expect(readable.map((each) => each.title)).toEqual(
      expect.arrayContaining([
        "Job posting",
        "Hiring manager: Hiring manager call",
        "Research: Panel backgrounds",
      ]),
    );
    expect(
      review.stages.map((each) => [each.ordinal, each.label, each.empty]),
    ).toEqual([
      [1, "Hiring manager", false],
      [2, "Technical", false],
    ]);
    // The person's matrix is theirs, read by no model.
    expect(
      review.counts.find((each) => each.kind === KINDS.achievement),
    ).toMatchObject({ total: 139, extracted: 0 });
    // A review asks no model.
    expect(model.calls).toEqual([]);
  });

  it("says what a profile that does not run on this device would not be given", async () => {
    const review = await reviewOf(
      await studio({ onDevice: false }).as(ids.owner).get(pack()),
    );
    expect(review.profile).toMatchObject({ onDevice: false });
    expect(review.withheld).toEqual([
      {
        sourceId: expect.stringContaining(":transcript:"),
        title: "Hiring manager: Hiring manager call",
        reason: "device-only",
      },
    ]);
  });

  it("says no profile can prepare when the Studio's is not offered", async () => {
    const { as } = studio({ packProfile: "agent/claude-code" });
    const review = await reviewOf(await as(ids.owner).get(pack()));
    expect(review.profile).toBeNull();
    const refused = await as(ids.owner).post(`${pack()}/prepare`);
    expect(refused.status).toBe(503);
    expect(await codeOf(refused)).toBe("generation-unavailable");
  });

  it("is of an application with nothing in it: no stage material, nothing to read", async () => {
    const review = await reviewOf(
      await studio().as(ids.owner).get(pack(made.empty)),
    );
    expect(review.prepared).toBe(false);
    expect(review.sources.filter((each) => each.readable)).toEqual([]);
    expect(review.stages).toEqual([
      {
        ordinal: 1,
        label: "Interview",
        notes: 0,
        transcripts: 0,
        extracted: 0,
        empty: true,
      },
    ]);
  });
});

describe("another member, and another workspace", () => {
  const prepared = () => {
    const world = studio();
    return world;
  };

  it("cannot read the review of an application that is not theirs", async () => {
    const { as, model } = prepared();
    const other = await as(ids.other).get(pack());
    expect(other.status).toBe(404);
    expect(await codeOf(other)).toBe("not-found");
    const outsider = await as(ids.outsider, {
      slug: "elsewhere",
      tenantId: ids.elsewhere,
    }).get(pack());
    expect(outsider.status).toBe(404);
    expect(await codeOf(outsider)).toBe("not-found");
    expect(model.calls).toEqual([]);
  });

  it("cannot prepare it: no model is asked and nothing is kept", async () => {
    const { as, model, store } = prepared();
    for (const stranger of [
      as(ids.other),
      as(ids.outsider, { slug: "elsewhere", tenantId: ids.elsewhere }),
    ]) {
      const response = await stranger.post(`${pack()}/prepare`);
      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe("not-found");
    }
    expect(model.calls).toEqual([]);
    for (const [tenantId, actorId] of [
      [ids.tenant, ids.other],
      [ids.elsewhere, ids.outsider],
      [ids.tenant, ids.owner],
    ] as const)
      expect(
        await loadKeptPack(store, { tenantId, actorId }, made.candidacy),
      ).toBeUndefined();
  });

  it("cannot correct it, nor read it once its owner has prepared it", async () => {
    const { as, store } = prepared();
    const done = doneOf(
      await linesOf(await as(ids.owner).post(`${pack()}/prepare`)),
    );
    const record = done.records[0];
    for (const stranger of [
      as(ids.other),
      as(ids.outsider, { slug: "elsewhere", tenantId: ids.elsewhere }),
    ]) {
      const corrected = await stranger.post(`${pack()}/corrections`, {
        corrections: [{ recordId: record?.id, action: "remove" }],
      });
      expect(corrected.status).toBe(404);
      expect((await stranger.get(pack())).status).toBe(404);
    }
    // The owner's pack is as it was, and is kept under the owner alone.
    const kept = await loadKeptPack(
      store,
      { tenantId: ids.tenant, actorId: ids.owner },
      made.candidacy,
    );
    expect(kept?.records.some((each) => each.id === record?.id)).toBe(true);
    expect(kept?.removed).toBeUndefined();
    expect(
      await loadKeptPack(
        store,
        { tenantId: ids.tenant, actorId: ids.other },
        made.candidacy,
      ),
    ).toBeUndefined();
  });

  it("refuses a member who may only read: the review is theirs to see, a preparation is not theirs to start", async () => {
    const { as, model } = prepared();
    const reader = as(ids.owner, { permissions: ["interview.read"] });
    expect((await reader.get(pack())).status).toBe(200);
    const prepare = await reader.post(`${pack()}/prepare`);
    expect(prepare.status).toBe(401);
    const correct = await reader.post(`${pack()}/corrections`, {
      corrections: [{ recordId: "x", action: "confirm" }],
    });
    expect(correct.status).toBe(401);
    expect(model.calls).toEqual([]);
    // With no permission at all, not even the review.
    expect((await as(ids.owner, { permissions: [] }).get(pack())).status).toBe(
      401,
    );
  });
});

describe("preparing a pack", () => {
  it("answers as it goes, then with the review, and keeps the pack", async () => {
    const { as, model, store } = studio({ misbehave: true });
    const response = await as(ids.owner).post(`${pack()}/prepare`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
    const lines = await linesOf(response);
    const progress = lines.filter((line) => line.t === "progress");
    expect(progress.map((line) => [line.done, line.total])).toEqual([
      [0, 8],
      [3, 8],
      [6, 8],
      [8, 8],
    ]);
    // A person is told what is being read, by the name they know it by.
    expect(progress.flatMap((line) => line.reading)).toEqual(
      expect.arrayContaining(["Job posting", "Research: Panel backgrounds"]),
    );
    const review = doneOf(lines);
    expect(review).toMatchObject({
      prepared: true,
      current: true,
      holes: [],
      withheld: [],
      fit: { requirements: 14, gap: 1 },
    });
    expect(review.stats).toMatchObject({
      extracted: 8,
      reused: 0,
      pieces: 8,
      calls: 8,
      holes: 0,
    });
    expect(review.stats?.linkCalls).toBeGreaterThan(0);
    expect(review.records.length).toBe(55);
    // What the scripted model invented was refused and is shown.
    expect(review.rejected.map((each) => each.text).sort()).toEqual(
      fixture.extraction.invented.map((each) => each.record.text).sort(),
    );
    expect(review.gaps).toEqual([
      expect.objectContaining({
        text: "Working proficiency in French, for brokers in Quebec",
      }),
    ]);
    expect(model.calls.length).toBe(
      (review.stats?.calls ?? 0) + (review.stats?.linkCalls ?? 0),
    );
    // Kept by the engine under the application and the member.
    const kept = await loadKeptPack(
      store,
      { tenantId: ids.tenant, actorId: ids.owner },
      made.candidacy,
    );
    expect(kept?.records.filter((each) => each.by === "model").length).toBe(55);
    // And the review read afterwards is the same pack.
    const read = await reviewOf(await as(ids.owner).get(pack()));
    expect(read.records.map((each) => each.id)).toEqual(
      review.records.map((each) => each.id),
    );
    expect(read.stats).toBeUndefined();
    expect(
      read.sources.filter((each) => each.readable).map((each) => each.state),
    ).toEqual(Array.from({ length: 8 }, () => "current"));
  });

  it("asks no model the second time, and one source's worth when one is read again", async () => {
    const { as, model } = studio();
    const mine = as(ids.owner);
    const first = doneOf(await linesOf(await mine.post(`${pack()}/prepare`)));
    const before = model.calls.length;
    const again = doneOf(await linesOf(await mine.post(`${pack()}/prepare`)));
    expect(model.calls.length).toBe(before);
    expect(again.stats).toMatchObject({
      extracted: 0,
      reused: 8,
      calls: 0,
      linkCalls: 0,
    });
    expect(again.records.length).toBe(first.records.length);

    const posting = first.sources.find((each) => each.title === "Job posting");
    const forced = doneOf(
      await linesOf(
        await mine.post(`${pack()}/prepare`, { sourceId: posting?.id }),
      ),
    );
    expect(forced.stats).toMatchObject({ extracted: 1, reused: 7, calls: 1 });
    expect(
      model.calls.slice(before).filter((call) => call.for === "posting").length,
    ).toBe(1);
    expect(
      model.calls
        .slice(before)
        .filter((call) => ["research", "transcript"].includes(call.for)),
    ).toEqual([]);
  });

  it("refuses a source the application does not have, and a body that is not a preparation", async () => {
    const { as, model } = studio();
    const mine = as(ids.owner);
    const unknown = await mine.post(`${pack()}/prepare`, {
      sourceId: "research:00000000-0000-4000-8000-00000000ffff",
    });
    expect(unknown.status).toBe(404);
    expect(await codeOf(unknown)).toBe("not-found");
    const bad = await mine.post(`${pack()}/prepare`, { everything: true });
    expect(bad.status).toBe(400);
    expect(await codeOf(bad)).toBe("invalid-request");
    const noId = await mine.post(
      "/candidacies/not-a-uuid/context-pack/prepare",
    );
    expect(noId.status).toBe(400);
    const missing = await mine.get(
      pack("00000000-0000-4000-8000-00000000ffff"),
    );
    expect(missing.status).toBe(404);
    expect(model.calls).toEqual([]);
  });

  it("tells a second asker it is already running, and charges them nothing", async () => {
    const world = studio();
    const mine = world.as(ids.owner);
    const release = world.hold();
    const running = mine.post(`${pack()}/prepare`);
    // The first has claimed the application once its stream has begun.
    const first = await running;
    const second = await mine.post(`${pack()}/prepare`);
    expect(second.status).toBe(409);
    expect(await codeOf(second)).toBe("already-running");
    release();
    expect(doneOf(await linesOf(first)).prepared).toBe(true);
    // And once it has ended, another may start.
    const third = await mine.post(`${pack()}/prepare`);
    expect(third.status).toBe(200);
    expect(doneOf(await linesOf(third)).stats?.calls).toBe(0);
  });

  it("stops when the reader leaves: what was read is kept, and the next preparation reads the rest", async () => {
    const world = studio();
    const mine = world.as(ids.owner);
    const response = await mine.post(`${pack()}/prepare`);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let seen = "";
    // Read until the second group of sources is announced, then leave.
    while (!seen.includes('"done":3')) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += decoder.decode(value);
    }
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const kept = await loadKeptPack(
      world.store,
      { tenantId: ids.tenant, actorId: ids.owner },
      made.candidacy,
    );
    const read = new Set(
      (kept?.records ?? [])
        .filter((each) => each.by === "model")
        .map((each) => each.source.id),
    );
    expect(read.size).toBeGreaterThanOrEqual(3);
    expect(read.size).toBeLessThan(8);
    const rest = doneOf(await linesOf(await mine.post(`${pack()}/prepare`)));
    expect(rest.stats?.extracted).toBe(8 - read.size);
    expect(rest.records.length).toBe(55);
  });

  it("never sends a device-only transcript to a profile that does not run here, and says it was withheld", async () => {
    const { as, model } = studio({ onDevice: false });
    const review = doneOf(
      await linesOf(await as(ids.owner).post(`${pack()}/prepare`)),
    );
    for (const call of model.calls) {
      expect(call.for).not.toBe("transcript");
      expect(call.user).not.toContain("who should own it");
      expect(call.user).not.toContain("the quote state had one owner");
    }
    expect(review.withheld).toEqual([
      expect.objectContaining({
        title: "Hiring manager: Hiring manager call",
        reason: "device-only",
      }),
    ]);
    expect(review.holes).toEqual([
      expect.objectContaining({ reason: "locality", failure: "policy" }),
    ]);
    expect(
      review.sources.find((each) => each.kind === "transcript")?.state,
    ).toBe("withheld");
    expect(review.records.some((each) => each.kind === KINDS.asked)).toBe(
      false,
    );
    // The rest was prepared.
    expect(review.records.length).toBe(50);
    expect(review.stages[0]).toMatchObject({ transcripts: 1, extracted: 0 });
  });
});

describe("correcting a pack", () => {
  it("confirms, edits and removes a record, and the correction survives preparing again", async () => {
    const { as, model } = studio();
    const mine = as(ids.owner);
    const first = doneOf(await linesOf(await mine.post(`${pack()}/prepare`)));
    const find = (text: string) => {
      const found = first.records.find((each) => each.text.startsWith(text));
      if (!found) throw new Error(`No record starts "${text}".`);
      return found;
    };
    const [confirmed, edited, removed] = [
      find("Security-minded design"),
      find("React for internal"),
      find("Experience introducing delivery metrics"),
    ];
    const response = await mine.post(`${pack()}/corrections`, {
      corrections: [
        { recordId: confirmed.id, action: "confirm" },
        {
          recordId: edited.id,
          action: "edit",
          text: "  React for internal tools  ",
          themes: ["react", "frontend"],
        },
        { recordId: removed.id, action: "remove" },
      ],
    });
    expect(response.status).toBe(200);
    const check = (review: PackReview) => {
      const byId = new Map(review.records.map((each) => [each.id, each]));
      expect(byId.get(confirmed.id)?.reviewed).toBe("confirmed");
      expect(byId.get(edited.id)).toMatchObject({
        text: "React for internal tools",
        themes: ["react", "frontend"],
        reviewed: "edited",
        quote: edited.quote,
      });
      expect(byId.has(removed.id)).toBe(false);
      expect(review.records.length).toBe(54);
      expect(
        review.counts.find((each) => each.kind === KINDS.requirement),
      ).toMatchObject({ extracted: 27, confirmed: 1, edited: 1 });
      expect(review.fit.requirements).toBe(13);
    };
    check(await reviewOf(response));
    check(await reviewOf(await mine.get(pack())));
    // Prepared again, unchanged; then with the posting read again, where the
    // model proposes the removed record and the old wording once more.
    const before = model.calls.length;
    check(doneOf(await linesOf(await mine.post(`${pack()}/prepare`))));
    expect(model.calls.length).toBe(before);
    check(
      doneOf(
        await linesOf(
          await mine.post(`${pack()}/prepare`, { sourceId: edited.sourceId }),
        ),
      ),
    );
    expect(model.calls.length).toBeGreaterThan(before);
  });

  it("refuses a record the pack does not hold, an empty correction, a text too long, and a pack that was never prepared", async () => {
    const { as } = studio();
    const mine = as(ids.owner);
    // Nothing prepared yet.
    const early = await mine.post(`${pack()}/corrections`, {
      corrections: [{ recordId: "anything", action: "confirm" }],
    });
    expect(early.status).toBe(400);
    expect(await codeOf(early)).toBe("invalid-request");
    const first = doneOf(await linesOf(await mine.post(`${pack()}/prepare`)));
    for (const body of [
      { corrections: [{ recordId: "no-such-record", action: "confirm" }] },
      { corrections: [] },
      { corrections: [{ recordId: first.records[0]?.id, action: "rename" }] },
      {
        corrections: [
          {
            recordId: first.records[0]?.id,
            action: "edit",
            text: "x".repeat(601),
          },
        ],
      },
      {
        corrections: [
          { recordId: first.records[0]?.id, action: "edit", text: "   " },
        ],
      },
      {},
    ]) {
      const refused = await mine.post(`${pack()}/corrections`, body);
      expect(refused.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(await codeOf(refused)).toBe("invalid-request");
    }
    // Nothing changed.
    const after = await reviewOf(await mine.get(pack()));
    expect(after.records).toEqual(first.records);
  });
});

describe("what a document and a briefing read of a prepared application", () => {
  const scope = () => ({ tenantId: ids.tenant, actorId: ids.owner });
  const signal = () => new AbortController().signal;
  const packsOf = (world: ReturnType<typeof studio>) =>
    createApplicationPacks({
      database,
      engine: world.engine,
      packs: world.store,
      loadMatrix: async () => ({
        matrix: fixture.material.matrix,
        id: "bench",
        revision: 1,
      }),
    });
  const forDocument = (
    packs: ReturnType<typeof packsOf>,
    who = scope(),
    roles?: string[],
  ) =>
    packs.forDocument(who, {
      candidacyId: made.candidacy,
      matrix: fixture.material.matrix,
      profile: { id: "bench", revision: 1 },
      ...(roles ? { roles } : {}),
      signal: signal(),
    });
  const BRIEFING = {
    company: fixture.material.brief.company,
    role: fixture.material.brief.role,
    stage: "hiring-manager" as const,
  };

  // [SAFETY] The application's one transcript is kept on this device (it was
  // attached as device-only above). A briefing and a document are written by
  // a model that need not run here, so neither is given anything a local
  // model extracted from it. The person decides otherwise by saying of a
  // transcript they pasted or attached that it may leave: `permitting` does
  // that through the API for one test, and puts it back.
  const policy = async (capturePolicy: "device-only" | "permitted-remote") =>
    expect(
      (
        await studio()
          .as(ids.owner)
          .patch(
            `/candidacies/${made.candidacy}/stages/${made.first}/transcripts/${made.transcript}`,
            { capturePolicy },
          )
      ).status,
    ).toBe(200);
  const permitting = async <Result>(work: () => Promise<Result>) => {
    await policy("permitted-remote");
    try {
      return await work();
    } finally {
      await policy("device-only");
    }
  };
  // Words only the transcript has, and only what was extracted from it.
  const SAID_ONLY_THERE = [
    "both need the same payout record",
    "the quote state had one owner",
    "new engineer into the on-call rota",
    "shadow for two weeks first",
    "expect a question on idempotent payouts",
    "10:02:10",
    "10:41:05",
  ];
  const saidIn = (given: unknown): string[] => {
    const text = JSON.stringify(given).toLowerCase();
    return SAID_ONLY_THERE.filter((words) => text.includes(words));
  };

  it("is nothing when no pack was prepared: both are written from what they always were", async () => {
    const world = studio();
    const packs = packsOf(world);
    expect(await forDocument(packs)).toBeNull();
    expect(await packs.forBriefing(scope(), BRIEFING, signal())).toEqual([]);
    expect(world.model.calls).toEqual([]);
    // And with no store at all.
    const storeless = createApplicationPacks({
      database,
      engine: world.engine,
    });
    expect(await forDocument(storeless)).toBeNull();
    expect(await storeless.forBriefing(scope(), BRIEFING, signal())).toEqual(
      [],
    );
  });

  it("gives a document what the employer asks for with its evidence, the gap, and the cast roles' achievements whole", async () => {
    const world = studio();
    await linesOf(await world.as(ids.owner).post(`${pack()}/prepare`));
    const before = world.model.calls.length;
    const packs = packsOf(world);
    const whole = await forDocument(packs);
    // [SAFETY] Reading the pack asks no model.
    expect(world.model.calls.length).toBe(before);
    expect(whole?.asks.length).toBe(14);
    expect(whole?.asks.filter((ask) => ask.level === "nice").length).toBe(3);
    const react = whole?.asks.find((ask) =>
      ask.requirement.startsWith("React for internal"),
    );
    expect(react).toMatchObject({ level: "must", fit: "strong" });
    expect(react?.evidence[0]).toMatchObject({
      pointer: expect.stringMatching(/^\/roles\/3\/responsibilities\/\d+$/),
      text: expect.stringContaining(
        "Built fleet reporting dashboards in React",
      ),
    });
    // The requirement is addressed by the posting and the place of its words.
    expect(react?.pointer).toMatch(/^posting:.+@chars:\d+-\d+$/);
    const ledger = whole?.asks.find((ask) =>
      ask.requirement.startsWith("Working proficiency in French"),
    );
    // A gap has no evidence, and says what is missing.
    expect(ledger).toMatchObject({
      fit: "gap",
      evidence: [],
      gap: expect.stringContaining("Nothing in the record says French"),
    });
    expect(whole?.achievements.length).toBe(139);
    // Only the cast roles' achievements, each whole under its role.
    const cast = await forDocument(packs, scope(), ["/roles/5", "/roles/0"]);
    expect(new Set(cast?.achievements.map((each) => each.role))).toEqual(
      new Set(["/roles/5", "/roles/0"]),
    );
    for (const each of cast?.achievements ?? []) {
      expect(each.pointer.startsWith(`${each.role}/`)).toBe(true);
      expect(each.text).toMatch(/^At (Quotewright|Larchmont Pay) \(/);
    }
    expect(cast?.asks).toEqual(whole?.asks);
  });

  it("gives a briefing its stage: the people, the asks with evidence and the gap, the notes, and, of a transcript that may leave this device, what the stage asked", async () => {
    const world = studio();
    await linesOf(await world.as(ids.owner).post(`${pack()}/prepare`));
    const before = world.model.calls.length;
    const packs = packsOf(world);
    const technical = await packs.forBriefing(
      scope(),
      { ...BRIEFING, stage: "behavioural" },
      signal(),
    );
    // No stage of the application is "behavioural": every stage is read.
    expect(technical.length).toBeGreaterThan(20);
    // The person says the transcript may leave this device: the pack kept
    // for it stands (its words did not change), and a briefing now reads it.
    const lines = (
      await permitting(() => packs.forBriefing(scope(), BRIEFING, signal()))
    ).map((line) => `${line.pointer} ${line.text}`);
    expect(world.model.calls.length).toBe(before);
    const of = (group: string) =>
      lines.filter((line) => line.startsWith(`/context/pack/${group}/`));
    expect(of("people").join("\n")).toContain(
      "Imre Solvang, Manager, Engineering",
    );
    expect(of("asks").length).toBe(14);
    expect(of("asks").join("\n")).toMatch(
      /Required: React for internal and customer-facing tools; Evidence \(strong\): \/roles\/3\/responsibilities\/\d+/,
    );
    expect(of("asks").join("\n")).toContain(
      "Required: Working proficiency in French, for brokers in Quebec; GAP: no evidence in the candidate's record. Nothing in the record says French",
    );
    expect(of("asks").join("\n")).toContain(
      "Preferred: Freight, logistics or payments domain experience",
    );
    expect(of("asked").join("\n")).toContain(
      "Asked in an earlier stage: When two teams both need the same payout record, who should own it?",
    );
    expect(of("signals").join("\n")).toContain(
      "Said to expect: The technical round is next: expect a question on idempotent payouts.",
    );
    expect(of("answered").join("\n")).toContain(
      "Answered before: Shadow for two weeks first",
    );
    expect(of("notes").join("\n")).toContain("Rota onboarding");
    // The hiring-manager stage is the first: the technical stage's notes are
    // a later stage's and are not read for it.
    expect(lines.join("\n")).not.toContain("Live coding plan");
    expect(of("employer").join("\n")).toContain(
      "References are taken only after an offer is agreed",
    );
    // Every line is cited under the pack, and none is a pointer into the
    // candidate's own record.
    for (const line of lines)
      expect(line).toMatch(/^\/context\/pack\/\w+\/\d+ /);
  });

  it("shows the person, in the review on their own screen, what a model that runs here read from the device-only transcript", async () => {
    const world = studio();
    await linesOf(await world.as(ids.owner).post(`${pack()}/prepare`));
    const review = await reviewOf(await world.as(ids.owner).get(pack()));
    const transcript = review.sources.find(
      (each) => each.kind === "transcript",
    );
    expect(transcript).toMatchObject({ state: "current", extracted: 5 });
    expect(
      review.records.filter((each) => each.sourceId === transcript?.id).length,
    ).toBe(5);
    expect(saidIn(review)).toEqual(SAID_ONLY_THERE);
    // Another member of the workspace is told there is no such application.
    expect((await world.as(ids.other).get(pack())).status).toBe(404);
  });

  it("gives a briefing and a document nothing of a device-only transcript, by line or by its words, though the kept pack holds it", async () => {
    const world = studio();
    await linesOf(await world.as(ids.owner).post(`${pack()}/prepare`));
    // The profile that prepared runs here: the transcript was read and kept.
    const kept = await loadKeptPack(world.store, scope(), made.candidacy);
    expect(saidIn(kept)).toEqual(SAID_ONLY_THERE);
    const packs = packsOf(world);
    for (const stage of [
      "hiring-manager",
      "recruiter",
      "behavioural",
    ] as const) {
      const lines = await packs.forBriefing(
        scope(),
        { ...BRIEFING, stage },
        signal(),
      );
      // The rest of the pack is read: the asks with their evidence.
      expect(
        lines.filter((line) => line.pointer.startsWith("/context/pack/asks/"))
          .length,
        stage,
      ).toBe(14);
      // Only a transcript gives these groups, and the only one is withheld.
      for (const group of ["asked", "signals", "answered", "commitments"])
        expect(
          lines.filter((line) =>
            line.pointer.startsWith(`/context/pack/${group}/`),
          ),
          `${stage} ${group}`,
        ).toEqual([]);
      expect(saidIn(lines), stage).toEqual([]);
    }
    const document = await forDocument(packs);
    expect(document?.asks.length).toBe(14);
    expect(saidIn(document)).toEqual([]);
    // Allowed out, the same kept pack gives the briefing what was asked: it
    // was the policy that withheld it, and nothing else.
    expect(
      saidIn(
        await permitting(() => packs.forBriefing(scope(), BRIEFING, signal())),
      ),
    ).toContain("both need the same payout record");
    // And put back, it is withheld again.
    expect(
      saidIn(await packs.forBriefing(scope(), BRIEFING, signal())),
    ).toEqual([]);
  });

  it("reads nothing for another member, another workspace, or a briefing no one application is meant by", async () => {
    const world = studio();
    await linesOf(await world.as(ids.owner).post(`${pack()}/prepare`));
    const packs = packsOf(world);
    for (const stranger of [
      { tenantId: ids.tenant, actorId: ids.other },
      { tenantId: ids.elsewhere, actorId: ids.outsider },
    ]) {
      expect(await forDocument(packs, stranger)).toBeNull();
      expect(await packs.forBriefing(stranger, BRIEFING, signal())).toEqual([]);
    }
    for (const context of [
      { ...BRIEFING, company: "Another Company" },
      { ...BRIEFING, role: "Another Role" },
      // An application with no pack prepared.
      {
        company: "Saltmarsh Robotics",
        role: "Staff Engineer",
        stage: "recruiter" as const,
      },
    ])
      expect(await packs.forBriefing(scope(), context, signal())).toEqual([]);
    // The names as typed, case and space aside, are the same application.
    expect(
      (
        await packs.forBriefing(
          scope(),
          {
            ...BRIEFING,
            company: `  ${BRIEFING.company.toUpperCase()} `,
            role: BRIEFING.role.toLowerCase(),
          },
          signal(),
        )
      ).length,
    ).toBeGreaterThan(20);
  });
});
