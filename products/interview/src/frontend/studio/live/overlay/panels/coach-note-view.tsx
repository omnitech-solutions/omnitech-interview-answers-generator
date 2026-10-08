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
import { Button } from "@oc-tech/omni-ui-components";
import type {
  CoachLine,
  CoachNote,
  CoachRole,
  CoachSectionKind,
  CoachSegment,
} from "@omnitech/interview-contracts";
import type { CSSProperties } from "react";
import { Icon } from "../../../icon";
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

const ROLE_STYLE: Record<CoachRole, CSSProperties> = {
  spoken: {},
  evidence: { color: COACH_COLOUR.evidence, fontWeight: 600 },
  caution: { color: COACH_COLOUR.caution, fontWeight: 600 },
  context: { color: COACH_COLOUR.context },
};

const SECTION: Record<CoachSectionKind, { label: string; colour: string }> = {
  say: { label: "Say this", colour: COACH_COLOUR.act },
  anchors: { label: "Anchors", colour: COACH_COLOUR.evidence },
  ask: { label: "Ask", colour: COACH_COLOUR.act },
  caution: { label: "Careful", colour: COACH_COLOUR.caution },
  context: { label: "Context", colour: COACH_COLOUR.context },
};

// The compact note is a ready response and a few anchors: nothing to read.
const COMPACT_KINDS: readonly CoachSectionKind[] = [
  "say",
  "anchors",
  "caution",
];
const COMPACT_ANCHORS = 3;

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

const STYLE = {
  // [DOMAIN] Space says what belongs together: a wide gap between sections,
  // a small one between a label and its own lines.
  note: { display: "flex", flexDirection: "column", gap: 26, minWidth: 0 },
  section: { display: "flex", flexDirection: "column", gap: 10 },
  label: {
    marginBottom: 2,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.09em",
    textTransform: "uppercase",
  },
  say: { margin: 0, fontSize: 19, lineHeight: 1.42, color: COACH_COLOUR.read },
  ask: { margin: 0, fontSize: 18, lineHeight: 1.42, color: COACH_COLOUR.read },
  row: { display: "flex", gap: 12, minWidth: 0 },
  mark: {
    flex: "0 0 6px",
    height: 6,
    marginTop: 11,
    borderRadius: "50%",
    background: "#6e6e73",
  },
  anchors: { display: "flex", flexDirection: "column", gap: 5 },
  anchor: {
    display: "flex",
    gap: 10,
    fontSize: 16,
    lineHeight: 1.4,
    color: COACH_COLOUR.read,
  },
  anchorMark: {
    flex: "0 0 6px",
    height: 6,
    marginTop: 8,
    borderRadius: 1.5,
    background: COACH_COLOUR.evidence,
  },
  caution: {
    display: "flex",
    gap: 10,
    padding: "9px 12px",
    borderRadius: 9,
    background: "rgba(245, 184, 74, 0.1)",
    border: "1px solid rgba(245, 184, 74, 0.35)",
    color: COACH_COLOUR.caution,
  },
  cautionLine: { margin: 0, fontSize: 16, lineHeight: 1.42 },
  context: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.45,
    color: COACH_COLOUR.context,
  },
  pending: {
    margin: 0,
    fontSize: 14,
    fontStyle: "italic",
    color: COACH_COLOUR.context,
  },
  links: { display: "flex", flexWrap: "wrap", gap: 4 },
} satisfies Record<string, CSSProperties>;

function Line({ line }: { line: CoachLine }) {
  return (
    <>
      {line.segments.map((segment, at) => (
        <span
          // The pieces of one line never reorder.
          // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
          key={at}
          style={
            segment.grounding === "inferred"
              ? {
                  ...ROLE_STYLE[segment.role],
                  textDecoration: `underline dotted ${COACH_COLOUR.caution}`,
                  textUnderlineOffset: 4,
                }
              : ROLE_STYLE[segment.role]
          }
          {...(segment.grounding === "inferred"
            ? { title: "Not confirmed in your experience: check before saying" }
            : {})}
          data-role={segment.role}
        >
          {segment.text}
        </span>
      ))}
    </>
  );
}

const keyOf = (line: CoachLine) =>
  line.segments.map((segment) => segment.text).join("");

function Section({
  section,
  compact,
}: {
  section: DrawnSection;
  compact: boolean;
}) {
  const lines =
    compact && section.kind === "anchors"
      ? section.lines.slice(0, COMPACT_ANCHORS)
      : section.lines;
  const label =
    section.label === "" ? null : (
      <span style={{ ...STYLE.label, color: SECTION[section.kind].colour }}>
        {section.label}
      </span>
    );
  if (section.kind === "caution")
    return (
      <div style={STYLE.caution} data-section="caution">
        <Icon name="warning" />
        <div style={{ ...STYLE.section, gap: 3, minWidth: 0 }}>
          {label}
          {lines.map((line, at) => (
            <p
              key={keyOf(line)}
              style={{
                ...STYLE.cautionLine,
                // The first line names what is off; the rest are what to say.
                color: at === 0 ? COACH_COLOUR.caution : COACH_COLOUR.read,
              }}
            >
              <Line line={line} />
            </p>
          ))}
        </div>
      </div>
    );
  if (section.kind === "anchors")
    return (
      <div style={STYLE.section} data-section="anchors">
        {label}
        <div style={STYLE.anchors}>
          {lines.map((line) => (
            <div key={keyOf(line)} style={STYLE.anchor}>
              <span style={STYLE.anchorMark} aria-hidden="true" />
              <span>
                <Line line={line} />
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  const text =
    section.kind === "context"
      ? STYLE.context
      : section.kind === "ask"
        ? STYLE.ask
        : STYLE.say;
  return (
    <div style={STYLE.section} data-section={section.kind}>
      {label}
      {lines.map((line) => (
        // Each sentence stands apart on its own mark, so several in a row
        // never read as one paragraph.
        <div key={keyOf(line)} style={STYLE.row}>
          {section.kind !== "context" && (
            <span style={STYLE.mark} aria-hidden="true" />
          )}
          <p style={text}>
            <Line line={line} />
          </p>
        </div>
      ))}
    </div>
  );
}

export function CoachNoteView({
  note,
  mode = "detail",
}: {
  note: CoachNote;
  // "compact": the response and at most three anchors, nothing to read.
  mode?: "detail" | "compact";
}) {
  const compact = mode === "compact";
  const drawn = drawnSections(note);
  const sections = compact
    ? drawn.sections.filter((section) => COMPACT_KINDS.includes(section.kind))
    : drawn.sections;
  return (
    <article
      style={STYLE.note}
      data-kind={note.kind}
      data-status={note.status}
      data-mode={mode}
      data-text-surface=""
      data-testid="pn-coach-note"
    >
      {sections.map((section, at) => (
        <Section
          // Sections of one note never reorder.
          // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
          key={at}
          section={section}
          compact={compact}
        />
      ))}
      {!compact &&
        drawn.diagrams.map((source) => (
          <Diagram key={source} source={source} />
        ))}
      {/* A revision being prepared: what was ready stays above it. */}
      {note.status === "pending" && (
        <p style={STYLE.pending} role="status">
          {sections.length > 0 ? "Updating…" : "Preparing response…"}
        </p>
      )}
      {!compact && note.links.length > 0 && (
        <div style={STYLE.links}>
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
    </article>
  );
}
