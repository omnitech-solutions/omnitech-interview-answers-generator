// The held-out material of the context pack's evaluation: two invented
// applications, and questions their authors did not write the ranker for.
//
// PROBLEM: every earlier score was measured on the questions the ranking
// rules were written against (the Kestrel fixture: the DEVELOPMENT set). A
// number is evidence only on questions nobody tuned for. STRATEGY: each
// held-out application is a folder of sources (a matrix, an employer brief, a
// posting, stages with notes and transcripts, what the employer said,
// research), a pack a model prepared from them ONCE and kept beside them
// (`kept-pack.json`: the corpus every arm selects from), and one question
// file whose gold names records by id and facts by the words the sources
// say. Every gold item is checked in code (`checkQuestions`).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Prepared } from "@omnitech/ai-engine";
import { z } from "zod";
import type { BriefMaterial } from "../../brief/repository";
import { type BenchMaterial, fixtureFolder, readBenchMaterial } from "../bench";

export const HELD_OUT_APPLICATIONS = [
  "tidewell-care",
  "spanforge-devtools",
] as const;
export type HeldOutApplication = (typeof HELD_OUT_APPLICATIONS)[number];

// [DOMAIN] The kinds of hard case, from the audit's checklist
// (evaluation-standards-and-audit.md, section 1.4). A category is reported as
// counts: ten questions describe, they do not prove.
export const CATEGORIES = [
  "paraphrase",
  "multi-hop",
  "entity-confusion",
  "temporal",
  "negation",
  "aggregation",
  "unanswerable",
  "off-topic",
  "conflict",
  "near-duplicate",
  "split-boundary",
  "noisy",
  "injection",
  "numbers",
  "acronym",
  "vague",
  "compound",
  "follow-up",
  "device-only",
  "device-only-paired",
  "stale",
  "carry-forward",
  "direct",
] as const;
export type Category = (typeof CATEGORIES)[number];
// The categories whose right result is NOTHING.
export const NOTHING: ReadonlySet<Category> = new Set([
  "unanswerable",
  "off-topic",
]);

export const questionSchema = z.strictObject({
  id: z.string().min(1),
  app: z.enum(HELD_OUT_APPLICATIONS),
  category: z.enum(CATEGORIES),
  question: z.string().min(1),
  // A follow-up: what was asked just before, which the question leans on.
  previous: z.string().min(1).optional(),
  // The stage the question is asked in (1 first). Absent: the last stage.
  stage: z.number().int().min(1).optional(),
  // Who reads what is selected. "device" is the person's own screen; absent
  // is a prompt sent to a model elsewhere, which is never given a device-only
  // source.
  reader: z.enum(["device", "remote"]).optional(),
  // "stale": asked after the posting was edited and before the pack was
  // prepared again.
  variant: z.enum(["stale"]).optional(),
  // The records that answer it: 2 answers the question, 1 supports an answer.
  // Empty when the right result is nothing.
  gold: z.array(
    z.strictObject({
      id: z.string().min(1),
      grade: z.union([z.literal(1), z.literal(2)]),
    }),
  ),
  // What a right ANSWER states, each in the sources' own words (checked), with
  // other ways of writing it.
  points: z
    .array(
      z.strictObject({
        says: z.string().min(1),
        aliases: z.array(z.string().min(1)).optional(),
      }),
    )
    .optional(),
  // The employers of the person's record a right answer may draw on.
  employers: z.array(z.string().min(1)).optional(),
  // Words that must NOT be in anything a reader is given (a device-only
  // source for a remote reader; a requirement the edited posting dropped).
  absent: z.array(z.string().min(1)).optional(),
  // A device-only question's pair: the same question for the device reader.
  pairOf: z.string().min(1).optional(),
});
export type Question = z.infer<typeof questionSchema>;

export const questionSetSchema = z.strictObject({
  name: z.string().min(1),
  // Bumped when a question or its gold changes.
  version: z.string().min(1),
  // How the set was written, so it can be written again.
  generator: z.strictObject({
    model: z.string().min(1),
    prompt: z.string().min(1),
    seed: z.number().int(),
    writtenOn: z.string().min(1),
    checkedBy: z.string().min(1),
  }),
  questions: z.array(questionSchema).min(1),
});
export type QuestionSet = z.infer<typeof questionSetSchema>;

export type EvalFixture = {
  name: HeldOutApplication;
  folder: string;
  material: BenchMaterial;
  // The application as `readBriefMaterial` gives it, with its posting.
  brief: BriefMaterial;
  // The same application after its posting was edited (the stale case).
  edited: BriefMaterial | null;
  // What a model prepared from the sources, kept with the fixture.
  kept: Prepared | null;
};

const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
export const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

type StoredTranscript = { text?: string; textFile?: string; sha256?: string };
type StoredStages = {
  stages: { transcripts?: StoredTranscript[] }[];
};

