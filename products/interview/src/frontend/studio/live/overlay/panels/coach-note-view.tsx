// One coaching note, drawn. This file owns how a note looks; the note itself
// only says what each piece is (coach-notes.ts in the contracts). The same
// component draws the full note and the compact one, so the two never drift.
//
// [DOMAIN] The colour vocabulary, used here and nowhere else:
//   green  say or act now: the response, the question to ask
//   blue   evidence: the employer, the technology, the figure that anchors it
//   amber  caution: a risk, a correction, a claim that is not verified
//   grey   supporting context: read later, never said
// White is the sentence itself. A section's label takes its kind's colour and
// the words inside stay white, so a note is never a wall of highlights.

import { Button, CueCard, type CueSection } from "@oc-tech/omni-ui-components";
import type {
  CoachLine,
  CoachNote,
  CoachSectionKind,
  CoachSegment,
} from "@omnitech/interview-contracts";
import { type CSSProperties, useLayoutEffect, useRef } from "react";
import { Icon } from "../../../icon";
import { useCoachTextSize } from "./coach-columns";
import {
  Diagram,
  noteBlocks,
  noteMarkdown,
  openLink,
  talkingPoints,
} from "./coach-notes";

export const COACH_COLOUR = {
  act: "#3ecf72",
  evidence: "#7cb4ff",
  caution: "#f5b84a",
  context: "#8e8e93",
  read: "#f2f2f3",
} as const;

const SECTION: Record<CoachSectionKind, { label: string; colour: string }> = {
  say: { label: "Say this", colour: COACH_COLOUR.act },
  anchors: { label: "Anchors", colour: COACH_COLOUR.evidence },
  ask: { label: "Ask", colour: COACH_COLOUR.act },
  caution: { label: "Careful", colour: COACH_COLOUR.caution },
  context: { label: "Context", colour: COACH_COLOUR.context },
};

const LABEL_LENGTH = 28;

export type DrawnSection = {
  kind: CoachSectionKind;
  label: string;
  lines: CoachLine[];
};

