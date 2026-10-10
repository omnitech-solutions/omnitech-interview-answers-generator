// The context pack's benchmark in PREPARED mode, as a gate: the fixture's
// whole application is prepared by the scripted model built from the
// fixture's gold (bench-prepared.ts; deterministic, no network), at a large
// and a small window, and the prepared pack's scores are asserted. The
// "must be" numbers are exact (nothing invented, no wrong link, every
// model-written record's quote verified); the others are floors, so a change
// that loses one fails here. Every name and figure in the fixture is invented.
import { beforeAll, describe, expect, it } from "vitest";
import { fixtureFolder } from "./bench";
import {
  applicationOf,
  BENCH_PROFILE,
  BENCH_WINDOWS,
  extractionGoldSchema,
  linkGoldSchema,
  type PreparedBenchResult,
  readPreparedFixture,
  readPreparedMaterial,
  reportPreparedBench,
  runPreparedBench,
  scriptedEngine,
  scriptedModel,
  summaryLine,
  withTranscriptsPermitted,
} from "./bench-prepared";
import { runStageBench, type StageBenchResult } from "./bench-stages";
import { applicationSources, createMemoryPackStore } from "./prepare";
import { ABOUT, type ContextKind, EXTRACTORS, KINDS } from "./recipe";

const FIXTURE = "kestrel-freight-pay";
const fixture = readPreparedFixture(FIXTURE);

type Run = PreparedBenchResult & {
  prepared: Awaited<ReturnType<typeof runPreparedBench>>["prepared"];
  calls: number;
  afterOneChange: { calls: number; extracted: number; reused: number };
};
const runs: Record<string, Run> = {};
let before: StageBenchResult["base"];

beforeAll(async () => {
  before = (
    await runStageBench(
      fixture.material,
      fixture.brief,
      fixture.gold,
      fixture.stageGold,
    )
  ).base;
  for (const [name, window] of Object.entries(BENCH_WINDOWS)) {
    const store = createMemoryPackStore();
    const model = scriptedModel(fixture, { misbehave: true });
    const engine = scriptedEngine(model, { window, onDevice: true, store });
    const result = await runPreparedBench(fixture, {
      engine,
      profile: BENCH_PROFILE,
      onDevice: true,
      packs: store,
    });
    const calls = model.calls.length;
    // One research document gains a line.
    const [first] = fixture.brief.research;
    const changed = {
      ...fixture,
      brief: {
        ...fixture.brief,
        research: fixture.brief.research.map((document) =>
          document === first
            ? {
                ...document,
                text: `${document.text}\nA second region is planned.`,
              }
            : document,
        ),
      },
    };
    const again = await runPreparedBench(changed, {
      engine,
      profile: BENCH_PROFILE,
      onDevice: true,
      kept: result.prepared,
      packs: store,
      sources: applicationSources(applicationOf(changed)),
    });
    runs[name] = {
      ...result,
      calls,
      afterOneChange: {
        calls: model.calls.length - calls,
        extracted: again.stats.extracted,
        reused: again.stats.reused,
      },
    };
  }
}, 60_000);
const run = (name: string) => runs[name] as Run;

