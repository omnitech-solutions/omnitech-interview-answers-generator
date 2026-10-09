// What the coach's model writes, and the note it becomes.
//
// PROBLEM: a note must reach the window while it is still being written, and
// a half-written JSON object cannot be shown. STRATEGY: the model writes one
// labelled line per piece ("SAY: …"), so every completed line is a whole,
// valid part of the note and the note so far can be posted as it grows.
import {
  COACH_NOTE_KINDS,
  type CoachNoteInput,
  type CoachNoteKind,
  type CoachSectionKind,
  TALKING_POINT_LENGTH,
} from "@omnitech/interview-contracts";

// The model's whole reply when nothing is worth saying.
export const SILENT = "NONE";

type Line = NonNullable<CoachNoteInput["sections"]>[number]["lines"][number];

const SECTION_OF: Readonly<Record<string, CoachSectionKind>> = {
  SAY: "say",
  ANCHOR: "anchors",
  QUESTION: "ask",
  CAUTION: "caution",
};
// The order the window reads them in, and how many lines each may hold.
const SECTIONS: readonly (readonly [CoachSectionKind, number])[] = [
  ["say", 3],
  ["anchors", 3],
  ["ask", 1],
  ["caution", 1],
];
const LABELLED = /^([A-Z]+):\s*(.*)$/;

const cut = (text: string, length: number): string =>
  text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;

// A line to say: **bold** marks its evidence (an employer, a technology, a
// figure), the rest is spoken. A pointer straight after the bold words
// (**cut latency 40%**[/roles/2/proof_points/1]) says where in the person's
// record the claim comes from.
//
// [SAFETY] Whether a claim is the person's own ("verified") is decided here,
// against the text of the facts the coach was given for this note, never by
// the model saying so:
//   - a cited claim verifies only if its pointer is one of those facts AND
//     every figure in the claim is a figure of that fact;
//   - an uncited claim verifies when one fact contains all of its words, or,
//     for a claim that carries a figure, every figure and most of its words
//     (the figure is what must not be invented; the rest is rephrasing).
// Anything else is the coach's inference and is marked so, so an
// accomplishment or a number is never put in the person's mouth unnoticed.
export type KnownFacts = ReadonlyMap<string, string>;
const NO_FACTS: KnownFacts = new Map();
// A word or a figure, without the full stop or comma that ends its sentence
// ("40%." is the figure "40%"), and with a figure apart from its unit, so
// "45ms" and "45 ms", "2.1M" and "2.1 m" are the same figure said two ways.
const tokens = (text: string): string[] =>
  (
    text
      .toLowerCase()
      .replace(/(\d)([a-z])/g, "$1 $2")
      .match(/[a-z0-9][a-z0-9.%+#-]*/g) ?? []
  ).map((token) => token.replace(/[.-]+$/, ""));
const figures = (text: string): string[] =>
  tokens(text).filter((token) => /\d/.test(token));
// Words too small to tell one fact from another.
const SMALL = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
]);
// How much of a figure-bearing claim must be the fact's own words.
const REPHRASED_SHARE = 0.6;
function sourceOf(
  claim: string,
  cited: string | undefined,
  known: KnownFacts,
): string | undefined {
  const citedText = cited ? known.get(cited) : undefined;
  if (cited && citedText !== undefined) {
    const held = new Set(tokens(citedText));
    return figures(claim).every((figure) => held.has(figure))
      ? cited
      : undefined;
  }
  const wanted = tokens(claim).filter((token) => !SMALL.has(token));
  if (wanted.length === 0) return undefined;
  const numbers = figures(claim);
  for (const [pointer, text] of known) {
    const held = new Set(tokens(text));
    const found = wanted.filter((token) => held.has(token)).length;
    if (found === wanted.length) return pointer;
    if (
      numbers.length > 0 &&
      numbers.every((figure) => held.has(figure)) &&
      found / wanted.length >= REPHRASED_SHARE
    )
      return pointer;
  }
  return undefined;
}

