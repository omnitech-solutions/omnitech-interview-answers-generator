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
// What is drawn comes from the UI library; the few inline styles left size
// the layout's own boxes (the columns, the call's room).
import {
  ActionMenu,
  Button,
  Divider,
  Empty,
  HeardLine,
  IconButton,
  OutlineList,
  Panel,
  SegmentedPrimitive,
  Splitter,
  SplitterPanel,
  Tab,
  TabPanel,
  Tabs,
  TabsBar,
  Tag,
} from "@oc-tech/omni-ui-components";
import type { CoachNote } from "@omnitech/interview-contracts";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { Icon } from "../../../icon";
import { ChatPanel } from "./chat-panel";
import { type ChatView, QUESTIONS_WIDTH, RIGHT_WIDTH } from "./chat-view-pref";
import {
  COACH_LAYOUTS,
  COLUMN_HANDLES,
  type CoachLayoutId,
  type CoachTextSize,
  HEIGHT_FLOOR,
  holdWindowDrag,
  QUESTIONS_FLOOR,
  SIDE_FLOOR,
  setCoachTextSize,
  setCoachWindowHeight,
  setCoachWindowWidth,
  TEXT_SIZES,
  useCoachSizes,
  useCoachTextSize,
  useToolbarWidth,
  WINDOW_FLOOR,
} from "./coach-columns";
import { CoachNoteView } from "./coach-note-view";
import { useCoachNotes } from "./coach-notes";
import { ContextPane } from "./context-pane";
import {
  conversationTurns,
  heardEmphasis,
  type Question,
  questionsOf,
  type Turn,
  WAITING_MS,
  waitingTurn,
} from "./conversation-model";
import { clock, panelRows } from "./panel-model";
import { AnswerPanel, CodePanel, type PanelSession } from "./panel-views";

const ASK = "#3ecf72";
const READ = "#f2f2f3";
const PANEL = "#1c1c1e";
const LINE = "#2c2c2f";
// The room the call opens with, and what the notes and the centre always keep.
const CALL_HEIGHT = 250;
const NOTES_FLOOR = 160;
const QUESTIONS_CEILING = 360;

const TEXT_SIZE_LABEL: Record<CoachTextSize, string> = {
  sm: "S",
  md: "M",
  lg: "L",
  xl: "XL",
};
const TEXT_SIZE_NAME: Record<CoachTextSize, string> = {
  sm: "Small",
  md: "Medium",
  lg: "Large",
  xl: "Extra large",
};
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
  // The pane inside is a panel of its own, so the tab panel draws no box.
  pane: {
    flex: "1 1 0",
    minHeight: 0,
    minWidth: 0,
    display: "flex",
    margin: 0,
    padding: 0,
    border: 0,
    background: "transparent",
    boxShadow: "none",
  },
  fill: { flex: "1 1 0", minWidth: 0, minHeight: 0 },
  columns: { flex: "1 1 0", minWidth: 0, minHeight: 0, display: "flex" },
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
    // The library's Panel is the pane (its heading, count and scrolling);
    // the OutlineList inside it is the rows.
    <Panel
      as="aside"
      title={`Questions · ${questions.length}`}
      meta="newest first"
      bodyPadding="none"
      scroll={{ thinScrollbar: true }}
      data-testid="pn-coach-questions"
    >
      <OutlineList
        aria-label="Questions"
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
      />
    </Panel>
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
    <CoachNoteView
      note={note}
      mode={compact ? "compact" : "detail"}
      // A note named as its question says the heading once, not twice.
      meta={`${KIND_LABEL[note.kind]} · ${clock(Date.parse(note.createdAt))}${
        sameTopic(note.title, heading) ? "" : ` · ${note.title}`
      }`}
    />
  );
}