describe("the fixture's gold for a prepared pack", () => {
  it("has a posting, and gold for every kind of source a model reads", () => {
    expect(fixture.brief.posting?.length).toBeGreaterThan(2_500);
    expect(
      new Set(fixture.extraction.sources.map((source) => source.kind)),
    ).toEqual(new Set(EXTRACTORS.map((each) => each.sourceKind)));
    expect(fixture.extraction.sources.length).toBe(8);
  });

  it("quotes the source exactly, record by record", () => {
    const text = (source: string): string => {
      if (source === "posting") return fixture.brief.posting ?? "";
      const [kind, ...rest] = source.split(":");
      const id = rest.at(-1);
      if (kind === "research")
        return (
          fixture.brief.research.find((each) => each.id === id)?.text ?? ""
        );
      if (kind === "employer-said")
        return (
          fixture.brief.employerSaid.find((each) => each.id === id)?.said ?? ""
        );
      return (
        fixture.brief.stages
          .flatMap((stage) => stage.transcripts)
          .find((each) => each.id === id)?.text ?? ""
      );
    };
    for (const source of fixture.extraction.sources)
      for (const record of source.records)
        expect(text(source.source), record.quote).toContain(record.quote);
    // What the scripted model invents is, by construction, not there.
    for (const each of fixture.extraction.invented) {
      expect(fixture.brief.posting).not.toContain(each.record.quote);
      for (const source of fixture.extraction.sources)
        expect(text(source.source)).not.toContain(each.record.quote);
    }
  });

  it("names fourteen things the posting asks of a candidate, eleven required and three preferred", () => {
    const asks = (
      fixture.extraction.sources.find((each) => each.source === "posting")
        ?.records ?? []
    ).filter((record) =>
      ["mustHaves", "niceToHaves"].includes(String(record.fields["section"])),
    );
    expect(asks.length).toBe(14);
    expect(asks.filter((each) => each.fields["level"] === "must").length).toBe(
      11,
    );
    expect(asks.filter((each) => each.fields["level"] === "nice").length).toBe(
      3,
    );
    for (const ask of asks) expect(ask.kind).toBe(KINDS.requirement);
  });

  it("names the two questions asked in the transcript, the two answers and what was said to expect", () => {
    const said = fixture.extraction.sources.find(
      (each) => each.kind === "transcript",
    )?.records;
    expect(said?.map((each) => each.kind)).toEqual([
      KINDS.asked,
      KINDS.answered,
      KINDS.asked,
      KINDS.answered,
      KINDS.signal,
    ]);
  });

  it("ties every requirement and note to an achievement the matrix really holds, and has one honest gap", () => {
    const said = fixture.material.matrix.roles.flatMap((role) =>
      [
        ...(role.responsibilities ?? []),
        ...(role.proof_points ?? []),
        ...(role.leadership_signals ?? []),
      ].map((text) => `${role.company}\n${text}`),
    );
    const all = [
      ...fixture.links.fit,
      ...fixture.links.proof,
      ...fixture.links.story,
    ];
    expect(fixture.links.fit.length).toBe(17);
    for (const entry of all)
      for (const to of entry.to)
        expect(
          said.some(
            (each) =>
              each.startsWith(`${to.company}\n`) && each.includes(to.says),
          ),
          `${to.company}: ${to.says}`,
        ).toBe(true);
    const gaps = fixture.links.fit.filter((entry) =>
      entry.to.some((to) => to["strength"] === "gap"),
    );
    expect(gaps.map((entry) => entry.from)).toEqual([
      "Working proficiency in French",
    ]);
    // The matrix says nothing of French: the gap is honest.
    expect(JSON.stringify(fixture.material.matrix).toLowerCase()).not.toContain(
      "french",
    );
  });

  it("refuses a gold file of another shape", () => {
    expect(() => extractionGoldSchema.parse({ name: "x" })).toThrow();
    expect(() =>
      linkGoldSchema.parse({ name: "x", fit: [{ from: "", to: [] }] }),
    ).toThrow();
  });
});

