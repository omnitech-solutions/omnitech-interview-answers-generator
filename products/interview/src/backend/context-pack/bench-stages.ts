// The context pack's benchmark with STAGES: the same fixed brief, with each
// stage's own material (people, notes, a transcript, an outcome), what the
// employer said and the research documents, and a second gold file of
// questions only stage scope can answer.
//
// PROBLEM: "a second stage has its own material and the pack filters by
// stage" has to be a number too, and adding that material must not cost the
// first benchmark a question. STRATEGY: the pack is prepared once per stage
// through the same door a live session uses (`prepareStagePack`); the stage
// gold is scored on the coach projection, and the first benchmark's gold is
// scored again on the same packs, each question at the stage that asks it,
// with the same scorer. No model is called anywhere.
import { readFileSync } from "node:fs";
import { createAiEngine } from "@omnitech/ai-engine";
import { z } from "zod";
import type { BriefMaterial } from "../brief/repository";
import type { SessionContext } from "../live-session/session-context";
import {
  type BenchMaterial,
  fixtureFolder,
  type Gold,
  type QuestionScore,
  readFixture,
  scoreQuestion,
} from "./bench";
import { BRIEF_SOURCE_KINDS, briefSources } from "./brief-sources";
import { KINDS } from "./recipe";
import { prepareStagePack, type StagePack } from "./stage";

// What should lead, or follow, or be left out, named by the words it starts
// with: never by a record's identity.
export const stageGoldSchema = z.strictObject({
  name: z.string().min(1),
  questions: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        // The stage the pack is resolved for, by its place.
        stage: z.number().int().min(1),
        question: z.string().min(1),
        // The prep note that should lead its slot.
        prep: z.array(z.string().min(1)).optional(),
        // An earlier stage's line that should come after it.
        follows: z.array(z.string().min(1)).optional(),
        // A later stage's line that must not be offered.
        absent: z.array(z.string().min(1)).optional(),
        // A line of the employer's that should be among those offered.
        employer: z.array(z.string().min(1)).optional(),
      }),
    )
    .min(1),
});
export type StageGold = z.infer<typeof stageGoldSchema>;

const stageSchema = z.looseObject({
  candidacyId: z.string(),
  stages: z
    .array(z.looseObject({ id: z.string(), ordinal: z.number() }))
    .min(1),
  employerSaid: z.array(z.looseObject({ id: z.string() })),
  research: z.array(z.looseObject({ id: z.string() })),
});

export function readStageFixture(name: string): {
  material: BenchMaterial;
  gold: Gold;
  brief: BriefMaterial;
  stageGold: StageGold;
} {
  const folder = fixtureFolder(name);
  const json = (file: string): unknown =>
    JSON.parse(readFileSync(`${folder}${file}`, "utf8"));
  return {
    ...readFixture(name),
    // The shape `readBriefMaterial` gives for a stored application.
    brief: stageSchema.parse(json("stages.json")) as unknown as BriefMaterial,
    stageGold: stageGoldSchema.parse(json("gold-stages.json")),
  };
}

const EXECUTION = {
  scope: {
    tenantId: "00000000-0000-4000-8000-0000000000b1",
    actorId: "00000000-0000-4000-8000-0000000000b2",
  },
};

// The brief as a session of that stage holds it.
export function stageContext(
  material: BenchMaterial,
  brief: BriefMaterial,
): SessionContext {
  return {
    matrix: material.matrix,
    snapshot: {} as SessionContext["snapshot"],
    material: {
      profile: { id: "bench", revision: 1, sha256: "0".repeat(64) },
      brief: { ...material.brief, candidacyId: "bench" },
      candidatePreferences: material.preferences.trim() || null,
      draftRevision: 1,
      interviewBrief: brief,
      stage: null,
    },
  };
}

export function prepareStagePackForBench(
  material: BenchMaterial,
  brief: BriefMaterial,
  stage: number | "all",
): Promise<StagePack> {
  const engine = createAiEngine({
    profiles: [],
    providers: {},
    log: { level: "silent" },
  });
  return prepareStagePack(
    engine,
    stageContext(material, brief),
    { ...EXECUTION, signal: new AbortController().signal },
    stage,
  );
}

type Tally = { right: number; of: number };
export type StageQuestionScore = {
  id: string;
  stage: number;
  prepFirst: boolean | null;
  follows: boolean | null;
  absent: boolean | null;
  employer: boolean | null;
};
export type StageBenchResult = {
  benchmark: string;
  // Sources and records the stage material adds, by kind.
  sources: Record<string, number>;
  records: Record<string, number>;
  // How many stages have material of their own.
  stagesWithMaterial: Tally;
  // Records that may not leave this machine (a device-only transcript's).
  deviceOnlyRecords: number;
  prepFirst: Tally;
  follows: Tally;
  absent: Tally;
  employer: Tally;
  questions: StageQuestionScore[];
  // The first benchmark's gold, scored with the stage material present.
  base: {
    evidenceFirst: Tally;
    prepFirst: Tally;
    wrongEmployerInThree: Tally;
    questions: QuestionScore[];
  };
};

const lower = (text: string) => text.toLowerCase();
const starts = (text: string, keys: readonly string[]) =>
  keys.some((key) => lower(text).startsWith(lower(key)));
// The place of each round the first gold file names.
const ROUND: Readonly<Record<string, number>> = {
  "hiring-manager": 1,
  technical: 2,
};

