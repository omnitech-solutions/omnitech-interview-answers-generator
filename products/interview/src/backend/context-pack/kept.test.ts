// A pack a model prepared, read with today's material (kept.ts): what of it
// still stands, what it replaces, and what the person's review changes. The
// packs here are written by hand, record by record, so each rule is seen on
// its own; prepare.test.ts proves the same rules on a pack the engine made.
// Every name and figure is invented.
import type { ContextLink, ContextRecord, Prepared } from "@omnitech/ai-engine";
import { createAiEngine } from "@omnitech/ai-engine";
import { describe, expect, it } from "vitest";
import { contextOf, EXECUTION } from "./fixture";
import { FROM_THE_POSTING, sectionOf, standing, withKept } from "./kept";
import { prepareContextPack, sessionSources } from "./pack";
import { KINDS, LINKS } from "./recipe";

const RECIPE = { id: "interview-context", version: "3" };
const record = (
  id: string,
  kind: string,
  text: string,
  source: ContextRecord["source"],
  more: Partial<ContextRecord> = {},
): ContextRecord => ({
  id,
  kind,
  text,
  source,
  hash: `hash-of-${id}`,
  ...more,
});
// A record the product gave, and one a model extracted with its quote.
const own = (
  id: string,
  kind: string,
  text: string,
  sourceId: string,
  fields?: ContextRecord["fields"],
) =>
  record(
    id,
    kind,
    text,
    { id: sourceId, revision: "1" },
    {
      by: "code",
      ...(fields ? { fields } : {}),
    },
  );
const read = (
  id: string,
  kind: string,
  text: string,
  sourceId: string,
  quote: string,
  more: Partial<ContextRecord> = {},
) =>
  record(
    id,
    kind,
    text,
    { id: sourceId, revision: "1", quote, locator: "chars:0-10" },
    { by: "model", verified: "quote-found", ...more },
  );
const link = (
  step: string,
  from: string,
  to: string,
  by: ContextLink["by"],
  fields?: ContextLink["fields"],
): ContextLink => ({
  id: `link:${step}:${from}:${to}`,
  step,
  from,
  to,
  by,
  verified: "ends-exist",
  ...(fields ? { fields } : {}),
});
const pack = (
  records: ContextRecord[],
  sources: [string, string][],
  more: Partial<Prepared> = {},
): Prepared => ({
  recipe: RECIPE,
  sources: sources.map(([id, revision]) => ({ id, revision })),
  records,
  rejected: [],
  ...more,
});

const ROLE = own(
  "role:harbour",
  KINDS.role,
  "Staff Engineer, Harbourline",
  "matrix:m",
  {
    company: "Harbourline",
    technologies: ["Go", "PostgreSQL"],
  },
);
const ACHIEVEMENT = own(
  "role:harbour:proof:1",
  KINDS.achievement,
  "At Harbourline: Rewrote the berth scheduler in Go.",
  "matrix:m",
  {
    company: "Harbourline",
    stack: ["Go", "PostgreSQL"],
    of: { role: "role:harbour" },
  },
);
const BRIEF_MUST = own(
  "brief:mustHaves:1",
  KINDS.requirement,
  "Five years of Go",
  "brief:c",
  {
    section: "mustHaves",
  },
);
const BRIEF_NOTE = own(
  "brief:prepNotes:1",
  KINDS.prep,
  "Round: the head of platform",
  "brief:c",
  {
    section: "prepNotes",
  },
);
const RESEARCH_LINE = own(
  "research:r:line1",
  KINDS.employerFact,
  "Larkspur sells tide forecasts to 300 marinas.",
  "research:r",
  { section: "research" },
);
const RESEARCH_OTHER = own(
  "research:r:line2",
  KINDS.employerFact,
  "The office is in Lisbon.",
  "research:r",
  { section: "research" },
);
const FRESH = pack(
  [ROLE, ACHIEVEMENT, BRIEF_MUST, BRIEF_NOTE, RESEARCH_LINE, RESEARCH_OTHER],
  [
    ["matrix:m", "1"],
    ["brief:c", "1"],
    ["research:r", "1"],
    ["posting:c", "1"],
  ],
  {
    links: [
      link(LINKS.names, BRIEF_NOTE.id, ACHIEVEMENT.id, "code", {
        basis: "employer",
      }),
    ],
  },
);
const POSTED = read(
  "posting:c:req1",
  KINDS.requirement,
  "Go in production",
  "posting:c",
  "We ask for Go in production",
  { fields: { section: "mustHaves", level: "must" }, themes: ["go"] },
);
const FOUND = read(
  "research:r:fact1",
  KINDS.employerFact,
  "Sells tide forecasts to 300 marinas",
  "research:r",
  "sells tide forecasts to 300 marinas",
  { fields: { section: "company" } },
);
const KEPT = pack(
  [ROLE, ACHIEVEMENT, BRIEF_NOTE, POSTED, FOUND],
  [
    ["matrix:m", "1"],
    ["brief:c", "1"],
    ["research:r", "1"],
    ["posting:c", "1"],
  ],
  {
    links: [
      link(LINKS.fit, POSTED.id, ACHIEVEMENT.id, "model", {
        strength: "strong",
      }),
      link(LINKS.names, BRIEF_NOTE.id, ACHIEVEMENT.id, "code", {
        basis: "employer",
      }),
    ],
    rejected: [
      {
        sourceId: "posting:c",
        reason: "the quoted words are not in the source",
        code: "quote-not-found",
        extractor: "posting",
        text: "Invented",
      },
    ],
    holes: [],
  },
);
const ids = (prepared: Prepared) => prepared.records.map((each) => each.id);