describe.each(["large", "small"] as const)(
  "the pack prepared by a %s profile",
  (name) => {
    it("reads all eight sources, and keeps a record only with a quote the engine found", () => {
      const result = run(name);
      expect(result.sources).toEqual({ right: 8, of: 8 });
      expect(result.records.extracted).toBe(55);
      // Must be 100% of the model-written records.
      expect(result.verifiedQuotes).toEqual({ right: 55, of: 55 });
      expect(result.holes).toBe(0);
      expect(result.withheld).toBe(0);
    });

    it("finds every requirement and every question asked, and invents none", () => {
      const result = run(name);
      expect(result.requirementsFound).toEqual({ right: 14, of: 14 });
      expect(result.questionsFound).toEqual({ right: 2, of: 2 });
      // Must be 0.
      expect(result.requirementsInvented).toBe(0);
      // The three proposals the source does not hold were refused.
      expect(result.rejected).toBe(3);
    });

    it("links thirteen of fourteen requirements to evidence, leaves the gap a gap, and makes no wrong link", () => {
      const result = run(name);
      expect(result.requirementsWithEvidence).toEqual({ right: 13, of: 14 });
      expect(result.gaps).toBe(1);
      // Must be 0.
      expect(result.wrongLinks).toBe(0);
      expect(result.refusedLinks).toBeGreaterThanOrEqual(3);
      const byId = new Map(
        result.prepared.records.map((each) => [each.id, each]),
      );
      for (const link of result.prepared.links ?? [])
        expect(ABOUT[byId.get(link.to)?.kind as ContextKind]).toBe("candidate");
    });

    // [SAFETY] The fixture's hiring-manager call was recorded under a
    // device-only policy. Must be 0: a remote reader of stage 2 is given
    // nothing a model extracted from it. Withheld, not failed.
    it("carries nothing of a device-only transcript to stage 2's remote reader, and says it was withheld", () => {
      const result = run(name);
      expect(result.carryForward).toEqual({ right: 0, of: 3 });
      expect(result.carryWithheld).toBe(1);
      // The profile that prepared runs here, so the transcript WAS read:
      // what is withheld is the reading of it, not the preparing.
      expect(result.withheld).toBe(0);
      expect(result.questionsFound).toEqual({ right: 2, of: 2 });
    });

    // The feature: the same transcript, permitted to leave this machine.
    it("carries what stage 1 asked and signalled to stage 2 when the transcript may leave this device", () => {
      expect(run(name).carryForwardPermitted).toEqual({ right: 3, of: 3 });
    });

    // The floors: the first benchmark's questions, each at its stage, on the
    // prepared pack. Code alone gives 24/28, 23/27 and 2/28 (bench-stages).
    it("does no worse on the first benchmark's questions than code alone, and better on evidence", () => {
      const { questions } = run(name);
      expect(before.evidenceFirst).toEqual({ right: 24, of: 28 });
      expect(before.prepFirst).toEqual({ right: 23, of: 27 });
      expect(before.wrongEmployerInThree).toEqual({ right: 2, of: 28 });
      expect(questions.evidenceFirst.of).toBe(28);
      expect(questions.evidenceFirst.right).toBeGreaterThanOrEqual(25);
      expect(questions.evidenceInThree.right).toBeGreaterThanOrEqual(25);
      expect(questions.prepFirst.right).toBeGreaterThanOrEqual(23);
      expect(questions.wrongEmployerInThree.right).toBeLessThanOrEqual(2);
      // The two questions the material has nothing for still find nothing.
      expect(questions.nothingUseful).toBe(2);
    });

    it("gains the evidence for 'Why Kestrel?', and loses no question code alone had right", () => {
      const now = new Map(
        run(name).questions.each.map((each) => [each.id, each]),
      );
      expect(now.get("hm-why-company")?.evidenceFirst).toBe(true);
      expect(
        before.questions.find((each) => each.id === "hm-why-company")
          ?.evidenceFirst,
      ).toBe(false);
      for (const was of before.questions) {
        if (was.evidenceFirst)
          expect(now.get(was.id)?.evidenceFirst, was.id).toBe(true);
        if (was.prepFirst)
          expect(now.get(was.id)?.prepFirst, was.id).toBe(true);
      }
    });

    it("selects for a question in milliseconds", () => {
      // The live coach's budget is seconds: a selection is a few milliseconds.
      expect(run(name).questions.resolveMs.median).toBeLessThan(100);
    });

    it("reads only the changed source again when one changes: one call", () => {
      expect(run(name).afterOneChange).toEqual({
        calls: 1,
        extracted: 1,
        reused: 7,
      });
    });
  },
);

describe("the two sizes, side by side", () => {
  it("give the same pack and the same scores", () => {
    const shape = (result: Run) => ({
      extracted: result.records.extracted,
      byKind: result.records.byKind,
      verifiedQuotes: result.verifiedQuotes,
      requirementsFound: result.requirementsFound,
      questionsFound: result.questionsFound,
      requirementsWithEvidence: result.requirementsWithEvidence,
      gaps: result.gaps,
      carryForward: result.carryForward,
      carryWithheld: result.carryWithheld,
      carryForwardPermitted: result.carryForwardPermitted,
      evidenceFirst: result.questions.evidenceFirst,
      prepFirst: result.questions.prepFirst,
      wrong: result.questions.wrongEmployerInThree,
    });
    expect(shape(run("small"))).toEqual(shape(run("large")));
  });

  it("differ in how the work is cut: one call a source for the large, pieces and batches for the small", () => {
    const [large, small] = [run("large"), run("small")];
    expect(large.stats).toMatchObject({ pieces: 8, calls: 8 });
    expect(large.stats.linkCalls).toBeLessThanOrEqual(5);
    expect(large.calls).toBe(large.stats.calls + large.stats.linkCalls);
    expect(small.stats.pieces).toBeGreaterThan(8);
    expect(small.stats.linkCalls).toBeGreaterThan(50);
    expect(small.calls).toBe(small.stats.calls + small.stats.linkCalls);
  });
});