// The pointers the note contract accepts as a claim's source.
const SHOWABLE = /^\/(?:roles\/\d+(?:\/[\w-]+)*|context\/\w+(?:\/\d+)?)$/;
const CITED = /\*\*([^*]+)\*\*(?:\[(\/[\w/-]+)\])?/g;
function lineOf(text: string, known: KnownFacts): Line | null {
  const segments: Line["segments"] = [];
  let length = 0;
  // [GUARD] A line is one sentence: a piece that does not fit is cut where it
  // stands, after the markers are read, so no half marker is ever shown.
  const add = (segment: Line["segments"][number]) => {
    const room = TALKING_POINT_LENGTH - length;
    if (room <= 0 || segment.text === "") return;
    const kept = cut(segment.text, room);
    segments.push({ ...segment, text: kept });
    length += kept.length;
  };
  let from = 0;
  const whole = text.trim();
  for (const match of whole.matchAll(CITED)) {
    add({ text: whole.slice(from, match.index), role: "spoken" });
    const claim = match[1] as string;
    const source = sourceOf(claim, match[2], known);
    add({
      text: claim,
      role: "evidence",
      ...(source
        ? {
            grounding: "verified",
            // The window shows where a claim comes from only for a place it
            // can open (a role, a line of the brief); the person's name or
            // headline is theirs without one.
            ...(SHOWABLE.test(source) ? { source } : {}),
          }
        : { grounding: "inferred" }),
    });
    from = match.index + match[0].length;
  }
  // A stray marker or an unfinished pointer never reaches the window as text.
  add({
    text: whole.slice(from).replace(/\*\*|\[\/[\w/-]*\]?/g, ""),
    role: "spoken",
  });
  return segments.length > 0 ? { segments: segments.slice(0, 12) } : null;
}

export type CoachReply = {
  note: CoachNoteInput;
  // The note is for the question the last note was for: it joins that one.
  sameQuestion: boolean;
};

// The note in `text` so far. Null while there is nothing to show yet, and
// for a reply that says nothing is worth saying. While the reply is still
// being written (`final` false) its last line is unfinished and left out.
export function parseCoachReply(
  text: string,
  final: boolean,
  // The person's own facts the model was given, by pointer: only these verify.
  known: KnownFacts = NO_FACTS,
): CoachReply | null {
  const lines = text.split(/\r?\n/);
  if (!final) lines.pop();
  const fields: Record<string, string> = {};
  const sections = new Map<CoachSectionKind, Line[]>();
  for (const raw of lines) {
    const labelled = LABELLED.exec(raw.trim());
    if (!labelled) continue;
    const label = labelled[1] as string;
    const value = (labelled[2] ?? "").trim();
    if (!value) continue;
    const kind = SECTION_OF[label];
    if (!kind) {
      fields[label] ??= value;
      continue;
    }
    const line = lineOf(value, known);
    if (line) sections.set(kind, [...(sections.get(kind) ?? []), line]);
  }
  const shown = SECTIONS.flatMap(([kind, most]) => {
    const held = sections.get(kind);
    return held ? [{ kind, lines: held.slice(0, most) }] : [];
  });
  // [GUARD] A note with nothing to say is not a note.
  if (shown.length === 0) return null;
  const kind = COACH_NOTE_KINDS.includes(fields["KIND"] as CoachNoteKind)
    ? (fields["KIND"] as CoachNoteKind)
    : "direct-answer";
  const ask = fields["ASK"] ? cut(fields["ASK"], 80) : undefined;
  const heard = fields["HEARD"] ? cut(fields["HEARD"], 600) : undefined;
  return {
    sameQuestion: /^(yes|true)$/i.test(fields["SAME"] ?? ""),
    note: {
      title: cut(ask ?? heard ?? "Coach", 120),
      kind,
      // A note that only warns is drawn as a warning.
      tone: shown.every((section) => section.kind === "caution")
        ? "watch"
        : "say",
      ...(ask ? { ask } : {}),
      ...(heard ? { heard } : {}),
      sections: shown,
    },
  };
}
