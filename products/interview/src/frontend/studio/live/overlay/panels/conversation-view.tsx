// The conversation view of the transcript pane: each question the interviewer
// asked stands out as a heading, and what belongs to it sits beneath it (the
// coach's notes as annotations, the studio's answer, what was said back). The
// question on the table stays pinned at the top, so it is never lost while
// reading a note. Styles are inline: the native window keeps its stylesheet
// until it reloads.
import { Button, Tag } from "@oc-tech/omni-ui-components";
import type { CoachNote } from "@omnitech/interview-contracts";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Icon } from "../../../icon";
import { Prompter } from "./coach-notes";
import {
  conversationTurns,
  currentQuestion,
  type Turn,
} from "./conversation-model";
import { clock, type PanelRow } from "./panel-model";

const ACCENT = "var(--oui-accent, #7aa2ff)";
const MUTED = "var(--ov-muted, #9aa4b2)";
const WATCH = "var(--pn-warn, #e0a83c)";
const STYLE = {
  root: { display: "flex", flexDirection: "column", gap: 14 },
  pinned: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    margin: "0 -4px",
    padding: "8px 10px",
    borderRadius: 10,
    borderLeft: `3px solid ${ACCENT}`,
    background: "var(--pn-glass-solid, rgba(24, 26, 32, 0.96))",
    boxShadow: "0 6px 14px rgba(0, 0, 0, 0.28)",
  },
  pinnedLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: ACCENT,
  },
  pinnedText: {
    margin: "2px 0 0",
    fontSize: 17,
    fontWeight: 650,
    lineHeight: 1.35,
    display: "-webkit-box",
    WebkitLineClamp: 4,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  turn: { display: "flex", flexDirection: "column", gap: 6 },
  question: {
    padding: "2px 0 2px 10px",
    borderLeft: `3px solid ${ACCENT}`,
  },
  meta: { fontSize: 11, color: MUTED },
  questionText: {
    margin: "2px 0 0",
    fontSize: 16,
    fontWeight: 650,
    lineHeight: 1.4,
  },
  aside: { margin: 0, paddingLeft: 13, fontSize: 13, color: MUTED },
  note: {
    marginLeft: 13,
    padding: "4px 10px 8px",
    borderRadius: 10,
    background: "var(--pn-chip, rgba(255, 255, 255, 0.05))",
  },
  noteHead: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 },
  studio: { marginLeft: 13 },
  mine: {
    margin: 0,
    marginLeft: 13,
    fontSize: 13,
    lineHeight: 1.45,
    color: MUTED,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  hearing: { margin: 0, fontSize: 14, fontStyle: "italic", color: MUTED },
  empty: { margin: 0, fontSize: 14, color: MUTED },
} satisfies Record<string, CSSProperties>;

const firstLine = (text: string): string =>
  text.split("\n").find((line) => line.trim() !== "") ?? "";

function Note({
  note,
  open,
  onToggle,
}: {
  note: CoachNote;
  open: boolean;
  onToggle(): void;
}) {
  const watch = note.tone === "watch";
  return (
    <div
      style={{
        ...STYLE.note,
        ...(watch ? { boxShadow: `inset 3px 0 0 ${WATCH}` } : {}),
      }}
      data-tone={note.tone}
      data-testid="pn-conversation-note"
    >
      <div style={STYLE.noteHead}>
        <Tag>{watch ? "Watch" : "Say"}</Tag>
        <Button
          buttonSize="sm"
          variant="ghost"
          icon={<Icon name={open ? "expand_more" : "chevron_right"} />}
          aria-expanded={open}
          title={note.title}
          onClick={onToggle}
        >
          {note.title}
        </Button>
      </div>
      {open && <Prompter note={note} inline />}
    </div>
  );
}

function TurnBlock({
  turn,
  openNotes,
  onToggleNote,
  selectedTaskId,
  onSelectTask,
}: {
  turn: Turn;
  openNotes: ReadonlySet<string>;
  onToggleNote(id: string): void;
  selectedTaskId: string | undefined;
  onSelectTask(taskId: string): void;
}) {
  return (
    <section style={STYLE.turn} data-testid="pn-conversation-turn">
      {turn.question && (
        <div style={STYLE.question} data-text-surface="">
          <span style={STYLE.meta}>
            {`Interviewer · ${clock(turn.question.shownAt ?? turn.question.at)}`}
          </span>
          <p style={STYLE.questionText} data-testid="pn-conversation-question">
            {turn.question.text}
          </p>
        </div>
      )}
      {turn.asides.map((row) => (
        <p key={row.key} style={STYLE.aside} data-text-surface="">
          {row.text}
        </p>
      ))}
      {turn.notes.map((note) => (
        <Note
          key={note.id}
          note={note}
          open={openNotes.has(note.id)}
          onToggle={() => onToggleNote(note.id)}
        />
      ))}
      {turn.studio.map((row) => (
        <div key={row.key} style={STYLE.studio}>
          <Button
            buttonSize="sm"
            variant={
              row.taskId && row.taskId === selectedTaskId
                ? "secondary"
                : "ghost"
            }
            icon={<Icon name="lightbulb" />}
            title="Show this answer"
            labelMaxWidth="380px"
            {...(row.taskId
              ? { onClick: () => onSelectTask(row.taskId as string) }
              : { disabled: true })}
          >
            {`${row.label} · ${
              firstLine(row.text).replaceAll("**", "") ||
              (row.stage ? `${row.stage.label}…` : "")
            }`}
          </Button>
        </div>
      ))}
      {turn.mine.map((row) => (
        <p key={row.key} style={STYLE.mine} data-text-surface="">
          {`${row.kind === "typed" ? "You typed" : "You"}: ${row.text}`}
        </p>
      ))}
    </section>
  );
}

