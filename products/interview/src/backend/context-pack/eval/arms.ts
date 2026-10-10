// The arms of the context pack's evaluation: each is one way of choosing what
// a reader is given for a question, over the SAME records.
//
// PROBLEM: "the pack is effective" means "more effective than something".
// STRATEGY: every arm answers the same call (an application, a question, a
// projection) with an ordered selection of the pack's records, so one scorer
// reads them all. The pack's own arms differ only in the recipe they select
// with (pack.ts takes it as an option); BM25 and "everything" are written
// here, for the benchmark only, and ship nowhere. Three deliberately broken
// selectors prove the gate can fail.
// COMPLEXITY: one prepare per (application, stage, reader, arm), kept; then
// one resolve per question.
import {
  type AiEngine,
  type ContextRecord,
  createAiEngine,
  type Prepared,
  type Slot,
  type SlotOutcome,
} from "@omnitech/ai-engine";
import type { BriefMaterial } from "../../brief/repository";
import { stageContext } from "../bench-stages";
import {
  CODE_ONLY_RECIPE,
  EVIDENCE_PLACES,
  KINDS,
  keyTerms,
  LEGACY_FLAGS,
  MEASURED_MATCH,
  type PackFlags,
  type ProjectionId,
  selectingRecipe,
} from "../recipe";
import { prepareStagePack, type StagePack } from "../stage";
import type { EvalFixture, Question } from "./fixture";

export type Chosen = {
  id: string;
  slot: string;
  kind: string;
  text: string;
  // What the record scored for the question (0 when it was not ranked by it).
  score: number;
  exact: boolean;
};
export type Selection = {
  chosen: Chosen[];
  ms: number;
  // How each ranked slot came out, where the arm can say (the margin a host
  // reads to abstain).
  outcomes?: readonly SlotOutcome[];
};
export type Arm = {
  id: string;
  label: string;
  // The records the arm selects from, for a question (to check gold against).
  pack(fixture: EvalFixture, question: Question): Promise<StagePack>;
  select(
    fixture: EvalFixture,
    question: Question,
    projection: ProjectionId,
  ): Promise<Selection>;
};

const EXECUTION = {
  scope: {
    tenantId: "00000000-0000-4000-8000-0000000000b1",
    actorId: "00000000-0000-4000-8000-0000000000b2",
  },
};
// No profile and no provider: a model call on the selection path would fail
// the run (the catalogue's "no model call on the resolve path").
const engine = (): AiEngine =>
  createAiEngine({ profiles: [], providers: {}, log: { level: "silent" } });

// The last stage of an application: where a question with no stage is asked.
const lastStage = (brief: BriefMaterial): number =>
  Math.max(...brief.stages.map((stage) => stage.ordinal));

export type PackChoice = {
  // Flags in place of each projection's own (recipe.ts); absent, the
  // product's defaults.
  flags?: Partial<PackFlags>;
  // [SAFETY] Broken on purpose: read as the person's own screen whoever asks.
  leaky?: boolean;
  // Broken on purpose: an edited source is read as it was when prepared.
  ignoresEdits?: boolean;
};

const packs = new Map<string, Promise<StagePack>>();
// The pack a question is read from: the application as it stands (or with
// its posting edited, for the stale case), scoped to the question's stage,
// for the question's reader, with what a model prepared kept beside it.
export function packFor(
  arm: string,
  choice: PackChoice,
  fixture: EvalFixture,
  question: Pick<Question, "stage" | "reader" | "variant">,
): Promise<StagePack> {
  const stale = question.variant === "stale" && !choice.ignoresEdits;
  const brief = stale && fixture.edited ? fixture.edited : fixture.brief;
  const stage = question.stage ?? lastStage(brief);
  const reader = choice.leaky ? "device" : (question.reader ?? "remote");
  const key = [arm, fixture.name, stage, reader, stale].join("|");
  const held = packs.get(key);
  if (held) return held;
  const recipe = CODE_ONLY_RECIPE;
  // [DOMAIN] The kept pack was prepared once, under one recipe version. An
  // arm that selects under another version reads the same extraction: the
  // extractors are the same, only the ranking differs.
  const kept: Prepared | undefined = fixture.kept
    ? { ...fixture.kept, recipe: { id: recipe.id, version: recipe.version } }
    : undefined;
  const made = prepareStagePack(
    engine(),
    stageContext(fixture.material, brief),
    { ...EXECUTION, signal: new AbortController().signal },
    stage,
    {
      kept,
      reader,
      ...(choice.flags ? { flags: choice.flags } : {}),
    },
  );
  packs.set(key, made);
  return made;
}
export const forgetPacks = () => packs.clear();

