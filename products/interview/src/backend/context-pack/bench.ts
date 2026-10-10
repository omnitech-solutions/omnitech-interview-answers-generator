// The context pack's benchmark: a fixed brief, fixed questions and a gold
// file, scored the same way run after run, so a change to the recipe or the
// sources can be seen to help or to hurt.
//
// PROBLEM: "the pack is better" has to be a number. STRATEGY: prepare the
// pack from a brief (an experience matrix, an employer brief, preference
// lines), resolve every gold question under a projection, and count how
// often the fact that leads a slot is one the gold file accepts. No model is
// called anywhere: the sources are structured and selection is code.
// COMPLEXITY: one prepare, then one resolve per question and projection.
//
// [DOMAIN] The gold file names what should lead by what it SAYS, never by a
// record's identity: an evidence record by its employer (and, where one
// achievement matters, words it must contain), a prep note or a preference by
// the words it starts with. A change to how records are identified or
// composed therefore leaves the gold standing.
import { readFileSync } from "node:fs";
import { createAiEngine } from "@omnitech/ai-engine";
import {
  type CandidateMatrix,
  candidateMatrixSchema,
  type EmployerBrief,
  employerBriefSchema,
} from "@omnitech/interview-contracts";
import { z } from "zod";
import {
  type ContextPack,
  contextSources,
  type PackOptions,
  prepareContextPack,
} from "./pack";
import type { ProjectionId } from "./recipe";

export const goldSchema = z.strictObject({
  name: z.string().min(1),
  questions: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        // Which round asks it. Kept for the day a pack filters by stage.
        stage: z.string().min(1),
        question: z.string().min(1),
        // The employers whose evidence may lead, best first.
        evidence: z
          .array(
            z.strictObject({
              company: z.string().min(1),
              says: z.string().min(1).optional(),
            }),
          )
          .optional(),
        // The words a right prep note, or preference line, starts with.
        prep: z.array(z.string().min(1)).optional(),
        preferences: z.array(z.string().min(1)).optional(),
        // The material holds nothing for it, and nothing should be offered.
        nothing: z.boolean().optional(),
      }),
    )
    .min(1),
});
export type Gold = z.infer<typeof goldSchema>;
type GoldQuestion = Gold["questions"][number];

export type BenchMaterial = {
  matrix: CandidateMatrix;
  brief: EmployerBrief;
  preferences: string;
};

const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

// A brief read from files: the fixture's, or a person's own material kept
// outside the repository. The employer brief may be the brief itself or an
// application row that holds it under `employer_brief`.
export function readBenchMaterial(paths: {
  matrix: string;
  brief: string;
  preferences?: string;
}): BenchMaterial {
  const held = json(paths.brief) as { employer_brief?: unknown };
  const brief =
    typeof held.employer_brief === "string"
      ? JSON.parse(held.employer_brief)
      : (held.employer_brief ?? held);
  return {
    matrix: candidateMatrixSchema.parse(json(paths.matrix)),
    brief: employerBriefSchema.parse(brief),
    preferences: paths.preferences
      ? readFileSync(paths.preferences, "utf8")
      : "",
  };
}
export const readGold = (path: string): Gold => goldSchema.parse(json(path));

// The fixtures kept with the product: invented people and employers only.
export const fixtureFolder = (name: string): string =>
  new URL(`../../../fixtures/context-pack/${name}/`, import.meta.url).pathname;
export function readFixture(name: string): {
  material: BenchMaterial;
  gold: Gold;
} {
  const folder = fixtureFolder(name);
  return {
    material: readBenchMaterial({
      matrix: `${folder}matrix.json`,
      brief: `${folder}employer-brief.json`,
      preferences: `${folder}preferences.txt`,
    }),
    gold: readGold(`${folder}gold.json`),
  };
}

type Tally = { right: number; of: number };
export type QuestionScore = {
  id: string;
  stage: string;
  // Each is null when the gold file names nothing for that slot.
  evidenceFirst: boolean | null;
  evidenceInThree: boolean | null;
  prepFirst: boolean | null;
  preferenceFirst: boolean | null;
  // No fact was found by the question's words: only the known fields, and
  // the recent roles offered when nothing else is.
  nothingUseful: boolean;
  // Evidence among the first three from an employer the gold does not name.
  wrongEmployers: number | null;
  chars: number;
  // Where the leading facts are, never what they say: a result is kept on
  // disk, and a person's own material is not copied there.
  firstEvidence: string | null;
  firstPrep: string | null;
};
export type ProjectionScore = {
  evidenceFirst: Tally;
  evidenceInThree: Tally;
  prepFirst: Tally;
  preferenceFirst: Tally;
  nothingUseful: number;
  // Of the questions the gold says have no answer, how many found nothing.
  honestNothing: Tally;
  // Questions whose first three evidence facts include a wrong employer.
  wrongEmployerInThree: Tally;
  chars: { median: number; largest: number };
  resolveMs: { median: number; largest: number };
  questions: QuestionScore[];
};
export type PackBenchResult = {
  benchmark: string;
  at: string;
  recipe: { id: string; version: string };
  records: { total: number; byKind: Record<string, number> };
  prepareMs: number;
  projections: Record<string, ProjectionScore>;
};