describe("what of a kept pack still stands", () => {
  it("is what a model extracted from a source at the revision it is at now", () => {
    const { records, current } = standing(FRESH, KEPT);
    expect(records.map((each) => each.id)).toEqual([POSTED.id, FOUND.id]);
    expect(current).toEqual(
      new Set(["matrix:m", "brief:c", "research:r", "posting:c"]),
    );
  });

  // [SAFETY] A fact whose source changed since it was read is not read.
  it("is nothing of a source that has changed since, or that is no longer there", () => {
    const changed = {
      ...FRESH,
      sources: FRESH.sources.map((each) =>
        each.id === "research:r" ? { ...each, revision: "2" } : each,
      ),
    };
    expect(standing(changed, KEPT).records.map((each) => each.id)).toEqual([
      POSTED.id,
    ]);
    const gone = {
      ...FRESH,
      sources: FRESH.sources.filter((each) => each.id !== "posting:c"),
    };
    expect(standing(gone, KEPT).records.map((each) => each.id)).toEqual([
      FOUND.id,
    ]);
  });

  it("is nothing of a pack prepared by another recipe, or another version of this one", () => {
    for (const recipe of [
      { id: "interview-context", version: "2" },
      { id: "another-recipe", version: "3" },
    ])
      expect(standing(FRESH, { ...KEPT, recipe })).toEqual({
        records: [],
        current: new Set(),
      });
  });

  it("is never a record the product gave: those are read as they are now", () => {
    for (const each of standing(FRESH, KEPT).records)
      expect(each.by).toBe("model");
  });
});

