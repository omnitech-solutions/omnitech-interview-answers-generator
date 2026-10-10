// The gate of the context pack's evaluation: the held-out questions, scored
// with no model, with thresholds; three selectors broken on purpose, each of
// which must fail it; and the answer level run by a scripted model.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { LEGACY_FLAGS } from "../recipe";
import { answerTotals, runAnswers, sample, scriptedAnswerer } from "./answers";
import { type Arm, BROKEN, bm25Arm, packArm, retrievalArms } from "./arms";
import { type CallScenario, renderCall } from "./call-scenario";
import {
  CATEGORIES,
  checkQuestions,
  type EvalFixture,
  HELD_OUT_APPLICATIONS,
  NOTHING,
  type QuestionSet,
  questionSetHash,
  readEvalFixture,
  readQuestions,
  sourceText,
} from "./fixture";
import {
  type ArmScore,
  compare,
  gate,
  reportCategories,
  reportRetrieval,
  scoreArm,
  type Thresholds,
} from "./retrieval";

// [GUARD] A floor under what was measured on 2026-10-10 (the brief, section
// 14: 99 of 178 right first, recall@3 0.645, a wrong employer in the first
// three for 34 of 116), to catch a regression. Not a target: a change that
// moves the measured value is reported by `pnpm pack:eval`, with its gained
// and lost questions.
const THRESHOLDS: Thresholds = {
  first: 0.52,
  recall3: 0.6,
  wrongEmployer: 0.33,
};

let set: QuestionSet;
const fixtures = new Map<string, EvalFixture>();
const scores = new Map<string, ArmScore>();
const arm = (id: string): Arm =>
  retrievalArms().find((each) => each.id === id) as Arm;
const scored = (id: string): ArmScore => scores.get(id) as ArmScore;

beforeAll(async () => {
  set = readQuestions();
  for (const name of HELD_OUT_APPLICATIONS)
    fixtures.set(name, readEvalFixture(name));
  for (const each of [
    arm("before"),
    arm("adopted"),
    BROKEN.unranked(),
    BROKEN.leaky(),
    BROKEN.stale(),
  ])
    scores.set(each.id, await scoreArm(each, fixtures, set.questions, "coach"));
}, 120_000);

describe("the held-out question set", () => {
  it("is the set the published numbers were measured on", () => {
    // Editing a question or its gold without bumping the version fails here.
    expect({ version: set.version, hash: questionSetHash(set) }).toEqual({
      version: "1",
      hash: "c1817af640892e48",
    });
  });

  it("has every category, at least eight questions each, and 28 that nothing answers", () => {
    for (const category of CATEGORIES)
      expect(
        set.questions.filter((each) => each.category === category).length,
        category,
      ).toBeGreaterThanOrEqual(8);
    expect(
      set.questions.filter((each) => NOTHING.has(each.category)).length,
    ).toBeGreaterThanOrEqual(25);
    expect(set.questions.length).toBeGreaterThanOrEqual(200);
  });

  it("has no gold fault: every gold record exists and every gold fact is in the sources", async () => {
    const checker = packArm("check", "check", { flags: LEGACY_FLAGS });
    const records = new Map<string, Set<string>>();
    const key = (question: (typeof set.questions)[number]) =>
      `${question.app}|${question.stage ?? ""}|${question.variant ?? ""}`;
    for (const question of set.questions) {
      if (records.has(key(question))) continue;
      const pack = await checker.pack(
        fixtures.get(question.app) as EvalFixture,
        { ...question, reader: "device" },
      );
      records.set(
        key(question),
        new Set(pack.prepared.records.map((record) => record.id)),
      );
    }
    const texts = new Map(
      [...fixtures].map(([name, fixture]) => [name, sourceText(fixture)]),
    );
    expect(
      checkQuestions(set, (question) => ({
        records: records.get(key(question)) ?? new Set(),
        sources: texts.get(question.app) ?? "",
      })),
    ).toEqual([]);
  });

  it("catches a gold record that does not exist and a fact no source says", () => {
    const first = set.questions.find(
      (each) => each.gold.length > 0 && each.category !== "aggregation",
    );
    if (!first) throw new Error("no question");
    const faults = checkQuestions(
      {
        ...set,
        questions: [
          {
            ...first,
            gold: [{ id: "no-such-record", grade: 2 }],
            points: [{ says: "a phrase no source of the fixture says" }],
          },
        ],
      },
      () => ({ records: new Set(), sources: "what the sources say" }),
    );
    expect(faults.map((each) => each.fault)).toEqual([
      "no record no-such-record",
      'the sources do not say "a phrase no source of the fixture says"',
    ]);
  });

  it("has a long transcript that is exactly what its written scenario renders to", () => {
    const folder = (fixtures.get("tidewell-care") as EvalFixture).folder;
    const scenario = JSON.parse(
      readFileSync(`${folder}call/scenario.json`, "utf8"),
    ) as CallScenario;
    const transcript = readFileSync(`${folder}call/transcript.txt`, "utf8");
    expect(renderCall(scenario).transcript).toBe(transcript);
    // Several thousand lines of it.
    expect(transcript.split("\n").length).toBeGreaterThan(5000);
  });
});

