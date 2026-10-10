// What a briefing and a document read of an application's context pack.
//
// PROBLEM: a briefing is written for one stage and a resume for one posting,
// and until now each gathered its own facts: the whole matrix, the posting as
// one text. Neither knew what the employer asks for line by line, which
// achievement is evidence for which requirement, where the record has a gap,
// or what an earlier stage asked. STRATEGY: both read the pack through its
// own projection (`briefing`, `document`; recipe.ts) and through the engine's
// read-only lookups (`find`, `related`), which is how the Studio gathers what
// it hands a writer that cannot be offered the pack as a tool (Claude Code
// and Codex run their own tools). Nothing here asks a model, and every fact
// handed over keeps the pointer it is cited by.
// With no pack prepared by a model there is no fit and nothing extracted:
// each function then answers `null`, and its reader writes from what it
// always wrote from.
import type { AiEngine, ContextRecord } from "@omnitech/ai-engine";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import { roleOf } from "./links";
import type { ContextPack, PackFact } from "./pack";
import { type FitStrength, KINDS, LINKS } from "./recipe";

type Lookups = Pick<AiEngine, "context">;
type Execution = {
  scope: { tenantId: string; actorId: string };
  signal: AbortSignal;
  for?: { kind: string; id: string };
};
const asking = (execution: Execution) => ({
  scope: { ...execution.scope, productId: INTERVIEW_PRODUCT_ID },
  permissions: ["interview.read"],
  signal: execution.signal,
  ...(execution.for ? { for: execution.for } : {}),
});

// What the employer asks of a candidate, with what the record shows for it.
export type Ask = {
  // The requirement, in the posting's terms, and where it is quoted from.
  requirement: string;
  pointer: string;
  level: "must" | "nice";
  // "none": nothing is tied to it, by a model or by a technology it names.
  fit: FitStrength | "none";
  // The achievements that are evidence for it, by pointer, strongest first.
  evidence: { pointer: string; text: string }[];
  // For a gap: what a model said is missing.
  gap?: string;
};

const pointerOf = (record: ContextRecord): string =>
  record.source.locator === undefined
    ? record.id
    : record.source.quote === undefined
      ? record.source.locator
      : `${record.source.id}@${record.source.locator}`;

// Whether a model prepared anything this pack reads: without it there is no
// fit map, and a reader keeps to what it had.
export const preparedByModel = (pack: ContextPack): boolean =>
  pack.prepared.records.some((record) => record.by === "model");

// [STRATEGY] The fit map, gathered with the engine's lookups: `find` lists
// what the employer asks for (a requirement is found by the section it is
// filed under), and `related` gives the achievements tied to each. A tie made
// by a model says how strongly; one made in code (a technology the
// requirement names, done by the person) counts as partial. A gap is taken
// from the pack's own list: it is never followed as evidence.
export function fitMap(
  engine: Lookups,
  pack: ContextPack,
  execution: Execution,
): Ask[] {
  const lookup = { prepared: pack.prepared };
  const asks: Ask[] = [];
  const seen = new Set<string>();
  const gapOf = new Map(pack.gaps.map((link) => [link.from, link]));
  for (const [section, level] of [
    ["mustHaves", "must"],
    ["niceToHaves", "nice"],
  ] as const) {
    const found = engine.context.find(
      lookup,
      { query: section, kind: KINDS.requirement, limit: 25 },
      asking(execution),
    );
    for (const record of found.records) {
      if (record.fields?.["section"] !== section || seen.has(record.id))
        continue;
      seen.add(record.id);
      const tied = engine.context
        .related(lookup, record.id, asking(execution))
        .related.filter(
          (each) =>
            each.direction === "from" &&
            (each.link.step === LINKS.fit || each.link.step === LINKS.stack) &&
            each.record.kind === KINDS.achievement,
        )
        .map((each) => ({
          record: each.record,
          strength:
            each.link.step === LINKS.fit &&
            each.link.fields?.["strength"] === "strong"
              ? 2
              : 1,
          by: each.link.by,
        }))
        // A model's judgement before a shared technology; strong first.
        .sort(
          (a, b) =>
            Number(b.by === "model") - Number(a.by === "model") ||
            b.strength - a.strength,
        );
      const judged = tied.filter((each) => each.by === "model");
      const evidence = (judged.length > 0 ? judged : tied).slice(0, 3);
      const gap = gapOf.get(record.id);
      const note = gap?.fields?.["note"];
      asks.push({
        requirement: record.text,
        pointer: pointerOf(record),
        level,
        fit:
          evidence.length === 0
            ? gap
              ? "gap"
              : "none"
            : evidence.some((each) => each.strength === 2)
              ? "strong"
              : "partial",
        evidence: evidence.map((each) => ({
          pointer: pointerOf(each.record),
          text: each.record.text,
        })),
        ...(evidence.length === 0 && typeof note === "string" && note
          ? { gap: note }
          : {}),
      });
    }
  }
  return asks;
}

