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
import { voiceAmong } from "./roster";

// The model's whole reply when nothing is worth saying.
export const SILENT = "NONE";

type Line = NonNullable<CoachNoteInput["sections"]>[number]["lines"][number];

const SECTION_OF: Readonly<Record<string, CoachSectionKind>> = {
  SAY: "say",
  ANCHOR: "anchors",
  QUESTION: "ask",
  CAUTION: "caution",
};
// [DOMAIN] What kind of round the coach is in. It changes what a good note
// is: a conversation wants the answer to say; a system design wants the
// questions to ask first and then a design that grows; live coding wants a
// prompt (where to look, the test to write), never the code.
export const COACH_MODES = ["conversation", "system-design", "coding"] as const;
export type CoachMode = (typeof COACH_MODES)[number];

// The order the window reads them in, and how many lines each may hold.
type Caps = readonly (readonly [CoachSectionKind, number])[];
const SECTIONS: Record<CoachMode, Caps> = {
  conversation: [
    ["say", 3],
    ["anchors", 3],
    ["ask", 1],
    ["caution", 1],
  ],
  // A design opens with the questions to ask, so it may hold five of them.
  "system-design": [
    ["ask", 5],
    ["say", 3],
    ["anchors", 3],
    ["caution", 2],
  ],
  coding: [
    ["say", 2],
    ["anchors", 4],
    ["ask", 2],
    ["caution", 2],
  ],
};

// One arrow of a design, as the model writes it: "DRAW: Client -> API: order".
export type DesignEdge = { from: string; to: string; label?: string };
const EDGE = /^(.{1,40}?)\s*-+>\s*([^:]{1,40})(?::\s*(.{1,60}))?$/;
export const DESIGN_STAGES = [
  "requirements",
  "high-level",
  "detail",
  "issues",
] as const;
export type DesignStage = (typeof DESIGN_STAGES)[number];

// The design so far as Mermaid source. Boxes are named by what they are
// called, so the same name is the same box however often it is drawn.
const DIAGRAM_LENGTH = 1_500;
export function designDiagram(
  edges: readonly DesignEdge[],
): string | undefined {
  if (edges.length === 0) return undefined;
  // A box is the same box whenever its name reads the same; its id is its
  // place among the boxes, so a name in any script gets one of its own.
  const ids = new Map<string, string>();
  const id = (name: string) => {
    const key = name.trim().toLowerCase();
    const held = ids.get(key) ?? `n${ids.size + 1}`;
    ids.set(key, held);
    return held;
  };
  // Mermaid reads brackets, pipes and parentheses as its own marks.
  const label = (text: string) =>
    cut(
      text
        .replace(/["[\]|(){}<>]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
      48,
    );
  const lines = ["flowchart LR"];
  for (const edge of edges) {
    // A label that is nothing once its marks are gone is no label.
    const said = edge.label ? label(edge.label) : "";
    const line = `  ${id(edge.from)}["${label(edge.from) || "?"}"] -->${
      said ? `|${said}|` : ""
    } ${id(edge.to)}["${label(edge.to) || "?"}"]`;
    // A drawing that would not fit is cut at a whole arrow, never mid-line.
    if (lines.join("\n").length + line.length + 1 > DIAGRAM_LENGTH) break;
    lines.push(line);
  }
  return lines.join("\n");
}
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

// [DOMAIN] How a claim that CITES a fact is checked (`cite`):
//   "pointer": the pointer is one of the facts given and every figure in the
//     claim is that fact's. The words are not looked at, so a claim with no
//     figure verifies under ANY pointer the model wrote, and a pointer written
//     a few words after the bold phrase verifies nothing. The coach as it was.
//   "words": as "pointer", and at least half of the words that carry the claim
//     are the cited fact's, so a pointer on words the fact does not say
//     verifies nothing; and a pointer written later in the line belongs to the
//     nearest bold phrase before it that cites nothing.
// Measured on replayed calls (BRIEF-interview-brief-and-context-pack, 15).
export type CiteCheck = "pointer" | "words";
// How much of a cited claim's words must be the cited fact's.
const CITED_SHARE = 0.5;
// A word as it is compared between a claim and the fact it cites: a hyphen
// separates ("adapter-based" holds "adapter"), and a long word is compared by
// how it begins, so "mentoring" is "mentored" and "migration" is "migrated".
const STEM = 5;
const carried = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z0-9][a-z0-9.%+#]*/g) ?? [])
    .map((word) => word.replace(/\.+$/, ""))
    .filter((word) => word !== "" && !SMALL.has(word))
    .map((word) => (/^[a-z]+$/.test(word) ? word.slice(0, STEM) : word));
function saysEnough(claim: string, fact: string): boolean {
  const wanted = carried(claim);
  if (wanted.length === 0) return true;
  const held = new Set(carried(fact));
  const found = wanted.filter((word) => held.has(word)).length;
  return found / wanted.length >= CITED_SHARE;
}

function sourceOf(
  claim: string,
  cited: readonly string[],
  known: KnownFacts,
  cite: CiteCheck,
): string | undefined {
  const given = cited.filter((pointer) => known.has(pointer));
  if (given.length > 0) {
    // The first cited fact that holds the claim; none, and it is inferred.
    return given.find((pointer) => {
      const text = known.get(pointer) as string;
      const held = new Set(tokens(text));
      return (
        figures(claim).every((figure) => held.has(figure)) &&
        (cite === "pointer" || saysEnough(claim, text))
      );
    });
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
// A bold phrase with what is written in brackets straight after it: its
// pointers, and anything else a model puts there as though it were one
// ("**the posted range**[posting]"), which is read as no pointer and never
// shown.
const CITED = /\*\*([^*]+)\*\*((?:\[[^\]\s*]+\])*)/g;
// A pointer the model wrote in bold ("stack**[/roles/5/metrics/0]**") is a
// pointer all the same, not a claim whose words are a pointer.
const BOLD_POINTER = /\*\*((?:\[\/[\w/-]+\])+)\*\*/g;
const POINTER = /\[(\/[\w/-]+)\]/g;
const pointersIn = (text: string): string[] =>
  [...text.matchAll(POINTER)].map((found) => found[1] as string);
function lineOf(text: string, known: KnownFacts, cite: CiteCheck): Line | null {
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
  const whole = text.trim().replace(BOLD_POINTER, "$1");
  const claims = [...whole.matchAll(CITED)].map((match) => ({
    at: match.index,
    end: match.index + match[0].length,
    claim: match[1] as string,
    cited: pointersIn(match[2] ?? ""),
  }));
  // [DOMAIN] A pointer written after a few more words ("**35%** on the
  // quoting UI[/roles/5/metrics/2]") is the model citing the phrase before
  // it: it belongs to the nearest bold phrase before it that cites nothing.
  if (cite === "words")
    for (const [at, each] of claims.entries()) {
      const next = claims[at + 1];
      const stray = pointersIn(whole.slice(each.end, next?.at ?? whole.length));
      if (each.cited.length === 0 && stray.length > 0) each.cited = stray;
    }
  let from = 0;
  for (const each of claims) {
    // A pointer between two bold phrases is never shown as words.
    add({
      text: whole.slice(from, each.at).replace(POINTER, ""),
      role: "spoken",
    });
    const source = sourceOf(each.claim, each.cited, known, cite);
    add({
      text: each.claim,
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
    from = each.end;
  }
  // A stray marker or an unfinished pointer never reaches the window as text.
  add({
    text: whole
      .slice(from)
      .replace(/\*\*|\[[^\]\s]*\/[^\]\s]*\]?|[\w.…/-]*\/[\w/-]*\]/g, ""),
    role: "spoken",
  });
  return segments.length > 0 ? { segments: segments.slice(0, 12) } : null;
}

// [DOMAIN] What the coach chose to remember for the rest of the call: lines
// it writes for itself ("LOG: she said the team owns pricing rules"), given
// back to it on every later call. They are never shown as a note, and a reply
// that is otherwise silent may still carry them.
const LOG_LINE = /^LOG:\s*(.+)$/;
export const LOG_LINE_LENGTH = 200;
export function coachLogOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const found = LOG_LINE.exec(line.trim());
      return found ? [cut((found[1] as string).trim(), LOG_LINE_LENGTH)] : [];
    })
    .slice(0, 3);
}

