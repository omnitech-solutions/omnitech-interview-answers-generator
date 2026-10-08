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
import {
  Button,
  HeardLine,
  IconButton,
  OutlineList,
  Splitter,
  SplitterPanel,
  Tab,
  TabPanel,
  Tabs,
  TabsBar,
} from "@oc-tech/omni-ui-components";
import type { CoachNote } from "@omnitech/interview-contracts";
import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "../../../icon";
import { ChatPanel } from "./chat-panel";
import { type ChatView, QUESTIONS_WIDTH, RIGHT_WIDTH } from "./chat-view-pref";
import { holdWindowDrag, useCoachSizes, WindowEdge } from "./coach-columns";
import { CoachNoteView } from "./coach-note-view";
import { useCoachNotes } from "./coach-notes";
import { ContextPane } from "./context-pane";
import {
  conversationTurns,
  heardEmphasis,
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
// The room the call opens with, and what the notes and the centre always keep.
const CALL_HEIGHT = 250;
const NOTES_FLOOR = 160;
const CENTRE_FLOOR = 320;
const QUESTIONS_CEILING = 360;
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
  // What she said, as heard: there to place the notes, not to be read out, so
  // it is small, grey and cut to two lines (the whole of it is in its title).
  followUp: {
    margin: "3px 0 0",
    fontSize: 15,
    lineHeight: 1.45,
    color: DIM,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  heardStrong: { color: "#dcdce0", fontWeight: 500 },
  waitingText: {
    margin: "3px 0 0",
    fontSize: 17,
    lineHeight: 1.4,
    fontWeight: 600,
    color: READ,
  },
  note: {
    paddingLeft: 18,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  warn: {
    marginLeft: 18,
    padding: "8px 12px",
    borderRadius: 9,
    background: "rgba(245, 184, 74, 0.1)",
    border: "1px solid rgba(245, 184, 74, 0.35)",
  },
  noteMeta: { fontSize: 11.5, color: FAINT },
  previous: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: FAINT,
  },
  rule: { flex: "1 1 auto", height: 1, background: LINE },
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
  pane: { flex: "1 1 0", minHeight: 0, minWidth: 0, display: "flex" },
  fill: { flex: "1 1 0", minWidth: 0, minHeight: 0 },
  panelFill: { display: "flex", flexDirection: "column", minHeight: 0 },
  callSlot: {
    boxSizing: "border-box",
    borderRadius: 12,
    border: "1.5px dashed rgba(255, 255, 255, 0.28)",
    pointerEvents: "none",
  },
  tabsRoot: {
    flex: "1 1 0",
    minHeight: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
} satisfies Record<string, CSSProperties>;

// ---- Questions ------------------------------------------------------------------

// [DOMAIN] The questions, newest first: the library's OutlineList draws them.
// The question on the table is its live (green) row; the one being read is
// the chosen row.
function QuestionsList({
  questions,
  shownKey,
  onPick,
}: {
  questions: readonly Question[];
  shownKey: string | undefined;
  onPick(key: string): void;
}) {
  return (
    <OutlineList
      className="pn-card"
      style={STYLE.card}
      title={`Questions · ${questions.length}`}
      hint="newest first"
      order="reversed"
      value={shownKey ?? null}
      items={questions.map((question) => ({
        id: question.key,
        label: question.label,
        name: question.question?.text ?? question.label,
        number: question.number,
        state: question.live ? ("live" as const) : ("default" as const),
        meta: [
          clock(question.at),
          question.notes.length > 0
            ? `${question.notes.length} ${question.notes.length === 1 ? "note" : "notes"}`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
      }))}
      onValueChange={(item) => onPick(item.id)}
      data-testid="pn-coach-questions"
    />
  );
}

// A note titled as its question ("Q: Data consistency…") adds nothing above it.
const topic = (text: string) =>
  text
    .replace(/^q:\s*/i, "")
    .trim()
    .toLowerCase();
const sameTopic = (a: string, b: string) => topic(a) === topic(b);

// What kind of note it is, in a word, beside the time it was for.
const KIND_LABEL: Record<CoachNote["kind"], string> = {
  "direct-answer": "Answer",
  technical: "Technical",
  behavioral: "Behavioural",
  closing: "Closing",
  "follow-up": "Follow-up",
  "missed-opportunity": "Missed opportunity",
};

function NoteBlock({
  note,
  heading,
  compact,
}: {
  note: CoachNote;
  heading: string;
  compact: boolean;
}) {
  return (
    <div
      style={STYLE.note}
      data-tone={note.tone}
      data-kind={note.kind}
      data-testid="pn-coach-block"
    >
      <span style={STYLE.noteMeta}>
        {`${KIND_LABEL[note.kind]} · ${clock(Date.parse(note.createdAt))}`}
        {/* A note named as its question says the heading once, not twice. */}
        {sameTopic(note.title, heading) ? "" : ` · ${note.title}`}
      </span>
      <CoachNoteView note={note} mode={compact ? "compact" : "detail"} />
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
  compact,
}: {
  label: string;
  // The compact note: the response and a few anchors (the prompter view).
  compact: boolean;
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
        {/* [DOMAIN] The question just asked is its own thing: the notes
            beneath are for the question before it, and are marked so. They
            never read as the answer to what was just asked. */}
        {waiting && (
          <>
            <div style={STYLE.waiting} data-testid="pn-coach-waiting">
              <span style={STYLE.askLabel}>
                {`Current question · listening · ${clock(waiting.at)}`}
              </span>
              <p style={STYLE.waitingText}>{waiting.question?.text ?? ""}</p>
              <span style={STYLE.small}>Preparing response…</span>
            </div>
            <div style={STYLE.previous}>
              <span>Previous coaching note</span>
              <span style={STYLE.rule} aria-hidden="true" />
            </div>
          </>
        )}
        {question && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 26,
              // Dimmed while it is only the previous question's.
              opacity: waiting ? 0.55 : 1,
            }}
          >
            <div style={STYLE.asked}>
              <span style={STYLE.askBar} aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <span style={STYLE.askLabel}>
                  {`${
                    waiting
                      ? "Previous question"
                      : question.live
                        ? "Live"
                        : "Asked"
                  } · ${clock(question.at)}`}
                </span>
                {/* The question in the coach's few words. What was actually
                    said is beneath it, small: it places the question and is
                    not read. */}
                <p style={STYLE.askText} data-testid="pn-coach-asked">
                  {question.label}
                </p>
                {question.question &&
                  question.question.text !== question.label && (
                    <HeardLine
                      pieces={heardEmphasis(question.question.text)}
                      data-testid="pn-coach-heard"
                    />
                  )}
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
                    heading={question.label}
                    compact={compact}
                  />
                ) : (
                  <HeardLine
                    key={block.key}
                    tone="ask"
                    label={`Follow-up · ${clock(block.at)}`}
                    pieces={heardEmphasis(block.asked.text)}
                    // Set apart from the notes above it by a rule: it is
                    // the interviewer speaking again, not more to say.
                    style={{ paddingTop: 20, borderTop: `1px solid ${LINE}` }}
                    data-testid="pn-coach-follow-up"
                  />
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
          </div>
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
  { id: "context", label: "Context", icon: "description" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// [DOMAIN] The studio's own answer keeps its pane: it is never folded into the
// notes or the transcript. The transcript and the code share the column as tabs.
function RightTabs({
  s,
  notes,
}: {
  s: PanelSession;
  // The notes on show, for the Context tab to mark what they lean on.
  notes: readonly CoachNote[];
}) {
  const pane: Record<TabId, ReactNode> = {
    answer: <AnswerPanel s={s} />,
    transcript: <ChatPanel s={s} />,
    code: <CodePanel s={s} />,
    // What the answers are built from: the brief and the experience matrix.
    context: <ContextPane s={s} notes={notes} />,
  };
  return (
    <Tabs defaultValue="answer" style={STYLE.tabsRoot}>
      {/* A surface of its own, so the see-through window gives it the mouse. */}
      <TabsBar
        aria-label="Answer, transcript, code or context"
        data-hit-surface=""
      >
        {TABS.map((each) => (
          <Tab
            key={each.id}
            value={each.id}
            data-testid={`pn-coach-tab-${each.id}`}
          >
            <Icon name={each.icon} />
            {each.label}
          </Tab>
        ))}
      </TabsBar>
      {TABS.map((each) => (
        <TabPanel key={each.id} value={each.id} style={STYLE.pane}>
          {pane[each.id]}
        </TabPanel>
      ))}
    </Tabs>
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
  const sizes = useCoachSizes();
  // A handle of the library's Splitter is a surface of its own (so the
  // see-through window gives it the mouse), and while one is held the page
  // tells the shell not to move the window.
  const splitter = {
    resizable: true,
    // Sizes are given only once one has been dragged: until then every
    // panel has its own default.
    ...(sizes.sizes ? { sizes: sizes.sizes } : {}),
    onSizesChange: sizes.keep,
    resetKey: sizes.resetKey,
    handleProps: { "data-hit-surface": "" },
    onResizeStart: () => holdWindowDrag(true),
    onResizeEnd: () => holdWindowDrag(false),
  } as const;
  const notes = (
    <NotesPane
      label={view === "coach" ? "Coach" : "Notes"}
      question={shown}
      questions={questions}
      onPick={pick}
      onLive={() => setPicked(null)}
      following={pickedQuestion === undefined}
      compact={view === "prompter"}
      waiting={pickedQuestion === undefined ? waiting : undefined}
      onReset={sizes.reset}
    />
  );
  // [DOMAIN] Room for the call window (or the captured screen), above the
  // notes: a panel that paints only its outline and is not one of the
  // window's surfaces, so the call shows through it and takes its own clicks.
  const centre = (
    <Splitter {...splitter} orientation="vertical" style={STYLE.fill}>
      <SplitterPanel
        id="call"
        label="the room for the call"
        defaultSize={CALL_HEIGHT}
        minSize={0}
        style={STYLE.callSlot}
        aria-label="Room for the call window"
        data-testid="pn-call-slot"
      />
      <SplitterPanel id="notes" minSize={NOTES_FLOOR} style={STYLE.panelFill}>
        {notes}
      </SplitterPanel>
    </Splitter>
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
  return (
    <div
      className="pn-single-body"
      style={{ ...STYLE.body, gap: 0 }}
      data-view={view}
      data-testid="pn-coach-layout"
    >
      <WindowEdge side="left" />
      <Splitter {...splitter} style={STYLE.fill}>
        <SplitterPanel
          id="questions"
          label="the questions"
          defaultSize={QUESTIONS_WIDTH}
          minSize={0}
          maxSize={QUESTIONS_CEILING}
          style={STYLE.panelFill}
        >
          <QuestionsList
            questions={questions}
            shownKey={shown?.key}
            onPick={pick}
          />
        </SplitterPanel>
        <SplitterPanel id="main" minSize={CENTRE_FLOOR} style={STYLE.panelFill}>
          {centre}
        </SplitterPanel>
        <SplitterPanel
          id="side"
          label="the answer"
          defaultSize={RIGHT_WIDTH}
          minSize={0}
          style={{ ...STYLE.panelFill, gap: 8 }}
        >
          {view === "coach" ? (
            <RightTabs s={s} notes={shown?.notes ?? []} />
          ) : (
            <div style={STYLE.pane}>
              <ChatPanel s={s} />
            </div>
          )}
        </SplitterPanel>
      </Splitter>
      <WindowEdge side="right" />
    </div>
  );
}
