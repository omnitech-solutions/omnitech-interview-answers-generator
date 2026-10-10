// An application's context pack prepared END TO END by a model, on the real
// AI engine with a SCRIPTED model behind one profile (bench-prepared.ts): the
// fixture's whole application (the posting, three research documents, three
// employer-said entries, both stages' notes and the transcript) is read,
// checked, linked, kept, corrected, read again and resolved for a stage.
// The scripted model reads as the fixture's gold reads, and can be told to
// invent, to fail and to propose ties the recipe forbids, so every check the
// engine and the product make is exercised. No network, no database. Every
// name and figure is invented.
import type { Prepared } from "@omnitech/ai-engine";
import type { PlatformDatabase } from "@omnitech/database";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import type { BriefMaterial } from "../brief/repository";
import { createCoachContext } from "../coach/context";
import { coachPromptParts } from "../coach/prompt";
import { parseCoachReply } from "../coach/reply";
import { loadSessionContext } from "../live-session/session-context";
import {
  type Asked,
  applicationOf,
  BENCH_PROFILE,
  BENCH_SCOPE,
  BENCH_WINDOWS,
  type PreparedFixture,
  readPreparedFixture,
  scriptedEngine,
  scriptedModel,
  withTranscriptsPermitted,
} from "./bench-prepared";
import { stageContext } from "./bench-stages";
import {
  applicationSources,
  correctApplicationPack,
  createMemoryPackStore,
  loadKeptPack,
  PackPreparationCancelled,
  type PrepareProgress,
  packKey,
  prepareApplicationPack,
  reviewPack,
} from "./prepare";
import { ABOUT, type ContextKind, KINDS, LINKS } from "./recipe";
import { prepareStagePack } from "./stage";

vi.mock("../live-session/session-context", () => ({
  loadSessionContext: vi.fn(),
}));
const load = vi.mocked(loadSessionContext);

const FIXTURE = "kestrel-freight-pay";
const fixture = readPreparedFixture(FIXTURE);
const CANDIDACY = fixture.brief.candidacyId;
const POSTING = `posting:${CANDIDACY}`;
const TRANSCRIPT = fixture.extraction.sources.find(
  (source) => source.kind === "transcript",
)?.source as string;
const execution = () => ({
  scope: BENCH_SCOPE,
  signal: new AbortController().signal,
});
const profile = (onDevice: boolean) => ({
  id: BENCH_PROFILE,
  label: "Pack reader",
  kind: "model" as const,
  provider: "scripted",
  locality: onDevice ? ("device" as const) : ("remote" as const),
});

// One preparation of the fixture's application: its own model, engine and
// store, so no test reads another's calls or pack.
function world(
  options: {
    window?: (typeof BENCH_WINDOWS)[keyof typeof BENCH_WINDOWS];
    onDevice?: boolean;
    misbehave?: boolean;
    fail?: (asked: Asked) => boolean;
    from?: PreparedFixture;
  } = {},
) {
  const from = options.from ?? fixture;
  const onDevice = options.onDevice ?? true;
  const model = scriptedModel(from, {
    ...(options.misbehave ? { misbehave: true } : {}),
    ...(options.fail ? { fail: options.fail } : {}),
  });
  const store = createMemoryPackStore();
  const engine = scriptedEngine(model, {
    window: options.window ?? BENCH_WINDOWS.large,
    onDevice,
    store,
  });
  const kept = () => loadKeptPack(store, BENCH_SCOPE, CANDIDACY);
  const prepare = async (
    more: {
      material?: PreparedFixture;
      again?: string;
      signal?: AbortSignal;
      onProgress?: (progress: PrepareProgress) => void;
    } = {},
  ) =>
    prepareApplicationPack(
      engine,
      {
        candidacyId: CANDIDACY,
        sources: applicationSources(applicationOf(more.material ?? from)),
        profileId: BENCH_PROFILE,
        onDevice,
        kept: await kept(),
        packs: store,
        ...(more.again ? { again: more.again } : {}),
      },
      { scope: BENCH_SCOPE, signal: more.signal ?? execution().signal },
      more.onProgress,
    );
  const review = async (material: PreparedFixture = from) =>
    reviewPack({
      material: applicationOf(material),
      sources: applicationSources(applicationOf(material)),
      kept: await kept(),
      profile: profile(onDevice),
      // The review as the card shows it: the person's own screen.
      reader: "device",
    });
  return { model, engine, store, kept, prepare, review };
}

// The fixture with one research document's text changed.
const withResearch = (title: string, text: string): PreparedFixture => ({
  ...fixture,
  brief: {
    ...fixture.brief,
    research: fixture.brief.research.map((document) =>
      document.title === title ? { ...document, text } : document,
    ),
  },
});
const written = (prepared: Pick<Prepared, "records"> | undefined) =>
  (prepared?.records ?? []).filter((record) => record.by === "model");

// [SAFETY] The fixture's hiring-manager call was RECORDED under a device-only
// policy (stages.json). What a model extracted from it is carried to a later
// stage's REMOTE readers only when the transcript may leave this machine, so
// the carry-forward suites read the fixture with that one fact changed in
// memory, and each has a mirror with the transcript as recorded.
const permitted = withTranscriptsPermitted(fixture);
// Words only that transcript has, and only what was extracted from it: the
// person's notes, which may be sent, also speak of the rota and of payouts.
const SAID_ONLY_THERE = [
  "both need the same payout record",
  "the quote state had one owner",
  "new engineer into the on-call rota",
  "shadow for two weeks first",
  "expect a question on idempotent payouts",
  "10:02:10",
  "10:41:05",
];
// Which of those words something holds, whatever its shape.
const saidIn = (given: unknown): string[] => {
  const text = JSON.stringify(given).toLowerCase();
  return SAID_ONLY_THERE.filter((words) => text.includes(words));
};

