// The context pack's benchmark, run on the fixture kept with the product: a
// synthetic brief with the traps a real application showed, forty questions
// and a gold file. The floors are what the pack achieves today, so a change
// that loses a question fails here. No model is called. Every name and
// figure in the fixture is invented.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fixtureFolder,
  goldSchema,
  type PackBenchResult,
  readBenchMaterial,
  readFixture,
  readGold,
  reportPackBench,
  runPackBench,
} from "./bench";

const FIXTURE = "kestrel-freight-pay";
// The same brief measured before the pack was changed (recipe version 1):
// the first row every later number stands against.
const BASELINE = {
  coach: { evidenceFirst: 16, prepFirst: 14, chars: [1255, 2017] },
  answer: { chars: [1657, 3103] },
} as const;

let result: PackBenchResult;
beforeAll(async () => {
  const { material, gold } = readFixture(FIXTURE);
  result = await runPackBench(material, gold);
});

describe("the fixture", () => {
  const { material, gold } = readFixture(FIXTURE);

  it("is a brief of the real shape: roles, a consultancy with its clients, stories, an employer brief and preferences", () => {
    expect(material.matrix.roles.length).toBe(13);
    const through = material.matrix.roles.filter(
      (role) => (role as { engaged_through?: string }).engaged_through,
    );
    expect(through.map((role) => role.company)).toEqual(
      (
        material.matrix as unknown as {
          contracting_companies: { clients: string[] }[];
        }
      ).contracting_companies[0]?.clients,
    );
    expect(material.matrix.story_selector?.length).toBe(8);
    expect(material.brief.prepNotes?.length).toBe(16);
    expect(material.preferences.trim().split("\n").length).toBe(5);
  });

  it("asks about forty questions over both stages, two of which have no answer", () => {
    expect(gold.questions.length).toBe(40);
    expect(new Set(gold.questions.map((each) => each.stage))).toEqual(
      new Set(["hiring-manager", "technical"]),
    );
    expect(
      gold.questions.filter((each) => each.nothing).map((each) => each.id),
    ).toEqual(["n-elixir", "n-rust"]);
    const ids = gold.questions.map((each) => each.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The gold names what should lead by what it says, never by a record's
  // identity, so it survives a change to how records are identified.
  it("names every gold employer and every gold note as the material has them", () => {
    const companies = material.matrix.roles.map((role) => role.company);
    const lines = [
      ...(material.brief.prepNotes ?? []),
      ...material.brief.questionsToAsk,
    ];
    const typed = material.preferences
      .split("\n")
      .flatMap((line) => line.replace(/^- /, "").split(/(?<=;)\s+/));
    for (const asked of gold.questions) {
      for (const wanted of asked.evidence ?? [])
        expect(companies, asked.id).toContain(wanted.company);
      for (const key of asked.prep ?? [])
        expect(
          lines.some((line) => line.startsWith(key)),
          `${asked.id}: ${key}`,
        ).toBe(true);
      for (const key of asked.preferences ?? [])
        expect(
          typed.some((line) => line.startsWith(key)),
          `${asked.id}: ${key}`,
        ).toBe(true);
    }
  });
});

describe("the pack on the fixture", () => {
  it("is prepared by the current recipe into whole achievements, with no fragment left", () => {
    expect(result.benchmark).toBe(FIXTURE);
    expect(result.recipe).toEqual({ id: "interview-context", version: "2" });
    expect(result.records.byKind).toEqual({
      "candidate-achievement": 139,
      "candidate-preference": 6,
      "candidate-profile": 1,
      "candidate-role": 13,
      "candidate-story": 8,
      "employer-detail": 1,
      "employer-fact": 16,
      "employer-requirement": 37,
      "prep-note": 22,
    });
    expect(result.records.total).toBe(243);
  });

  it("scores the coach and an answer projection on every question", () => {
    expect(Object.keys(result.projections)).toEqual(["coach", "answer"]);
    for (const score of Object.values(result.projections))
      expect(score.questions.length).toBe(40);
  });

  // The floors: what phase 1 of the context-pack work achieved.
  it.each(["coach", "answer"] as const)(
    "keeps the %s projection's floors",
    (projection) => {
      const score = result.projections[projection] as NonNullable<
        (typeof result.projections)[string]
      >;
      // Right evidence leads on at least 24 of the 28 questions that have
      // one (16 before), and stays in the first three.
      expect(score.evidenceFirst.of).toBe(28);
      expect(score.evidenceFirst.right).toBeGreaterThanOrEqual(24);
      expect(score.evidenceInThree.right).toBeGreaterThanOrEqual(24);
      // The right prep note leads on at least 23 of 27 (14 before).
      expect(score.prepFirst.of).toBe(27);
      expect(score.prepFirst.right).toBeGreaterThanOrEqual(23);
      expect(score.preferenceFirst).toEqual({ right: 3, of: 3 });
      // Evidence from an employer the gold does not name is among the first
      // three on at most 2 questions (10 before).
      expect(score.wrongEmployerInThree.right).toBeLessThanOrEqual(2);
      // The two questions with no answer find nothing, and no other does.
      expect(score.honestNothing).toEqual({ right: 2, of: 2 });
      expect(score.nothingUseful).toBe(2);
    },
  );

  it("beats the baseline measured before the change", () => {
    const coach = result.projections["coach"];
    expect(coach?.evidenceFirst.right).toBeGreaterThan(
      BASELINE.coach.evidenceFirst,
    );
    expect(coach?.prepFirst.right).toBeGreaterThan(BASELINE.coach.prepFirst);
  });

  // Whole achievements cost more characters than fragments did: no more
  // than a third more than the baseline, per question.
  it.each(["coach", "answer"] as const)(
    "hands the %s no more than a third more characters than before",
    (projection) => {
      const [median, largest] = BASELINE[projection].chars;
      const chars = result.projections[projection]?.chars;
      expect(chars?.median).toBeLessThanOrEqual(Math.floor((median * 4) / 3));
      expect(chars?.largest).toBeLessThanOrEqual(Math.floor((largest * 4) / 3));
    },
  );

  it("answers the traps the real material showed", () => {
    const coach = new Map(
      result.projections["coach"]?.questions.map((each) => [each.id, each]),
    );
    // An old role that says "migration"; a note that names its proof; a
    // technology the matrix names differently; a question with no word of
    // the material in it.
    for (const id of [
      "hm-migration",
      "hm-mongo-postgres",
      "hm-nestjs",
      "hm-yourself",
      "hm-proudest",
    ])
      expect(coach.get(id), id).toMatchObject({
        evidenceFirst: true,
        prepFirst: true,
        wrongEmployers: 0,
      });
    expect(coach.get("hm-salary")).toMatchObject({ preferenceFirst: true });
    expect(coach.get("hm-conflict")).toMatchObject({
      prepFirst: true,
      nothingUseful: false,
    });
  });

  // Not tuned away: what a word match and a link made in code cannot find.
  it("still misses what only a reader of meaning would find", () => {
    const coach = new Map(
      result.projections["coach"]?.questions.map((each) => [each.id, each]),
    );
    // The note names no employer; nothing in the question is in the record.
    expect(coach.get("hm-why-company")?.evidenceFirst).toBe(false);
    expect(coach.get("t-twice")?.evidenceFirst).toBe(false);
  });

  it("keeps where the leading facts are, and never what they say", () => {
    const kept = JSON.stringify(result);
    for (const score of Object.values(result.projections))
      for (const each of score.questions) {
        expect(Object.keys(each).sort()).toEqual([
          "chars",
          "evidenceFirst",
          "evidenceInThree",
          "firstEvidence",
          "firstPrep",
          "id",
          "nothingUseful",
          "preferenceFirst",
          "prepFirst",
          "stage",
          "wrongEmployers",
        ]);
        if (each.firstEvidence !== null)
          expect(each.firstEvidence).toMatch(/^\/roles\/\d+\//);
      }
    expect(kept).not.toContain("Larchmont");
    expect(kept).not.toContain("Rowan");
  });

  it("takes about a second, and calls no model", () => {
    expect(result.prepareMs).toBeLessThan(2_000);
    for (const score of Object.values(result.projections))
      expect(score.resolveMs.largest).toBeLessThan(1_000);
  });
});

describe("a brief read from files", () => {
  const folder = mkdtempSync(join(tmpdir(), "pack-bench-"));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const fixture = fixtureFolder(FIXTURE);
  const brief = readFixture(FIXTURE).material.brief;
  const written = (name: string, value: unknown) => {
    const path = join(folder, name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };

  it("takes an employer brief, or an application row that holds one as an object or as text", () => {
    for (const held of [
      brief,
      { title: "Tech Lead", employer_brief: brief },
      { title: "Tech Lead", employer_brief: JSON.stringify(brief) },
    ])
      expect(
        readBenchMaterial({
          matrix: `${fixture}matrix.json`,
          brief: written("brief.json", held),
        }),
      ).toMatchObject({ brief, preferences: "" });
  });

  it("refuses a brief or a matrix that is not one", () => {
    expect(() =>
      readBenchMaterial({
        matrix: `${fixture}matrix.json`,
        brief: written("not-a-brief.json", { company: "Kestrel" }),
      }),
    ).toThrow();
    expect(() =>
      readBenchMaterial({
        matrix: written("not-a-matrix.json", { roles: "none" }),
        brief: `${fixture}employer-brief.json`,
      }),
    ).toThrow();
  });

  it("scores a brief with no preferences and its own gold", async () => {
    const gold = written("gold.json", {
      name: "tiny",
      questions: [
        {
          id: "pay",
          stage: "hiring-manager",
          question: "Would you relocate to Reykjavik?",
          preferences: ["Base salary"],
        },
        {
          id: "nest",
          stage: "technical",
          question: "What is your experience with NestJS?",
          evidence: [{ company: "Quotewright", says: "no such words" }],
          prep: ["NestJS"],
        },
      ],
    });
    const tiny = await runPackBench(
      readBenchMaterial({
        matrix: `${fixture}matrix.json`,
        brief: `${fixture}employer-brief.json`,
      }),
      readGold(gold),
    );
    expect(tiny.benchmark).toBe("tiny");
    expect(tiny.records.byKind["candidate-preference"]).toBeUndefined();
    const [pay, nest] = tiny.projections["coach"]?.questions ?? [];
    // No preference was typed, and nothing in the material is about
    // moving: nothing is found, and that is said.
    expect(pay).toMatchObject({
      evidenceFirst: null,
      prepFirst: null,
      preferenceFirst: false,
      nothingUseful: true,
      wrongEmployers: null,
      firstEvidence: null,
    });
    // Evidence is right only from a gold employer that says the gold words.
    expect(nest).toMatchObject({
      evidenceFirst: false,
      evidenceInThree: false,
      prepFirst: true,
      preferenceFirst: null,
      nothingUseful: false,
      wrongEmployers: 3,
    });
    expect(tiny.projections["coach"]).toMatchObject({
      evidenceFirst: { right: 0, of: 1 },
      preferenceFirst: { right: 0, of: 1 },
      prepFirst: { right: 1, of: 1 },
      wrongEmployerInThree: { right: 1, of: 1 },
      nothingUseful: 1,
      honestNothing: { right: 0, of: 0 },
    });
  });

  it("refuses a gold file with a key it does not know, or no question", () => {
    const question = { id: "a", stage: "technical", question: "Go?" };
    expect(
      goldSchema.safeParse({ name: "x", questions: [question] }).success,
    ).toBe(true);
    expect(
      goldSchema.safeParse({
        name: "x",
        questions: [{ ...question, record: "role:x" }],
      }).success,
    ).toBe(false);
    expect(goldSchema.safeParse({ name: "x", questions: [] }).success).toBe(
      false,
    );
  });
});

describe("the report", () => {
  it("says the scores, the records by kind and each question", () => {
    const report = reportPackBench(result);
    expect(report).toContain(
      `pack:bench ${FIXTURE}: recipe interview-context v2, no earlier run`,
    );
    expect(report).toContain("records: 243: candidate-achievement 139,");
    expect(report).toMatch(/right evidence first\s+\d+\/28\s*$/m);
    expect(report).toMatch(/hm-migration\s+yes\s+yes\s+yes\s+-\s+0\s+\d+/);
    expect(report).toMatch(
      /n-elixir\s+-\s+-\s+-\s+-\s+-\s+\d+\s+nothing found/,
    );
    expect(report).not.toContain("(changed)");
    expect(report).not.toContain("was ");
  });

  it("sets each score beside the last run's, and marks the questions that changed", () => {
    const coach = result.projections["coach"] as NonNullable<
      (typeof result.projections)[string]
    >;
    const earlier: PackBenchResult = {
      ...result,
      at: "2026-01-01T00:00:00.000Z",
      recipe: { id: "interview-context", version: "1" },
      records: { total: 265, byKind: {} },
      projections: {
        ...result.projections,
        coach: {
          ...coach,
          evidenceFirst: { right: 16, of: 28 },
          chars: { median: 1255, largest: 2017 },
          questions: coach.questions.map((each) =>
            each.id === "hm-migration"
              ? { ...each, evidenceFirst: false }
              : each,
          ),
        },
      },
    };
    const report = reportPackBench(result, earlier);
    expect(report).toContain("compared with 2026-01-01T00:00:00.000Z (v1)");
    expect(report).toContain("records: 243 (was 265)");
    expect(report).toMatch(/right evidence first\s+\d+\/28\s+was 16\/28/);
    expect(report).toMatch(/was 1255, 2017/);
    const changed = report
      .split("\n")
      .filter((line) => line.includes("(changed)"));
    expect(changed.length).toBe(1);
    expect(changed[0]).toContain("hm-migration");
  });
});