const BENCH_PROJECTIONS: readonly ProjectionId[] = ["coach", "answer"];
const EXECUTION = {
  scope: {
    tenantId: "00000000-0000-4000-8000-0000000000b1",
    actorId: "00000000-0000-4000-8000-0000000000b2",
  },
};

const middle = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
};
const lower = (text: string) => text.toLowerCase();
const starts = (text: string, keys: readonly string[]) =>
  keys.some((key) => lower(text).startsWith(lower(key)));

export async function preparePackForBench(
  material: BenchMaterial,
  // Flags in place of each projection's own (recipe.ts): how the development
  // sweep tries a mechanism on these questions before the held-out set is read.
  flags?: PackOptions["flags"],
): Promise<ContextPack> {
  // No profile and no provider: a model call here would fail the run.
  const engine = createAiEngine({
    profiles: [],
    providers: {},
    log: { level: "silent" },
  });
  return prepareContextPack(
    engine,
    contextSources({
      matrix: { matrix: material.matrix, id: "bench", revision: 1 },
      brief: { brief: material.brief, id: "bench", revision: "bench" },
      ...(material.preferences.trim()
        ? {
            preferences: {
              text: material.preferences,
              id: "bench",
              revision: "1",
            },
          }
        : {}),
    }),
    { ...EXECUTION, signal: new AbortController().signal },
    flags ? { flags } : {},
  );
}

// Exported for the stage benchmark (bench-stages.ts), which scores the same
// gold on a pack resolved for a stage.
export function scoreQuestion(
  pack: Pick<ContextPack, "resolve" | "prepared">,
  projection: ProjectionId,
  asked: GoldQuestion,
): QuestionScore {
  const resolved = pack.resolve(projection, asked.question);
  const byId = new Map(pack.prepared.records.map((each) => [each.id, each]));
  const inSlot = (slot: string) =>
    resolved.selected.filter((fact) => fact.slot === slot);

  // [DOMAIN] An evidence fact is right when its employer is one the gold
  // names and, where the gold asks for particular words, it says them.
  const company = (id: string) =>
    String(byId.get(id)?.fields?.["company"] ?? "");
  const accepts = (fact: { recordId: string; text: string }) =>
    (asked.evidence ?? []).some(
      (wanted) =>
        lower(company(fact.recordId)) === lower(wanted.company) &&
        (!wanted.says || lower(fact.text).includes(lower(wanted.says))),
    );
  const employers = new Set(
    (asked.evidence ?? []).map((each) => lower(each.company)),
  );
  const evidence = inSlot("evidence");
  const leading = evidence.slice(0, 3);
  const prep = inSlot("prep");
  const preferences = inSlot("preferences");
  const first = <Fact>(facts: readonly Fact[]) => facts[0];
  const firstEvidence = first(evidence);
  const firstPrep = first(prep);
  const firstPreference = first(preferences);

  return {
    id: asked.id,
    stage: asked.stage,
    evidenceFirst: asked.evidence
      ? firstEvidence !== undefined && accepts(firstEvidence)
      : null,
    evidenceInThree: asked.evidence ? leading.some(accepts) : null,
    prepFirst: asked.prep
      ? firstPrep !== undefined && starts(firstPrep.text, asked.prep)
      : null,
    preferenceFirst: asked.preferences
      ? firstPreference !== undefined &&
        starts(firstPreference.text, asked.preferences)
      : null,
    nothingUseful: resolved.selected.every(
      (fact) => fact.exact || fact.score.words === 0,
    ),
    wrongEmployers: asked.evidence
      ? leading.filter((fact) => !employers.has(lower(company(fact.recordId))))
          .length
      : null,
    chars: resolved.selected.reduce((sum, fact) => sum + fact.text.length, 0),
    firstEvidence: firstEvidence?.source.locator ?? null,
    firstPrep: firstPrep?.recordId ?? null,
  };
}