describe("the report", () => {
  it("says each score, beside the pack code alone prepares", () => {
    const report = reportPreparedBench(run("large"), before);
    expect(report).toContain(
      "pack:bench prepared kestrel-freight-pay-extraction: profile pack-reader, recipe interview-context v3",
    );
    expect(report).toMatch(/records with a verified quote\s+55\/55/);
    expect(report).toMatch(/requirements found \(recall\)\s+14\/14/);
    expect(report).toMatch(/requirements invented \(must be 0\)\s+0/);
    expect(report).toMatch(/requirements with evidence linked\s+13\/14/);
    expect(report).toMatch(/wrong links \(must be 0\)\s+0/);
    // Carry-forward is said twice, each for a remote reader: as recorded
    // (device-only: withheld, which is the rule kept) and permitted remote.
    expect(report).toContain(
      "  stage carry-forward, to a remote reader (the coach, a briefing):",
    );
    expect(report).toMatch(
      /transcript as recorded\s+0\/3\s+withheld: device-only/,
    );
    expect(report).toMatch(/transcript permitted remote\s+3\/3/);
    expect(report).not.toMatch(/stage carry-forward\s+\d/);
    expect(report).toMatch(/right evidence first\s+25\/28\s+code only: 24\/28/);
    expect(report).toMatch(
      /right prep note first\s+23\/27\s+code only: 23\/27/,
    );
    expect(report).toContain("(8 pieces, 8 extraction calls,");
  });

  it("does not say withheld of an application whose transcript may leave this device", async () => {
    const open = withTranscriptsPermitted(fixture);
    const result = await runPreparedBench(open, {
      engine: scriptedEngine(scriptedModel(open)),
      profile: BENCH_PROFILE,
      // A profile that does not run here reads it too: nothing forbids it.
      onDevice: false,
    });
    expect(result.sources).toEqual({ right: 8, of: 8 });
    expect(result.carryWithheld).toBe(0);
    expect(result.carryForward).toEqual({ right: 3, of: 3 });
    expect(result.carryForwardPermitted).toEqual({ right: 3, of: 3 });
    const report = reportPreparedBench(result);
    expect(report).toMatch(/transcript as recorded\s+3\/3\s*$/m);
    expect(report).not.toContain("withheld: device-only");
    expect(summaryLine(result)).toContain("carry 3/3 | carry if permitted 3/3");
  });

  it("says a run in one short line, and never what a record says", () => {
    const line = summaryLine(run("small"));
    expect(line.split("\n").length).toBe(1);
    expect(line).toContain("pack-reader | calls ");
    expect(line).toContain("quotes 55/55");
    expect(line).toContain("requirements 14/14");
    expect(line).toContain("invented 0");
    expect(line).toContain("wrong 0");
    expect(line).toContain(
      "carry 0/3 (withheld: device-only) | carry if permitted 3/3",
    );
    const { prepared: _prepared, ...kept } = run("large");
    const stored = JSON.stringify(kept);
    // Scores and pointers only: no fact's text is kept on disk.
    expect(stored).not.toContain("proficiency in French");
    expect(stored).not.toContain("who should own it");
  });
});

describe("an application kept outside the repository", () => {
  const folder = fixtureFolder(FIXTURE);
  const paths = {
    matrix: `${folder}matrix.json`,
    brief: `${folder}employer-brief.json`,
    gold: `${folder}gold.json`,
    application: `${folder}stages.json`,
    preferences: `${folder}preferences.txt`,
    posting: `${folder}posting.txt`,
  };

  it("is read from files: with its gold it is the fixture, and without it the gold-bound scores are 0 of 0", async () => {
    const whole = readPreparedMaterial({
      ...paths,
      extraction: `${folder}gold-extraction.json`,
      links: `${folder}gold-links.json`,
    });
    expect(whole.brief.posting).toBe(fixture.brief.posting);
    expect(whole.extraction).toEqual(fixture.extraction);
    expect(whole.links).toEqual(fixture.links);

    const bare = readPreparedMaterial(paths);
    expect(bare.extraction.sources).toEqual([]);
    // The scripted model still reads as the fixture's gold reads.
    const model = scriptedModel(fixture);
    const result = await runPreparedBench(bare, {
      engine: scriptedEngine(model, { onDevice: true }),
      profile: BENCH_PROFILE,
      onDevice: true,
    });
    expect(result.requirementsFound).toEqual({ right: 0, of: 0 });
    expect(result.questionsFound).toEqual({ right: 0, of: 0 });
    expect(result.carryForward).toEqual({ right: 0, of: 0 });
    expect(result.carryForwardPermitted).toEqual({ right: 0, of: 0 });
    // What needs no gold still stands.
    expect(result.verifiedQuotes).toEqual({ right: 55, of: 55 });
    expect(result.wrongLinks).toBe(0);
    expect(result.requirementsInvented).toBe(0);
  });

  it("has no posting to read when none is given", () => {
    const { posting: _posting, ...without } = paths;
    expect(readPreparedMaterial(without).brief.posting).toBeUndefined();
  });
});
