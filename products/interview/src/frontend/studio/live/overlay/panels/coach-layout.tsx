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
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "../../../icon";
import { CallSlot } from "./call-slot";
import { ChatPanel } from "./chat-panel";
import { type ChatView, QUESTIONS_WIDTH, RIGHT_WIDTH } from "./chat-view-pref";
import { Prompter, useCoachNotes } from "./coach-notes";
import {
  conversationTurns,
  type Question,
  questionsOf,
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
  body: { flex: "1 1 0", minHeight: 0, display: "flex", gap: 8 },
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
  // The list stays on the question on the table: the newest is at the bottom,
  // like the transcript, and older ones scroll up out of view.
  const list = useRef<HTMLDivElement>(null);
  const count = questions.length;
  useLayoutEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
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
        <span style={STYLE.small}>newest ↓</span>
      </div>
      <div ref={list} style={STYLE.list}>
        {/* Pushes a short list to the bottom of the column. */}
        <span style={{ flex: "1 1 auto" }} aria-hidden="true" />
        {questions.map((question) => {
          const shown = question.key === shownKey;
          const colour = question.live ? ASK : shown ? READ : "#a1a1a6";
          return (
            <div
              key={question.key}
              data-live={question.live ? "" : undefined}
              data-testid="pn-coach-question"
              style={{
                display: "flex",
                gap: 6,
                padding: "5px 6px 7px 6px",
                borderRadius: 8,
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
                  paddingTop: 7,
                }}
              >
                {question.number}
              </span>
              <span
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  minWidth: 0,
                  color: colour,
                }}
              >
                <Button
                  buttonSize="sm"
                  variant="ghost"
                  aria-current={shown ? "true" : undefined}
                  title={question.question?.text ?? question.label}
                  labelMaxWidth="186px"
                  onClick={() => onPick(question.key)}
                >
                  {question.label}
                </Button>
                <span style={{ fontSize: 11.5, color: FAINT, paddingLeft: 8 }}>
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
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---- Notes ----------------------------------------------------------------------

function NoteBlock({ note }: { note: CoachNote }) {
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
      <span style={STYLE.caps}>{note.title}</span>
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
}: {
  label: string;
  // The question on show: the one picked, or the one on the table.
  question: Question | undefined;
  questions: readonly Question[];
  onPick(key: string): void;
  // Back to the question on the table.
  onLive(): void;
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
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = 0;
    atBottom.current = true;
    setBelow(false);
  }, [key]);
  useEffect(() => {
    const element = scroller.current;
    if (!element || noteCount === 0) return;
    if (atBottom.current) element.scrollTop = element.scrollHeight;
    else setBelow(true);
  }, [noteCount]);
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
        {question?.live ? (
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
            {question.notes.map((note) => (
              <NoteBlock key={note.id} note={note} />
            ))}
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
  const rows = panelRows(s.model, s.entries, s.clearedAt, s.revisionPicks);
  const questions = questionsOf(conversationTurns(rows, coach.notes));
  // The question on show: the one picked from the list, or the one on the table.
  const [picked, setPicked] = useState<string | null>(null);
  const live = questions[questions.length - 1];
  const shown = questions.find((each) => each.key === picked) ?? live;
  // Picking the question on the table is following it again.
  const pick = (key: string) => setPicked(key === live?.key ? null : key);
  const notes = (
    <NotesPane
      label={view === "coach" ? "Coach" : "Notes"}
      question={shown}
      questions={questions}
      onPick={pick}
      onLive={() => setPicked(null)}
    />
  );
  const centre = (
    <div style={{ ...STYLE.column, gap: 0, flex: "1 1 0" }}>
      <CallSlot />
      {notes}
    </div>
  );
  if (view === "prompter")
    return (
      <div
        className="pn-single-body"
        style={STYLE.body}
        data-view={view}
        data-testid="pn-coach-layout"
      >
        {centre}
      </div>
    );
  return (
    <div
      className="pn-single-body"
      style={STYLE.body}
      data-view={view}
      data-testid="pn-coach-layout"
    >
      <div style={{ ...STYLE.column, flex: `0 0 ${QUESTIONS_WIDTH}px` }}>
        <QuestionsList
          questions={questions}
          shownKey={shown?.key}
          onPick={pick}
        />
      </div>
      {centre}
      <div style={{ ...STYLE.column, flex: `0 0 ${RIGHT_WIDTH}px` }}>
        {view === "coach" ? (
          <RightTabs s={s} />
        ) : (
          <div style={STYLE.pane}>
            <ChatPanel s={s} />
          </div>
        )}
      </div>
    </div>
  );
}