describe("a kept pack read with today's material", () => {
  it("is today's material untouched when the kept pack has nothing that stands", () => {
    const stale = {
      ...KEPT,
      recipe: { id: "interview-context", version: "2" },
    };
    expect(withKept(FRESH, stale)).toBe(FRESH);
    expect(withKept(FRESH, pack([], []))).toBe(FRESH);
  });

  it("adds what a model extracted, after the person's own records", () => {
    const merged = withKept(FRESH, KEPT);
    expect(ids(merged).slice(-2)).toEqual([POSTED.id, FOUND.id]);
    expect(merged.records.find((each) => each.id === FOUND.id)).toMatchObject({
      by: "model",
      verified: "quote-found",
      source: { quote: "sells tide forecasts to 300 marinas" },
    });
  });

  // The employer brief is the posting cleaned by a model with no pointer
  // back; once the posting itself is read, its copy is not offered twice.
  it("leaves the employer brief's copy of the posting out once the posting is read, and keeps its notes", () => {
    const merged = withKept(FRESH, KEPT);
    expect(ids(merged)).not.toContain(BRIEF_MUST.id);
    expect(ids(merged)).toContain(BRIEF_NOTE.id);
    expect(FROM_THE_POSTING).toEqual([
      "mustHaves",
      "niceToHaves",
      "techStack",
      "responsibilities",
      "companyFacts",
      "values",
      "summary",
      "team",
      "interviewFormat",
    ]);
    expect(FROM_THE_POSTING).not.toContain("prepNotes");
    expect(FROM_THE_POSTING).not.toContain("questionsToAsk");
  });

  it("keeps the employer brief whole while the posting has not been read", () => {
    const unread = {
      ...KEPT,
      records: KEPT.records.filter((each) => each.id !== POSTED.id),
    };
    expect(ids(withKept(FRESH, unread))).toContain(BRIEF_MUST.id);
  });

  it("leaves a raw line out when a model's record quotes it, and keeps a line nothing quotes", () => {
    const merged = withKept(FRESH, KEPT);
    expect(ids(merged)).not.toContain(RESEARCH_LINE.id);
    expect(ids(merged)).toContain(RESEARCH_OTHER.id);
    // A quote is compared without case and with every run of space one.
    const spaced = {
      ...KEPT,
      records: KEPT.records.map((each) =>
        each.id === FOUND.id
          ? {
              ...each,
              source: {
                ...each.source,
                quote: "SELLS  tide\nforecasts to 300 marinas",
              },
            }
          : each,
      ),
    };
    expect(ids(withKept(FRESH, spaced))).not.toContain(RESEARCH_LINE.id);
  });

  it("keeps a model's tie whose two ends are both there, and drops one that hangs", () => {
    const merged = withKept(FRESH, KEPT);
    expect(merged.links).toContainEqual(
      expect.objectContaining({
        step: LINKS.fit,
        from: POSTED.id,
        to: ACHIEVEMENT.id,
        by: "model",
      }),
    );
    // Today's own ties stay, once.
    expect(
      (merged.links ?? []).filter((each) => each.step === LINKS.names).length,
    ).toBe(1);
    const gone = pack(
      FRESH.records.filter((each) => each.id !== ACHIEVEMENT.id),
      FRESH.sources.map(({ id, revision }) => [id, revision]),
      { links: [] },
    );
    expect(
      (withKept(gone, KEPT).links ?? []).some(
        (each) => each.step === LINKS.fit,
      ),
    ).toBe(false);
  });

  it("ties an extracted requirement to the person's technologies by the rule every requirement is tied by", () => {
    const merged = withKept(FRESH, KEPT);
    const requirement = merged.records.find((each) => each.id === POSTED.id);
    expect(requirement?.fields?.["technologies"]).toEqual(["Go"]);
    expect(merged.links).toContainEqual(
      expect.objectContaining({
        step: LINKS.stack,
        from: POSTED.id,
        to: ACHIEVEMENT.id,
        by: "code",
        fields: { technology: "Go", via: "own" },
      }),
    );
  });

  it("carries what could not be read and what was refused, for the sources that are still there", () => {
    const holed = {
      ...KEPT,
      holes: [
        {
          sourceId: "posting:c",
          reason: "not-extracted" as const,
          failure: { code: "timeout" } as never,
        },
        {
          sourceId: "research:gone",
          reason: "locality" as const,
          failure: { code: "refused" } as never,
        },
      ],
    };
    const merged = withKept(FRESH, holed);
    expect(merged.holes?.map((each) => each.sourceId)).toEqual(["posting:c"]);
    expect(merged.rejected.map((each) => each.text)).toEqual(["Invented"]);
  });
});

describe("what the person did in the review, for a reader", () => {
  it("leaves a removed record out, whoever wrote it", () => {
    const merged = withKept(FRESH, {
      ...KEPT,
      removed: [POSTED.id, RESEARCH_OTHER.id],
    });
    expect(ids(merged)).not.toContain(POSTED.id);
    expect(ids(merged)).not.toContain(RESEARCH_OTHER.id);
    expect(merged.removed).toEqual([POSTED.id, RESEARCH_OTHER.id]);
    // And no tie is left on what was removed.
    for (const each of merged.links ?? []) {
      expect(each.from).not.toBe(POSTED.id);
      expect(each.to).not.toBe(POSTED.id);
    }
  });

  it("gives an edited record of the person's own material as they wrote it, and marks a confirmed one", () => {
    const merged = withKept(FRESH, {
      ...KEPT,
      records: [
        ROLE,
        ACHIEVEMENT,
        POSTED,
        FOUND,
        {
          ...RESEARCH_OTHER,
          text: "The office is in Porto.",
          themes: ["office"],
          reviewed: "edited" as const,
        },
        { ...BRIEF_NOTE, reviewed: "confirmed" as const },
      ],
    });
    expect(
      merged.records.find((each) => each.id === RESEARCH_OTHER.id),
    ).toMatchObject({
      text: "The office is in Porto.",
      themes: ["office"],
      reviewed: "edited",
    });
    expect(
      merged.records.find((each) => each.id === BRIEF_NOTE.id)?.reviewed,
    ).toBe("confirmed");
  });

  it("keeps an extracted record as the person edited it", () => {
    const merged = withKept(FRESH, {
      ...KEPT,
      records: KEPT.records.map((each) =>
        each.id === POSTED.id
          ? { ...each, text: "Go, three years", reviewed: "edited" as const }
          : each,
      ),
    });
    expect(merged.records.find((each) => each.id === POSTED.id)).toMatchObject({
      text: "Go, three years",
      reviewed: "edited",
    });
  });
});

describe("a section", () => {
  it("is read from a record's fields, and is nothing when there is none", () => {
    expect(sectionOf(BRIEF_MUST)).toBe("mustHaves");
    expect(sectionOf(ROLE)).toBe("");
    expect(sectionOf({ fields: { section: 3 } })).toBe("");
    expect(sectionOf({})).toBe("");
  });
});