export async function runStageBench(
  material: BenchMaterial,
  brief: BriefMaterial,
  gold: Gold,
  stageGold: StageGold,
): Promise<StageBenchResult> {
  const packs = new Map<number, StagePack>();
  for (const { ordinal } of brief.stages)
    packs.set(
      ordinal,
      await prepareStagePackForBench(material, brief, ordinal),
    );
  const packFor = (stage: number) => {
    const pack = packs.get(stage);
    if (!pack) throw new Error(`The fixture has no stage ${stage}.`);
    return pack;
  };

  const questions = stageGold.questions.map((asked): StageQuestionScore => {
    const selected = packFor(asked.stage).facts("coach", asked.question);
    const prep = selected.filter((fact) => fact.slot === "prep");
    const lead = prep[0];
    return {
      id: asked.id,
      stage: asked.stage,
      prepFirst: asked.prep
        ? lead !== undefined && starts(lead.text, asked.prep)
        : null,
      follows: asked.follows
        ? prep.slice(1).some((fact) => starts(fact.text, asked.follows ?? []))
        : null,
      absent: asked.absent
        ? !selected.some((fact) => starts(fact.text, asked.absent ?? []))
        : null,
      employer: asked.employer
        ? selected.some(
            (fact) =>
              fact.slot === "employer" &&
              starts(fact.text, asked.employer ?? []),
          )
        : null,
    };
  });
  const tally = <Each>(
    all: readonly Each[],
    pick: (each: Each) => boolean | null,
  ): Tally => ({
    right: all.filter((each) => pick(each) === true).length,
    of: all.filter((each) => pick(each) !== null).length,
  });

  const base = gold.questions.map((asked) =>
    scoreQuestion(packFor(ROUND[asked.stage] ?? 1), "coach", asked),
  );
  const sources = briefSources(brief);
  const count = (kinds: readonly string[]) =>
    Object.fromEntries(
      [...new Set(kinds)]
        .sort()
        .map((kind) => [kind, kinds.filter((each) => each === kind).length]),
    );
  return {
    benchmark: stageGold.name,
    sources: count(sources.map((source) => source.kind)),
    records: count(
      sources.flatMap((source) =>
        (source.records ?? []).map((record) => record.kind),
      ),
    ),
    stagesWithMaterial: {
      right: brief.stages.filter((stage) =>
        sources.some(
          (source) =>
            source.stage === stage.ordinal &&
            (source.kind === BRIEF_SOURCE_KINDS.notes ||
              source.kind === BRIEF_SOURCE_KINDS.transcript),
        ),
      ).length,
      of: brief.stages.length,
    },
    deviceOnlyRecords: sources
      .filter((source) => !source.sendable)
      .flatMap((source) => source.records ?? [])
      .filter((record) => record.kind === KINDS.turn).length,
    prepFirst: tally(questions, (each) => each.prepFirst),
    follows: tally(questions, (each) => each.follows),
    absent: tally(questions, (each) => each.absent),
    employer: tally(questions, (each) => each.employer),
    questions,
    base: {
      evidenceFirst: tally(base, (each) => each.evidenceFirst),
      prepFirst: tally(base, (each) => each.prepFirst),
      wrongEmployerInThree: tally(base, (each) =>
        each.wrongEmployers === null ? null : each.wrongEmployers > 0,
      ),
      questions: base,
    },
  };
}

export function reportStageBench(result: StageBenchResult): string {
  const share = ({ right, of }: Tally) => `${right}/${of}`;
  const mark = (value: boolean | null) =>
    value === null ? "-" : value ? "yes" : "NO";
  const list = (counts: Record<string, number>) =>
    Object.entries(counts)
      .map(([kind, count]) => `${kind} ${count}`)
      .join(", ");
  return [
    `pack:bench ${result.benchmark} (coach projection, resolved per stage)`,
    `stage sources: ${list(result.sources)}`,
    `stage records: ${list(result.records)} (${result.deviceOnlyRecords} device-only)`,
    `  ${"stages with material of their own".padEnd(44)}${share(result.stagesWithMaterial)}`,
    `  ${"right stage note first".padEnd(44)}${share(result.prepFirst)}`,
    `  ${"earlier stage's line follows".padEnd(44)}${share(result.follows)}`,
    `  ${"later stage's line left out".padEnd(44)}${share(result.absent)}`,
    `  ${"employer's line offered".padEnd(44)}${share(result.employer)}`,
    `  ${"question".padEnd(20)}${"stage".padEnd(7)}${"prep".padEnd(6)}${"follows".padEnd(9)}${"absent".padEnd(8)}employer`,
    ...result.questions.map(
      (each) =>
        `  ${each.id.padEnd(20)}${String(each.stage).padEnd(7)}${mark(each.prepFirst).padEnd(6)}${mark(each.follows).padEnd(9)}${mark(each.absent).padEnd(8)}${mark(each.employer)}`,
    ),
    "",
    "the first benchmark's questions, with the stage material present:",
    `  ${"right evidence first".padEnd(44)}${share(result.base.evidenceFirst)}`,
    `  ${"right prep note first".padEnd(44)}${share(result.base.prepFirst)}`,
    `  ${"wrong-employer evidence in the first three".padEnd(44)}${share(result.base.wrongEmployerInThree)}`,
  ].join("\n");
}