// One stage, as a briefing reads it.
export type StageBriefing = {
  // Who is met, and when and how.
  people: PackFact[];
  asks: Ask[];
  // The person's notes for this stage and, after them, earlier stages'.
  notes: PackFact[];
  // What earlier stages asked, said to expect, heard answered and were
  // promised: read from their transcripts.
  asked: PackFact[];
  signals: PackFact[];
  answered: PackFact[];
  commitments: PackFact[];
  // What the employer said and what the research found.
  employer: PackFact[];
};

// The `briefing` projection of a pack resolved for a stage (pack.ts gives
// the stage), or null when no model prepared anything it reads.
export function stageBriefing(
  engine: Lookups,
  pack: ContextPack,
  execution: Execution,
): StageBriefing | null {
  if (!preparedByModel(pack)) return null;
  // No question: the stage's material by priority, the stage's own first.
  const facts = pack.facts("briefing", "");
  const of = (slot: string) => facts.filter((fact) => fact.slot === slot);
  return {
    people: of("people"),
    asks: fitMap(engine, pack, execution),
    notes: of("prep"),
    asked: of("asked"),
    signals: of("signals"),
    answered: of("answered"),
    commitments: of("commitments"),
    employer: of("employer"),
  };
}

// A briefing's material as lines a writer cites: each a fact with a pointer
// under `/context/pack/`, said to be the employer's (never the candidate's
// experience), in the order a person would read them.
export function briefingLines(
  briefing: StageBriefing,
): { pointer: string; text: string }[] {
  const lines: { pointer: string; text: string }[] = [];
  const add = (group: string, texts: readonly string[]) => {
    for (const [at, text] of texts.entries())
      lines.push({ pointer: `/context/pack/${group}/${at}`, text });
  };
  add(
    "people",
    briefing.people.map((fact) => fact.text),
  );
  add(
    "asks",
    briefing.asks.map((ask) =>
      [
        `${ask.level === "must" ? "Required" : "Preferred"}: ${ask.requirement}`,
        ask.fit === "gap" || ask.fit === "none"
          ? `GAP: no evidence in the candidate's record${ask.gap ? `. ${ask.gap}` : ""}`
          : `Evidence (${ask.fit}): ${ask.evidence.map((each) => each.pointer).join(", ")}`,
      ].join("; "),
    ),
  );
  add(
    "asked",
    briefing.asked.map((fact) => `Asked in an earlier stage: ${fact.text}`),
  );
  add(
    "signals",
    briefing.signals.map((fact) => `Said to expect: ${fact.text}`),
  );
  add(
    "answered",
    briefing.answered.map((fact) => `Answered before: ${fact.text}`),
  );
  add(
    "commitments",
    briefing.commitments.map((fact) => `Promised: ${fact.text}`),
  );
  add(
    "notes",
    briefing.notes.map((fact) => fact.text),
  );
  add(
    "employer",
    briefing.employer.map((fact) => fact.text),
  );
  return lines;
}

// What a document's writing call is given of the pack.
export type DocumentPack = {
  // What the employer asks for, with the evidence for each by pointer.
  asks: Ask[];
  // The achievements of the roles the document was cast with, whole, each
  // under its role's pointer ("/roles/3").
  achievements: { role: string; pointer: string; text: string }[];
};

// [DOMAIN] The `document` projection: every role with its achievements
// whole, and what the employer asks for. The cast (which role fills which
// block) is decided elsewhere and is not changed here: the roles asked for
// are the cast's, by their pointers, and only their achievements are given.
// With no roles named, every role's are.
export function documentPack(
  engine: Lookups,
  pack: ContextPack,
  execution: Execution,
  roles?: readonly string[],
): DocumentPack | null {
  if (!preparedByModel(pack)) return null;
  const byId = new Map(pack.prepared.records.map((each) => [each.id, each]));
  // A role's pointer by its record.
  const roleAt = new Map(
    pack.prepared.records
      .filter((record) => record.kind === KINDS.role)
      .map((record) => [record.id, record.source.locator ?? record.id]),
  );
  const wanted = roles ? new Set(roles) : undefined;
  const achievements = pack
    .facts("document", "")
    .filter((fact) => fact.slot === "evidence")
    .flatMap((fact) => {
      const record = byId.get(fact.id);
      const role = roleAt.get((record && roleOf(record)) ?? "");
      return role !== undefined && (!wanted || wanted.has(role))
        ? [{ role, pointer: fact.pointer, text: fact.text }]
        : [];
    });
  return { asks: fitMap(engine, pack, execution), achievements };
}
