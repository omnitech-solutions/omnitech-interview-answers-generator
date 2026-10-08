// The coach layouts: the call at the top of the window and the coach's notes
// directly beneath it, so the person reads without looking away from the
// interviewer. Three of them share this file (chat-view-pref.ts names them):
//
//   coach         questions | call + coach | answer, transcript and code (tabs)
//   conversation  questions | call + notes | transcript
//   prompter      call + one question's notes
//
// [DOMAIN] Colour carries role and nothing else: green is what the interviewer
// asked and the question on the table, blue is the words to land, amber is a
// warning, white is the text to read, grey is everything secondary. A note is
// never swapped out while it is being read: a new one is added beneath, and
// the pane follows it only when the reader is already at the bottom.
//
// Styles are inline: the native window keeps its stylesheet until it reloads.
import { Button, IconButton } from "@oc-tech/omni-ui-components";
import type { CoachNote } from "@omnitech/interview-contracts";
import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "../../../icon";
import { CallSlot } from "./call-slot";
import { ChatPanel } from "./chat-panel";
import type { ChatView } from "./chat-view-pref";
import { ColumnSplitter, useCoachColumns, WindowEdge } from "./coach-columns";
import { Prompter, useCoachNotes } from "./coach-notes";
import {
  conversationTurns,
  type Question,
  questionsOf,
  type Turn,
  waitingTurn,
} from "./conversation-model";
import { clock, panelRows } from "./panel-model";
import { AnswerPanel, CodePanel, type PanelSession } from "./panel-views";

const ASK = "#3ecf72";
const WARN = "#f5b84a";
const READ = "#f2f2f3";
const DIM = "#8e8e93";
const FAINT = "#6e6e73";
const PANEL = "#1c1c1e";
const LINE = "#2c2c2f";
// The reader counts as "at the bottom" within this many px of it.
const FOLLOW_SLACK = 48;

const STYLE = {
  // The library panes inside a coach layout (answer, transcript, code) take
  // the same neutral grey as the notes: no blue panel in these layouts.
  body: {
    flex: "1 1 0",
    minHeight: 0,
    display: "flex",
    gap: 8,
    "--oui-panel-bg": PANEL,
    "--oui-panel-dock-bg": PANEL,
    "--oui-panel-divider": LINE,
  } as CSSProperties,
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
    minHeight: 0,
  },
  card: {
    flex: "1 1 0",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    borderRadius: 12,
    background: PANEL,
    border: `1px solid ${LINE}`,
    overflow: "hidden",
    color: READ,
  },
  head: {
    flex: "0 0 40px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "0 8px 0 14px",
    borderBottom: `1px solid ${LINE}`,
    minWidth: 0,
  },
  caps: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: DIM,
    whiteSpace: "nowrap",
  },
  small: {
    fontSize: 12,
    color: FAINT,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  list: {
    flex: "1 1 0",
    minHeight: 0,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: 8,
  },
  notes: {
    flex: "1 1 0",
    minHeight: 0,
    overflow: "auto",
    overflowAnchor: "auto",
    padding: "18px 24px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  asked: { display: "flex", gap: 14 },
  askBar: { flex: "0 0 4px", borderRadius: 2, background: ASK },
  askLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: ASK,
  },
  askText: {
    margin: "4px 0 0",
    fontSize: 21,
    lineHeight: 1.35,
    fontWeight: 600,
    color: READ,
    textWrap: "pretty",
  },
  waiting: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "10px 14px",
    borderRadius: 10,
    background: "rgba(62, 207, 114, 0.1)",
    border: "1px solid rgba(62, 207, 114, 0.35)",
  },
  followUp: {
    margin: "3px 0 0",
    fontSize: 17,
    lineHeight: 1.4,
    fontWeight: 600,
    color: READ,
  },
  note: { paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 },
  warn: {
    marginLeft: 18,
    padding: "8px 12px",
    borderRadius: 9,
    background: "rgba(245, 184, 74, 0.1)",
    border: "1px solid rgba(245, 184, 74, 0.35)",
  },
  warnTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: WARN,
    fontSize: 15,
    fontWeight: 600,
  },
  empty: { margin: 0, fontSize: 15, lineHeight: 1.5, color: DIM },
  pill: {
    position: "sticky",
    bottom: 0,
    alignSelf: "center",
    flex: "0 0 auto",
  },
  tabs: {
    flex: "0 0 auto",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    padding: 4,
    borderRadius: 12,
    background: PANEL,
    border: `1px solid ${LINE}`,
  },
  pane: { flex: "1 1 0", minHeight: 0, minWidth: 0, display: "flex" },
} satisfies Record<string, CSSProperties>;

// ---- Questions ------------------------------------------------------------------