// `**bold**` in a written line is its evidence.
// A scripted line's quotation marks are dropped: it is what to say, not a
// quotation of it.
function segmentsOf(text: string): CoachSegment[] {
  return text
    .replace(/["“”]/g, "")
    .split("**")
    .map((piece, at) => ({
      text: piece,
      role: at % 2 === 1 ? ("evidence" as const) : ("spoken" as const),
    }))
    .filter((segment) => segment.text !== "");
}

// What a heading written by hand is for, from its words.
function kindOf(heading: string): CoachSectionKind {
  const words = heading.toLowerCase();
  if (/avoid|watch|careful|steer|fix|delivery|do not|don't/.test(words))
    return "caution";
  if (/^(then )?ask\b|questions? (for|to)/.test(words)) return "ask";
  if (/why|context|looking for|background/.test(words)) return "context";
  return "say";
}

// [STRATEGY] One shape for every note. A structured note is drawn as it is. A
// note written as Markdown (or as plain points) is read into the same shape:
// each heading opens a section, a paragraph becomes one line a sentence, a
// bullet is one line, bold is evidence. A "watch" note is all caution.
export function drawnSections(note: CoachNote): {
  sections: DrawnSection[];
  diagrams: string[];
} {
  if (note.sections.length > 0)
    return {
      sections: note.sections.map((section) => ({
        kind: section.kind,
        label: section.label ?? SECTION[section.kind].label,
        lines: section.lines,
      })),
      diagrams: note.diagram ? [note.diagram] : [],
    };
  const sections: DrawnSection[] = [];
  const diagrams: string[] = [];
  const all = note.tone === "watch" ? ("caution" as const) : null;
  const open = (heading: string | null): DrawnSection => {
    const kind = all ?? (heading ? kindOf(heading) : "say");
    const section = {
      kind,
      label: heading ?? SECTION[kind].label,
      lines: [],
    };
    sections.push(section);
    return section;
  };
  for (const block of noteBlocks(noteMarkdown(note))) {
    if (block.kind === "heading") {
      const heading = block.text.replaceAll("**", "");
      // [GUARD] A label is a word or two. A heading written as a sentence is
      // context for what follows: it is drawn as that, small and grey, never
      // as a line of capitals across the note.
      if (heading.length <= LABEL_LENGTH) open(heading);
      else {
        sections.push({
          kind: "context",
          label: "",
          lines: [{ segments: [{ text: heading, role: "context" }] }],
        });
        open(null);
      }
      continue;
    }
    if (block.kind === "code") {
      if (block.language === "mermaid") diagrams.push(block.source);
      continue;
    }
    const section = sections[sections.length - 1] ?? open(null);
    const written =
      block.kind === "text" ? talkingPoints(block.text) : block.items;
    for (const text of written)
      section.lines.push({ segments: segmentsOf(text) });
  }
  return {
    sections: sections.filter((section) => section.lines.length > 0),
    diagrams,
  };
}

// The note's own shape, as the card's: the same pieces, with nothing left
// undefined where the card expects a field to be absent.
const cueSection = (section: DrawnSection): CueSection => ({
  kind: section.kind,
  label: section.label,
  lines: section.lines.map((line) => ({
    segments: line.segments.map((segment) => ({
      text: segment.text,
      role: segment.role,
      ...(segment.grounding ? { grounding: segment.grounding } : {}),
      ...(segment.source ? { source: segment.source } : {}),
    })),
  })),
});

const linkRow: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 4 };

// [DOMAIN] The library's CueCard draws the note: this file only reads a note
// [SAFETY] The native window keeps the stylesheet it loaded: when the library
// is updated under a running window, the card's markup is new and its rules
// are missing (small text, no bullets). The card's base size is a rule of
// that stylesheet, so a card that does not have it is drawn from a stale one
// and the page loads again, once a minute at most so it can never loop.
const CARD_PX = { sm: 14, md: 16, lg: 19, xl: 22 } as const;
const RELOADED_KEY = "omnitech.interview.styles-reloaded-at";
function reloadOnStaleStyles(card: HTMLElement, size: keyof typeof CARD_PX) {
  const drawn = Number.parseFloat(getComputedStyle(card).fontSize);
  if (!Number.isFinite(drawn) || Math.abs(drawn - CARD_PX[size]) < 0.5) return;
  try {
    const last = Number(window.sessionStorage.getItem(RELOADED_KEY));
    if (Date.now() - last < 60_000) return;
    window.sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  } catch {
    return;
  }
  window.location.reload();
}

// (structured, or written as Markdown) into the card's sections and hands it
// the diagram and the links.
export function CoachNoteView({
  note,
  mode = "detail",
  meta,
}: {
  note: CoachNote;
  // "compact": the response and at most three anchors, nothing to read.
  mode?: "detail" | "compact";
  // A quiet line above the note: its kind and time.
  meta?: string;
}) {
  const drawn = drawnSections(note);
  const size = useCoachTextSize();
  const card = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (card.current) reloadOnStaleStyles(card.current, size);
  }, [size]);
  return (
    <CueCard
      ref={card}
      size={size}
      {...(meta ? { meta, inset: true } : {})}
      sections={drawn.sections.map(cueSection)}
      mode={mode}
      status={note.status}
      cautionIcon={<Icon name="warning" />}
      data-kind={note.kind}
      data-text-surface=""
      data-testid="pn-coach-note"
    >
      {drawn.diagrams.map((source) => (
        <Diagram key={source} source={source} />
      ))}
      {note.links.length > 0 && (
        <div style={linkRow}>
          {note.links.map((link) => (
            <Button
              key={link.url}
              buttonSize="sm"
              variant="outline"
              icon={<Icon name="open_in_new" />}
              title={link.url}
              onClick={() => openLink(link.url)}
              data-testid="pn-coach-link"
            >
              {link.label}
            </Button>
          ))}
        </div>
      )}
    </CueCard>
  );
}