// [DOMAIN] A long transcript is kept as a file of its own beside stages.json
// (`textFile`, from the fixture's folder), so it is written once by its
// script and read as it is. Its sha256 must be the file's.
export function readApplication(folder: string, file = "stages.json") {
  const stored = json(`${folder}${file}`) as StoredStages;
  for (const stage of stored.stages)
    for (const transcript of stage.transcripts ?? []) {
      if (transcript.textFile === undefined) continue;
      transcript.text = readFileSync(`${folder}${transcript.textFile}`, "utf8");
      if (transcript.sha256 && transcript.sha256 !== sha256(transcript.text))
        throw new Error(
          `${transcript.textFile} is not the transcript stages.json names (sha256).`,
        );
      delete transcript.textFile;
    }
  return stored as unknown as BriefMaterial;
}

export function readEvalFixture(name: HeldOutApplication): EvalFixture {
  const folder = fixtureFolder(name);
  const stages = readApplication(folder);
  const posting = readFileSync(`${folder}posting.txt`, "utf8");
  const editedPath = `${folder}posting-edited.txt`;
  const keptPath = `${folder}kept-pack.json`;
  return {
    name,
    folder,
    material: readBenchMaterial({
      matrix: `${folder}matrix.json`,
      brief: `${folder}employer-brief.json`,
      preferences: `${folder}preferences.txt`,
    }),
    brief: { ...stages, posting },
    edited: existsSync(editedPath)
      ? { ...stages, posting: readFileSync(editedPath, "utf8") }
      : null,
    kept: existsSync(keptPath) ? (json(keptPath) as Prepared) : null,
  };
}

export const heldOutFolder = (): string => fixtureFolder("held-out");
export function readQuestions(
  path = `${heldOutFolder()}questions.json`,
): QuestionSet {
  return questionSetSchema.parse(json(path));
}

// What identifies a question set: a score is a score of THESE questions.
export const questionSetHash = (set: QuestionSet): string =>
  sha256(JSON.stringify(set.questions)).slice(0, 16);

// Text as a gold fact is looked for: without case, every run of anything
// that is not a letter or a digit one space.
export const plain = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9%.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Everything an application's sources say, as one searchable text.
export function sourceText(fixture: EvalFixture): string {
  const stages = fixture.brief as unknown as {
    stages: Record<string, unknown>[];
    employerSaid: unknown[];
    research: unknown[];
  };
  return plain(
    [
      JSON.stringify(fixture.material.matrix),
      JSON.stringify(fixture.material.brief),
      fixture.material.preferences,
      fixture.brief.posting ?? "",
      fixture.edited?.posting ?? "",
      JSON.stringify(stages.stages),
      JSON.stringify(stages.employerSaid),
      JSON.stringify(stages.research),
    ].join("\n"),
  );
}

export type GoldFault = { id: string; fault: string };
// [GUARD] Every gold item, checked in code: a gold record exists in the pack
// its question is read from; a gold fact is said by the sources; an "absent"
// phrase really is in the sources (or it proves nothing); a question whose
// right result is nothing names no record; a pair names a question that is
// there. A set with a fault is not scored.
export function checkQuestions(
  set: QuestionSet,
  known: (question: Question) => {
    records: ReadonlySet<string>;
    sources: string;
  },
): GoldFault[] {
  const faults: GoldFault[] = [];
  const ids = new Set<string>();
  for (const question of set.questions) {
    const fault = (text: string) =>
      faults.push({ id: question.id, fault: text });
    if (ids.has(question.id)) fault("the id is used twice");
    ids.add(question.id);
    const { records, sources } = known(question);
    for (const gold of question.gold)
      if (!records.has(gold.id)) fault(`no record ${gold.id}`);
    if (NOTHING.has(question.category) && question.gold.length > 0)
      fault("a question with no answer names a gold record");
    if (
      !NOTHING.has(question.category) &&
      question.category !== "device-only" &&
      question.category !== "stale" &&
      question.gold.length === 0
    )
      fault("no gold record");
    // A total is computed from several records: no source says it whole.
    for (const point of question.category === "aggregation"
      ? []
      : (question.points ?? []))
      if (
        ![point.says, ...(point.aliases ?? [])].some((each) =>
          sources.includes(plain(each)),
        )
      )
        fault(`the sources do not say "${point.says}"`);
    for (const phrase of question.absent ?? [])
      if (!sources.includes(plain(phrase)))
        fault(`"${phrase}" is in no source, so its absence proves nothing`);
    // The stale case is judged by record, not by phrase: what was prepared
    // from the old posting must not be handed over (retrieval.ts).
    if (question.variant === "stale" && (question.absent ?? []).length > 0)
      fault("a stale question is judged by record: it names no phrase");
    if (question.category === "follow-up" && !question.previous)
      fault("a follow-up without the question before it");
  }
  for (const question of set.questions)
    if (question.pairOf && !ids.has(question.pairOf))
      faults.push({ id: question.id, fault: `no pair ${question.pairOf}` });
  return faults;
}