function QuestionsList({
  questions,
  shownKey,
  onPick,
}: {
  questions: readonly Question[];
  shownKey: string | undefined;
  onPick(key: string): void;
}) {
  // The newest question is at the top, where the eye lands first; older ones
  // run down the column. A new question brings the list back to its top.
  const list = useRef<HTMLDivElement>(null);
  const count = questions.length;
  useLayoutEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = 0;
  }, [count]);
  return (
    <section
      className="pn-card"
      style={STYLE.card}
      aria-label="Questions"
      data-testid="pn-coach-questions"
    >
      <div style={STYLE.head}>
        <span style={STYLE.caps}>{`Questions · ${count}`}</span>
        <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
        <span style={STYLE.small}>newest first</span>
      </div>
      <div ref={list} style={STYLE.list}>
        {questions.toReversed().map((question) => {
          const shown = question.key === shownKey;
          const colour = question.live ? ASK : shown ? READ : "#a1a1a6";
          return (
            // A row is a button, so the shell never drags the window from it;
            // its label wraps, which a library Button's does not.
            <button
              key={question.key}
              type="button"
              aria-label={question.label}
              aria-current={shown ? "true" : undefined}
              title={question.question?.text ?? question.label}
              data-live={question.live ? "" : undefined}
              data-testid="pn-coach-question"
              onClick={() => onPick(question.key)}
              style={{
                all: "unset",
                boxSizing: "border-box",
                display: "flex",
                gap: 10,
                padding: "9px 10px 9px 8px",
                borderRadius: 8,
                cursor: "pointer",
                borderLeft: `3px solid ${
                  question.live ? ASK : shown ? READ : "transparent"
                }`,
                background: question.live
                  ? "rgba(62, 207, 114, 0.1)"
                  : shown
                    ? "#2a2a2d"
                    : "transparent",
              }}
            >
              <span
                style={{
                  flex: "0 0 16px",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 12,
                  color: question.live ? ASK : shown ? READ : FAINT,
                  paddingTop: 1,
                }}
              >
                {question.number}
              </span>
              <span
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.35,
                    color: colour,
                    fontWeight: question.live ? 600 : shown ? 500 : 400,
                  }}
                >
                  {question.label}
                </span>
                <span style={{ fontSize: 11.5, color: FAINT }}>
                  {[
                    clock(question.at),
                    question.notes.length > 0
                      ? `${question.notes.length} ${question.notes.length === 1 ? "note" : "notes"}`
                      : null,
                    question.live ? "live" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---- Notes ----------------------------------------------------------------------

function NoteBlock({ note, heading }: { note: CoachNote; heading: string }) {
  if (note.tone === "watch")
    return (
      <div style={STYLE.warn} data-tone="watch" data-testid="pn-coach-block">
        <div style={STYLE.warnTitle}>
          <Icon name="warning" />
          <span>{note.title}</span>
        </div>
        <Prompter note={note} inline />
      </div>
    );
  return (
    <div style={STYLE.note} data-tone="say" data-testid="pn-coach-block">
      {/* A note named as its question says the heading once, not twice. */}
      {note.title !== heading && <span style={STYLE.caps}>{note.title}</span>}
      <Prompter note={note} inline />
    </div>
  );
}

function NotesPane({
  label,
  question,
  questions,
  onPick,
  onLive,
  onReset,
  waiting,
  following,
}: {
  label: string;
  // The question on the table, while the notes on show are still the last
  // question's: its own have not arrived yet.
  waiting: Turn | undefined;
  // Nothing was picked: the pane moves on by itself as the call does.
  following: boolean;
  // The question on show: the one picked, or the one on the table.
  question: Question | undefined;
  questions: readonly Question[];
  onPick(key: string): void;
  // Back to the question on the table.
  onLive(): void;
  // Puts every size in the layout back: the columns and the call's room.
  onReset(): void;
}) {
  const at = question ? questions.indexOf(question) : -1;
  const previous = at > 0 ? questions[at - 1] : undefined;
  const next = at >= 0 ? questions[at + 1] : undefined;
  // [DOMAIN] The block being read stays where it is. A note added beneath is
  // followed only when the reader is already at the bottom; otherwise a pill
  // says it is there.
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [below, setBelow] = useState(false);
  const noteCount = question?.notes.length ?? 0;
  const key = question?.key;
  // The question and the note count the pane last settled on.
  const settled = useRef<{ key: string | undefined; count: number }>({
    key: undefined,
    count: 0,
  });
  useLayoutEffect(() => {
    const element = scroller.current;
    const before = settled.current;
    settled.current = { key, count: noteCount };
    if (!element) return;
    // Another question opens at its top.
    if (before.key !== key) {
      element.scrollTop = 0;
      atBottom.current = element.scrollHeight <= element.clientHeight;
      setBelow(false);
      return;
    }
    // A note was added to the question on show.
    if (noteCount <= before.count) return;
    if (atBottom.current) element.scrollTop = element.scrollHeight;
    else setBelow(true);
  }, [key, noteCount]);
  return (
    <section
      className="pn-card"
      style={STYLE.card}
      aria-label={label}
      data-testid="pn-coach-notes"
    >
      <div style={STYLE.head}>
        <span style={STYLE.caps}>{label}</span>
        {question && (
          <span
            style={STYLE.small}
          >{`Q${question.number} · ${question.label}`}</span>
        )}
        <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
        {following ? (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: ASK,
              whiteSpace: "nowrap",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: ASK,
              }}
            />
            Following live
          </span>
        ) : (
          question && (
            <Button
              buttonSize="sm"
              variant="outline"
              onClick={onLive}
              data-testid="pn-coach-live"
            >
              Back to live
            </Button>
          )
        )}
        <Button
          buttonSize="sm"
          variant="ghost"
          title="Put the columns and the call's room back to their sizes"
          onClick={onReset}
          data-testid="pn-coach-reset"
        >
          Reset layout
        </Button>
        <IconButton
          variant="ghost"
          iconSize="sm"
          icon={<Icon name="chevron_left" />}
          label="Previous question"
          disabled={!previous}
          onClick={() => previous && onPick(previous.key)}
        />
        <IconButton
          variant="ghost"
          iconSize="sm"
          icon={<Icon name="chevron_right" />}
          label="Next question"
          disabled={!next}
          onClick={() => next && onPick(next.key)}
        />
      </div>
      <div
        ref={scroller}
        style={STYLE.notes}
        data-text-surface=""
        onScroll={(event) => {
          const element = event.currentTarget;
          atBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <=
            FOLLOW_SLACK;
          if (atBottom.current) setBelow(false);
        }}
      >
        {!question && (
          <p style={STYLE.empty} role="status">
            The question being asked appears here, with the coach's notes for it
            beneath.
          </p>
        )}
        {waiting && (
          <div style={STYLE.waiting} data-testid="pn-coach-waiting">
            <span style={STYLE.askLabel}>
              {`Being asked · ${clock(waiting.at)}`}
            </span>
            <p style={STYLE.followUp}>{waiting.question?.text ?? ""}</p>
            <span style={STYLE.small}>
              Notes for this are on their way. The last notes stay below.
            </span>
          </div>
        )}
        {question && (
          <>
            <div style={STYLE.asked}>
              <span style={STYLE.askBar} aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <span style={STYLE.askLabel}>
                  {`${question.live ? "Being asked" : "Asked"} · ${clock(question.at)}`}
                </span>
                <p style={STYLE.askText} data-testid="pn-coach-asked">
                  {question.question?.text ?? question.label}
                </p>
              </div>
            </div>
            {question.notes.length === 0 && (
              <p style={{ ...STYLE.empty, paddingLeft: 18 }} role="status">
                No notes for this question yet.
              </p>
            )}
            {/* The notes and the follow-ups asked under this question, in the
                order they came. */}
            {[
              ...question.notes.map((note) => ({
                at: Date.parse(note.createdAt),
                key: note.id,
                note,
                asked: null,
              })),
              ...question.followUps.map((asked) => ({
                at: asked.at,
                key: asked.key,
                note: null,
                asked,
              })),
            ]
              .sort((a, b) => a.at - b.at)
              .map((block) =>
                block.note ? (
                  <NoteBlock
                    key={block.key}
                    note={block.note}
                    heading={question.question?.text ?? question.label}
                  />
                ) : (
                  <div
                    key={block.key}
                    style={STYLE.asked}
                    data-testid="pn-coach-follow-up"
                  >
                    <span style={STYLE.askBar} aria-hidden="true" />
                    <div style={{ minWidth: 0 }}>
                      <span style={STYLE.askLabel}>
                        {`Follow-up · ${clock(block.at)}`}
                      </span>
                      <p style={STYLE.followUp}>{block.asked.text}</p>
                    </div>
                  </div>
                ),
              )}
            {below && (
              <div style={STYLE.pill}>
                <Button
                  buttonSize="sm"
                  variant="secondary"
                  onClick={() => {
                    const element = scroller.current;
                    if (element) element.scrollTop = element.scrollHeight;
                    setBelow(false);
                  }}
                  data-testid="pn-coach-below"
                >
                  ↓ New note added below
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ---- The right column -----------------------------------------------------------

const TABS = [
  { id: "answer", label: "Answer", icon: "lightbulb" },
  { id: "transcript", label: "Transcript", icon: "forum" },
  { id: "code", label: "Code", icon: "code" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// [DOMAIN] The studio's own answer keeps its pane: it is never folded into the
// notes or the transcript. The transcript and the code share the column as tabs.
function RightTabs({ s }: { s: PanelSession }) {
  const [tab, setTab] = useState<TabId>("answer");
  const pane: Record<TabId, ReactNode> = {
    answer: <AnswerPanel s={s} />,
    transcript: <ChatPanel s={s} />,
    code: <CodePanel s={s} />,
  };
  return (
    <>
      <div
        className="pn-card"
        style={STYLE.tabs}
        role="tablist"
        aria-label="Answer, transcript or code"
      >
        {TABS.map((each) => (
          <Button
            key={each.id}
            buttonSize="sm"
            variant={each.id === tab ? "secondary" : "ghost"}
            icon={<Icon name={each.icon} />}
            role="tab"
            aria-selected={each.id === tab}
            onClick={() => setTab(each.id)}
            data-testid={`pn-coach-tab-${each.id}`}
          >
            {each.label}
          </Button>
        ))}
      </div>
      <div style={STYLE.pane} role="tabpanel">
        {pane[tab]}
      </div>
    </>
  );
}

// ---- The layout -----------------------------------------------------------------

export function CoachLayout({
  s,
  view,
}: {
  s: PanelSession;
  view: Exclude<ChatView, "original" | "transcript">;
}) {
  const coach = useCoachNotes(s.open);
  // Every row of the session, not the transcript pane's window of them: the
  // questions go back to the first one asked.
  const rows = panelRows(
    s.model,
    s.entries,
    s.clearedAt,
    s.revisionPicks,
    Number.POSITIVE_INFINITY,
  );
  const turns = conversationTurns(rows, coach.notes);
  const questions = questionsOf(turns);
  // The question just asked whose notes have not arrived: it is named above
  // the notes on show and has no row of its own until it has notes.
  const waiting = waitingTurn(turns);
  // The question on show: the one picked from the list, or the newest.
  const [picked, setPicked] = useState<string | null>(null);
  const live = questions[questions.length - 1];
  const pickedQuestion = questions.find((each) => each.key === picked);
  const shown = pickedQuestion ?? live;
  // Picking the question on the table is following it again.
  // [DOMAIN] It also brings the studio's own answer to that question into the
  // Answer pane, so the notes and the answer on show are for the same thing.
  const pick = (key: string) => {
    setPicked(key === live?.key ? null : key);
    const answered = questions
      .find((each) => each.key === key)
      ?.studio.findLast((row) => row.taskId !== undefined);
    if (answered?.taskId) s.select(answered.taskId);
  };
  const sizes = useCoachColumns();
  const notes = (
    <NotesPane
      label={view === "coach" ? "Coach" : "Notes"}
      question={shown}
      questions={questions}
      onPick={pick}
      onLive={() => setPicked(null)}
      following={pickedQuestion === undefined}
      waiting={pickedQuestion === undefined ? waiting : undefined}
      onReset={sizes.reset}
    />
  );
  const centre = (
    <div style={{ ...STYLE.column, gap: 0, flex: "1 1 0", overflow: "hidden" }}>
      <CallSlot />
      {notes}
    </div>
  );
  if (view === "prompter")
    return (
      <div
        className="pn-single-body"
        style={{ ...STYLE.body, gap: 0 }}
        data-view={view}
        data-testid="pn-coach-layout"
      >
        <WindowEdge side="left" />
        {centre}
        <WindowEdge side="right" />
      </div>
    );
  // The bars stand in the gaps, so the row itself keeps none.
  const side = (which: "left" | "right") => ({
    ...STYLE.column,
    flex: `0 0 ${sizes.columns[which]}px`,
    overflow: "hidden",
  });
  return (
    <div
      ref={sizes.row}
      className="pn-single-body"
      style={{ ...STYLE.body, gap: 0 }}
      data-view={view}
      data-testid="pn-coach-layout"
    >
      <WindowEdge side="left" />
      <div style={side("left")}>
        <QuestionsList
          questions={questions}
          shownKey={shown?.key}
          onPick={pick}
        />
      </div>
      <ColumnSplitter
        side="left"
        width={sizes.columns.left}
        max={sizes.ceiling("left")}
        onResize={(width) => sizes.resize("left", width)}
        onReset={() => sizes.resetSide("left")}
      />
      {centre}
      <ColumnSplitter
        side="right"
        width={sizes.columns.right}
        max={sizes.ceiling("right")}
        onResize={(width) => sizes.resize("right", width)}
        onReset={() => sizes.resetSide("right")}
      />
      <div style={side("right")}>
        {view === "coach" ? (
          <RightTabs s={s} />
        ) : (
          <div style={STYLE.pane}>
            <ChatPanel s={s} />
          </div>
        )}
      </div>
      <WindowEdge side="right" />
    </div>
  );
}
