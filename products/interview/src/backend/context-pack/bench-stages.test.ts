// The stage benchmark on the fixture kept with the product: the same
// invented brief with its two stages as real stage material, and a gold file
// of questions only stage scope can answer. The floors are what the pack
// achieves today. No model is called. Every name and figure is invented.
import { beforeAll, describe, expect, it } from "vitest";
import { runPackBench } from "./bench";
import {
  readStageFixture,
  reportStageBench,
  runStageBench,
  type StageBenchResult,
  stageGoldSchema,
} from "./bench-stages";
import { briefSources, remoteSources } from "./brief-sources";

const FIXTURE = "kestrel-freight-pay";
const fixture = readStageFixture(FIXTURE);
let result: StageBenchResult;
beforeAll(async () => {
  result = await runStageBench(
    fixture.material,
    fixture.brief,
    fixture.gold,
    fixture.stageGold,
  );
});

describe("the fixture's stage material", () => {
  it("is two stages with people, notes, a transcript and an outcome, what the employer said, and research", () => {
    const { brief } = fixture;
    expect(brief.stages.map(({ ordinal, kind }) => [ordinal, kind])).toEqual([
      [1, "hiring_manager"],
      [2, "technical"],
    ]);
    for (const stage of brief.stages) {
      expect(stage.people.length).toBeGreaterThanOrEqual(2);
      expect(stage.notes).toBeTruthy();
    }
    expect(brief.stages[0]?.transcripts).toHaveLength(1);
    expect(brief.stages[0]?.outcome).toBeTruthy();
    expect(brief.employerSaid).toHaveLength(3);
    expect(brief.research).toHaveLength(3);
  });

  it("leaves the first benchmark's material and gold as they were", () => {
    expect(fixture.gold.questions).toHaveLength(40);
    expect(fixture.material.brief.prepNotes).toHaveLength(16);
  });

  it("names every gold line as the stage material has it", () => {
    const lines = briefSources(fixture.brief).flatMap((source) =>
      (source.records ?? []).map((record) => record.text),
    );
    for (const asked of fixture.stageGold.questions) {
      expect(
        fixture.brief.stages.map((stage) => stage.ordinal),
        asked.id,
      ).toContain(asked.stage);
      for (const key of [
        ...(asked.prep ?? []),
        ...(asked.follows ?? []),
        ...(asked.absent ?? []),
        ...(asked.employer ?? []),
      ])
        expect(
          lines.some((line) => line.startsWith(key)),
          `${asked.id}: ${key}`,
        ).toBe(true);
    }
    const ids = fixture.stageGold.questions.map((each) => each.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses a stage gold file with a key it does not know", () => {
    const question = { id: "a", stage: 1, question: "Go?" };
    expect(
      stageGoldSchema.safeParse({ name: "x", questions: [question] }).success,
    ).toBe(true);
    expect(
      stageGoldSchema.safeParse({
        name: "x",
        questions: [{ ...question, record: "prep:x" }],
      }).success,
    ).toBe(false);
    expect(
      stageGoldSchema.safeParse({
        name: "x",
        questions: [{ ...question, stage: 0 }],
      }).success,
    ).toBe(false);
  });
});

describe("the pack on the fixture, resolved per stage", () => {
  it("gives both stages material of their own, as sources with a stage", () => {
    expect(result.stagesWithMaterial).toEqual({ right: 2, of: 2 });
    expect(result.sources).toEqual({
      "candidate-notes": 2,
      "employer-said": 3,
      research: 3,
      "stage-details": 2,
      "stage-outcome": 1,
      transcript: 1,
    });
    expect(result.records).toEqual({
      "employer-fact": 17,
      "prep-note": 7,
      "transcript-turn": 5,
    });
  });

  it("answers every stage question: the stage's note leads, an earlier stage's follows, a later stage's is left out", () => {
    expect(result.prepFirst).toEqual({ right: 5, of: 5 });
    expect(result.follows).toEqual({ right: 1, of: 1 });
    expect(result.absent).toEqual({ right: 2, of: 2 });
    expect(result.employer).toEqual({ right: 2, of: 2 });
    const by = new Map(result.questions.map((each) => [each.id, each]));
    // The same question, asked in each stage.
    expect(by.get("s2-data-ownership")).toMatchObject({
      prepFirst: true,
      follows: true,
    });
    expect(by.get("s1-data-ownership")).toMatchObject({ absent: true });
    // A note of stage 1 still answers in stage 2.
    expect(by.get("s2-rota")?.prepFirst).toBe(true);
  });

  // [DOMAIN] Adding a stage's material must not cost the first benchmark a
  // question: its gold is scored again on the stage packs, each question at
  // the stage that asks it, against the same floors (bench.test.ts).
  it("keeps the first benchmark's floors with the stage material present", async () => {
    expect(result.base.evidenceFirst.of).toBe(28);
    expect(result.base.evidenceFirst.right).toBeGreaterThanOrEqual(24);
    expect(result.base.prepFirst.of).toBe(27);
    expect(result.base.prepFirst.right).toBeGreaterThanOrEqual(23);
    expect(result.base.wrongEmployerInThree.right).toBeLessThanOrEqual(2);
    // Question by question, nothing that was right without it is wrong
    // with it.
    const without = await runPackBench(fixture.material, fixture.gold);
    const before = new Map(
      without.projections["coach"]?.questions.map((each) => [each.id, each]),
    );
    for (const each of result.base.questions) {
      const was = before.get(each.id);
      if (was?.evidenceFirst) expect(each.evidenceFirst, each.id).toBe(true);
      if (was?.prepFirst) expect(each.prepFirst, each.id).toBe(true);
      if (was?.preferenceFirst)
        expect(each.preferenceFirst, each.id).toBe(true);
    }
  });

  it("counts the device-only transcript's turns and never lists it as sendable", () => {
    expect(result.deviceOnlyRecords).toBe(5);
    const { withheld, sendable } = remoteSources(briefSources(fixture.brief));
    expect(withheld).toHaveLength(1);
    expect(withheld[0]?.id).toMatch(/^stage:.+:transcript:/);
    expect(JSON.stringify(sendable)).not.toContain("named backup, at");
  });

  it("reports the scores and each question", () => {
    const report = reportStageBench(result);
    expect(report).toContain("stages with material of their own");
    expect(report).toMatch(/right stage note first\s+5\/5/);
    expect(report).toMatch(/s2-data-ownership\s+2\s+yes\s+yes\s+-\s+-/);
    expect(report).toMatch(/right prep note first\s+\d+\/27/);
  });
});