const scoreOf = (score: { words: number; total?: number }) =>
  score.total ?? score.words;

// An arm that is the pack itself, selecting with a recipe.
export function packArm(
  id: string,
  label: string,
  choice: PackChoice = {},
): Arm {
  return {
    id,
    label,
    pack: (fixture, question) => packFor(id, choice, fixture, question),
    async select(fixture, question, projection) {
      const pack = await packFor(id, choice, fixture, question);
      const started = performance.now();
      const resolved = pack.resolve(projection, question.question);
      const ms = performance.now() - started;
      return {
        chosen: resolved.selected.map((fact) => ({
          id: fact.recordId,
          slot: fact.slot,
          kind: fact.kind,
          text: fact.text,
          score: scoreOf(fact.score),
          exact: fact.exact,
        })),
        ms,
        ...(resolved.outcomes ? { outcomes: resolved.outcomes } : {}),
      };
    },
  };
}

// ---- BM25, for the benchmark only ----------------------------------------

const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .match(/[\p{L}\p{N}][\p{L}\p{N}+#]*/gu) ?? [];

// Everything a record says that a question could match: its text and every
// string it carries as a field (its employer, its technologies, its heading).
function saidBy(record: ContextRecord): string[] {
  const strings: string[] = [record.text];
  for (const value of Object.values(record.fields ?? {})) {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value))
      for (const each of value)
        if (typeof each === "string") strings.push(each);
  }
  return tokens(
    [...strings, ...(record.themes ?? []), ...(record.answers ?? [])].join(" "),
  );
}

// [DOMAIN] Okapi BM25, the standard lexical baseline: a matching word counts
// by how rare it is among the slot's records, a repeated word adds a little
// with diminishing returns, and a long record is discounted.
const K1 = 1.2;
const B = 0.75;
export function bm25(
  query: readonly string[],
  documents: readonly (readonly string[])[],
): number[] {
  const count = documents.length;
  const average =
    documents.reduce((sum, words) => sum + words.length, 0) /
    Math.max(1, count);
  const within = documents.map((words) => {
    const seen = new Map<string, number>();
    for (const word of words) seen.set(word, (seen.get(word) ?? 0) + 1);
    return seen;
  });
  const asked = [...new Set(query)];
  const holding = new Map(
    asked.map((word) => [
      word,
      within.reduce((sum, seen) => sum + (seen.has(word) ? 1 : 0), 0),
    ]),
  );
  return documents.map((words, at) => {
    let score = 0;
    for (const word of asked) {
      const frequency = within[at]?.get(word) ?? 0;
      if (frequency === 0) continue;
      const held = holding.get(word) ?? 0;
      const rarity = Math.log(1 + (count - held + 0.5) / (held + 0.5));
      score +=
        (rarity * frequency * (K1 + 1)) /
        (frequency + K1 * (1 - B + (B * words.length) / Math.max(1, average)));
    }
    return score;
  });
}

// The slots a projection has under a set of flags (what was answered and
// promised is there only when the flags say so).
const slotsOf = (
  projection: ProjectionId,
  flags: PackFlags = LEGACY_FLAGS,
): readonly Slot[] =>
  selectingRecipe(flags).projections.find((each) => each.id === projection)
    ?.slots ?? [];