describe("the gate, on the held-out questions", () => {
  it("is passed by what ships", () => {
    expect(gate(scored("adopted"), THRESHOLDS)).toEqual([]);
  });

  it("keeps a device-only source from every remote reader, and gives it to the person's own screen", () => {
    const { totals } = scored("adopted");
    expect(totals.deviceOnlyKept).toEqual({ right: 10, of: 10 });
    expect(totals.devicePairFound.right).toBeGreaterThanOrEqual(8);
    expect(totals.staleKept).toEqual({ right: 8, of: 8 });
  });

  it("is better than recipe 3 as it was, question by question", () => {
    const { gained, lost, p } = compare(scored("before"), scored("adopted"));
    expect(lost).toEqual([]);
    expect(gained.length).toBeGreaterThanOrEqual(19);
    expect(p).toBeLessThan(0.001);
  });

  it("is failed by a selector that does not rank, on the right record leading", () => {
    expect(
      gate(scored("broken-unranked"), THRESHOLDS).map((each) => each.metric),
    ).toContain("right-first");
  });

  it("is failed by a selector that does not withhold a device-only source", () => {
    expect(
      gate(scored("broken-leaky"), THRESHOLDS).map((each) => each.metric),
    ).toContain("device-only");
  });

  it("is failed by a selector that reads a source as it was before its edit", () => {
    expect(
      gate(scored("broken-stale"), THRESHOLDS).map((each) => each.metric),
    ).toContain("stale");
  });

  it("reports every arm it is given, with intervals and the paired difference", () => {
    const report = reportRetrieval(
      [scored("before"), scored("adopted")],
      "before",
    );
    expect(report).toContain("Recipe 3 as it was");
    expect(report).toMatch(/\+\d+ -0, p=0\.000/);
    expect(reportCategories([scored("adopted")])).toContain("| paraphrase |");
  });

  it("selects the same thing run after run, and calls no model", async () => {
    // The arms' engine has no profile and no provider: a model call on the
    // selection path would have failed every score above.
    const again = await scoreArm(
      arm("adopted"),
      fixtures,
      set.questions.slice(0, 40),
      "coach",
    );
    const first = scored("adopted").marks.slice(0, 40);
    expect(again.marks.map(({ ms: _ms, ...mark }) => mark)).toEqual(
      first.map(({ ms: _ms, ...mark }) => mark),
    );
  });
});

describe("the answer level, by a scripted model", () => {
  it("puts the gold records at the ceiling and no records at the floor", async () => {
    const picked = sample(set.questions, 40);
    const results = await runAnswers({
      answerer: scriptedAnswerer(),
      arms: ["none", "bm25", "pack", "gold"],
      questions: picked,
      fixtures,
      selectors: { bm25: bm25Arm(), pack: arm("adopted") },
    });
    const totals = (id: "none" | "bm25" | "pack" | "gold") =>
      answerTotals(
        id,
        results.filter((each) => each.arm === id),
      );
    // Given nothing, it says so every time, and states no gold point.
    expect(totals("none").points).toBe(0);
    expect(totals("none").wronglyAbstained.right).toBe(
      totals("none").wronglyAbstained.of,
    );
    // It states only what it is given, so it invents nothing in any arm.
    for (const id of ["bm25", "pack", "gold"] as const)
      expect(totals(id).invented.right, id).toBe(0);
    // The ceiling is above the pack, and the pack above nothing.
    expect(totals("gold").points).toBeGreaterThan(totals("pack").points);
    expect(totals("pack").points).toBeGreaterThan(0.3);
    expect(totals("pack").citesExist.right).toBe(totals("pack").citesExist.of);
  });
});