export function ConversationView({
  rows,
  notes,
  interim,
  selectedTaskId,
  onSelectTask,
}: {
  rows: readonly PanelRow[];
  notes: readonly CoachNote[];
  // The words being heard right now, not yet a line.
  interim: string;
  selectedTaskId: string | undefined;
  onSelectTask(taskId: string): void;
}) {
  const turns = conversationTurns(rows, notes);
  const asked = currentQuestion(turns);
  // Which notes are open. A note opens when it arrives, and the notes of
  // earlier questions fold to their titles so the current one is not buried.
  const [openNotes, setOpenNotes] = useState<ReadonlySet<string>>(new Set());
  const seen = useRef(new Set<string>());
  const lastTurn = turns[turns.length - 1];
  const currentIds = (lastTurn?.notes ?? []).map((note) => note.id).join(",");
  useEffect(() => {
    const ids = currentIds === "" ? [] : currentIds.split(",");
    const fresh = ids.filter((id) => !seen.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) seen.current.add(id);
    // Only the newest note of the current question stays open by itself.
    setOpenNotes(new Set([ids[ids.length - 1] as string]));
  }, [currentIds]);
  const toggle = (id: string) =>
    setOpenNotes((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  if (turns.length === 0 && interim === "")
    return (
      <p style={STYLE.empty} role="status">
        Questions appear here as they are asked, with the coach's notes under
        each one.
      </p>
    );
  return (
    <div style={STYLE.root} data-testid="pn-conversation">
      {asked && (
        <div style={STYLE.pinned} data-text-surface="" aria-live="polite">
          <span style={STYLE.pinnedLabel}>Being asked</span>
          <p style={STYLE.pinnedText} data-testid="pn-conversation-current">
            {asked.text}
          </p>
        </div>
      )}
      {turns.map((turn) => (
        <TurnBlock
          key={turn.key}
          turn={turn}
          openNotes={openNotes}
          onToggleNote={toggle}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
        />
      ))}
      {interim !== "" && (
        <p style={STYLE.hearing} data-text-surface="">
          {interim}
        </p>
      )}
    </div>
  );
}

// [DOMAIN] Room for the call window, above the conversation. It paints nothing
// but its outline and is not one of the window's surfaces, so in the native
// window the call shows through it and takes its own clicks. The bar under it
// is dragged (or moved with the arrow keys) to make the room any height, from
// none to nearly the whole pane, and the height is kept for the next session.
const SLOT_KEY = "omnitech.interview.call-slot.height";
const SLOT_DEFAULT = 292;
const SLOT_STEP = 24;
// What the conversation beneath always keeps.
const CONVERSATION_FLOOR = 160;
const slotCeiling = () =>
  Math.max(
    0,
    (typeof window === "undefined" ? 800 : window.innerHeight) -
      CONVERSATION_FLOOR,
  );
const boundSlot = (height: number) =>
  Math.round(Math.min(Math.max(height, 0), slotCeiling()));
function savedSlot(): number {
  try {
    const kept = Number(window.localStorage.getItem(SLOT_KEY));
    return Number.isFinite(kept) && kept > 0 ? kept : SLOT_DEFAULT;
  } catch {
    return SLOT_DEFAULT;
  }
}

export function CallSlot() {
  const [height, setHeight] = useState(savedSlot);
  const shown = boundSlot(height);
  const resize = (next: number) => {
    const bounded = boundSlot(next);
    setHeight(bounded);
    try {
      window.localStorage.setItem(SLOT_KEY, String(bounded));
    } catch {
      // The height still holds for this window.
    }
  };
  // Where the drag began: the pointer's height on screen and the slot's own.
  const drag = useRef<{ y: number; height: number } | null>(null);
  return (
    <>
      <div
        style={{
          flex: `0 0 ${shown}px`,
          minHeight: 0,
          borderRadius: 12,
          border: shown > 0 ? `1px dashed ${MUTED}` : "none",
          opacity: 0.55,
          pointerEvents: "none",
        }}
        role="img"
        aria-label="Room for the call window"
        data-testid="pn-call-slot"
      />
      {/* A slider, so the shell treats it as a control and never drags the
          window from it; a surface of its own, so it takes the mouse. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Height of the room for the call window"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={slotCeiling()}
        aria-valuenow={shown}
        title="Drag to resize the room for the call window"
        data-hit-surface=""
        data-testid="pn-call-slot-resize"
        style={{
          flex: "0 0 12px",
          display: "grid",
          placeItems: "center",
          borderRadius: 6,
          background: "var(--pn-glass, rgba(30, 30, 34, 0.8))",
          cursor: "ns-resize",
          touchAction: "none",
        }}
        onPointerDown={(event) => {
          drag.current = { y: event.clientY, height: shown };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          resize(drag.current.height + event.clientY - drag.current.y);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          const next =
            event.key === "ArrowDown"
              ? shown + SLOT_STEP
              : event.key === "ArrowUp"
                ? shown - SLOT_STEP
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? slotCeiling()
                    : null;
          if (next === null) return;
          event.preventDefault();
          resize(next);
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 44,
            height: 4,
            borderRadius: 2,
            background: MUTED,
            opacity: 0.7,
          }}
        />
      </div>
    </>
  );
}