export async function runPackBench(
  material: BenchMaterial,
  gold: Gold,
  nowMs: () => number = () => performance.now(),
  flags?: PackOptions["flags"],
): Promise<PackBenchResult> {
  const startedAt = nowMs();
  const pack = await preparePackForBench(material, flags);
  const prepareMs = nowMs() - startedAt;

  const byKind: Record<string, number> = {};
  for (const record of pack.prepared.records)
    byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;

  const projections: Record<string, ProjectionScore> = {};
  for (const projection of BENCH_PROJECTIONS) {
    const took: number[] = [];
    const questions = gold.questions.map((asked) => {
      const from = nowMs();
      const scored = scoreQuestion(pack, projection, asked);
      took.push(nowMs() - from);
      return scored;
    });
    // A tally counts only the questions the gold has an answer for.
    const tally = (pick: (each: QuestionScore) => boolean | null): Tally => ({
      right: questions.filter((each) => pick(each) === true).length,
      of: questions.filter((each) => pick(each) !== null).length,
    });
    const honest = new Set(
      gold.questions.filter((each) => each.nothing).map((each) => each.id),
    );
    const sizes = questions.map((each) => each.chars);
    projections[projection] = {
      evidenceFirst: tally((each) => each.evidenceFirst),
      evidenceInThree: tally((each) => each.evidenceInThree),
      prepFirst: tally((each) => each.prepFirst),
      preferenceFirst: tally((each) => each.preferenceFirst),
      nothingUseful: questions.filter((each) => each.nothingUseful).length,
      honestNothing: tally((each) =>
        honest.has(each.id) ? each.nothingUseful : null,
      ),
      wrongEmployerInThree: tally((each) =>
        each.wrongEmployers === null ? null : each.wrongEmployers > 0,
      ),
      chars: { median: middle(sizes), largest: Math.max(0, ...sizes) },
      resolveMs: { median: middle(took), largest: Math.max(0, ...took) },
      questions,
    };
  }
  return {
    benchmark: gold.name,
    at: new Date().toISOString(),
    recipe: pack.prepared.recipe,
    records: { total: pack.prepared.records.length, byKind },
    prepareMs,
    projections,
  };
}

// The result as lines a person reads, beside the last run when there is one.
export function reportPackBench(
  result: PackBenchResult,
  previous?: PackBenchResult,
): string {
  const share = ({ right, of }: Tally) => `${right}/${of}`;
  const ms = (value: number) => `${value.toFixed(1)} ms`;
  const kinds = Object.entries(result.records.byKind)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind} ${count}`)
    .join(", ");
  const lines = [
    `pack:bench ${result.benchmark}: recipe ${result.recipe.id} v${result.recipe.version}${
      previous
        ? `, compared with ${previous.at} (v${previous.recipe.version})`
        : ", no earlier run"
    }`,
    `records: ${result.records.total}${
      previous ? ` (was ${previous.records.total})` : ""
    }: ${kinds}`,
    `prepared in ${ms(result.prepareMs)}`,
  ];
  for (const [name, now] of Object.entries(result.projections)) {
    const was = previous?.projections[name];
    const row = (label: string, value: string, before?: string) =>
      lines.push(
        `  ${label.padEnd(44)}${value.padEnd(14)}${before === undefined ? "" : `was ${before}`}`,
      );
    lines.push("", `${name} (${now.questions.length} questions)`);
    row(
      "right evidence first",
      share(now.evidenceFirst),
      was && share(was.evidenceFirst),
    );
    row(
      "right evidence in the first three",
      share(now.evidenceInThree),
      was && share(was.evidenceInThree),
    );
    row(
      "right prep note first",
      share(now.prepFirst),
      was && share(was.prepFirst),
    );
    row(
      "right preference first",
      share(now.preferenceFirst),
      was && share(was.preferenceFirst),
    );
    row(
      "questions with nothing useful",
      String(now.nothingUseful),
      was && String(was.nothingUseful),
    );
    row(
      "  of the honestly empty ones, still empty",
      share(now.honestNothing),
      was && share(was.honestNothing),
    );
    row(
      "wrong-employer evidence in the first three",
      share(now.wrongEmployerInThree),
      was && share(was.wrongEmployerInThree),
    );
    row(
      "characters per question (median, largest)",
      `${now.chars.median}, ${now.chars.largest}`,
      was && `${was.chars.median}, ${was.chars.largest}`,
    );
    row(
      "resolve per question (median, largest)",
      `${ms(now.resolveMs.median)}, ${ms(now.resolveMs.largest)}`,
    );
    // Each question that changed since the last run, so a gain or a loss is
    // seen where it happened.
    const mark = (value: boolean | null) =>
      value === null ? "-" : value ? "yes" : "NO";
    lines.push(
      `  ${"question".padEnd(20)}${"evidence".padEnd(10)}${"in three".padEnd(10)}${"prep".padEnd(6)}${"pref".padEnd(6)}${"wrong".padEnd(7)}chars`,
    );
    for (const each of now.questions) {
      const before = was?.questions.find((other) => other.id === each.id);
      const changed =
        before &&
        (before.evidenceFirst !== each.evidenceFirst ||
          before.prepFirst !== each.prepFirst ||
          before.preferenceFirst !== each.preferenceFirst ||
          before.nothingUseful !== each.nothingUseful);
      lines.push(
        `  ${each.id.padEnd(20)}${mark(each.evidenceFirst).padEnd(10)}${mark(each.evidenceInThree).padEnd(10)}${mark(each.prepFirst).padEnd(6)}${mark(each.preferenceFirst).padEnd(6)}${String(each.wrongEmployers ?? "-").padEnd(7)}${String(each.chars).padEnd(6)}${each.nothingUseful ? "nothing found " : ""}${changed ? "(changed)" : ""}`,
      );
    }
  }
  return lines.join("\n");
}