describe("a reader with no kept pack", () => {
  const engine = createAiEngine({ profiles: [], providers: {} });

  it("has exactly the pack it had before, for every projection and question", async () => {
    const sources = sessionSources(contextOf());
    const plain = await prepareContextPack(engine, sources, EXECUTION);
    for (const options of [{}, { kept: undefined }, { kept: pack([], []) }]) {
      const same = await prepareContextPack(
        engine,
        sources,
        EXECUTION,
        options,
      );
      expect(same.prepared.records).toEqual(plain.prepared.records);
      for (const question of ["Have you used Go?", "", "Do you know Elixir?"])
        for (const projection of ["coach", "answer", "inspect"] as const)
          expect(same.view(projection, question)).toEqual(
            plain.view(projection, question),
          );
      expect(same.gaps).toEqual([]);
    }
  });

  // [SAFETY] No model is on a reader's path: the engine here has none.
  it("never asks a model, though a source carries the text a preparation would read", async () => {
    const sources = sessionSources(contextOf()).map((source) => ({
      ...source,
      text: "A posting a model would read.",
      kind: source.kind,
    }));
    const prepared = await prepareContextPack(engine, sources, EXECUTION);
    expect(prepared.prepared.records.every((each) => each.by === "code")).toBe(
      true,
    );
    expect(prepared.prepared.rejected).toEqual([]);
  });

  it("reads a stage's extracted records after its own, and never follows a gap as evidence", async () => {
    const sources = sessionSources(contextOf());
    const base = await prepareContextPack(engine, sources, EXECUTION);
    const achievement = base.prepared.records.find(
      (each) => each.kind === KINDS.achievement,
    );
    const requirement = read(
      "posting:c:gap",
      KINDS.requirement,
      "Experience with Erlang clustering in production",
      "matrix:profile-1",
      "Erlang clustering",
      { fields: { section: "mustHaves" } },
    );
    const earlier = read(
      "t1:q",
      KINDS.asked,
      "How do you cluster Erlang nodes?",
      "matrix:profile-1",
      "cluster Erlang",
      { scope: "stage:1" },
    );
    const later = read(
      "t3:q",
      KINDS.asked,
      "Why Erlang clustering at all?",
      "matrix:profile-1",
      "Why Erlang",
      { scope: "stage:3" },
    );
    const mine = read(
      "t2:q",
      KINDS.asked,
      "Erlang clustering under load?",
      "matrix:profile-1",
      "under load",
      { scope: "stage:2" },
    );
    const kept: Prepared = {
      ...base.prepared,
      records: [requirement, earlier, later, mine].map((each) => ({
        ...each,
        source: { ...each.source, revision: "3" },
      })),
      links: [
        link(LINKS.fit, requirement.id, achievement?.id ?? "", "model", {
          strength: "gap",
          note: "No Erlang in the record.",
        }),
      ],
    };
    const staged = await prepareContextPack(engine, sources, EXECUTION, {
      kept,
      stage: 2,
    });
    const asked = staged
      .facts("inspect", "Erlang clustering")
      .filter((fact) => fact.slot === "asked")
      .map((fact) => fact.text);
    // This stage's own first, an earlier stage's after, a later one's not.
    expect(asked).toEqual([
      "Erlang clustering under load?",
      "How do you cluster Erlang nodes?",
    ]);
    expect(
      staged
        .view("inspect", "Erlang clustering")
        .excluded.find((fact) => fact.text === "Why Erlang clustering at all?"),
    ).toMatchObject({ slot: "asked", reason: "scope" });
    // The gap is the pack's to show, and brings no evidence.
    expect(staged.gaps.map((each) => each.fields?.["note"])).toEqual([
      "No Erlang in the record.",
    ]);
    expect(
      (staged.prepared.links ?? []).some(
        (each) => each.fields?.["strength"] === "gap",
      ),
    ).toBe(false);
    expect(
      staged
        .facts("inspect", "Erlang clustering")
        .filter((fact) => fact.slot === "evidence"),
    ).toEqual([]);
    // With no stage named, every stage's is read.
    const all = await prepareContextPack(engine, sources, EXECUTION, { kept });
    expect(
      all
        .facts("inspect", "Erlang clustering")
        .filter((fact) => fact.slot === "asked").length,
    ).toBe(3);
    // An extracted record is addressed by its source and its place.
    expect(
      all
        .facts("inspect", "Erlang clustering")
        .find((fact) => fact.slot === "asked")?.pointer,
    ).toBe("matrix:profile-1@chars:0-10");
  });
});