// How many records a slot gives: the projection's places for evidence.
const limitOf = (projection: ProjectionId, slot: Slot): number =>
  slot.id === "evidence"
    ? EVIDENCE_PLACES[projection].places
    : (slot.limit ?? 3);
const meets = (record: ContextRecord, slot: Slot): boolean =>
  record.kind === slot.kind &&
  record.text.length <= (slot.maxChars ?? Number.POSITIVE_INFINITY) &&
  (slot.where ?? []).every(
    (condition) =>
      condition.op !== "equals" ||
      record.fields?.[condition.field] === condition.value,
  );
// The engine's stage scope, as a filter: a later stage's record is no part of
// an earlier stage's selection, for any arm.
const inScope = (record: ContextRecord, stage: number): boolean => {
  const scope = (record as { scope?: string }).scope;
  if (!scope?.startsWith("stage:")) return true;
  return Number(scope.slice("stage:".length)) <= stage;
};

// One selection made by ranking each slot's records with `rank`.
function slotwise(
  id: string,
  label: string,
  rank: (
    query: readonly string[],
    records: readonly ContextRecord[],
  ) => { record: ContextRecord; score: number }[],
  choice: PackChoice = {},
  flags: PackFlags = LEGACY_FLAGS,
): Arm {
  return {
    id,
    label,
    pack: (fixture, question) => packFor("records", choice, fixture, question),
    async select(fixture, question, projection) {
      const pack = await packFor("records", choice, fixture, question);
      const stage = question.stage ?? lastStage(fixture.brief);
      const started = performance.now();
      const query = tokens(keyTerms(question.question));
      const chosen: Chosen[] = [];
      for (const slot of slotsOf(projection, flags)) {
        if (slot.mode !== "ranked") continue;
        const candidates = pack.prepared.records.filter(
          (record) => meets(record, slot) && inScope(record, stage),
        );
        for (const { record, score } of rank(query, candidates).slice(
          0,
          limitOf(projection, slot),
        ))
          chosen.push({
            id: record.id,
            slot: slot.id,
            kind: record.kind,
            text: record.text,
            score,
            exact: false,
          });
      }
      return { chosen, ms: performance.now() - started };
    },
  };
}

export const bm25Arm = (said = false): Arm =>
  slotwise(
    said ? "bm25-said" : "bm25",
    said
      ? "BM25 + what was answered and promised (benchmark only)"
      : "BM25 over the same records (benchmark only)",
    (query, records) => {
      const scores = bm25(query, records.map(saidBy));
      return records
        .map((record, at) => ({ record, score: scores[at] ?? 0 }))
        .filter((each) => each.score > 0)
        .sort(
          (a, b) => b.score - a.score || (a.record.id < b.record.id ? -1 : 1),
        );
    },
    {},
    { ...LEGACY_FLAGS, said },
  );

// No selection at all: every record the reader may read, in the pack's order.
export function everythingArm(): Arm {
  return {
    id: "everything",
    label: "Everything (no selection)",
    pack: (fixture, question) => packFor("records", {}, fixture, question),
    async select(fixture, question) {
      const pack = await packFor("records", {}, fixture, question);
      const stage = question.stage ?? lastStage(fixture.brief);
      const started = performance.now();
      const chosen = pack.prepared.records
        .filter((record) => inScope(record, stage))
        .map((record) => ({
          id: record.id,
          slot: "everything",
          kind: record.kind,
          text: record.text,
          score: 0,
          exact: false,
        }));
      return { chosen, ms: performance.now() - started };
    },
  };
}