describe("the whole application, prepared by a model", () => {
  let large: Awaited<ReturnType<ReturnType<typeof world>["prepare"]>>;
  let small: Awaited<ReturnType<ReturnType<typeof world>["prepare"]>>;
  const worlds = {
    large: world({ window: BENCH_WINDOWS.large, misbehave: true }),
    small: world({ window: BENCH_WINDOWS.small, misbehave: true }),
  };
  beforeAll(async () => {
    large = await worlds.large.prepare();
    small = await worlds.small.prepare();
  });

  it("reads every source a model reads: the posting, three research documents, three employer-said entries and the transcript", () => {
    const read = new Set(written(large.prepared).map((each) => each.source.id));
    expect(read.size).toBe(8);
    expect(read.has(POSTING)).toBe(true);
    expect(read.has(TRANSCRIPT)).toBe(true);
    expect([...read].filter((id) => id.startsWith("research:")).length).toBe(3);
    expect(
      [...read].filter((id) => id.startsWith("employer-said:")).length,
    ).toBe(3);
    expect(large.stats).toMatchObject({ extracted: 8, holes: 0 });
  });

  it("keeps every gold record, each with the source's own words and where they are", () => {
    const gold = fixture.extraction.sources.flatMap((source) =>
      source.records.map((record) => ({ ...record, source: source.source })),
    );
    const kept = written(large.prepared);
    expect(kept.length).toBe(gold.length);
    for (const wanted of gold) {
      const found = kept.find(
        (record) =>
          record.kind === wanted.kind &&
          record.text === wanted.text &&
          record.source.id.endsWith(wanted.source.replace("posting", POSTING)),
      );
      expect(found, wanted.text).toBeDefined();
      expect(found?.verified).toBe("quote-found");
      expect(found?.source.quote?.toLowerCase()).toBe(
        wanted.quote.toLowerCase(),
      );
      expect(found?.source.locator).toBeTruthy();
      expect(found?.fields).toEqual(wanted.fields);
      expect(found?.themes).toEqual(wanted.themes);
    }
  });

  it("points a posting record at its characters and a transcript record at its moment on the clock", () => {
    const posting = fixture.brief.posting ?? "";
    for (const record of written(large.prepared)) {
      if (record.source.id === POSTING) {
        const [, from, to] =
          /^chars:(\d+)-(\d+)$/.exec(record.source.locator ?? "") ?? [];
        expect(posting.slice(Number(from), Number(to))).toBe(
          record.source.quote,
        );
      }
      if (record.source.id === TRANSCRIPT)
        expect(record.source.locator).toMatch(
          /^\d\d:\d\d:\d\d-\d\d:\d\d:\d\d$/,
        );
    }
    const asked = written(large.prepared).find(
      (record) => record.kind === KINDS.asked,
    );
    expect(asked?.source.locator).toBe("10:02:10-10:02:24");
    // What a stage's transcript gave belongs to that stage.
    expect(asked?.scope).toBe("stage:1");
  });

  it("gives a large and a small profile the same kept records, where the model answers the same", () => {
    const shape = (prepared: typeof large.prepared) =>
      written(prepared)
        .map((record) => ({
          id: record.id,
          kind: record.kind,
          text: record.text,
          quote: record.source.quote,
          locator: record.source.locator,
          fields: record.fields,
          themes: record.themes,
          answers: record.answers,
          scope: record.scope,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    expect(shape(small.prepared)).toEqual(shape(large.prepared));
    // The same ties, too: a list read in batches gives what one call gave.
    const ties = (prepared: typeof large.prepared) =>
      (prepared.links ?? [])
        .map((link) => [link.step, link.from, link.to, link.by, link.fields])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(ties(small.prepared)).toEqual(ties(large.prepared));
  });

  it("reads a long source in pieces for the small profile and whole for the large one", () => {
    // Eight sources, one call each, for a model that holds any of them.
    expect(large.stats.pieces).toBe(8);
    expect(large.stats.calls).toBe(8);
    // The posting does not fit the small model: it is read in pieces.
    expect(small.stats.pieces).toBeGreaterThan(large.stats.pieces);
    const postingCalls = (model: typeof worlds.large.model) =>
      model.calls.filter((call) => call.for === "posting").length;
    expect(postingCalls(worlds.large.model)).toBe(1);
    expect(postingCalls(worlds.small.model)).toBeGreaterThan(1);
    // And the lists of records are tied in batches, never in one prompt.
    expect(small.stats.linkCalls).toBeGreaterThan(large.stats.linkCalls);
    for (const call of worlds.small.model.calls)
      expect(call.user.length, call.for).toBeLessThan(
        BENCH_WINDOWS.small.contextTokens * 3,
      );
  });

  it("rejects a record whose quote the source does not hold, and shows it in the review", async () => {
    const invented = fixture.extraction.invented.map(
      (each) => each.record.text,
    );
    expect(invented.length).toBe(3);
    for (const prepared of [large.prepared, small.prepared]) {
      for (const text of invented) {
        expect(
          prepared.records.some((record) => record.text === text),
          text,
        ).toBe(false);
        expect(
          prepared.rejected.find((each) => each.text === text),
        ).toMatchObject({
          code: "quote-not-found",
          reason: "the quoted words are not in the source",
        });
      }
    }
    const review = await worlds.large.review();
    expect(review.rejected.map((each) => each.text).sort()).toEqual(
      [...invented].sort(),
    );
    expect(
      review.rejected.find((each) => each.sourceId === POSTING),
    ).toMatchObject({ kind: KINDS.requirement, code: "quote-not-found" });
    // Every record a model wrote has a quote code found: all of them.
    for (const record of written(large.prepared))
      expect(record.verified, record.text).toBe("quote-found");
  });

  it("ties each requirement to its evidence with a strength, and each note and question to its story", () => {
    const { prepared } = large;
    const byId = new Map(prepared.records.map((each) => [each.id, each]));
    const of = (step: string) =>
      (prepared.links ?? []).filter(
        (link) => link.step === step && link.by === "model",
      );
    const fit = of(LINKS.fit);
    expect(fit.length).toBeGreaterThan(20);
    for (const link of fit) {
      expect(byId.get(link.from)?.kind).toBe(KINDS.requirement);
      expect(byId.get(link.to)?.kind).toBe(KINDS.achievement);
      expect(["strong", "partial", "gap"]).toContain(link.fields?.["strength"]);
      expect(link.verified).toBe("ends-exist");
    }
    const react = fit.find((link) =>
      byId.get(link.from)?.text.startsWith("React for internal"),
    );
    expect(byId.get(react?.to ?? "")?.text).toContain(
      "Built fleet reporting dashboards in React",
    );
    expect(react?.fields?.["strength"]).toBe("strong");
    // A gap names what is missing.
    const ledger = fit.find((link) =>
      byId.get(link.from)?.text.startsWith("Working proficiency in French"),
    );
    expect(ledger?.fields).toMatchObject({
      strength: "gap",
      note: expect.stringContaining("Nothing in the record says French"),
    });
    expect(of(LINKS.proof).length).toBe(fixture.links.proof.length);
    const story = of(LINKS.story);
    expect(story.map((link) => link.fields?.["rank"]).sort()).toEqual([
      "backup",
      "primary",
      "primary",
    ]);
    for (const link of story)
      expect(byId.get(link.from)?.kind).toBe(KINDS.asked);
  });

  // [SAFETY] The recipe declares each pair, and the engine refuses any other:
  // evidence offered as the requirement, a requirement as evidence for
  // another, an end that is not a record.
  it("never links an employer's fact as the candidate's experience, whatever the model proposes", () => {
    for (const prepared of [large.prepared, small.prepared]) {
      const byId = new Map(prepared.records.map((each) => [each.id, each]));
      for (const link of prepared.links ?? []) {
        const to = byId.get(link.to);
        expect(to, link.id).toBeDefined();
        expect(ABOUT[to?.kind as ContextKind], link.step).toBe("candidate");
        expect(ABOUT[byId.get(link.from)?.kind as ContextKind]).not.toBe(
          undefined,
        );
      }
      const refused = (prepared.unlinked ?? []).map((each) => each.reason);
      expect(refused).toContain("forbidden-pair");
      expect(refused).toContain("end-missing");
    }
    // What the scripted model proposed and the engine refused, one by one.
    const byId = new Map(large.prepared.records.map((each) => [each.id, each]));
    const forbidden = (large.prepared.unlinked ?? []).filter(
      (each) => each.reason === "forbidden-pair",
    );
    expect(
      forbidden.map((each) => [
        byId.get(each.from ?? "")?.kind,
        byId.get(each.to ?? "")?.kind,
      ]),
    ).toEqual([
      [KINDS.achievement, KINDS.requirement],
      [KINDS.requirement, KINDS.requirement],
    ]);
  });

  it("keeps the ties made in code beside the model's, each checked by the engine", () => {
    const links = large.prepared.links ?? [];
    const code = links.filter((link) => link.by === "code");
    // A note and a story are tied to what they name. A requirement is tied
    // to the person's technologies by a reader, once it is read with today's
    // material (kept.ts): the kept pack's requirements are the model's.
    expect(new Set(code.map((link) => link.step))).toEqual(
      new Set([LINKS.names, LINKS.tells]),
    );
    expect(
      new Set(links.filter((l) => l.by === "model").map((l) => l.step)),
    ).toEqual(new Set([LINKS.fit, LINKS.proof, LINKS.story]));
    for (const link of code) expect(link.verified).toBe("ends-exist");
    // A note that states an achievement's figure is tied to it for that.
    expect(
      code.some(
        (link) =>
          link.step === LINKS.names && link.fields?.["basis"] === "figure",
      ),
    ).toBe(true);
  });

  it("prepares from the posting itself, and leaves the employer brief's copy of it out", () => {
    const { prepared } = large;
    const brief = prepared.records.filter((record) =>
      record.source.id.startsWith("brief:"),
    );
    // What the brief distilled from the person's notes stays.
    expect(new Set(brief.map((record) => record.fields?.["section"]))).toEqual(
      new Set([undefined, "prepNotes", "questionsToAsk"]),
    );
    expect(brief.filter((each) => each.kind === KINDS.prep).length).toBe(22);
    // Every requirement in the pack is quoted from the posting.
    for (const record of prepared.records.filter(
      (each) => each.kind === KINDS.requirement,
    )) {
      expect(record.source.id).toBe(POSTING);
      expect(record.source.quote).toBeTruthy();
    }
  });

  it("says in its review what was prepared: counts by kind, the fit, the gap, the stages", async () => {
    const review = await worlds.large.review();
    expect(review).toMatchObject({
      candidacyId: CANDIDACY,
      prepared: true,
      current: true,
      recipe: { id: "interview-context", version: "3" },
      profile: { id: BENCH_PROFILE, onDevice: true },
    });
    const count = (kind: string) =>
      review.counts.find((each) => each.kind === kind);
    expect(count(KINDS.requirement)).toEqual({
      kind: KINDS.requirement,
      total: 28,
      extracted: 28,
      confirmed: 0,
      edited: 0,
    });
    expect(count(KINDS.asked)).toMatchObject({ total: 2, extracted: 2 });
    expect(count(KINDS.answered)).toMatchObject({ total: 2, extracted: 2 });
    expect(count(KINDS.signal)).toMatchObject({ total: 1, extracted: 1 });
    expect(count(KINDS.achievement)).toMatchObject({
      total: 139,
      extracted: 0,
    });
    // Fourteen things asked of a candidate; one has no evidence.
    expect(review.fit).toMatchObject({
      requirements: 14,
      gap: 1,
      refused: 3,
    });
    expect(review.fit.strong + review.fit.partial).toBe(13);
    expect(review.gaps).toEqual([
      {
        id: expect.stringContaining(POSTING),
        text: "Working proficiency in French, for brokers in Quebec",
        note: expect.stringContaining(
          "written communication in English is the nearest",
        ),
      },
    ]);
    expect(review.stages).toEqual([
      {
        ordinal: 1,
        label: "Hiring manager",
        notes: 2,
        transcripts: 1,
        extracted: 5,
        empty: false,
      },
      {
        ordinal: 2,
        label: "Technical",
        notes: 3,
        transcripts: 0,
        extracted: 0,
        empty: false,
      },
    ]);
    expect(review.holes).toEqual([]);
    expect(review.withheld).toEqual([]);
    expect(review.records.length).toBe(written(large.prepared).length);
    const requirement = review.records.find((each) =>
      each.text.startsWith("7+ years"),
    );
    expect(requirement).toMatchObject({
      kind: KINDS.requirement,
      sourceId: POSTING,
      section: "mustHaves",
      level: "must",
      quote:
        "7+ years of experience building complex, scalable APIs, including integrating with third-party APIs",
      themes: ["apis", "integrations"],
    });
    const turn = review.records.find((each) => each.kind === KINDS.asked);
    expect(turn).toMatchObject({ stage: 1, locator: "10:02:10-10:02:24" });
    const states = new Map(review.sources.map((each) => [each.id, each]));
    expect(states.get(POSTING)).toMatchObject({
      title: "Job posting",
      state: "current",
      extracted: 39,
      readable: true,
    });
    expect(states.get(TRANSCRIPT)).toMatchObject({
      title: "Hiring manager: Hiring manager call",
      state: "current",
      stage: 1,
    });
    expect(states.get("matrix:bench")).toMatchObject({
      state: "structured",
      readable: false,
    });
  });

  it("says a stage with no notes and no transcript has no material", () => {
    const bare: PreparedFixture = {
      ...fixture,
      brief: {
        ...fixture.brief,
        stages: [
          ...fixture.brief.stages,
          {
            ...(fixture.brief.stages[1] as BriefMaterial["stages"][number]),
            id: "00000000-0000-4000-8000-00000000a003",
            ordinal: 3,
            kind: "final",
            label: "Final",
            notes: null,
            people: [],
          },
        ],
      },
    };
    const review = reviewPack({
      material: applicationOf(bare),
      sources: applicationSources(applicationOf(bare)),
      kept: large.prepared,
      profile: profile(true),
    });
    expect(review.stages.at(-1)).toEqual({
      ordinal: 3,
      label: "Final",
      notes: 0,
      transcripts: 0,
      extracted: 0,
      empty: true,
    });
  });
});

describe("a pack before any preparation", () => {
  it("is not prepared, lists every source a model would read as not read yet, and reads nothing extracted", async () => {
    const { review, model } = world();
    const shown = await review();
    expect(shown.prepared).toBe(false);
    expect(shown.current).toBe(true);
    expect(shown.records).toEqual([]);
    expect(shown.rejected).toEqual([]);
    expect(shown.fit).toMatchObject({ strong: 0, refused: 0 });
    expect(
      shown.sources.filter((each) => each.readable).map((each) => each.state),
    ).toEqual(Array.from({ length: 8 }, () => "unread"));
    expect(model.calls).toEqual([]);
  });

  it("says no profile can prepare when none is offered, and what a remote one would not be given", () => {
    const material = applicationOf(fixture);
    const sources = applicationSources(material);
    const none = reviewPack({
      material,
      sources,
      kept: undefined,
      profile: null,
    });
    expect(none.profile).toBeNull();
    const remote = reviewPack({
      material,
      sources,
      kept: undefined,
      profile: profile(false),
    });
    expect(remote.withheld).toEqual([
      {
        sourceId: TRANSCRIPT,
        title: "Hiring manager: Hiring manager call",
        reason: "device-only",
      },
    ]);
    // An agent is never on this device, wherever its runtime is.
    const agent = reviewPack({
      material,
      sources,
      kept: undefined,
      profile: { ...profile(true), kind: "agent" },
    });
    expect(agent.profile?.onDevice).toBe(false);
    expect(agent.withheld.length).toBe(1);
    expect(
      reviewPack({ material, sources, kept: undefined, profile: profile(true) })
        .withheld,
    ).toEqual([]);
  });
});

describe("a transcript that may not leave this device", () => {
  const SAID = "who should own it";

  it("is never sent to a profile that does not run here: no call carries its words", async () => {
    const remote = world({ onDevice: false });
    const done = await remote.prepare();
    expect(remote.model.calls.some((call) => call.for === "transcript")).toBe(
      false,
    );
    for (const call of remote.model.calls) {
      // Words only the transcript has (the person's own notes, which may
      // be sent, also speak of the rota and of idempotent payouts).
      expect(call.user).not.toContain(SAID);
      expect(call.user).not.toContain("the quote state had one owner");
      expect(call.user).not.toContain("shadow for two weeks first");
      expect(call.user).not.toContain("10:02:10");
    }
    expect(done.prepared.holes).toEqual([
      {
        sourceId: TRANSCRIPT,
        reason: "locality",
        failure: expect.objectContaining({
          code: "refused",
          refusal: "policy",
        }),
      },
    ]);
    expect(
      written(done.prepared).some((each) => each.source.id === TRANSCRIPT),
    ).toBe(false);
    // The rest of the pack is prepared.
    expect(done.stats).toMatchObject({ extracted: 8, calls: 7 });
    expect(
      written(done.prepared).filter((each) => each.source.id === POSTING)
        .length,
    ).toBe(39);
  });

  it("is said in the review to have been withheld, and why", async () => {
    const remote = world({ onDevice: false });
    await remote.prepare();
    const review = await remote.review();
    expect(review.withheld).toEqual([
      {
        sourceId: TRANSCRIPT,
        title: "Hiring manager: Hiring manager call",
        reason: "device-only",
      },
    ]);
    expect(review.holes).toEqual([
      { sourceId: TRANSCRIPT, reason: "locality", failure: "policy" },
    ]);
    expect(review.sources.find((each) => each.id === TRANSCRIPT)?.state).toBe(
      "withheld",
    );
    expect(review.stages[0]).toMatchObject({ transcripts: 1, extracted: 0 });
    expect(review.profile?.onDevice).toBe(false);
  });

  it("is read by a profile that runs here", async () => {
    const local = world({ onDevice: true });
    const done = await local.prepare();
    const calls = local.model.calls.filter((call) => call.for === "transcript");
    expect(calls.length).toBe(1);
    expect(calls[0]?.user).toContain(SAID);
    // Each turn is given with its place on the transcript's clock.
    expect(calls[0]?.user).toContain(
      "[10:02:10-10:02:24] Interviewer: when two teams both need the same payout record",
    );
    expect(done.prepared.holes).toEqual([]);
    expect(
      written(done.prepared).filter((each) => each.source.id === TRANSCRIPT)
        .length,
    ).toBe(5);
    expect((await local.review()).withheld).toEqual([]);
  });

  it("is not shown to a remote profile that prepares later, though a profile that runs here read it first", async () => {
    // The same store, first behind a local profile, then behind a remote one.
    const store = createMemoryPackStore();
    const first = scriptedModel(fixture);
    await prepareApplicationPack(
      scriptedEngine(first, { onDevice: true, store }),
      {
        candidacyId: CANDIDACY,
        sources: applicationSources(applicationOf(fixture)),
        profileId: BENCH_PROFILE,
        onDevice: true,
        kept: undefined,
        packs: store,
      },
      execution(),
    );
    const kept = await loadKeptPack(store, BENCH_SCOPE, CANDIDACY);
    expect(saidIn(kept)).toEqual(SAID_ONLY_THERE);
    // The person's record gains an achievement and a research document a
    // line: there are new records to tie, and a source to read again.
    const [role, ...others] = fixture.material.matrix.roles;
    const changed: PreparedFixture = {
      ...withResearch(
        "Engineering blog: one payout workflow",
        "The payout workflow is one state machine. A second region is planned.",
      ),
      material: {
        ...fixture.material,
        matrix: {
          ...fixture.material.matrix,
          roles: [
            {
              ...(role as NonNullable<typeof role>),
              proof_points: [
                ...((role as NonNullable<typeof role>).proof_points ?? []),
                "Settled who owns a payout record shared by two teams",
              ],
            },
            ...others,
          ],
        },
      },
    };
    const second = scriptedModel(changed);
    const done = await prepareApplicationPack(
      scriptedEngine(second, { onDevice: false, store }),
      {
        candidacyId: CANDIDACY,
        sources: applicationSources(applicationOf(changed)),
        profileId: BENCH_PROFILE,
        kept,
        packs: store,
      },
      execution(),
    );
    // The remote profile was asked for ties (there is a new achievement to
    // tie), and no call of it carries a word of the device-only transcript:
    // not its turns, and not the questions a local model read from it.
    // (No story is asked for: the only questions asked before are that
    // transcript's, and they were set aside.)
    expect([...new Set(second.calls.map((call) => call.for))]).toEqual([
      "fit",
      "proof",
    ]);
    expect(second.calls.some((call) => call.for === "transcript")).toBe(false);
    for (const call of second.calls)
      expect(saidIn([call.system, call.user]), call.for).toEqual([]);
    // What the local model read is still the pack's, as it was kept: every
    // record, and every tie a model made from one.
    const tied = (prepared: Prepared | undefined) => {
      const ids = new Set(
        written(prepared)
          .filter((each) => each.source.id === TRANSCRIPT)
          .map((each) => each.id),
      );
      return (prepared?.links ?? [])
        .filter((link) => ids.has(link.from) || ids.has(link.to))
        .map((link) => link.id)
        .sort();
    };
    const of = (prepared: Prepared | undefined) =>
      written(prepared)
        .filter((each) => each.source.id === TRANSCRIPT)
        .map((each) => each.id)
        .sort();
    const after = await loadKeptPack(store, BENCH_SCOPE, CANDIDACY);
    for (const pack of [done.prepared, after]) {
      expect(of(pack)).toEqual(of(kept));
      expect(of(pack).length).toBe(5);
      expect(tied(pack)).toEqual(tied(kept));
      expect(tied(pack).length).toBeGreaterThan(0);
      // It was not asked for, so it is not a part that could not be read.
      expect(pack?.holes ?? []).toEqual([]);
    }
    // The new achievement is in the pack the remote profile made.
    expect(
      done.prepared.records.some((record) =>
        record.text.includes("Settled who owns a payout record"),
      ),
    ).toBe(true);
    // A third preparation, by the local profile again, reads nothing anew.
    const third = scriptedModel(changed);
    await prepareApplicationPack(
      scriptedEngine(third, { onDevice: true, store }),
      {
        candidacyId: CANDIDACY,
        sources: applicationSources(applicationOf(changed)),
        profileId: BENCH_PROFILE,
        onDevice: true,
        kept: after,
        packs: store,
      },
      execution(),
    );
    expect(third.calls.filter((call) => call.for === "transcript")).toEqual([]);
  });

  it("is set aside from a profile that is not said to run here, whatever the engine's profile is", async () => {
    // [SAFETY] Fail closed: `onDevice` absent is "not on this machine".
    const store = createMemoryPackStore();
    const local = scriptedEngine(scriptedModel(fixture), {
      onDevice: true,
      store,
    });
    const input = {
      candidacyId: CANDIDACY,
      sources: applicationSources(applicationOf(fixture)),
      profileId: BENCH_PROFILE,
      packs: store,
    };
    await prepareApplicationPack(
      local,
      { ...input, onDevice: true, kept: undefined },
      execution(),
    );
    const kept = await loadKeptPack(store, BENCH_SCOPE, CANDIDACY);
    const seen: (Prepared | undefined)[] = [];
    const watching = {
      context: {
        ...local.context,
        prepare: (
          given: Parameters<typeof local.context.prepare>[0],
          execution: Parameters<typeof local.context.prepare>[1],
        ) => {
          seen.push(given.previous);
          return local.context.prepare(given, execution);
        },
      },
    };
    const done = await prepareApplicationPack(
      watching,
      { ...input, kept },
      execution(),
    );
    expect(seen.length).toBeGreaterThan(0);
    const from = (prepared: Prepared | undefined) =>
      written(prepared).filter((each) => each.source.id === TRANSCRIPT);
    const ids = new Set(from(kept).map((each) => each.id));
    expect(ids.size).toBe(5);
    // The engine is handed the kept pack without what a model wrote from the
    // transcript, and without a tie to any of it.
    for (const previous of seen) {
      expect(from(previous)).toEqual([]);
      for (const link of previous?.links ?? [])
        expect(ids.has(link.from) || ids.has(link.to)).toBe(false);
    }
    // And it is the pack's again afterwards.
    expect(from(done.prepared).map((each) => each.id)).toEqual(
      from(kept).map((each) => each.id),
    );
  });

  it("is listed in the review, with its words, only on the person's own screen", async () => {
    const local = world({ onDevice: true, misbehave: true });
    await local.prepare();
    const material = applicationOf(fixture);
    const reviewAs = async (reader?: "device" | "remote") =>
      reviewPack({
        material,
        sources: applicationSources(material),
        kept: await local.kept(),
        profile: profile(true),
        ...(reader ? { reader } : {}),
      });
    // The card (routes.ts reads as "device"): the five records, each quoted.
    const card = await reviewAs("device");
    expect(
      card.records.filter((each) => each.sourceId === TRANSCRIPT).length,
    ).toBe(5);
    expect(saidIn(card)).toEqual(SAID_ONLY_THERE);
    // Anyone else, and anyone who does not say: counted, never said.
    for (const reader of [undefined, "remote"] as const) {
      const review = await reviewAs(reader);
      expect(
        review.records.filter((each) => each.sourceId === TRANSCRIPT),
      ).toEqual([]);
      expect(
        review.rejected.filter((each) => each.sourceId === TRANSCRIPT),
      ).toEqual([]);
      expect(saidIn(review)).toEqual([]);
      expect(review.counts).toEqual(card.counts);
      expect(review.stages).toEqual(card.stages);
      expect(review.sources).toEqual(card.sources);
      // What was read from sources that may leave is listed as before.
      expect(
        review.records.filter((each) => each.sourceId === POSTING),
      ).toEqual(card.records.filter((each) => each.sourceId === POSTING));
    }
  });

  it("is read on the next preparation when the profile then runs here: only it is read", async () => {
    // The same store, first behind a remote profile, then behind a local one.
    const store = createMemoryPackStore();
    const first = scriptedModel(fixture);
    await prepareApplicationPack(
      scriptedEngine(first, { onDevice: false, store }),
      {
        candidacyId: CANDIDACY,
        sources: applicationSources(applicationOf(fixture)),
        profileId: BENCH_PROFILE,
        kept: undefined,
        packs: store,
      },
      execution(),
    );
    const second = scriptedModel(fixture);
    const done = await prepareApplicationPack(
      scriptedEngine(second, { onDevice: true, store }),
      {
        candidacyId: CANDIDACY,
        sources: applicationSources(applicationOf(fixture)),
        profileId: BENCH_PROFILE,
        onDevice: true,
        kept: await loadKeptPack(store, BENCH_SCOPE, CANDIDACY),
      },
      execution(),
    );
    expect(
      second.calls.filter((call) => call.for === "transcript").length,
    ).toBe(1);
    expect(
      second.calls.filter((call) =>
        ["posting", "research", "employer-said"].includes(call.for),
      ),
    ).toEqual([]);
    expect(done.prepared.holes).toEqual([]);
    expect(done.stats).toMatchObject({ extracted: 1, reused: 7 });
  });
});

describe("a piece the model fails on", () => {
  // The scripted model fails whenever it is shown the posting's "Nice to
  // have" heading: the whole posting first, then the half that holds it.
  const failing = (asked: Asked) =>
    asked.for === "posting" && asked.user.includes("Nice to have");

  it("is asked again at half its size, then left as a stated hole, and the pack is still made", async () => {
    const broken = world({ fail: failing });
    const done = await broken.prepare();
    const posting = broken.model.calls.filter((call) => call.for === "posting");
    // The whole, then the same text again in smaller parts.
    expect(posting.length).toBeGreaterThanOrEqual(3);
    expect(posting[0]?.user.length).toBeGreaterThan(
      (posting[1]?.user.length ?? 0) + 100,
    );
    expect(
      posting
        .slice(1)
        .map((call) => call.user)
        .join(""),
    ).toBe(posting[0]?.user);
    // Only the part the model failed on twice is a hole.
    expect(done.prepared.holes).toEqual([
      {
        sourceId: POSTING,
        extractor: "posting",
        locator: expect.stringMatching(/^chars:\d+-\d+$/),
        reason: "not-extracted",
        failure: expect.objectContaining({ code: expect.any(String) }),
      },
    ]);
    // What the other half says was kept, each with its quote.
    const kept = written(done.prepared).filter(
      (each) => each.source.id === POSTING,
    );
    expect(kept.length).toBeGreaterThan(5);
    expect(kept.length).toBeLessThan(39);
    expect(
      kept.some((each) => each.text.startsWith("Set technical direction")),
    ).toBe(true);
    // And every other source was read.
    expect(
      new Set(written(done.prepared).map((each) => each.source.id)).size,
    ).toBe(8);
  });

  it("is shown in the review as a part that could not be read, and the pack is usable", async () => {
    const broken = world({ fail: failing });
    const done = await broken.prepare();
    const review = await broken.review();
    expect(review.prepared).toBe(true);
    expect(review.holes).toEqual([
      {
        sourceId: POSTING,
        locator: expect.stringMatching(/^chars:/),
        reason: "not-extracted",
        failure: expect.any(String),
      },
    ]);
    expect(review.sources.find((each) => each.id === POSTING)?.state).toBe(
      "partial",
    );
    const pack = await prepareStagePack(
      broken.engine,
      stageContext(fixture.material, fixture.brief),
      execution(),
      2,
      { kept: done.prepared },
    );
    const facts = pack.facts("coach", "How long is the technical round?");
    expect(facts.some((fact) => fact.text.includes("two hours"))).toBe(true);
  });

  it("is read again on the next preparation, and only its source is", async () => {
    let fails = true;
    const mended = world({ fail: (asked) => fails && failing(asked) });
    await mended.prepare();
    fails = false;
    const before = mended.model.calls.length;
    const again = await mended.prepare();
    const calls = mended.model.calls.slice(before);
    expect(calls.filter((call) => call.for === "posting").length).toBe(1);
    expect(
      calls.filter((call) =>
        ["research", "employer-said", "transcript"].includes(call.for),
      ),
    ).toEqual([]);
    expect(again.prepared.holes).toEqual([]);
    expect(again.stats).toMatchObject({ extracted: 1, reused: 7 });
    expect(
      written(again.prepared).filter((each) => each.source.id === POSTING)
        .length,
    ).toBe(39);
  });
});

describe("preparing again", () => {
  it("asks no model when nothing changed", async () => {
    const same = world();
    const first = await same.prepare();
    const before = same.model.calls.length;
    const again = await same.prepare();
    expect(same.model.calls.length).toBe(before);
    expect(again.stats).toMatchObject({
      extracted: 0,
      reused: 8,
      calls: 0,
      linkCalls: 0,
    });
    expect(written(again.prepared).length).toBe(written(first.prepared).length);
    expect((again.prepared.links ?? []).length).toBe(
      (first.prepared.links ?? []).length,
    );
  });

  it("re-extracts only the one source that changed: one model call", async () => {
    const changing = world();
    await changing.prepare();
    const before = changing.model.calls.length;
    // The carrier payment index gains a line. It gives facts of the employer
    // and no note, so nothing new is there to tie: one call, the extraction.
    const changed = withResearch(
      "Carrier payment index, autumn issue",
      "Median days to pay a carrier fell from 31 to 27 across the brokers surveyed.\nFactoring fees held at about 3% of invoice value.\nBrokers under 50 staff paid slowest.",
    );
    const again = await changing.prepare({ material: changed });
    const calls = changing.model.calls.slice(before);
    expect(calls.map((call) => call.for)).toEqual(["research"]);
    expect(calls[0]?.user).toContain("Brokers under 50 staff paid slowest");
    expect(again.stats).toMatchObject({
      extracted: 1,
      reused: 7,
      pieces: 1,
      calls: 1,
      linkCalls: 0,
    });
    // What the other sources gave is exactly what it was.
    const others = (prepared: typeof again.prepared) =>
      written(prepared)
        .filter((each) => !each.source.id.endsWith("c002"))
        .map((each) => each.id)
        .sort();
    expect(others(again.prepared)).toEqual(
      others((await world().prepare()).prepared),
    );
  });

  it("asks for ties only for the new records of the changed source", async () => {
    // A reader that finds, in the settlements notes, one more question worth
    // asking once the notes say a second region is planned.
    const reader: PreparedFixture = {
      ...fixture,
      extraction: {
        ...fixture.extraction,
        sources: [
          ...fixture.extraction.sources,
          {
            source: "research:second-region",
            kind: "research",
            records: [
              {
                kind: KINDS.prep,
                text: "When is the second region planned, and who owns its payouts?",
                quote: "A second region is planned",
                fields: { section: "questionsToAsk" },
                themes: ["region"],
                answers: [],
              },
            ],
          },
        ],
      },
    };
    const changing = world({ from: reader });
    const first = await changing.prepare();
    expect(
      written(first.prepared).some((each) =>
        each.text.includes("second region"),
      ),
    ).toBe(false);
    const before = changing.model.calls.length;
    const changed: PreparedFixture = {
      ...reader,
      brief: withResearch(
        "Settlements engineering notes",
        "# Settlements engineering notes\nThe settlement ledger is append-only and balanced nightly against bank files.\nPayout batches close at 16:00 Atlantic on business days.\n\nOn-call rotates weekly across the six engineers.\nA second region is planned.",
      ).brief,
    };
    const again = await changing.prepare({ material: changed });
    const calls = changing.model.calls.slice(before);
    // The new note is shown against the achievements for its proof (a note
    // is what that step is from); no requirement and no question is new, so
    // the fit and the stories are not asked for again.
    expect(calls.map((call) => call.for)).toEqual(["research", "proof"]);
    expect(calls[1]?.user).toContain("When is the second region planned");
    expect(calls[1]?.user).not.toContain("Why Kestrel");
    expect(again.stats).toMatchObject({ extracted: 1, calls: 1, linkCalls: 1 });
    expect(
      (again.prepared.links ?? []).filter((link) => link.step === LINKS.fit)
        .length,
    ).toBeGreaterThan(20);
    expect(again.stats.linksReused).toBeGreaterThan(20);
  });

  it("no longer reads what a changed source gave until it is prepared again", async () => {
    const stale = world();
    const done = await stale.prepare();
    const changed = withResearch(
      "Panel backgrounds",
      "Imre Solvang managed the reconciliation team before Settlements.",
    );
    const review = reviewPack({
      material: applicationOf(changed),
      sources: applicationSources(applicationOf(changed)),
      kept: done.prepared,
      profile: profile(true),
    });
    const panel = review.sources.find(
      (each) => each.title === "Research: Panel backgrounds",
    );
    expect(panel).toMatchObject({ state: "changed", extracted: 0 });
    expect(
      review.records.some((each) => each.text.includes("Asta Verhoeven")),
    ).toBe(false);
    // A reader of the stage is not given it either.
    const pack = await prepareStagePack(
      stale.engine,
      stageContext(changed.material, changed.brief),
      execution(),
      2,
      { kept: done.prepared },
    );
    expect(
      pack.prepared.records.some(
        (record) =>
          record.by === "model" && record.text.includes("Asta Verhoeven"),
      ),
    ).toBe(false);
    // What the unchanged sources gave is still read.
    expect(
      pack.prepared.records.some(
        (record) => record.by === "model" && record.source.id === POSTING,
      ),
    ).toBe(true);
  });

  it("reads one source again when asked to, though it has not changed", async () => {
    const forced = world();
    await forced.prepare();
    const before = forced.model.calls.length;
    const again = await forced.prepare({ again: POSTING });
    const calls = forced.model.calls.slice(before);
    expect(calls.filter((call) => call.for === "posting").length).toBe(1);
    expect(
      calls.filter((call) =>
        ["research", "employer-said", "transcript"].includes(call.for),
      ),
    ).toEqual([]);
    expect(again.stats).toMatchObject({ extracted: 1, reused: 7 });
  });

  it("says how far it is, a few sources at a time", async () => {
    const watched = world();
    const seen: PrepareProgress[] = [];
    await watched.prepare({ onProgress: (progress) => seen.push(progress) });
    expect(seen.map((each) => [each.done, each.total])).toEqual([
      [0, 8],
      [3, 8],
      [6, 8],
      [8, 8],
    ]);
    expect(seen[0]?.reading.length).toBe(3);
    expect(seen.at(-1)?.reading).toEqual([]);
    // Model calls so far only ever grow.
    const calls = seen.map((each) => each.calls);
    expect([...calls].sort((a, b) => a - b)).toEqual(calls);
    expect(calls.at(-1)).toBe(watched.model.calls.length);
  });

  it("can be stopped: what was read is kept, and the next preparation reads only the rest", async () => {
    const stopped = world();
    const stop = new AbortController();
    await expect(
      stopped.prepare({
        signal: stop.signal,
        // Stop as the second group of sources is about to be read.
        onProgress: (progress) => {
          if (progress.done === 3) stop.abort();
        },
      }),
    ).rejects.toBeInstanceOf(PackPreparationCancelled);
    const kept = await stopped.kept();
    expect(new Set(written(kept).map((each) => each.source.id)).size).toBe(3);
    const before = stopped.model.calls.length;
    const rest = await stopped.prepare();
    expect(rest.stats).toMatchObject({ extracted: 5, reused: 3 });
    expect(
      stopped.model.calls
        .slice(before)
        .filter((call) =>
          ["posting", "research", "employer-said", "transcript"].includes(
            call.for,
          ),
        ).length,
    ).toBe(5);
    expect(
      new Set(written(rest.prepared).map((each) => each.source.id)).size,
    ).toBe(8);
  });
});

describe("what the person corrects", () => {
  it("is kept with the pack and survives preparing again, even when the source is read again", async () => {
    const corrected = world();
    const first = await corrected.prepare();
    const find = (text: string) => {
      const found = written(first.prepared).find((each) =>
        each.text.startsWith(text),
      );
      if (!found) throw new Error(`No record starts "${text}".`);
      return found;
    };
    const removed = find("Experience introducing delivery metrics");
    const edited = find("React for internal");
    const confirmed = find("Security-minded design");
    await correctApplicationPack(
      corrected.engine,
      {
        candidacyId: CANDIDACY,
        corrections: [
          { recordId: removed.id, action: "remove" },
          {
            recordId: edited.id,
            action: "edit",
            text: "React for internal tools; customer-facing is a plus",
            themes: ["react", "frontend"],
          },
          { recordId: confirmed.id, action: "confirm" },
        ],
      },
      execution(),
    );
    const check = async () => {
      const kept = await corrected.kept();
      const byId = new Map(
        (kept?.records ?? []).map((each) => [each.id, each]),
      );
      expect(byId.has(removed.id)).toBe(false);
      expect(kept?.removed).toEqual([removed.id]);
      expect(byId.get(edited.id)).toMatchObject({
        text: "React for internal tools; customer-facing is a plus",
        themes: ["react", "frontend"],
        reviewed: "edited",
        // Its identity, its quote and its place stay.
        source: { quote: edited.source.quote, locator: edited.source.locator },
      });
      expect(byId.get(confirmed.id)?.reviewed).toBe("confirmed");
      // No tie is left hanging on the record that was removed.
      expect(
        (kept?.links ?? []).some(
          (link) => link.from === removed.id || link.to === removed.id,
        ),
      ).toBe(false);
    };
    await check();
    // Preparing again with nothing changed.
    await corrected.prepare();
    await check();
    // And with the posting read again: the model proposes the removed record
    // and the old wording again, and neither comes back.
    await corrected.prepare({ again: POSTING });
    await check();
    const review = await corrected.review();
    expect(
      review.counts.find((each) => each.kind === KINDS.requirement),
    ).toMatchObject({ extracted: 27, confirmed: 1, edited: 1 });
    expect(review.fit.requirements).toBe(13);
    expect(review.records.find((each) => each.id === edited.id)?.reviewed).toBe(
      "edited",
    );
  });

  it("holds for a reader: a removed record is not selected, and an edited one says what the person wrote", async () => {
    const corrected = world();
    const first = await corrected.prepare();
    const react = written(first.prepared).find((each) =>
      each.text.startsWith("React for internal"),
    );
    const metrics = written(first.prepared).find((each) =>
      each.text.startsWith("Experience introducing delivery metrics"),
    );
    await correctApplicationPack(
      corrected.engine,
      {
        candidacyId: CANDIDACY,
        corrections: [
          { recordId: metrics?.id ?? "", action: "remove" },
          {
            recordId: react?.id ?? "",
            action: "edit",
            text: "React for internal tools",
          },
        ],
      },
      execution(),
    );
    const pack = await prepareStagePack(
      corrected.engine,
      stageContext(fixture.material, fixture.brief),
      execution(),
      2,
      { kept: await corrected.kept() },
    );
    const texts = pack.prepared.records.map((record) => record.text);
    expect(texts).toContain("React for internal tools");
    expect(texts).not.toContain("React for internal and customer-facing tools");
    expect(texts).not.toContain(
      "Experience introducing delivery metrics to a team",
    );
  });

  it("is refused for a record the pack does not hold, and when nothing was prepared", async () => {
    const corrected = world();
    await expect(
      correctApplicationPack(
        corrected.engine,
        {
          candidacyId: CANDIDACY,
          corrections: [{ recordId: "anything", action: "confirm" }],
        },
        execution(),
      ),
    ).rejects.toThrow("The context pack could not be prepared.");
    await corrected.prepare();
    await expect(
      correctApplicationPack(
        corrected.engine,
        {
          candidacyId: CANDIDACY,
          corrections: [{ recordId: "no-such-record", action: "confirm" }],
        },
        execution(),
      ),
    ).rejects.toThrow();
  });
});

describe("a pack is one member's own", () => {
  it("is kept under the application AND the member: another member, and another workspace, read nothing", async () => {
    const mine = world();
    await mine.prepare();
    expect(packKey(CANDIDACY, BENCH_SCOPE.actorId)).toBe(
      `application:${CANDIDACY}:${BENCH_SCOPE.actorId}`,
    );
    expect(
      await loadKeptPack(mine.store, BENCH_SCOPE, CANDIDACY),
    ).toBeDefined();
    const colleague = {
      ...BENCH_SCOPE,
      actorId: "00000000-0000-4000-8000-0000000000c9",
    };
    expect(
      await loadKeptPack(mine.store, colleague, CANDIDACY),
    ).toBeUndefined();
    const elsewhere = {
      ...BENCH_SCOPE,
      tenantId: "00000000-0000-4000-8000-0000000000c8",
    };
    expect(
      await loadKeptPack(mine.store, elsewhere, CANDIDACY),
    ).toBeUndefined();
    expect(
      await loadKeptPack(
        mine.store,
        BENCH_SCOPE,
        "00000000-0000-4000-8000-00000000b999",
      ),
    ).toBeUndefined();
    // Kept under this product: another product's scope has nothing.
    expect(
      await mine.store.load?.(
        { tenantId: BENCH_SCOPE.tenantId, productId: "presentation" },
        {
          key: packKey(CANDIDACY, BENCH_SCOPE.actorId),
          recipeId: "interview-context",
        },
      ),
    ).toBeUndefined();
    expect(
      await mine.store.load?.(
        { tenantId: BENCH_SCOPE.tenantId, productId: INTERVIEW_PRODUCT_ID },
        {
          key: packKey(CANDIDACY, BENCH_SCOPE.actorId),
          recipeId: "interview-context",
        },
      ),
    ).toBeDefined();
  });

  it("reads as no pack when there is no store, or the store does not answer", async () => {
    expect(
      await loadKeptPack(undefined, BENCH_SCOPE, CANDIDACY),
    ).toBeUndefined();
    expect(
      await loadKeptPack(
        {
          load: async () => {
            throw new Error("the database is away");
          },
        },
        BENCH_SCOPE,
        CANDIDACY,
      ),
    ).toBeUndefined();
    expect(await loadKeptPack({}, BENCH_SCOPE, CANDIDACY)).toBeUndefined();
  });

  it("is not kept at all by an engine with no store: the preparation still answers", async () => {
    const model = scriptedModel(fixture);
    const { createAiEngine } = await import("@omnitech/ai-engine");
    const engine = createAiEngine({
      profiles: [
        {
          id: BENCH_PROFILE,
          provider: "scripted",
          window: BENCH_WINDOWS.large,
          locality: "device",
        },
      ],
      providers: { scripted: model.port },
      log: { level: "silent" },
    });
    const done = await prepareApplicationPack(
      engine,
      {
        candidacyId: CANDIDACY,
        sources: applicationSources(applicationOf(fixture)),
        profileId: BENCH_PROFILE,
        kept: undefined,
      },
      execution(),
    );
    expect(written(done.prepared).length).toBe(55);
  });
});

// A second transcript, of the technical stage, that may be read anywhere.
const SECOND = "00000000-0000-4000-8000-00000000e002";
const withTechnicalRound = (
  from: PreparedFixture,
  capturePolicy: "device-only" | "permitted-remote" = "permitted-remote",
): PreparedFixture => ({
  ...from,
  brief: {
    ...from.brief,
    stages: from.brief.stages.map((stage) =>
      stage.ordinal === 2
        ? {
            ...stage,
            transcripts: [
              {
                id: SECOND,
                title: "Technical round",
                origin: "pasted",
                capturePolicy,
                occurredAt: null,
                sha256: "b".repeat(64),
                text: "11:05:00 --> 11:05:12\nAsta: who owns the payout record once a refund reverses it\n\n11:05:15 --> 11:05:30\nMe: the same owner, a reversal is a new event on the same record\n",
              },
            ],
          }
        : stage,
    ),
  },
  extraction: {
    ...from.extraction,
    sources: [
      ...from.extraction.sources,
      {
        source: `transcript:${SECOND}`,
        kind: "transcript",
        records: [
          {
            kind: KINDS.asked,
            text: "Who owns the payout record once a refund reverses it?",
            quote: "who owns the payout record once a refund reverses it",
            fields: { askedBy: "Asta" },
            themes: ["ownership", "refund"],
            answers: [],
          },
        ],
      },
    ],
  },
});
const OWNERSHIP = "Who should own the payout record?";

describe("a later stage, resolved from the prepared pack, when the earlier stage's transcript may leave this device", () => {
  const staged = withTechnicalRound(permitted);
  let kept: Awaited<
    ReturnType<ReturnType<typeof world>["prepare"]>
  >["prepared"];
  let staging: ReturnType<typeof world>;
  const packFor = (stage: number | "all") =>
    prepareStagePack(
      staging.engine,
      stageContext(staged.material, staged.brief),
      execution(),
      stage,
      { kept },
    );
  beforeAll(async () => {
    staging = world({ from: staged });
    kept = (await staging.prepare()).prepared;
  });

  it("brings stage 1's questions after stage 2's own", async () => {
    const pack = await packFor(2);
    const asked = pack
      .facts("coach", OWNERSHIP)
      .filter((fact) => fact.slot === "asked");
    expect(asked.map((fact) => fact.text)).toEqual([
      // The technical round's own question leads.
      "Who owns the payout record once a refund reverses it?",
      // What the hiring manager asked follows.
      "When two teams both need the same payout record, who should own it?",
    ]);
    expect(asked.every((fact) => fact.about === "employer")).toBe(true);
    // Each is addressed by its transcript and its moment.
    expect(asked[1]?.pointer).toBe(`${TRANSCRIPT}@10:02:10-10:02:24`);
  });

  it("brings what stage 1 said to expect", async () => {
    const pack = await packFor(2);
    const signals = pack
      .facts("coach", "What about idempotent payouts in the technical round?")
      .filter((fact) => fact.slot === "signals");
    expect(signals.map((fact) => fact.text)).toEqual([
      "The technical round is next: expect a question on idempotent payouts.",
    ]);
  });

  it("leaves a later stage's questions out of an earlier stage, and says it was for scope", async () => {
    const pack = await packFor(1);
    const view = pack.view("coach", OWNERSHIP);
    expect(
      view.selected
        .filter((fact) => fact.slot === "asked")
        .map((fact) => fact.text),
    ).toEqual([
      "When two teams both need the same payout record, who should own it?",
    ]);
    // The later stage's transcript is no part of an earlier stage's pack:
    // what was read from it is not there, and its turn is listed as left out
    // for its stage.
    expect(
      pack.prepared.records.some((record) =>
        record.text.startsWith("Who owns the payout record once"),
      ),
    ).toBe(false);
    expect(
      view.excluded.find((fact) =>
        fact.text.includes("once a refund reverses"),
      ),
    ).toMatchObject({ kind: KINDS.turn, reason: "scope", stage: 2 });
  });

  it("reads every stage's with no stage named", async () => {
    const pack = await packFor("all");
    expect(
      pack.facts("inspect", OWNERSHIP).filter((fact) => fact.slot === "asked")
        .length,
    ).toBe(2);
  });

  it("follows a question asked before to the story a model tied to it", async () => {
    const pack = await packFor(2);
    const ASKED =
      "When two teams both need the same payout record, who should own it?";
    const tied = (fact: { text: string }) =>
      fact.text.includes("Kept quote workflow state on the server");
    // Everything that bears on the question (the inspecting view): the
    // achievement a model tied to the question is in the ranking though it
    // shares none of the question's words.
    const all = pack
      .resolve("inspect", ASKED)
      .selected.filter((fact) => fact.slot === "evidence");
    expect(all.find(tied)?.score.words).toBe(0);
    // It breaks a tie and never outranks an achievement that answers the
    // question itself: every achievement before it matches more words.
    const at = all.findIndex(tied);
    for (const before of all.slice(0, at))
      expect(before.score.words).toBeGreaterThan(0);
    // With no kept pack the same question does not find it at all.
    const without = await prepareStagePack(
      staging.engine,
      stageContext(staged.material, staged.brief),
      execution(),
      2,
    );
    expect(
      without
        .resolve("inspect", ASKED)
        .selected.filter((fact) => fact.slot === "evidence")
        .some(tied),
    ).toBe(false);
  });

  it("selects for a stage in milliseconds, with no model call", async () => {
    const pack = await packFor(2);
    const before = staging.model.calls.length;
    const started = performance.now();
    for (const question of fixture.gold.questions)
      pack.resolve("coach", question.question);
    const each = (performance.now() - started) / fixture.gold.questions.length;
    expect(staging.model.calls.length).toBe(before);
    // The live coach's budget is seconds; one selection is a few milliseconds.
    expect(each).toBeLessThan(100);
  });
});

// [SAFETY] The mirror image: the same application with the hiring-manager call
// as it was RECORDED, under a device-only policy. A model that runs on this
// machine read it, so the kept pack holds what it said. No remote reader is
// given any of it, by id or by its words; the person's own screen is.
describe("a later stage, when the earlier stage's transcript is device-only", () => {
  const staged = withTechnicalRound(fixture);
  let kept: Prepared;
  let staging: ReturnType<typeof world>;
  // What the kept pack holds of the device-only transcript.
  let extracted: Prepared["records"];
  const packFor = (
    stage: number | "all",
    reader?: "device" | "remote",
    from: PreparedFixture = staged,
    held: Prepared | undefined = kept,
  ) =>
    prepareStagePack(
      staging.engine,
      stageContext(from.material, from.brief),
      execution(),
      stage,
      { kept: held, ...(reader ? { reader } : {}) },
    );
  beforeAll(async () => {
    staging = world({ from: staged });
    kept = (await staging.prepare()).prepared;
    extracted = written(kept).filter((each) => each.source.id === TRANSCRIPT);
  });

  it("was read by the profile that runs here, so the kept pack does hold what it said", () => {
    expect(extracted.map((each) => each.kind)).toEqual([
      KINDS.asked,
      KINDS.answered,
      KINDS.asked,
      KINDS.answered,
      KINDS.signal,
    ]);
    // Every word the suite looks for is there to be found.
    expect(saidIn(kept)).toEqual(SAID_ONLY_THERE);
    // And a model tied a question it asked to the person's story.
    const ids = new Set(extracted.map((each) => each.id));
    expect(
      (kept.links ?? []).filter(
        (link) => ids.has(link.from) || ids.has(link.to),
      ).length,
    ).toBeGreaterThan(0);
  });

  it.each([
    ["by default", undefined],
    ["when it says it is remote", "remote" as const],
  ])(
    "gives a remote reader %s nothing of it: no record, no tie, no word, whatever the stage",
    async (_name, reader) => {
      const ids = new Set(extracted.map((each) => each.id));
      for (const stage of [2, 1, "all"] as const) {
        const pack = await packFor(stage, reader);
        // By id: no turn of it, nothing extracted from it, no tie to either.
        expect(
          pack.prepared.records.filter(
            (record) => record.source.id === TRANSCRIPT,
          ),
        ).toEqual([]);
        expect(pack.prepared.sources.map((source) => source.id)).not.toContain(
          TRANSCRIPT,
        );
        for (const link of [...(pack.prepared.links ?? []), ...pack.gaps])
          expect(ids.has(link.from) || ids.has(link.to)).toBe(false);
        // By its words: everything a reader could be handed, serialised.
        expect(saidIn(pack.prepared), String(stage)).toEqual([]);
        expect(saidIn(pack.gaps)).toEqual([]);
        for (const projection of [
          "coach",
          "answer",
          "briefing",
          "document",
          "inspect",
        ] as const) {
          expect(
            saidIn(pack.facts(projection, OWNERSHIP)),
            `${stage} ${projection}`,
          ).toEqual([]);
          expect(saidIn(pack.view(projection, OWNERSHIP))).toEqual([]);
          expect(saidIn(pack.resolve(projection, ""))).toEqual([]);
        }
      }
    },
  );

  it("carries nothing of it to stage 2's coach: stage 2's own question is all that was asked before, and nothing was said to expect", async () => {
    const pack = await packFor(2);
    expect(
      pack
        .facts("coach", OWNERSHIP)
        .filter((fact) => fact.slot === "asked")
        .map((fact) => fact.text),
    ).toEqual(["Who owns the payout record once a refund reverses it?"]);
    expect(
      pack
        .facts("coach", "What about idempotent payouts in the technical round?")
        .filter((fact) => fact.slot === "signals"),
    ).toEqual([]);
    expect(
      (await packFor("all"))
        .facts("inspect", OWNERSHIP)
        .filter((fact) => fact.slot === "asked").length,
    ).toBe(1);
    // The story a model tied to the withheld question is not brought by it:
    // the selection is the one a pack with nothing kept of the call gives.
    const ASKED =
      "When two teams both need the same payout record, who should own it?";
    const evidence = (of: Awaited<ReturnType<typeof packFor>>) =>
      of
        .resolve("inspect", ASKED)
        .selected.filter((fact) => fact.slot === "evidence")
        .map((fact) => fact.recordId);
    expect(evidence(pack)).not.toContain(
      pack.prepared.records.find((record) =>
        record.text.includes("Kept quote workflow state on the server"),
      )?.id,
    );
    // What was read from sources that may leave is still there.
    expect(
      pack.prepared.records.some(
        (record) => record.by === "model" && record.source.id === POSTING,
      ),
    ).toBe(true);
  });

  it("shows the person all of it on their own screen", async () => {
    const pack = await packFor(2, "device");
    const view = pack.view("inspect", OWNERSHIP);
    const asked = view.selected.filter((fact) => fact.slot === "asked");
    expect(asked.map((fact) => [fact.text, fact.pointer])).toEqual([
      [
        "Who owns the payout record once a refund reverses it?",
        `stage:${staged.brief.stages[1]?.id}:transcript:${SECOND}@11:05:00-11:05:12`,
      ],
      [
        "When two teams both need the same payout record, who should own it?",
        `${TRANSCRIPT}@10:02:10-10:02:24`,
      ],
    ]);
    expect(
      pack
        .view(
          "inspect",
          "What about idempotent payouts in the technical round?",
        )
        .selected.filter((fact) => fact.slot === "signals")
        .map((fact) => fact.text),
    ).toEqual([
      "The technical round is next: expect a question on idempotent payouts.",
    ]);
    // Its turns are in the pack, each marked as not to leave the device, and
    // the view says of the source that it is not sendable.
    const turns = pack.prepared.records.filter(
      (record) => record.kind === KINDS.turn && record.source.id === TRANSCRIPT,
    );
    expect(turns.length).toBe(5);
    for (const turn of turns) expect(turn.fields?.["deviceOnly"]).toBe(true);
    expect(saidIn(pack.prepared)).toEqual(SAID_ONLY_THERE);
    expect(
      view.sources.find((source) => source.id === TRANSCRIPT),
    ).toMatchObject({ kind: "transcript", stage: 1, sendable: false });
    // The remote reader's view still says the source exists and is kept
    // here, and says nothing it holds.
    const remote = (await packFor(2)).view("inspect", OWNERSHIP);
    expect(
      remote.sources.find((source) => source.id === TRANSCRIPT),
    ).toMatchObject({ kind: "transcript", stage: 1, sendable: false });
  });

  it("does not list a later stage's device-only turns as left out for scope, except on the person's own screen", async () => {
    // The technical round's own transcript, this time kept on the device.
    const later = withTechnicalRound(fixture, "device-only");
    const said = "once a refund reverses";
    const remote = (await packFor(1, undefined, later, undefined)).view(
      "coach",
      OWNERSHIP,
    );
    expect(JSON.stringify(remote)).not.toContain(said);
    expect(remote.excluded.filter((fact) => fact.kind === KINDS.turn)).toEqual(
      [],
    );
    const shown = (await packFor(1, "device", later, undefined)).view(
      "coach",
      OWNERSHIP,
    );
    expect(
      shown.excluded.find((fact) => fact.text.includes(said)),
    ).toMatchObject({ kind: KINDS.turn, reason: "scope", stage: 2 });
  });
});

const DATABASE = {
  name: "the database handle",
} as unknown as PlatformDatabase;
const SESSION = {
  ...BENCH_SCOPE,
  sessionId: "00000000-0000-4000-8000-0000000000d1",
};
// A session of the application's technical stage, as the coach loads it.
const technicalSession = (from: PreparedFixture) => {
  const technical = from.brief.stages[1] as BriefMaterial["stages"][number];
  const context = stageContext(from.material, from.brief);
  return {
    ...context,
    material: {
      ...(context.material as NonNullable<typeof context.material>),
      stage: {
        id: technical.id,
        ordinal: 2,
        label: technical.label,
        kind: technical.kind,
      },
    },
  };
};
const SPOKEN =
  "When two teams both need the same payout record, who should own it? Expect idempotent payouts.";
// The same thing asked in words the hiring-manager call did not use, so a
// prompt built from it holds that call's words only if a fact brought them.
const ASKED_AGAIN =
  "Who should own a payout record that two teams need? Should I expect idempotent payouts?";
const promptFor = (
  facts: NonNullable<Parameters<typeof coachPromptParts>[0]["facts"]>,
  text: string,
) =>
  coachPromptParts({
    lines: [
      { seq: 1, speaker: "interviewer", text, at: "2026-03-12T14:05:00.000Z" },
    ],
    readTo: 0,
    notes: [],
    facts,
    reason: "question-finished",
  });

describe("the live coach, on a stage-2 session of a prepared application whose earlier transcript may leave this device", () => {
  const session = () => technicalSession(permitted);
  let prepared: ReturnType<typeof world>;
  beforeAll(async () => {
    prepared = world({ from: permitted });
    await prepared.prepare();
  });
  beforeEach(() => {
    load.mockReset();
    load.mockResolvedValue(session());
  });

  it("is given what stage 1 asked and said to expect, as employer material", async () => {
    const coach = createCoachContext(
      DATABASE,
      prepared.engine,
      Date.now,
      prepared.store,
    );
    const before = prepared.model.calls.length;
    const facts = await coach.facts(SESSION, SPOKEN);
    // [SAFETY] No model is asked on the coach's path.
    expect(prepared.model.calls.length).toBe(before);
    const question = facts.find((fact) =>
      fact.text.startsWith("When two teams both need the same payout record"),
    );
    const signal = facts.find((fact) =>
      fact.text.includes("expect a question on idempotent payouts"),
    );
    expect(question).toMatchObject({
      about: "employer",
      pointer: `${TRANSCRIPT}@10:02:10-10:02:24`,
    });
    expect(signal?.about).toBe("employer");

    const prompt = promptFor(facts, SPOKEN).whole;
    const employer = prompt.slice(
      prompt.indexOf("EMPLOYER MATERIAL (not the candidate's experience):"),
    );
    expect(employer).toContain(
      `[${TRANSCRIPT}@10:02:10-10:02:24] When two teams both need the same payout record, who should own it?`,
    );
    expect(employer).toContain(
      "The technical round is next: expect a question on idempotent payouts.",
    );
    // And never under the candidate's own record.
    const record = prompt.slice(
      prompt.indexOf("THE CANDIDATE'S RECORD (cite a fact by its [pointer]):"),
      prompt.indexOf("EMPLOYER MATERIAL (not the candidate's experience):"),
    );
    expect(record).not.toContain("who should own it");
    expect(record).not.toContain("idempotent payouts");
    // Asked again in other words, the same two are brought: the question the
    // device-only mirror below asks does find them when they may be sent.
    const again = await coach.facts(SESSION, ASKED_AGAIN);
    const brought = [
      "both need the same payout record",
      "expect a question on idempotent payouts",
      // Each is cited by its moment on the transcript's clock.
      "10:02:10",
      "10:41:05",
    ];
    expect(saidIn(again)).toEqual(brought);
    expect(saidIn(promptFor(again, ASKED_AGAIN))).toEqual(brought);
  });

  it("stays verified: a claim is checked against the candidate's own facts only", async () => {
    const coach = createCoachContext(
      DATABASE,
      prepared.engine,
      Date.now,
      prepared.store,
    );
    const facts = await coach.facts(SESSION, SPOKEN);
    const known = new Map(
      facts
        .filter((fact) => fact.about !== "employer")
        .map((fact) => [fact.pointer, fact.text]),
    );
    // One of the person's own achievements the coach was given.
    const own = facts.find(
      (fact) => fact.about === "candidate" && fact.text.startsWith("At "),
    );
    expect(own?.pointer).toMatch(/^\/roles\/\d+\/\w+\/\d+$/);
    const said = /\): ([^.;]+)/.exec(own?.text ?? "")?.[1] ?? "";
    // What a transcript says is never among the facts a claim verifies on.
    expect(known.has(`${TRANSCRIPT}@10:02:10-10:02:24`)).toBe(false);
    for (const pointer of known.keys())
      expect(pointer.startsWith("/")).toBe(true);

    const claim = (say: string) =>
      parseCoachReply(
        `ASK: Evidence\nSAY: ${say}`,
        true,
        known,
      )?.note.sections?.[0]?.lines[0]?.segments?.find(
        (segment) => segment.role === "evidence",
      );
    // Cited on the person's own fact, in its own words: verified.
    expect(claim(`I **${said}**[${own?.pointer}].`)).toMatchObject({
      grounding: "verified",
      source: own?.pointer,
    });
    // Cited on what the transcript says: the coach's inference, never a
    // verified fact of the person's record.
    expect(
      claim(
        `They **asked who should own the payout record**[${TRANSCRIPT}@10:02:10-10:02:24].`,
      )?.grounding,
    ).toBe("inferred");
  });

  it("is given exactly what it was given before when no pack is kept, or none can be read", async () => {
    const without = await createCoachContext(DATABASE, prepared.engine).facts(
      SESSION,
      SPOKEN,
    );
    expect(
      without.some((fact) => fact.text.includes("who should own it?")),
    ).toBe(false);
    expect(without.some((fact) => fact.pointer.includes("@"))).toBe(false);
    const empty = await createCoachContext(
      DATABASE,
      prepared.engine,
      Date.now,
      createMemoryPackStore(),
    ).facts(SESSION, SPOKEN);
    expect(empty).toEqual(without);
    const broken = await createCoachContext(
      DATABASE,
      prepared.engine,
      Date.now,
      {
        load: async () => {
          throw new Error("the database is away");
        },
      },
    ).facts(SESSION, SPOKEN);
    expect(broken).toEqual(without);
    // Another member's session of the same application reads no pack.
    const other = await createCoachContext(
      DATABASE,
      prepared.engine,
      Date.now,
      prepared.store,
    ).facts(
      { ...SESSION, actorId: "00000000-0000-4000-8000-0000000000c9" },
      SPOKEN,
    );
    expect(other).toEqual(without);
  });

  it("reads the kept pack once a minute at most, like the material", async () => {
    const loads = vi.fn(
      prepared.store.load as NonNullable<typeof prepared.store.load>,
    );
    let now = Date.parse("2026-03-12T14:00:00.000Z");
    const coach = createCoachContext(DATABASE, prepared.engine, () => now, {
      load: loads,
    });
    await coach.facts(SESSION, SPOKEN);
    await coach.facts(SESSION, "How do you mentor engineers?");
    expect(loads).toHaveBeenCalledTimes(1);
    now += 61_000;
    await coach.facts(SESSION, SPOKEN);
    expect(loads).toHaveBeenCalledTimes(2);
  });
});

// [SAFETY] The coach's prompt is sent to a model that does not run on this
// machine (coach.ts: `policy: "permitted-remote"`; the worker runs it on
// Claude Code or Codex). With the hiring-manager call as it was recorded,
// device-only, nothing a local model extracted from it reaches that prompt.
describe("the live coach, when the earlier stage's transcript is device-only", () => {
  let prepared: ReturnType<typeof world>;
  beforeAll(async () => {
    // Prepared by a profile that runs here: the kept pack holds the call.
    prepared = world();
    await prepared.prepare();
  });
  beforeEach(() => {
    load.mockReset();
    load.mockResolvedValue(technicalSession(fixture));
  });

  it("is given nothing extracted from it, by pointer or by its words, though the kept pack holds it", async () => {
    expect(saidIn(await prepared.kept())).toEqual(SAID_ONLY_THERE);
    const coach = createCoachContext(
      DATABASE,
      prepared.engine,
      Date.now,
      prepared.store,
    );
    for (const spoken of [
      SPOKEN,
      ASKED_AGAIN,
      "How would you bring a new engineer onto the rota?",
      "",
    ]) {
      const facts = await coach.facts(SESSION, spoken);
      expect(facts.length, spoken).toBeGreaterThan(0);
      expect(
        facts.filter((fact) => fact.pointer.includes(TRANSCRIPT)),
        spoken,
      ).toEqual([]);
      expect(saidIn(facts), spoken).toEqual([]);
    }
    // The prompt the remote model is sent, every part of it.
    const facts = await coach.facts(SESSION, ASKED_AGAIN);
    const prompt = promptFor(facts, ASKED_AGAIN);
    expect(saidIn(prompt)).toEqual([]);
    expect(JSON.stringify(prompt)).not.toContain(TRANSCRIPT);
    // What a model read from the posting, which may leave, is still given.
    expect(facts.some((fact) => fact.pointer.startsWith(`${POSTING}@`))).toBe(
      true,
    );
  });

  it("is given what it is given with the call never read at all", async () => {
    // A pack prepared by a profile that does not run here never read the
    // transcript. The coach of the pack that did read it is given the same.
    const never = world({ onDevice: false });
    await never.prepare();
    const facts = (from: ReturnType<typeof world>) =>
      createCoachContext(DATABASE, from.engine, Date.now, from.store).facts(
        SESSION,
        ASKED_AGAIN,
      );
    expect(await facts(prepared)).toEqual(await facts(never));
  });
});