// [DOMAIN] The notes pane is drawn from the library's parts alone: its Panel
// (heading, actions, scrolling), a HeardLine for the question and for each
// follow-up, a CueCard per note, and its Divider, Tag and Empty.
function NotesPane({
  label,
  question,
  questions,
  onPick,
  onLive,
  onLayout,
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
  // Arranges the layout: the default sizes, the whole screen, panes folded.
  onLayout(layout: CoachLayoutId): void;
}) {
  const textSize = useCoachTextSize();
  const at = question ? questions.indexOf(question) : -1;
  const previous = at > 0 ? questions[at - 1] : undefined;
  const next = at >= 0 ? questions[at + 1] : undefined;
  const onTable = question?.live === true && !waiting;
  return (
    <Panel
      // Another question opens at its top.
      key={question?.key ?? "none"}
      title={label}
      subtitle={
        question ? `Q${question.number} · ${question.label}` : undefined
      }
      meta={
        following ? (
          <Tag variant="filled" color={ASK}>
            Following live
          </Tag>
        ) : undefined
      }
      actions={
        <>
          {!following && question && (
            <Button
              buttonSize="sm"
              variant="outline"
              onClick={onLive}
              data-testid="pn-coach-live"
            >
              Back to live
            </Button>
          )}
          <SegmentedPrimitive
            appearance="control"
            aria-label="Size of the notes"
            value={textSize}
            onChange={(size) => setCoachTextSize(size as CoachTextSize)}
            options={TEXT_SIZES.map((size) => ({
              value: size,
              label: TEXT_SIZE_LABEL[size],
              ariaLabel: `${TEXT_SIZE_NAME[size]} text`,
            }))}
            data-testid="pn-coach-text-size"
          />
          <ActionMenu
            label="Layout"
            title="Layout"
            width={300}
            sections={[
              {
                id: "layout",
                selection: "none",
                items: COACH_LAYOUTS.map((layout) => ({
                  id: layout.id,
                  label: layout.label,
                  description: layout.description,
                  onSelect: () => onLayout(layout.id),
                })),
              },
            ]}
            trigger={
              <IconButton
                variant="ghost"
                iconSize="sm"
                icon={<Icon name="fit_screen" />}
                label="Layout"
                data-testid="pn-coach-layout-menu"
              />
            }
          />
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
        </>
      }
      {...(question
        ? {}
        : {
            empty: {
              icon: <Icon name="forum" />,
              description:
                "The question being asked appears here, with the coach's notes for it beneath.",
            },
          })}
      scroll={{ thinScrollbar: true }}
      bodyPadding="md"
      bodyClassName="gap-6"
      data-text-surface=""
      data-testid="pn-coach-notes"
    >
      {/* [DOMAIN] The question just asked is its own thing: the notes
          beneath are for the question before it, and are marked so. They
          never read as the answer to what was just asked. */}
      {waiting && (
        <HeardLine
          variant="boxed"
          tone="ask"
          size={textSize}
          label={`Current question · listening · ${clock(waiting.at)}`}
          title={waiting.question?.text ?? ""}
          status="Preparing response…"
          data-testid="pn-coach-waiting"
        />
      )}
      {waiting && <Divider>Previous coaching note</Divider>}
      {question && (
        // The same marks as its row in the list: the chosen question is blue,
        // and only the one on the table is green. The question is in the
        // coach's few words; what was actually said is beneath it, small.
        <HeardLine
          tone={onTable ? "ask" : "accent"}
          size={textSize}
          label={`Q${question.number} · ${
            waiting ? "Previous question" : question.live ? "Live" : "Asked"
          } · ${clock(question.at)}`}
          title={question.label}
          {...(question.question && question.question.text !== question.label
            ? { pieces: heardEmphasis(question.question.text) }
            : {})}
          data-testid="pn-coach-asked"
        />
      )}
      {question && question.notes.length === 0 && (
        <Empty variant="tile" description="No notes for this question yet." />
      )}
      {/* The notes and the follow-ups asked under this question, in the
          order they came. */}
      {question &&
        [
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
          .flatMap((block) =>
            block.note
              ? [
                  <NoteBlock
                    key={block.key}
                    note={block.note}
                    heading={question.label}
                    compact={compact}
                  />,
                ]
              : [
                  // Set apart from the notes above it by a rule: it is the
                  // interviewer speaking again, not more to say.
                  <Divider key={`${block.key}:rule`} />,
                  <HeardLine
                    key={block.key}
                    tone="ask"
                    size={textSize}
                    label={`Follow-up · ${clock(block.at)}`}
                    pieces={heardEmphasis(block.asked.text)}
                    data-testid="pn-coach-follow-up"
                  />,
                ],
          )}
    </Panel>
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
  question,
}: {
  s: PanelSession;
  // The notes on show, for the Context tab to mark what they lean on.
  notes: readonly CoachNote[];
  // The question on show, as asked, for the Context tab's selection.
  question: string;
}) {
  const pane: Record<TabId, ReactNode> = {
    answer: <AnswerPanel s={s} />,
    transcript: <ChatPanel s={s} />,
    code: <CodePanel s={s} />,
    // What the answers are built from: the brief and the experience matrix.
    context: <ContextPane s={s} notes={notes} question={question} />,
  };
  const [open, setOpen] = useState<TabId>("answer");
  return (
    <Tabs
      value={open}
      onValueChange={(next) => setOpen(next as TabId)}
      style={STYLE.tabsRoot}
    >
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
        // A closed panel stays hidden: only the open one is laid out.
        <TabPanel
          key={each.id}
          value={each.id}
          {...(each.id === open ? { style: STYLE.pane } : {})}
        >
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
  // A question stops waiting when its time is up, not at the next thing heard.
  const [, tick] = useState(0);
  const waitingAt = waiting?.at;
  useEffect(() => {
    if (waitingAt === undefined) return;
    const left = waitingAt + WAITING_MS - Date.now();
    const timer = window.setTimeout(
      () => tick((n) => n + 1),
      Math.max(left, 0) + 50,
    );
    return () => window.clearTimeout(timer);
  }, [waitingAt]);
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
  // The centre column is the toolbar's width at least.
  const toolbarWidth = useToolbarWidth();
  // A handle of the library's Splitter is a surface of its own (so the
  // see-through window gives it the mouse), and while one is held the page
  // tells the shell not to move the window.
  const splitter = {
    resizable: true,
    // Sizes are given only once one has been dragged: until then every
    // panel has its own default.
    // A width kept from before the side columns had a floor is lifted to it.
    ...(sizes.sizes
      ? {
          sizes: {
            ...sizes.sizes,
            ...(sizes.sizes["questions"] !== undefined
              ? {
                  questions: Math.max(
                    sizes.sizes["questions"],
                    QUESTIONS_FLOOR,
                  ),
                }
              : {}),
            ...(sizes.sizes["side"] !== undefined
              ? { side: Math.max(sizes.sizes["side"], SIDE_FLOOR) }
              : {}),
          },
        }
      : {}),
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
      onLayout={sizes.arrange}
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
  // [DOMAIN] The window itself is resized from the Splitters' outer edges: the
  // columns' left and right (the shell widens about the window's centre) and
  // the bottom (the shell fits a height from the top). The sizes are kept
  // until "Reset layout".
  const sideEdges = {
    edges: ["start", "end"],
    edgeAnchor: "centre",
    extent: window.innerWidth,
    // Never narrower than the side columns at their least with the centre at
    // the toolbar's width.
    minExtent:
      view === "prompter"
        ? WINDOW_FLOOR
        : QUESTIONS_FLOOR + toolbarWidth + SIDE_FLOOR + COLUMN_HANDLES,
    maxExtent: window.screen.availWidth,
    onExtentChange: (width: number) => setCoachWindowWidth(width),
    onExtentReset: () => setCoachWindowWidth(null),
  } as const;
  const frame = (columns: ReactNode) => (
    <Splitter
      {...splitter}
      orientation="vertical"
      edges={["end"]}
      extent={window.innerHeight}
      minExtent={HEIGHT_FLOOR}
      maxExtent={window.screen.availHeight}
      onExtentChange={(height) => setCoachWindowHeight(height)}
      onExtentReset={() => setCoachWindowHeight(null)}
      className="pn-single-body"
      style={{ ...STYLE.body, flexDirection: "column", gap: 0 }}
      data-view={view}
      data-testid="pn-coach-layout"
    >
      <SplitterPanel id="columns" style={STYLE.columns}>
        {columns}
      </SplitterPanel>
    </Splitter>
  );
  if (view === "prompter")
    return frame(
      <Splitter {...splitter} {...sideEdges} style={STYLE.fill}>
        <SplitterPanel id="main" style={STYLE.panelFill}>
          {centre}
        </SplitterPanel>
      </Splitter>,
    );
  return frame(
    <Splitter {...splitter} {...sideEdges} style={STYLE.fill}>
      <SplitterPanel
        id="questions"
        label="the questions"
        defaultSize={QUESTIONS_WIDTH}
        minSize={QUESTIONS_FLOOR}
        maxSize={QUESTIONS_CEILING}
        style={STYLE.panelFill}
      >
        <QuestionsList
          questions={questions}
          shownKey={shown?.key}
          onPick={pick}
        />
      </SplitterPanel>
      <SplitterPanel id="main" minSize={toolbarWidth} style={STYLE.panelFill}>
        {centre}
      </SplitterPanel>
      <SplitterPanel
        id="side"
        label="the answer"
        defaultSize={RIGHT_WIDTH}
        minSize={SIDE_FLOOR}
        style={{ ...STYLE.panelFill, gap: 8 }}
      >
        {view === "coach" ? (
          <RightTabs
            s={s}
            notes={shown?.notes ?? []}
            question={shown?.question?.text ?? shown?.label ?? ""}
          />
        ) : (
          <div style={STYLE.pane}>
            <ChatPanel s={s} />
          </div>
        )}
      </SplitterPanel>
    </Splitter>,
  );
}