// ---- Counter-fixtures: selectors broken on purpose -------------------------
// Each must fail the gate on the metric it is named for (retrieval.test.ts).
export const BROKEN = {
  // Ranking disabled: each slot's first records by id, whatever was asked.
  unranked: (): Arm =>
    slotwise("broken-unranked", "BROKEN: no ranking", (_query, records) =>
      [...records]
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((record) => ({ record, score: 1 })),
    ),
  // [SAFETY] The privacy filter removed: every reader is treated as the
  // person's own screen, so a device-only source reaches a remote prompt.
  leaky: (choice: PackChoice = {}): Arm =>
    packArm("broken-leaky", "BROKEN: device-only not withheld", {
      ...choice,
      leaky: true,
    }),
  // A source's edit ignored: what was prepared from the old posting is still
  // read after the posting changed.
  stale: (choice: PackChoice = {}): Arm =>
    packArm("broken-stale", "BROKEN: an edited source still read", {
      ...choice,
      ignoresEdits: true,
    }),
} as const;

// ---- The pack's own arms ----------------------------------------------------

const VERSION_2: PackFlags = {
  match: MEASURED_MATCH,
  terms: false,
  said: false,
};
const measured = (over: Partial<typeof MEASURED_MATCH>) => ({
  match: { ...MEASURED_MATCH, ...over },
});
// Everything that has a switch, on.
export const FULL: PackFlags = {
  match: MEASURED_MATCH,
  terms: true,
  said: true,
};

// What a transcript turn is: never offered by any arm of the pack (it is in
// no slot), and what makes "everything" long.
export const isTurn = (kind: string): boolean => kind === KINDS.turn;

// The flag sets the development sweep tries on the Kestrel questions.
export const DEV_FLAGS: Readonly<Record<string, Partial<PackFlags>>> = {
  before: LEGACY_FLAGS,
  v2: VERSION_2,
  "v2-no-stem": { ...VERSION_2, ...measured({ stem: false }) },
  "v2-no-stop": { ...VERSION_2, ...measured({ stop: false }) },
  "v2-no-exclusion": { ...VERSION_2, ...measured({ exclusion: false }) },
  "v2-no-cut": { ...VERSION_2, ...measured({ cut: false }) },
};

// Every retrieval arm, in the order the report lists them. `adopted` is the
// product's own defaults (PACK_FLAGS), whatever they are today. The arms that
// were tried and dropped (a cap per employer, a follow-up's carry-over, the
// question as said, ties as support, the word forms switched off) were
// measured before their code was removed; the brief's section 14 has them.
export function retrievalArms(): Arm[] {
  const full = (id: string, label: string, over: Partial<PackFlags> = {}) =>
    packArm(id, label, { flags: { ...FULL, ...over } });
  return [
    packArm("before", "Recipe 3 as it was (plain matching)", {
      flags: LEGACY_FLAGS,
    }),
    packArm("adopted", "The product's defaults today"),
    // The ladder: one mechanism added at a time.
    packArm("said", "+ what was answered and promised", {
      flags: { ...LEGACY_FLAGS, said: true },
    }),
    packArm("said-terms", "+ model terms (opt-in at prepare)", {
      flags: { ...LEGACY_FLAGS, said: true, terms: true },
    }),
    full("full", "+ version 2 matching (everything on)"),
    // Version 2 alone, and the candidate with one mechanism off.
    packArm("v2", "Version 2 matching alone", { flags: VERSION_2 }),
    full(
      "full-no-stem",
      "everything, without stemming",
      measured({ stem: false }),
    ),
    full(
      "full-no-stop",
      "everything, without stop words",
      measured({ stop: false }),
    ),
    full(
      "full-no-exclusion",
      "everything, without exclusions",
      measured({ exclusion: false }),
    ),
    full(
      "full-no-cut",
      "everything, without the cut",
      measured({ cut: false }),
    ),
    full("full-no-terms", "everything, without model terms", { terms: false }),
    full("full-no-said", "everything, without answered and promised", {
      said: false,
    }),
    bm25Arm(),
    bm25Arm(true),
    everythingArm(),
  ];
}