export type CoachReply = {
  // In a system design: where the conversation is, and the arrows to add.
  stage?: DesignStage;
  draw: DesignEdge[];
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
  mode: CoachMode = "conversation",
  // [SAFETY] The interviewers a note may name as who asked ("FROM: Marcus"):
  // those the turn's lines named, or else the plan's roster. A name that is
  // not one of them is dropped, never shown. None given: no note names anyone.
  voices: readonly string[] = [],
  // How a cited claim is checked against its fact (CiteCheck, above).
  cite: CiteCheck = "pointer",
): CoachReply | null {
  const lines = text.split(/\r?\n/);
  if (!final) lines.pop();
  const fields: Record<string, string> = {};
  const sections = new Map<CoachSectionKind, Line[]>();
  const draw: DesignEdge[] = [];
  for (const raw of lines) {
    const labelled = LABELLED.exec(raw.trim());
    if (!labelled) continue;
    const label = labelled[1] as string;
    const value = (labelled[2] ?? "").trim();
    if (!value) continue;
    if (label === "DRAW") {
      const edge = EDGE.exec(value);
      if (edge)
        draw.push({
          from: (edge[1] as string).trim(),
          to: (edge[2] as string).trim(),
          ...(edge[3] ? { label: edge[3].trim() } : {}),
        });
      continue;
    }
    const kind = SECTION_OF[label];
    if (!kind) {
      fields[label] ??= value;
      continue;
    }
    const line = lineOf(value, known, cite);
    if (line) sections.set(kind, [...(sections.get(kind) ?? []), line]);
  }
  const shown = SECTIONS[mode].flatMap(([kind, most]) => {
    const held = sections.get(kind);
    return held ? [{ kind, lines: held.slice(0, most) }] : [];
  });
  // [GUARD] A note with nothing to say is not a note (a design's arrows are
  // something to say).
  if (shown.length === 0 && draw.length === 0) return null;
  const kind = COACH_NOTE_KINDS.includes(fields["KIND"] as CoachNoteKind)
    ? (fields["KIND"] as CoachNoteKind)
    : "direct-answer";
  const ask = fields["ASK"] ? cut(fields["ASK"], 80) : undefined;
  const heard = fields["HEARD"] ? cut(fields["HEARD"], 600) : undefined;
  const from = voiceAmong(fields["FROM"], voices);
  return {
    sameQuestion: /^(yes|true)$/i.test(fields["SAME"] ?? ""),
    draw,
    ...(DESIGN_STAGES.includes(fields["STAGE"] as DesignStage)
      ? { stage: fields["STAGE"] as DesignStage }
      : {}),
    note: {
      title: cut(ask ?? heard ?? "Coach", 120),
      kind,
      // A note that only warns is drawn as a warning.
      tone:
        shown.length > 0 && shown.every((section) => section.kind === "caution")
          ? "watch"
          : "say",
      ...(ask ? { ask } : {}),
      ...(heard ? { heard } : {}),
      ...(from ? { from } : {}),
      sections: shown,
    },
  };
}
