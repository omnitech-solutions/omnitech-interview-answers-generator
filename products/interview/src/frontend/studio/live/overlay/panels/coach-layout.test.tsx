// The coach layouts over a scripted session and scripted coach notes: which
// columns each one has, the room for the call, the question on the table and
// an earlier one, how a note is drawn and how large it reads, the tabs of the
// right column, and the library Splitter's bars and outer edges that resize
// the columns, the call's room and the window itself.
import type { CoachNote } from "@omnitech/interview-contracts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveLiveModel } from "../../session-state";
import { answerAction } from "../../testing/live-view-kit";
import {
  type action,
  minutesAfter,
  sessionView,
  snapshot,
  transcript,
} from "../../testing/session-fixtures";
import { codingAnswer } from "../../testing/session-result-fixtures";
import {
  COACH_LAYOUTS,
  COLUMN_HANDLES,
  QUESTIONS_FLOOR,
  SIDE_FLOOR,
  setCoachTextSize,
  setCoachWindowHeight,
  setCoachWindowWidth,
  TOOLBAR_FALLBACK,
} from "./coach-columns";
import { CoachLayout } from "./coach-layout";
import type { PanelSession } from "./panel-views";

// The answer and the code panes need the whole panel session (screenshots, the
// tray, the store); single-panel.test.tsx draws them for real inside a coach
// view. Here they are named stand-ins, so the tabs can be told apart; the
// transcript is the real pane.
vi.mock("./panel-views", async (original) => ({
  ...(await original<typeof import("./panel-views")>()),
  AnswerPanel: () => <div data-testid="pane-answer" />,
  CodePanel: () => <div data-testid="pane-code" />,
}));
// The Context pane reads the brief and the matrix (context-pane.test.tsx);
// here it is a stand-in that says which notes and which question it was given.
vi.mock("./context-pane", () => ({
  ContextPane: ({
    notes,
    question,
  }: {
    notes: readonly CoachNote[];
    question?: string;
  }) => (
    <div
      data-testid="pane-context"
      data-notes={notes.map((each) => each.title).join(" | ")}
      data-question={question}
    />
  ),
}));

const QUESTION_ONE =
  "How do you decide when a feature should be its own microservice rather than a module?";
const QUESTION_TWO =
  "How do you handle data consistency between multiple services?";
const ASK_TWO = "Data consistency across services";
const POLL_MS = 2_000;

// The interviewer asks at 0:02 and 1:00; the person answers in between.
const heardSoFar = (extra: ReturnType<typeof transcript>[] = []) => [
  transcript(2, QUESTION_ONE, { sourceId: "application-audio-r1" }),
  transcript(20, "I default to the monolith unless a boundary earns it.", {
    sourceId: "microphone-r1",
  }),
  transcript(60, QUESTION_TWO, { sourceId: "application-audio-r1" }),
  ...extra,
];
function session(
  observations = heardSoFar(),
  extra: Partial<PanelSession> = {},
  actions: ReturnType<typeof action>[] = [],
): PanelSession {
  return {
    model: deriveLiveModel({
      session: sessionView({ processingPolicy: "permitted-remote" }),
      observations: [snapshot(1), ...observations],
      actions,
      serverClockOffsetMs: 0,
      nowMs: Date.parse(minutesAfter(5)),
    }),
    snapshot: { pending: [], observations: [snapshot(1)], actions: [] },
    target: null,
    entries: [],
    system: [],
    markers: [],
    clearedAt: 0,
    open: true,
    phase: null,
    note: null,
    draft: "",
    selected: undefined,
    card: null,
    revisionPicks: {},
    tray: { intent: "add", items: [] },
    live: { mic: "off", interim: "" },
    select: () => undefined,
    setDraft: () => undefined,
    send: async () => ({ ok: true }),
    press: () => undefined,
    toast: () => undefined,
    notify: () => undefined,
    ...extra,
  } as unknown as PanelSession;
}

const note = (
  at: number,
  seconds: number,
  extra: Partial<CoachNote> = {},
): CoachNote => ({
  id: `00000000-0000-4000-8000-${String(at).padStart(12, "0")}`,
  createdAt: minutesAfter(0, seconds),
  title: `Note ${at}`,
  tone: "say",
  kind: "direct-answer",
  revision: 1,
  status: "ready",
  points: [],
  sections: [],
  links: [],
  ...extra,
});
const FIRST = note(1, 10, {
  title: "Name the criteria",
  points: ["Team boundary", "Independent scaling"],
});
const SECOND = note(2, 70, {
  title: "Name the techniques",
  markdown: "- **Outbox**: one transaction",
  ask: ASK_TWO,
  askId: "q-consistency",
});

// What the coach has posted; a test adds to it and the next poll shows it.
let posted: CoachNote[] = [];
let revision = 1;
const post = (...notes: CoachNote[]) => {
  posted = [...posted, ...notes];
  revision += 1;
};
// What a replay's coach has posted: kept apart, and none unless a test says.
let replayed: CoachNote[] = [];
let replayRevision = 1;
const postReplay = (...notes: CoachNote[]) => {
  replayed = [...replayed, ...notes];
  replayRevision += 1;
};
// What the layout asked the notes API, as [method, address].
const askedNotes = () =>
  vi
    .mocked(fetch)
    .mock.calls.map(
      ([input, init]) => [init?.method ?? "GET", String(input)] as const,
    );
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
const poll = () => act(() => vi.advanceTimersByTimeAsync(POLL_MS));
async function show(
  view: "coach" | "conversation" | "prompter",
  s: PanelSession = session(),
) {
  const drawn = render(<CoachLayout s={s} view={view} />);
  await settle();
  return drawn;
}

// Where the layout's sizes are kept (coach-columns.test.tsx covers the store).
const SIZES_KEY = "omnitech.interview.coach.sizes";
const WIDTH_KEY = "omnitech.interview.coach.window-width";
const HEIGHT_KEY = "omnitech.interview.coach.window-height";
const TEXT_KEY = "omnitech.interview.coach.text-size";
const keptSizes = () =>
  JSON.parse(window.localStorage.getItem(SIZES_KEY) ?? "null");
// React reads the pointer's place from a mouse event; jsdom's pointer events
// may not carry it.
const pointer = (
  element: Element,
  type: "down" | "move" | "up" | "cancel",
  at: { x?: number; y?: number } = {},
) => {
  const event = new MouseEvent(`pointer${type}`, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: at.x ?? 0,
    clientY: at.y ?? 0,
    screenX: at.x ?? 0,
    screenY: at.y ?? 0,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(element, event);
};

const layout = () => screen.getByTestId("pn-coach-layout");
const notesPane = () => screen.getByTestId("pn-coach-notes");
// [DOMAIN] The question on show is the library's HeardLine: a label (its
// number, whether it is live, its time), the question in the coach's few
// words as its title, and what was actually said beneath, small.
const askedLine = () => screen.getByTestId("pn-coach-asked");
const slot = (within: Element | null, name: string) =>
  within?.querySelector<HTMLElement>(`[data-slot="${name}"]`) ?? null;
const asked = () => slot(askedLine(), "heard-line-title") as HTMLElement;
const askedLabel = () => slot(askedLine(), "heard-line-label") as HTMLElement;
// What was said, as heard: cut to two lines, the whole of it in its title.
const heard = (line: Element | null = askedLine()) =>
  slot(line, "heard-line-text");
// A question's few words where the coach gave none: what was heard, cut.
const cut = (text: string) =>
  text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text;
// The question on show: its few words large, and what was actually said
// small beneath them when that differs.
function onShow(said: string, label = cut(said)) {
  expect(asked().textContent).toBe(label);
  if (label === said) expect(heard()).toBeNull();
  else {
    expect(heard()?.textContent).toBe(said);
    expect(heard()).toHaveAttribute("title", said);
  }
}
const sectionsOf = (block: Element | undefined) =>
  [...(block?.querySelectorAll('[data-slot="cue-card-section"]') ?? [])].map(
    (section) => section.getAttribute("data-kind"),
  );
// The lines of a note as drawn: one sentence or anchor to a line.
const linesOf = (block: Element | undefined) =>
  [...(block?.querySelectorAll('[data-slot="cue-card-line"]') ?? [])].map(
    (line) => line.textContent,
  );
// The quiet line over a note: its kind, its time and (unless it is the
// question) its title.
const metaOf = (block: Element | undefined) =>
  slot(block ?? null, "cue-card-meta")?.textContent ?? "";
// The rows of the questions list as drawn (the library's OutlineList): the
// newest question first. There are none in the prompter, which has no list.
const rows = () => [
  ...document.querySelectorAll<HTMLElement>('[data-slot="outline-list-row"]'),
];
const numberOf = (row: Element) =>
  slot(row, "outline-list-number")?.textContent ?? "";
const nameOf = (row: Element) =>
  slot(row, "outline-list-label")?.textContent ?? "";
const metaOfRow = (row: Element) =>
  slot(row, "outline-list-meta")?.textContent ?? "";
// A row by its question's number (1 is the first one asked).
const question = (number: number) => {
  const row = rows().find((each) => numberOf(each) === String(number));
  if (!row) throw new Error(`no question ${number} in the list`);
  return row;
};
const isLive = (row: Element) => row.getAttribute("data-state") === "live";
// The notes on show, each the library's CueCard.
const blocks = () => screen.queryAllByTestId("pn-coach-note");
const pickListed = (number: number) => fireEvent.click(question(number));
const follows = (before: Element, after: Element) =>
  Boolean(
    before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
const held = () => document.documentElement.hasAttribute("data-no-drag");
// The notes pane's Layout menu (the library's ActionMenu): opened with a
// press, and a row is chosen with a click.
const layoutMenu = () => screen.getByTestId("pn-coach-layout-menu");
const openLayouts = () => {
  fireEvent.pointerDown(layoutMenu(), { button: 0, ctrlKey: false });
};
const layoutRow = (name: string) =>
  screen.getByRole("menuitem", { name: new RegExp(`^${name}`) });
const chooseLayout = (name: string) => {
  openLayouts();
  fireEvent.click(layoutRow(name));
};
const resetLayout = () => chooseLayout("Default");

// The window and the screen it is on: the Splitters' outer edges read both.
const WINDOW = { width: 1_000, height: 768 };
const SCREEN = { availWidth: 1_600, availHeight: 1_000 };

beforeEach(() => {
  vi.useFakeTimers();
  // [DOMAIN] A question waits for its notes three minutes at most. The
  // scripted call is read three minutes in: inside the wait of the last
  // thing asked in it (1:00, or 2:30 where a test adds a third question).
  vi.setSystemTime(Date.parse(minutesAfter(3)));
  vi.stubGlobal("innerWidth", WINDOW.width);
  vi.stubGlobal("innerHeight", WINDOW.height);
  vi.stubGlobal("screen", SCREEN);
  window.localStorage.clear();
  posted = [FIRST, SECOND];
  revision = 1;
  replayed = [];
  replayRevision = 1;
  // The notes API as the server answers it: the person's own notes, and the
  // replay's (`?space=replay`) apart from them, each cleared by a DELETE.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const replay = String(input).includes("space=replay");
      if (init?.method === "DELETE") {
        if (replay) {
          replayed = [];
          replayRevision += 1;
        } else {
          posted = [];
          revision += 1;
        }
      }
      return new Response(
        JSON.stringify(
          replay
            ? { revision: replayRevision, notes: replayed }
            : { revision, notes: posted },
        ),
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  // The window's width and height and the notes' size are kept in the module.
  act(() => {
    setCoachWindowWidth(null);
    setCoachWindowHeight(null);
    setCoachTextSize("lg");
  });
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-no-drag");
});

describe("the three layouts", () => {
  it("coach: the questions, the call over the coach's notes, and the answer, transcript, code and context as tabs", async () => {
    await show("coach");
    expect(layout()).toHaveAttribute("data-view", "coach");
    expect(screen.getByTestId("pn-coach-questions")).toHaveAccessibleName(
      "Questions · 2",
    );
    expect(screen.getByTestId("pn-call-slot")).toBeInTheDocument();
    expect(notesPane()).toHaveAccessibleName("Coach");
    expect(
      screen.getByRole("tablist", {
        name: "Answer, transcript, code or context",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Answer",
      "Transcript",
      "Code",
      "Context",
    ]);
    // Left to right: questions, the call and the notes, the tabs.
    const order = [
      screen.getByTestId("pn-coach-questions"),
      screen.getByTestId("pn-call-slot"),
      notesPane(),
      screen.getByRole("tablist"),
    ];
    for (const [at, element] of order.entries()) {
      const next = order[at + 1];
      if (next) expect(follows(element, next)).toBe(true);
    }
  });

  it("conversation: the questions, the call over the notes, and the transcript with no tabs", async () => {
    await show("conversation");
    expect(layout()).toHaveAttribute("data-view", "conversation");
    expect(screen.getByTestId("pn-coach-questions")).toBeInTheDocument();
    expect(screen.getByTestId("pn-call-slot")).toBeInTheDocument();
    expect(notesPane()).toHaveAccessibleName("Notes");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByTestId("pn-chat")).toBeInTheDocument();
    expect(screen.getByLabelText("Transcript and chat")).toHaveTextContent(
      QUESTION_ONE,
    );
    expect(screen.queryByTestId("pane-answer")).toBeNull();
    expect(screen.queryByTestId("pane-code")).toBeNull();
  });

  it("prompter: only the call and one question's notes", async () => {
    await show("prompter");
    expect(layout()).toHaveAttribute("data-view", "prompter");
    expect(screen.getByTestId("pn-call-slot")).toBeInTheDocument();
    expect(notesPane()).toHaveAccessibleName("Notes");
    expect(screen.getByText("Outbox")).toBeVisible();
    expect(screen.queryByTestId("pn-coach-questions")).toBeNull();
    expect(rows()).toEqual([]);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByTestId("pn-chat")).toBeNull();
    expect(screen.queryByTestId("pane-answer")).toBeNull();
  });

  it.each(["coach", "conversation", "prompter"] as const)(
    "%s: the layout is the window's one body, and each view has the panels it should",
    async (view) => {
      await show(view);
      expect(layout()).toHaveClass("pn-single-body");
      expect(layout()).toHaveAttribute("data-slot", "splitter");
      expect(
        [...layout().querySelectorAll("[data-panel]")]
          .filter((each) => each.getAttribute("data-slot") === "splitter-panel")
          .map((each) => each.getAttribute("data-panel")),
      ).toEqual(
        view === "prompter"
          ? ["columns", "main", "call", "notes"]
          : ["columns", "questions", "main", "call", "notes", "side"],
      );
    },
  );

  it("reads the coach's notes itself, and reads none while the session is not open", async () => {
    await show("prompter");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/coach-notes",
      expect.objectContaining({ method: "GET" }),
    );
    cleanup();
    vi.mocked(fetch).mockClear();
    await show("prompter", { ...session(), open: false } as PanelSession);
    expect(fetch).not.toHaveBeenCalled();
    expect(blocks()).toHaveLength(0);
  });
});

describe("the room for the call", () => {
  const slotPanel = () => screen.getByTestId("pn-call-slot");
  const bar = () =>
    screen.getByRole("separator", { name: /room for the call/ });

  it.each(["coach", "conversation", "prompter"] as const)(
    "%s: sits directly above the notes, with the bar to resize it between them",
    async (view) => {
      await show(view);
      expect(slotPanel()).toHaveAttribute("data-panel", "call");
      expect(slotPanel().nextElementSibling).toBe(bar());
      expect(bar().nextElementSibling).toContainElement(notesPane());
      expect(bar().nextElementSibling).toHaveAttribute("data-panel", "notes");
    },
  );

  it("opens 250 px tall, says what it is for, is only an outline and lets clicks through to the call", async () => {
    await show("coach");
    expect(slotPanel()).toHaveAccessibleName("Room for the call window");
    expect(slotPanel()).toHaveStyle({ flex: "0 0 250px" });
    expect(slotPanel().style.pointerEvents).toBe("none");
    expect(slotPanel().style.border).toContain("dashed");
    expect(slotPanel().style.background).toBe("");
    // Nothing is drawn in it, and it is not one of the window's surfaces.
    expect(slotPanel()).toBeEmptyDOMElement();
    expect(slotPanel()).not.toHaveAttribute("data-hit-surface");
  });

  it("its bar is a horizontal separator that says the room's height, starts at nothing, and takes the mouse", async () => {
    await show("coach");
    expect(bar()).toHaveAttribute("aria-orientation", "horizontal");
    expect(bar()).toHaveAttribute("aria-valuenow", "250");
    expect(bar()).toHaveAttribute("aria-valuemin", "0");
    expect(bar()).toHaveAttribute("tabindex", "0");
    expect(bar()).toHaveAttribute("data-hit-surface");
  });

  it("the arrows on the bar make the room shorter and taller, 24 px a press, and the height is kept", async () => {
    await show("coach");
    fireEvent.keyDown(bar(), { key: "ArrowUp" });
    expect(bar()).toHaveAttribute("aria-valuenow", "226");
    expect(slotPanel()).toHaveStyle({ flex: "0 0 226px" });
    expect(keptSizes()).toMatchObject({ call: 226 });
    fireEvent.keyDown(bar(), { key: "ArrowDown" });
    expect(bar()).toHaveAttribute("aria-valuenow", "250");
    expect(keptSizes()).toMatchObject({ call: 250 });
  });

  it("dragging the bar up makes the room shorter by as much, and holds the window still until it is let go", async () => {
    await show("prompter");
    pointer(bar(), "down", { y: 250 });
    expect(held()).toBe(true);
    pointer(bar(), "move", { y: 150 });
    expect(bar()).toHaveAttribute("aria-valuenow", "150");
    expect(slotPanel()).toHaveStyle({ flex: "0 0 150px" });
    expect(held()).toBe(true);
    pointer(bar(), "cancel", { y: 150 });
    expect(held()).toBe(false);
    expect(keptSizes()).toMatchObject({ call: 150 });
  });

  it("takes the height kept from an earlier session; a room folded away stays folded", async () => {
    window.localStorage.setItem(SIZES_KEY, JSON.stringify({ call: 90 }));
    await show("conversation");
    expect(slotPanel()).toHaveStyle({ flex: "0 0 90px" });
    expect(bar()).toHaveAttribute("aria-valuenow", "90");
    cleanup();
    window.localStorage.setItem(SIZES_KEY, JSON.stringify({ call: 0 }));
    await show("prompter");
    expect(slotPanel()).toHaveStyle({ flex: "0 0 0px" });
  });

  it("the Default layout brings a folded room back to 250 px, in the prompter too", async () => {
    window.localStorage.setItem(SIZES_KEY, JSON.stringify({ call: 0 }));
    await show("prompter");
    resetLayout();
    expect(slotPanel()).toHaveStyle({ flex: "0 0 250px" });
    expect(bar()).toHaveAttribute("aria-valuenow", "250");
  });
});

describe("the questions list", () => {
  it("is the library's panel with its outline list inside", async () => {
    await show("coach");
    const questions = screen.getByTestId("pn-coach-questions");
    expect(questions.tagName).toBe("ASIDE");
    expect(questions).toHaveAttribute("data-slot", "panel");
    expect(within(questions).getByRole("list", { name: "Questions" })).toBe(
      rows()[0]?.closest("ul"),
    );
  });

  it("lists what was asked newest first, numbered in the order asked, with the coach's wording where there is some", async () => {
    await show("coach");
    const questions = screen.getByTestId("pn-coach-questions");
    expect(questions).toHaveTextContent("Questions · 2");
    expect(questions).toHaveTextContent("newest first");
    expect(rows()).toHaveLength(2);
    // The top row is the newest question, so it has the highest number.
    expect(rows().map(numberOf)).toEqual(["2", "1"]);
    expect(nameOf(rows()[0] as HTMLElement)).toBe(ASK_TWO);
    // The whole question is one hover away.
    expect(rows()[0]).toHaveAttribute("title", QUESTION_TWO);
    // The first has no restatement: what was heard, cut to 60 characters.
    expect(nameOf(rows()[1] as HTMLElement)).toBe(cut(QUESTION_ONE));
    expect(rows()[1]).toHaveAttribute("title", QUESTION_ONE);
  });

  it("each row is a real button, so the keyboard reaches it and the shell never drags the window from it", async () => {
    await show("coach");
    for (const row of rows()) {
      expect(row.tagName).toBe("BUTTON");
      expect(row).toHaveAttribute("type", "button");
    }
    expect(
      within(screen.getByTestId("pn-coach-questions")).getAllByRole("button"),
    ).toEqual(rows());
  });

  it("a new question goes to the top", async () => {
    // No coach yet: every question heard has a row.
    posted = [];
    const drawn = await show("coach");
    expect(rows().map(numberOf)).toEqual(["2", "1"]);
    drawn.rerender(
      <CoachLayout
        s={session(
          heardSoFar([
            transcript(150, "Tell me about a project you are proud of.", {
              sourceId: "application-audio-r1",
            }),
          ]),
        )}
        view="coach"
      />,
    );
    await settle();
    expect(rows().map(numberOf)).toEqual(["3", "2", "1"]);
    expect(screen.getByTestId("pn-coach-questions")).toHaveTextContent(
      "Questions · 3",
    );
  });

  it("once a coach is writing, a question has a row only when it has notes", async () => {
    const NEXT = "Tell me about a project you are proud of.";
    await show(
      "coach",
      session(
        heardSoFar([
          transcript(150, NEXT, { sourceId: "application-audio-r1" }),
        ]),
      ),
    );
    expect(screen.getByTestId("pn-coach-questions")).toHaveTextContent(
      "Questions · 2",
    );
    expect(rows()).toHaveLength(2);
    expect(isLive(question(2))).toBe(true);
    post(note(5, 160, { title: "Pick one with numbers", askId: "q-project" }));
    await poll();
    expect(rows()).toHaveLength(3);
    expect(question(3)).toHaveAttribute("title", NEXT);
    expect(isLive(question(3))).toBe(true);
    expect(isLive(question(2))).toBe(false);
  });

  it("marks only the question on the table as live, and says when each was asked and how many notes it has", async () => {
    await show("coach");
    expect(rows().map(isLive)).toEqual([true, false]);
    expect(metaOfRow(question(1))).toMatch(/^\d+:\d\d[^·]* · 1 note$/);
    expect(metaOfRow(question(2))).toMatch(/^\d+:\d\d[^·]* · 1 note · live$/);
    post(note(3, 80, { askId: "q-consistency" }));
    await poll();
    expect(metaOfRow(question(2))).toMatch(/ · 2 notes · live$/);
    expect(metaOfRow(question(1))).toMatch(/ · 1 note$/);
  });

  it("a question with no notes says only when it was asked", async () => {
    posted = [];
    await show("coach");
    expect(metaOfRow(question(1))).toMatch(/^\d+:\d\d[^·]*$/);
    expect(metaOfRow(question(1))).not.toContain("note");
  });

  it("the person's own lines and the interviewer's closing remarks are not questions", async () => {
    await show(
      "coach",
      session(
        heardSoFar([
          transcript(90, "We use the Outbox pattern for that.", {
            sourceId: "microphone-r1",
          }),
          transcript(120, "Great, thank you so much for your time today.", {
            sourceId: "application-audio-r1",
          }),
        ]),
      ),
    );
    expect(rows()).toHaveLength(2);
    expect(isLive(question(2))).toBe(true);
  });

  it("is empty before anything is asked, and the notes pane says what will appear", async () => {
    posted = [];
    await show("coach", session([]));
    expect(screen.getByTestId("pn-coach-questions")).toHaveTextContent(
      "Questions · 0",
    );
    expect(rows()).toEqual([]);
    expect(screen.queryByTestId("pn-coach-asked")).toBeNull();
    expect(notesPane()).toHaveTextContent(
      "The question being asked appears here, with the coach's notes for it beneath.",
    );
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
    // Nothing is followed yet, and there is nowhere to step to.
    expect(
      screen.getByRole("button", { name: "Previous question" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Next question" }),
    ).toBeDisabled();
  });
});

describe("the question on the table", () => {
  it("is shown whole with its notes beneath, marked as live in green and followed live", async () => {
    await show("coach");
    onShow(QUESTION_TWO, ASK_TWO);
    expect(askedLabel().textContent).toMatch(/^Q2 · Live · \d+:\d\d/);
    expect(askedLine()).toHaveAttribute("data-tone", "ask");
    expect(notesPane()).toHaveTextContent(`Q2 · ${ASK_TWO}`);
    expect(notesPane()).toHaveTextContent("Following live");
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
    expect(blocks()).toHaveLength(1);
    expect(metaOf(blocks()[0])).toContain("Name the techniques");
    expect(linesOf(blocks()[0])).toEqual(["Outbox: one transaction"]);
    // Its row in the list is the current one.
    expect(question(2)).toHaveAttribute("aria-current", "true");
    expect(question(1)).not.toHaveAttribute("aria-current");
  });

  it("says so when no question has notes yet", async () => {
    posted = [];
    await show("conversation");
    // No coach, so no restatement: what was heard, cut, with the whole beneath.
    onShow(QUESTION_TWO);
    expect(blocks()).toHaveLength(0);
    expect(notesPane()).toHaveTextContent("No notes for this question yet.");
    expect(notesPane()).toHaveTextContent("Following live");
    expect(screen.queryByTestId("pn-coach-waiting")).toBeNull();
  });

  it("moves on once the coach's notes for the next one arrive", async () => {
    const drawn = await show("coach");
    onShow(QUESTION_TWO, ASK_TWO);
    const NEXT = "Tell me about a project you are proud of.";
    drawn.rerender(
      <CoachLayout
        s={session(
          heardSoFar([
            transcript(150, NEXT, { sourceId: "application-audio-r1" }),
          ]),
        )}
        view="coach"
      />,
    );
    await settle();
    // Until then the last notes stay on show.
    onShow(QUESTION_TWO, ASK_TWO);
    post(note(5, 160, { title: "Pick one with numbers", askId: "q-project" }));
    await poll();
    onShow(NEXT);
    expect(blocks()).toHaveLength(1);
    expect(metaOf(blocks()[0])).toContain("Pick one with numbers");
    expect(notesPane()).toHaveTextContent("Following live");
    expect(screen.queryByTestId("pn-coach-waiting")).toBeNull();
  });
});

describe("a new question whose notes have not arrived", () => {
  const NEXT = "Tell me about a project you are proud of.";
  const waiting = () => screen.getByTestId("pn-coach-waiting");
  const withNext = () =>
    session(
      heardSoFar([transcript(150, NEXT, { sourceId: "application-audio-r1" })]),
    );

  it("never empties the pane: the last notes stay, with the new question named above them", async () => {
    await show("coach", withNext());
    expect(slot(waiting(), "heard-line-label")?.textContent).toMatch(
      /^Current question · listening · \d+:\d\d/,
    );
    expect(slot(waiting(), "heard-line-title")?.textContent).toBe(NEXT);
    expect(waiting()).toHaveTextContent(/Preparing response…$/);
    // Beneath it, the last question the coach answered, with its notes.
    onShow(QUESTION_TWO, ASK_TWO);
    expect(blocks()).toHaveLength(1);
    expect(metaOf(blocks()[0])).toContain("Name the techniques");
    expect(follows(waiting(), askedLine())).toBe(true);
    expect(notesPane()).toContainElement(waiting());
    expect(notesPane()).not.toHaveTextContent("No notes for this question yet");
  });

  it("the notes beneath are marked as the previous question's, and no longer in the live green: they never read as the answer to what was just asked", async () => {
    await show("coach", withNext());
    const divider = within(notesPane()).getByText("Previous coaching note");
    expect(follows(waiting(), divider)).toBe(true);
    expect(follows(divider, askedLine())).toBe(true);
    expect(askedLabel().textContent).toMatch(
      /^Q2 · Previous question · \d+:\d\d/,
    );
    expect(notesPane()).not.toHaveTextContent("Live · ");
    expect(askedLine()).toHaveAttribute("data-tone", "accent");
    // The green is the box's: the question being asked now.
    expect(waiting()).toHaveAttribute("data-tone", "ask");
    expect(waiting()).not.toContainElement(askedLine());
  });

  it("once its notes arrive nothing is marked previous, and it is the live question", async () => {
    await show("coach", withNext());
    post(note(5, 160, { title: "Pick one with numbers", askId: "q-project" }));
    await poll();
    expect(notesPane()).not.toHaveTextContent("Previous coaching note");
    expect(notesPane()).not.toHaveTextContent("Previous question ·");
    expect(askedLabel().textContent).toMatch(/^Q3 · Live · \d+:\d\d/);
    expect(askedLine()).toHaveAttribute("data-tone", "ask");
  });

  it("a picked question is never marked previous, even while another waits", async () => {
    await show("coach", withNext());
    pickListed(1);
    expect(notesPane()).not.toHaveTextContent("Previous coaching note");
    expect(askedLabel().textContent).toMatch(/^Q1 · Asked · \d+:\d\d/);
    expect(askedLine()).toHaveAttribute("data-tone", "accent");
  });

  it("is a box of its own and is never cut: it is what is being asked now", async () => {
    await show("coach", withNext());
    expect(waiting()).toHaveAttribute("data-variant", "boxed");
    expect(askedLine()).toHaveAttribute("data-variant", "line");
    const said = slot(waiting(), "heard-line-title") as HTMLElement;
    expect(said.style.getPropertyValue("-webkit-line-clamp")).toBe("");
    // The whole of it is its title: there is no cut line beneath.
    expect(heard(waiting())).toBeNull();
  });

  it("is still following live, and has no row of its own until its notes arrive", async () => {
    await show("coach", withNext());
    expect(notesPane()).toHaveTextContent("Following live");
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
    expect(notesPane()).toHaveTextContent(`Q2 · ${ASK_TWO}`);
    expect(rows()).toHaveLength(2);
    expect(question(2)).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("pn-coach-questions")).not.toHaveTextContent(
      "Tell me about a project",
    );
  });

  it("goes back to the latest question that has notes, however many were asked since", async () => {
    posted = [FIRST];
    await show("conversation");
    expect(waiting()).toHaveTextContent(QUESTION_TWO);
    onShow(QUESTION_ONE);
    expect(blocks()).toHaveLength(1);
    expect(metaOf(blocks()[0])).toContain("Name the criteria");
  });

  it("the box goes when its notes arrive, and the pane moves on to it", async () => {
    await show("coach", withNext());
    expect(waiting()).toBeInTheDocument();
    post(note(5, 160, { title: "Pick one with numbers", askId: "q-project" }));
    await poll();
    expect(screen.queryByTestId("pn-coach-waiting")).toBeNull();
    onShow(NEXT);
    expect(metaOf(blocks()[0])).toContain("Pick one with numbers");
  });

  it("there is no box while the question on the table has notes", async () => {
    await show("coach");
    expect(screen.queryByTestId("pn-coach-waiting")).toBeNull();
  });

  it("a picked question is shown as it is, with no box; back on the newest, the box returns", async () => {
    await show("coach", withNext());
    pickListed(1);
    expect(screen.queryByTestId("pn-coach-waiting")).toBeNull();
    onShow(QUESTION_ONE);
    expect(notesPane()).not.toHaveTextContent("Following live");
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    onShow(QUESTION_TWO, ASK_TWO);
    expect(waiting()).toHaveTextContent(NEXT);
    expect(notesPane()).toHaveTextContent("Following live");
    // The question that waits cannot be stepped to: it has no notes to show.
    expect(
      screen.getByRole("button", { name: "Next question" }),
    ).toBeDisabled();
  });

  it("there is no box where no coach is writing: the question just asked is the one on show", async () => {
    posted = [];
    await show("coach", withNext());
    expect(screen.queryByTestId("pn-coach-waiting")).toBeNull();
    onShow(NEXT);
    expect(rows()).toHaveLength(3);
  });

  it("is shown in the prompter too", async () => {
    await show("prompter", withNext());
    expect(waiting()).toHaveTextContent(NEXT);
    onShow(QUESTION_TWO, ASK_TWO);
  });

  it("waits three minutes at most: a question asked longer ago than that is drawn as a follow-up of the last answered one, with no box", async () => {
    // Read three minutes and a second after the third question (2:30).
    vi.setSystemTime(Date.parse(minutesAfter(5, 31)));
    await show("coach", withNext());
    expect(screen.queryByTestId("pn-coach-waiting")).toBeNull();
    expect(notesPane()).not.toHaveTextContent("Previous coaching note");
    onShow(QUESTION_TWO, ASK_TWO);
    expect(askedLabel().textContent).toMatch(/^Q2 · Live · /);
    const followUp = screen.getByTestId("pn-coach-follow-up");
    expect(heard(followUp)?.textContent).toBe(NEXT);
    expect(rows()).toHaveLength(2);
  });

  it("still waits at exactly three minutes", async () => {
    vi.setSystemTime(Date.parse(minutesAfter(5, 30)));
    await show("coach", withNext());
    expect(waiting()).toHaveTextContent(NEXT);
    expect(screen.queryByTestId("pn-coach-follow-up")).toBeNull();
  });
});

describe("an earlier question", () => {
  it("picked from the list is shown with its own notes, and offers the way back to live", async () => {
    await show("coach");
    pickListed(1);
    onShow(QUESTION_ONE);
    expect(askedLabel().textContent).toMatch(/^Q1 · Asked · \d+:\d\d/);
    expect(notesPane()).not.toHaveTextContent("Live · ");
    expect(notesPane()).not.toHaveTextContent("Previous question · ");
    expect(notesPane()).not.toHaveTextContent("Following live");
    expect(blocks()).toHaveLength(1);
    expect(metaOf(blocks()[0])).toContain("Name the criteria");
    expect(linesOf(blocks()[0])).toEqual([
      "Team boundary",
      "Independent scaling",
    ]);
    expect(notesPane()).not.toHaveTextContent("Outbox");
    const back = screen.getByTestId("pn-coach-live");
    expect(back).toHaveTextContent("Back to live");
    // The list shows which is on show; the live one is still marked live.
    expect(question(1)).toHaveAttribute("aria-current", "true");
    expect(question(2)).not.toHaveAttribute("aria-current");
    expect(rows().map(isLive)).toEqual([true, false]);

    fireEvent.click(back);
    onShow(QUESTION_TWO, ASK_TWO);
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
    expect(notesPane()).toHaveTextContent("Following live");
  });

  it("is marked in the list's blue, never the live green", async () => {
    await show("coach");
    expect(askedLine()).toHaveAttribute("data-tone", "ask");
    pickListed(1);
    expect(askedLine()).toHaveAttribute("data-tone", "accent");
  });

  it("picking the live question from the list is following it again", async () => {
    await show("conversation");
    pickListed(1);
    expect(screen.getByTestId("pn-coach-live")).toBeInTheDocument();
    pickListed(2);
    onShow(QUESTION_TWO, ASK_TWO);
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
  });

  it("stays on show when a new question is asked, with the way back to the new one", async () => {
    const drawn = await show("coach");
    pickListed(1);
    const NEXT = "Tell me about a project you are proud of.";
    drawn.rerender(
      <CoachLayout
        s={session(
          heardSoFar([
            transcript(150, NEXT, { sourceId: "application-audio-r1" }),
          ]),
        )}
        view="coach"
      />,
    );
    await settle();
    onShow(QUESTION_ONE);
    expect(screen.queryByTestId("pn-coach-waiting")).toBeNull();
    fireEvent.click(screen.getByTestId("pn-coach-live"));
    // The new one has no notes yet: it is named above the last notes.
    expect(screen.getByTestId("pn-coach-waiting")).toHaveTextContent(NEXT);
    onShow(QUESTION_TWO, ASK_TWO);
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
  });

  it("is reached with the previous and next buttons where there is no list (the prompter)", async () => {
    await show("prompter");
    const previous = screen.getByRole("button", { name: "Previous question" });
    const next = screen.getByRole("button", { name: "Next question" });
    expect(next).toBeDisabled();
    expect(previous).toBeEnabled();
    fireEvent.click(previous);
    onShow(QUESTION_ONE);
    expect(screen.getByTestId("pn-coach-live")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous question" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    onShow(QUESTION_TWO, ASK_TWO);
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
  });

  it("opens in a pane of its own, so it is read from its top", async () => {
    await show("coach");
    const before = notesPane();
    pickListed(1);
    expect(notesPane()).not.toBe(before);
    expect(before).not.toBeInTheDocument();
    // A note for the question on show is added to the pane that is there.
    const shown = notesPane();
    post(note(3, 90, { title: "Add the team-size point" }));
    await poll();
    expect(notesPane()).toBe(shown);
  });
});

describe("how a note is drawn", () => {
  it("a note to say is the library's cue card under its quiet line; a note to watch is all caution", async () => {
    post(
      note(3, 80, {
        title: "Do not promise exactly-once",
        tone: "watch",
        points: ["Say at-least-once with idempotent consumers"],
        askId: "q-consistency",
      }),
    );
    await show("coach");
    const [say, watch] = blocks();
    expect(blocks()).toHaveLength(2);
    for (const block of blocks())
      expect(block).toHaveAttribute("data-slot", "cue-card");
    expect(metaOf(say)).toContain("Name the techniques");
    expect(metaOf(watch)).toContain("Do not promise exactly-once");
    expect(linesOf(watch)).toEqual([
      "Say at-least-once with idempotent consumers",
    ]);
    expect(sectionsOf(say)).toEqual(["say"]);
    expect(sectionsOf(watch)).toEqual(["caution"]);
  });

  it("in a panel, a note that says who asked names them in its quiet line, after its kind", async () => {
    post(
      note(3, 80, {
        title: "Then the Saga",
        kind: "technical",
        from: "Marcus",
        askId: "q-consistency",
      }),
    );
    await show("coach");
    const [plain, asked] = blocks();
    expect(metaOf(asked)).toMatch(/^Technical · from Marcus · \d/);
    expect(metaOf(asked)).toContain("Then the Saga");
    // A note that names nobody reads as it always has: kind, then the time.
    expect(metaOf(plain)).toMatch(/^Answer · \d/);
    expect(metaOf(plain)).not.toContain("from");
  });

  it("a follow-up that names the question is added beneath the earlier note, never in its place", async () => {
    await show("coach");
    expect(blocks()).toHaveLength(1);
    post(
      note(3, 80, { title: "Then the Saga", askId: "q-consistency" }),
      note(4, 85, { title: "Pace", tone: "watch", askId: "q-consistency" }),
    );
    await poll();
    expect(blocks().map(metaOf)).toEqual([
      expect.stringContaining("Name the techniques"),
      expect.stringContaining("Then the Saga"),
      expect.stringContaining("Pace"),
    ]);
  });

  it("a follow-up for an earlier question goes under that question, not the one on the table", async () => {
    posted = [{ ...FIRST, askId: "q-service" }, SECOND];
    await show("coach");
    post(note(3, 90, { title: "Add the team-size point", askId: "q-service" }));
    await poll();
    expect(blocks()).toHaveLength(1);
    expect(metaOfRow(question(1))).toMatch(/ · 2 notes$/);
    pickListed(1);
    expect(blocks().map(metaOf)).toEqual([
      expect.stringContaining("Name the criteria"),
      expect.stringContaining("Add the team-size point"),
    ]);
  });

  it("a poll that brings nothing new changes nothing", async () => {
    await show("coach");
    const [before] = blocks();
    await poll();
    await poll();
    expect(blocks()).toEqual([before]);
  });
});

describe("how large the notes read", () => {
  const control = () => screen.getByTestId("pn-coach-text-size");
  const option = (name: string) =>
    within(control()).getByRole("radio", { name });
  const chosen = () =>
    within(control())
      .getAllByRole("radio")
      .filter((each) => each.getAttribute("aria-checked") === "true")
      .map((each) => each.textContent);

  it.each(["coach", "conversation", "prompter"] as const)(
    "%s: the notes pane offers four sizes, S to XL, and opens on large",
    async (view) => {
      await show(view);
      expect(notesPane()).toContainElement(control());
      expect(
        within(control())
          .getAllByRole("radio")
          .map((each) => [each.textContent, each.getAttribute("aria-label")]),
      ).toEqual([
        ["S", "Small text"],
        ["M", "Medium text"],
        ["L", "Large text"],
        ["XL", "Extra large text"],
      ]);
      expect(chosen()).toEqual(["L"]);
      expect(blocks()[0]).toHaveAttribute("data-size", "lg");
      expect(askedLine()).toHaveAttribute("data-size", "lg");
    },
  );

  it("the size chosen is every note's, the question's and the follow-ups', and is kept", async () => {
    post(note(3, 80, { title: "Then the Saga", askId: "q-consistency" }));
    await show("coach");
    act(() => setCoachTextSize("xl"));
    expect(chosen()).toEqual(["XL"]);
    expect(blocks()).toHaveLength(2);
    for (const block of blocks())
      expect(block).toHaveAttribute("data-size", "xl");
    expect(askedLine()).toHaveAttribute("data-size", "xl");
    expect(window.localStorage.getItem(TEXT_KEY)).toBe("xl");
  });

  it("the box for a question that waits takes the size too", async () => {
    await show(
      "coach",
      session(
        heardSoFar([
          transcript(150, "Tell me about a project you are proud of.", {
            sourceId: "application-audio-r1",
          }),
        ]),
      ),
    );
    act(() => setCoachTextSize("sm"));
    expect(screen.getByTestId("pn-coach-waiting")).toHaveAttribute(
      "data-size",
      "sm",
    );
  });

  it("a size kept from an earlier session is the one the control shows", async () => {
    act(() => setCoachTextSize("md"));
    await show("prompter");
    expect(chosen()).toEqual(["M"]);
    expect(blocks()[0]).toHaveAttribute("data-size", "md");
    expect(option("Medium text")).toHaveAttribute("aria-checked", "true");
  });

  it("the Default layout leaves the size as chosen", async () => {
    await show("coach");
    act(() => setCoachTextSize("xl"));
    resetLayout();
    expect(chosen()).toEqual(["XL"]);
    expect(blocks()[0]).toHaveAttribute("data-size", "xl");
  });
});

describe("the right column of the coach view", () => {
  const tab = (id: "answer" | "transcript" | "code" | "context") =>
    screen.getByTestId(`pn-coach-tab-${id}`);
  // The library's tabs take a press, not a bare click event.
  const openTab = (id: Parameters<typeof tab>[0]) =>
    fireEvent.mouseDown(tab(id), { button: 0, ctrlKey: false });
  const selected = () =>
    screen
      .getAllByRole("tab")
      .filter((each) => each.getAttribute("aria-selected") === "true")
      .map((each) => each.textContent);
  const panel = () => screen.getByRole("tabpanel");
  // Every tab panel, open or not (a closed one is hidden from roles).
  const panels = () => [
    ...document.querySelectorAll<HTMLElement>('[role="tabpanel"]'),
  ];

  it("opens on the answer, and draws one pane at a time", async () => {
    await show("coach");
    expect(selected()).toEqual(["Answer"]);
    expect(within(panel()).getByTestId("pane-answer")).toBeInTheDocument();
    expect(screen.queryByTestId("pn-chat")).toBeNull();
    expect(screen.queryByTestId("pane-code")).toBeNull();
  });

  it("the tab bar is a surface of its own, so the see-through window gives it the mouse", async () => {
    await show("coach");
    expect(screen.getByRole("tablist")).toHaveAttribute("data-hit-surface");
  });

  it("only the open panel is laid out, and it draws no box of its own; the closed ones stay hidden", async () => {
    await show("coach");
    const laidOut = () =>
      panels().map((each) => [
        each.getAttribute("aria-labelledby") === tabId(),
        each.hidden,
        each.style.display,
      ]);
    const tabId = () =>
      screen
        .getAllByRole("tab")
        .find((each) => each.getAttribute("aria-selected") === "true")?.id;
    expect(panels()).toHaveLength(4);
    expect(laidOut()).toEqual([
      [true, false, "flex"],
      [false, true, ""],
      [false, true, ""],
      [false, true, ""],
    ]);
    const open = panel();
    expect(open.style.background).toBe("transparent");
    expect(open.style.boxShadow).toBe("none");
    openTab("code");
    expect(laidOut()).toEqual([
      [false, true, ""],
      [false, true, ""],
      [true, false, "flex"],
      [false, true, ""],
    ]);
    // The answer's panel was given its layout back to the library.
    expect(panels()[0]?.style.background).toBe("");
    expect(panels()[0]?.style.display).toBe("");
  });

  it("the Transcript tab shows the transcript and its message box in the answer's place", async () => {
    await show("coach");
    openTab("transcript");
    expect(selected()).toEqual(["Transcript"]);
    expect(within(panel()).getByTestId("pn-chat")).toBeInTheDocument();
    expect(within(panel()).getByLabelText("Message")).toBeInTheDocument();
    expect(
      within(panel()).getByLabelText("Transcript and chat"),
    ).toHaveTextContent(QUESTION_TWO);
    expect(screen.queryByTestId("pane-answer")).toBeNull();
    expect(screen.queryByTestId("pane-code")).toBeNull();
  });

  it("the Code tab shows the code pane, and Answer brings the answer back", async () => {
    await show("coach");
    openTab("code");
    expect(selected()).toEqual(["Code"]);
    expect(within(panel()).getByTestId("pane-code")).toBeInTheDocument();
    expect(screen.queryByTestId("pn-chat")).toBeNull();
    expect(screen.queryByTestId("pane-answer")).toBeNull();
    openTab("answer");
    expect(selected()).toEqual(["Answer"]);
    expect(within(panel()).getByTestId("pane-answer")).toBeInTheDocument();
    expect(screen.queryByTestId("pane-code")).toBeNull();
  });

  it("the Context tab shows what the answers are built from, in the answer's place", async () => {
    await show("coach");
    expect(screen.queryByTestId("pane-context")).toBeNull();
    openTab("context");
    expect(selected()).toEqual(["Context"]);
    expect(within(panel()).getByTestId("pane-context")).toBeInTheDocument();
    expect(screen.queryByTestId("pane-answer")).toBeNull();
    expect(screen.queryByTestId("pn-chat")).toBeNull();
    expect(screen.queryByTestId("pane-code")).toBeNull();
    openTab("answer");
    expect(screen.queryByTestId("pane-context")).toBeNull();
  });

  it("the Context tab is given the notes of the question on show, and follows it", async () => {
    post(note(3, 80, { title: "Then the Saga", askId: "q-consistency" }));
    await show("coach");
    openTab("context");
    const given = () =>
      screen.getByTestId("pane-context").getAttribute("data-notes");
    expect(given()).toBe("Name the techniques | Then the Saga");
    pickListed(1);
    expect(given()).toBe("Name the criteria");
    fireEvent.click(screen.getByTestId("pn-coach-live"));
    expect(given()).toBe("Name the techniques | Then the Saga");
  });

  it("the Context tab is given no notes before anything is asked", async () => {
    posted = [];
    await show("coach", session([]));
    openTab("context");
    expect(screen.getByTestId("pane-context")).toHaveAttribute(
      "data-notes",
      "",
    );
  });

  it("the Context tab is given the question on show as it was asked, and follows it", async () => {
    await show("coach");
    openTab("context");
    const asked = () =>
      screen.getByTestId("pane-context").getAttribute("data-question");
    // What was heard, whole: not the coach's few words for it.
    expect(asked()).toBe(QUESTION_TWO);
    pickListed(1);
    expect(asked()).toBe(QUESTION_ONE);
    fireEvent.click(screen.getByTestId("pn-coach-live"));
    expect(asked()).toBe(QUESTION_TWO);
  });

  it("the Context tab is given an empty question before anything is asked", async () => {
    posted = [];
    await show("coach", session([]));
    openTab("context");
    expect(screen.getByTestId("pane-context")).toHaveAttribute(
      "data-question",
      "",
    );
  });

  it("there is no Context tab outside the coach view", async () => {
    await show("conversation");
    expect(screen.queryByTestId("pn-coach-tab-context")).toBeNull();
    cleanup();
    await show("prompter");
    expect(screen.queryByTestId("pn-coach-tab-context")).toBeNull();
  });

  it("switching tabs leaves the question on show and its notes alone", async () => {
    await show("coach");
    pickListed(1);
    openTab("transcript");
    openTab("code");
    onShow(QUESTION_ONE);
    expect(metaOf(blocks()[0])).toContain("Name the criteria");
    expect(screen.getByTestId("pn-coach-live")).toBeInTheDocument();
  });

  it("picking a question leaves the open tab open", async () => {
    await show("coach");
    openTab("transcript");
    pickListed(1);
    expect(selected()).toEqual(["Transcript"]);
  });
});

describe("a note named as its question", () => {
  it("does not repeat its title above the note: the question is said once", async () => {
    post(
      note(3, 80, {
        title: ASK_TWO,
        points: ["Start from the Outbox"],
        askId: "q-consistency",
      }),
    );
    await show("coach");
    expect(blocks()).toHaveLength(2);
    expect(linesOf(blocks()[1])).toEqual(["Start from the Outbox"]);
    expect(metaOf(blocks()[1])).toMatch(/^Answer · [^·]+$/);
    expect(blocks()[1]).not.toHaveTextContent(ASK_TWO);
    expect(within(notesPane()).getAllByText(ASK_TWO)).toEqual([asked()]);
    // Any other title is still said above its note.
    expect(metaOf(blocks()[0])).toMatch(
      /^Answer · [^·]+ · Name the techniques$/,
    );
  });

  it("the question it is compared with is the one in the heading (the coach's words), not what was heard beneath it", async () => {
    post(
      note(3, 80, {
        title: QUESTION_TWO,
        points: ["Start from the Outbox"],
        askId: "q-consistency",
      }),
    );
    await show("coach");
    expect(metaOf(blocks()[1])).toContain(` · ${QUESTION_TWO}`);
  });

  it("a warning named as its question does not repeat it either", async () => {
    post(
      note(3, 80, {
        title: ASK_TWO,
        tone: "watch",
        points: ["Do not promise exactly-once"],
        askId: "q-consistency",
      }),
    );
    await show("coach");
    expect(metaOf(blocks()[1])).toMatch(/^Answer · [^·]+$/);
    expect(sectionsOf(blocks()[1])).toEqual(["caution"]);
  });
});

describe("a note under the call", () => {
  const add = async (
    extra: Partial<CoachNote>,
    view: "coach" | "conversation" | "prompter" = "coach",
  ) => {
    post(
      note(3, 80, { title: "Then the Saga", askId: "q-consistency", ...extra }),
    );
    await show(view);
    return blocks()[1] as HTMLElement;
  };
  const line = (
    ...segments: CoachNote["sections"][number]["lines"][number]["segments"]
  ) => ({
    segments,
  });
  const spoken = (text: string) => line({ text, role: "spoken" });

  it("is drawn as talking points: one line to a whole sentence, its quotation marks dropped", async () => {
    const block = await add({
      markdown:
        "Each step has its own undo. “Say the words compensating action.”",
    });
    expect(sectionsOf(block)).toEqual(["say"]);
    expect(linesOf(block)).toEqual([
      "Each step has its own undo.",
      "Say the words compensating action.",
    ]);
  });

  it("a structured note is its sections: each under its kind's label or its own, with the evidence marked", async () => {
    const block = await add({
      sections: [
        {
          kind: "say",
          lines: [
            line(
              { text: "Each step has its own ", role: "spoken" },
              { text: "undo", role: "evidence" },
            ),
          ],
        },
        {
          kind: "say",
          label: "If pushed",
          lines: [spoken("Name the orchestrator")],
        },
        { kind: "caution", lines: [spoken("That covers reads only")] },
      ],
    });
    expect(sectionsOf(block)).toEqual(["say", "say", "caution"]);
    expect(
      [
        ...block.querySelectorAll(
          '[data-kind="say"] [data-slot="cue-card-label"]',
        ),
      ].map((label) => label.textContent),
    ).toEqual(["Say this", "If pushed"]);
    expect(linesOf(block)).toEqual([
      "Each step has its own undo",
      "Name the orchestrator",
      "That covers reads only",
    ]);
    expect(
      [...block.querySelectorAll('[data-role="evidence"]')].map(
        (piece) => piece.textContent,
      ),
    ).toEqual(["undo"]);
    // The steer box and the "she wants" line are gone: a caution section says it.
    expect(within(block).queryByTestId("pn-coach-steer")).toBeNull();
    expect(block).not.toHaveTextContent("She wants");
  });

  it.each([
    ["direct-answer", "Answer"],
    ["technical", "Technical"],
    ["behavioral", "Behavioural"],
    ["closing", "Closing"],
    ["follow-up", "Follow-up"],
    ["missed-opportunity", "Missed opportunity"],
  ] as const)(
    "a %s note says so over the note, with its time and its title: %s",
    async (kind, label) => {
      const block = await add({ kind, points: ["Start from the Outbox"] });
      expect(block).toHaveAttribute("data-kind", kind);
      expect(metaOf(block)).toMatch(
        new RegExp(`^${label} · \\d+:\\d\\d[^·]* · Then the Saga$`),
      );
    },
  );

  const FULL: Partial<CoachNote> = {
    sections: [
      { kind: "say", lines: [spoken("Each step has its own undo")] },
      {
        kind: "anchors",
        lines: ["One", "Two", "Three", "Four", "Five"].map((text) =>
          spoken(`Anchor ${text}`),
        ),
      },
      { kind: "ask", lines: [spoken("Which failure worries you most?")] },
      { kind: "context", lines: [spoken("She is probing for trade-offs")] },
    ],
    links: [{ label: "Saga reference", url: "https://example.com/saga" }],
  };

  it.each(["coach", "conversation"] as const)(
    "%s: the note is drawn in full",
    async (view) => {
      const block = await add(FULL, view);
      expect(block).toHaveAttribute("data-mode", "detail");
      expect(sectionsOf(block)).toEqual(["say", "anchors", "ask", "context"]);
      expect(block).toHaveTextContent("Anchor Five");
      expect(within(block).getByTestId("pn-coach-link")).toHaveTextContent(
        "Saga reference",
      );
    },
  );

  it("prompter: the note is the compact one: the response and three anchors, nothing to read, no links", async () => {
    const block = await add(FULL, "prompter");
    expect(block).toHaveAttribute("data-mode", "compact");
    expect(sectionsOf(block)).toEqual(["say", "anchors"]);
    expect(block).toHaveTextContent("Anchor Three");
    expect(block).not.toHaveTextContent("Anchor Four");
    expect(block).not.toHaveTextContent("Which failure worries you most?");
    expect(block).not.toHaveTextContent("She is probing");
    expect(within(block).queryByTestId("pn-coach-link")).toBeNull();
    // The line over the note is the same in both.
    expect(metaOf(block)).toMatch(/^Answer · [^·]+ · Then the Saga$/);
  });

  it("a revision being prepared keeps what is on show and says it is updating", async () => {
    const block = await add({
      status: "pending",
      sections: [
        { kind: "say", lines: [spoken("Each step has its own undo")] },
      ],
    });
    expect(block).toHaveAttribute("data-status", "pending");
    expect(linesOf(block)).toEqual(["Each step has its own undo"]);
    expect(within(block).getByRole("status")).toHaveTextContent(/^Updating…$/);
  });

  it.each([
    ["in another case", ASK_TWO.toUpperCase()],
    ["after a leading Q:", `Q: ${ASK_TWO}`],
    ["after a leading q: and with space round it", `q:  ${ASK_TWO} `],
  ])(
    "a title that is the question %s is not repeated above the note",
    async (_name, title) => {
      const block = await add({ title, points: ["Start from the Outbox"] });
      expect(metaOf(block)).toMatch(/^Answer · [^·]+$/);
      expect(linesOf(block)).toEqual(["Start from the Outbox"]);
    },
  );

  it("a title that only starts like the question is still said", async () => {
    const block = await add({
      title: `${ASK_TWO} (part two)`,
      points: ["Start from the Outbox"],
    });
    expect(metaOf(block)).toMatch(
      / · Data consistency across services \(part two\)$/,
    );
  });
});

describe("the question on show: the coach's few words, and what was said beneath", () => {
  const strong = (element: Element | null) =>
    [...(element?.querySelectorAll("span") ?? [])]
      .filter((piece) => piece.className.includes("font-medium"))
      .map((piece) => piece.textContent);

  it("shows the coach's restatement as the line's title, and what was heard beneath it, cut to two lines with the whole of it on hover", async () => {
    await show("coach");
    expect(askedLine()).toHaveAttribute("data-slot", "heard-line");
    expect(asked().textContent).toBe(ASK_TWO);
    expect(heard()?.textContent).toBe(QUESTION_TWO);
    expect(heard()).toHaveAttribute("title", QUESTION_TWO);
    expect(follows(askedLabel(), asked())).toBe(true);
    expect(follows(asked(), heard() as HTMLElement)).toBe(true);
    // Cut to two lines: it places the question, it is not read.
    expect(heard()?.style.getPropertyValue("-webkit-line-clamp")).toBe("2");
    expect(asked().style.getPropertyValue("-webkit-line-clamp")).toBe("");
  });

  it("lifts the words that carry what was heard, and leaves the rest quiet", async () => {
    await show("coach");
    expect(
      [...(heard()?.querySelectorAll("span") ?? [])].map(
        (piece) => piece.textContent,
      ),
    ).toEqual([
      "How do you ",
      "handle ",
      "data ",
      "consistency between multiple services?",
    ]);
    expect(strong(heard())).toEqual([
      "handle ",
      "consistency between multiple services?",
    ]);
    // The title is plain: one run of text, nothing lifted.
    expect(asked().querySelector("span")).toBeNull();
  });

  it("with no restatement the heading is what was heard, cut to 60 characters, and the whole is beneath", async () => {
    await show("coach");
    pickListed(1);
    expect(asked().textContent).toBe(
      "How do you decide when a feature should be its own microserv…",
    );
    expect(heard()?.textContent).toBe(QUESTION_ONE);
  });

  it("a short question with no restatement is said once: nothing beneath it", async () => {
    posted = [];
    await show(
      "coach",
      session([
        transcript(2, "Why did you leave your last role?", {
          sourceId: "application-audio-r1",
        }),
      ]),
    );
    expect(asked().textContent).toBe("Why did you leave your last role?");
    expect(heard()).toBeNull();
  });

  it("a restatement that is exactly what was heard is said once too", async () => {
    const SAID = "Why did you leave your last role?";
    posted = [note(1, 10, { ask: SAID })];
    await show(
      "coach",
      session([transcript(2, SAID, { sourceId: "application-audio-r1" })]),
    );
    expect(asked().textContent).toBe(SAID);
    expect(heard()).toBeNull();
  });

  it("the header over the pane names the question by its number and the same few words", async () => {
    await show("coach");
    const subtitle = () => slot(notesPane(), "panel-subtitle")?.textContent;
    expect(subtitle()).toBe(`Q2 · ${ASK_TWO}`);
    pickListed(1);
    expect(subtitle()).toBe(`Q1 · ${cut(QUESTION_ONE)}`);
  });

  it("the line under it carries the same number as its row in the list", async () => {
    await show("coach");
    expect(askedLabel().textContent).toMatch(/^Q2 · /);
    expect(
      numberOf(
        rows().find((each) => each.hasAttribute("aria-current")) as HTMLElement,
      ),
    ).toBe("2");
    pickListed(1);
    expect(askedLabel().textContent).toMatch(/^Q1 · /);
    expect(
      numberOf(
        rows().find((each) => each.hasAttribute("aria-current")) as HTMLElement,
      ),
    ).toBe("1");
  });
});

describe("the bars that resize the columns", () => {
  const bar = (panel: "questions" | "side") =>
    document.querySelector<HTMLElement>(
      `[data-slot="splitter-handle"][data-panel="${panel}"]`,
    ) as HTMLElement;
  const column = (panel: "questions" | "main" | "side") =>
    document.querySelector<HTMLElement>(
      `[data-slot="splitter-panel"][data-panel="${panel}"]`,
    ) as HTMLElement;
  const widths = () =>
    (["questions", "side"] as const).map((panel) =>
      Number(bar(panel).getAttribute("aria-valuenow")),
    );

  it.each(["coach", "conversation"] as const)(
    "%s: a bar stands between the questions and the centre, and between the centre and the right column",
    async (view) => {
      await show(view);
      const row = [...(column("main").parentElement?.children ?? [])];
      expect(
        row.map(
          (each) =>
            `${each.getAttribute("data-slot")}:${each.getAttribute("data-panel") ?? each.getAttribute("data-edge")}`,
        ),
      ).toEqual([
        "splitter-edge:start",
        "splitter-panel:questions",
        "splitter-handle:questions",
        "splitter-panel:main",
        "splitter-handle:side",
        "splitter-panel:side",
        "splitter-edge:end",
      ]);
      expect(column("questions")).toContainElement(
        screen.getByTestId("pn-coach-questions"),
      );
      expect(column("main")).toContainElement(notesPane());
      expect(column("main")).toContainElement(
        screen.getByTestId("pn-call-slot"),
      );
      expect(column("side")).toContainElement(
        view === "coach"
          ? screen.getByRole("tablist")
          : screen.getByTestId("pn-chat"),
      );
      expect(bar("questions")).toHaveAccessibleName("Resize the questions");
      expect(bar("side")).toHaveAccessibleName("Resize the answer");
      // The side columns open 250 and 400 px wide; the centre takes the rest.
      expect(widths()).toEqual([250, 400]);
      expect(column("questions")).toHaveStyle({ flex: "0 0 250px" });
      expect(column("side")).toHaveStyle({ flex: "0 0 400px" });
    },
  );

  it("each bar is a vertical separator that says its column's width and its floor, and takes the mouse and the keyboard", async () => {
    await show("coach");
    for (const panel of ["questions", "side"] as const) {
      expect(bar(panel)).toHaveAttribute("role", "separator");
      expect(bar(panel)).toHaveAttribute("aria-orientation", "vertical");
      expect(bar(panel)).toHaveAttribute("tabindex", "0");
      expect(bar(panel)).toHaveAttribute("data-hit-surface");
    }
    // A side column is never folded away: each has a floor it stays readable at.
    expect(bar("questions")).toHaveAttribute(
      "aria-valuemin",
      String(QUESTIONS_FLOOR),
    );
    expect(bar("side")).toHaveAttribute("aria-valuemin", String(SIDE_FLOOR));
    // The questions are never wider than 360 px.
    expect(bar("questions")).toHaveAttribute("aria-valuemax", "360");
  });

  it("the centre is never narrower than the toolbar above it: 560 px where there is none to measure, the toolbar's own width where there is", async () => {
    const drawn = await show("coach");
    expect(column("main").style.minWidth).toBe(`${TOOLBAR_FALLBACK}px`);
    drawn.unmount();
    const pill = document.createElement("div");
    pill.className = "pn-toolbar";
    Object.defineProperty(pill, "offsetWidth", {
      configurable: true,
      value: 640,
    });
    document.body.append(pill);
    try {
      await show("conversation");
      expect(column("main").style.minWidth).toBe("640px");
    } finally {
      pill.remove();
    }
  });

  it("nothing is kept until a column is resized", async () => {
    await show("coach");
    expect(window.localStorage.getItem(SIZES_KEY)).toBeNull();
  });

  it("the arrows on the questions' bar widen and narrow them 24 px a press, Home takes them to their 180 px floor and End to 360 px", async () => {
    await show("coach");
    fireEvent.keyDown(bar("questions"), { key: "ArrowRight" });
    expect(widths()).toEqual([274, 400]);
    expect(column("questions")).toHaveStyle({ flex: "0 0 274px" });
    expect(keptSizes()).toMatchObject({ questions: 274 });
    fireEvent.keyDown(bar("questions"), { key: "ArrowLeft" });
    fireEvent.keyDown(bar("questions"), { key: "ArrowLeft" });
    expect(widths()).toEqual([226, 400]);
    fireEvent.keyDown(bar("questions"), { key: "Home" });
    expect(widths()).toEqual([QUESTIONS_FLOOR, 400]);
    expect(keptSizes()).toMatchObject({ questions: QUESTIONS_FLOOR });
    fireEvent.keyDown(bar("questions"), { key: "End" });
    expect(widths()).toEqual([360, 400]);
  });

  it("on the right bar the arrows are mirrored: the bar moves the way the arrow points", async () => {
    await show("coach");
    fireEvent.keyDown(bar("side"), { key: "ArrowRight" });
    expect(widths()).toEqual([250, 376]);
    expect(keptSizes()).toMatchObject({ side: 376 });
    fireEvent.keyDown(bar("side"), { key: "ArrowLeft" });
    expect(widths()).toEqual([250, 400]);
    // Home is the right column's floor: it is never folded away either.
    fireEvent.keyDown(bar("side"), { key: "Home" });
    expect(widths()[1]).toBe(SIDE_FLOOR);
  });

  it("a width kept from before the columns had a floor is lifted to it", async () => {
    window.localStorage.setItem(
      SIZES_KEY,
      JSON.stringify({ questions: 0, side: 120, call: 0 }),
    );
    await show("coach");
    expect(widths()).toEqual([QUESTIONS_FLOOR, SIDE_FLOOR]);
    expect(column("questions")).toHaveStyle({
      flex: `0 0 ${QUESTIONS_FLOOR}px`,
    });
    expect(column("side")).toHaveStyle({ flex: `0 0 ${SIDE_FLOOR}px` });
    // The call's room has no floor: folded away stays folded.
    expect(screen.getByTestId("pn-call-slot")).toHaveStyle({ flex: "0 0 0px" });
  });

  it("a kept width at or above its floor is used as kept", async () => {
    window.localStorage.setItem(
      SIZES_KEY,
      JSON.stringify({ questions: QUESTIONS_FLOOR, side: SIDE_FLOOR + 1 }),
    );
    await show("conversation");
    expect(widths()).toEqual([QUESTIONS_FLOOR, SIDE_FLOOR + 1]);
  });

  it("a bar takes the keys it uses and leaves every other key alone", async () => {
    await show("coach");
    expect(fireEvent.keyDown(bar("questions"), { key: "ArrowRight" })).toBe(
      false,
    );
    const before = widths();
    expect(fireEvent.keyDown(bar("questions"), { key: "x" })).toBe(true);
    expect(fireEvent.keyDown(bar("questions"), { key: "Tab" })).toBe(true);
    expect(widths()).toEqual(before);
  });

  it("dragging a bar: the column follows the pointer from where the drag began, and the width is kept", async () => {
    await show("coach");
    pointer(bar("questions"), "down", { x: 250 });
    pointer(bar("questions"), "move", { x: 200 });
    expect(widths()).toEqual([200, 400]);
    pointer(bar("questions"), "move", { x: 230 });
    expect(widths()).toEqual([230, 400]);
    pointer(bar("questions"), "up", { x: 230 });
    expect(keptSizes()).toMatchObject({ questions: 230 });
    expect(column("questions")).toHaveStyle({ flex: "0 0 230px" });
  });

  it("a pointer that only passes over a bar does nothing", async () => {
    await show("coach");
    pointer(bar("questions"), "move", { x: 100 });
    expect(widths()).toEqual([250, 400]);
    pointer(bar("questions"), "down", { x: 250 });
    pointer(bar("questions"), "up", { x: 250 });
    pointer(bar("questions"), "move", { x: 100 });
    expect(widths()).toEqual([250, 400]);
    expect(held()).toBe(false);
  });

  it.each([
    ["questions", "up"],
    ["questions", "cancel"],
    ["side", "up"],
    ["side", "cancel"],
  ] as const)(
    "the %s bar tells the shell not to move the window while it is held, until pointer %s",
    async (panel, end) => {
      await show("coach");
      expect(held()).toBe(false);
      pointer(bar(panel), "down", { x: 300 });
      expect(held()).toBe(true);
      pointer(bar(panel), "move", { x: 320 });
      expect(held()).toBe(true);
      pointer(bar(panel), end, { x: 320 });
      expect(held()).toBe(false);
    },
  );

  it("the keys and a double click never hold the window", async () => {
    await show("coach");
    fireEvent.keyDown(bar("questions"), { key: "ArrowRight" });
    expect(held()).toBe(false);
    fireEvent.doubleClick(bar("side"));
    expect(held()).toBe(false);
  });

  it("a column takes the width kept from an earlier session", async () => {
    window.localStorage.setItem(
      SIZES_KEY,
      JSON.stringify({ questions: 200, side: 520 }),
    );
    await show("conversation");
    expect(widths()).toEqual([200, 520]);
    expect(column("questions")).toHaveStyle({ flex: "0 0 200px" });
    expect(column("side")).toHaveStyle({ flex: "0 0 520px" });
  });

  it("a double click on a bar puts that column back and leaves the other", async () => {
    window.localStorage.setItem(
      SIZES_KEY,
      JSON.stringify({ questions: 200, side: 520 }),
    );
    await show("coach");
    fireEvent.doubleClick(bar("side"));
    expect(widths()).toEqual([200, 400]);
    expect(column("side")).toHaveStyle({ flex: "0 0 400px" });
    expect(keptSizes()).toMatchObject({ questions: 200, side: 400 });
  });

  it("prompter: no columns to resize, only the window's own edges around the centre", async () => {
    await show("prompter");
    expect(
      document.querySelector(
        '[data-slot="splitter-handle"][data-panel="questions"]',
      ),
    ).toBeNull();
    expect(
      document.querySelector(
        '[data-slot="splitter-handle"][data-panel="side"]',
      ),
    ).toBeNull();
    const row = [...(column("main").parentElement?.children ?? [])];
    expect(row.map((each) => each.getAttribute("data-slot"))).toEqual([
      "splitter-edge",
      "splitter-panel",
      "splitter-edge",
    ]);
    expect(column("main")).toContainElement(notesPane());
    // With no column beside it, the centre has no floor of its own.
    expect(column("main").style.minWidth).toMatch(/^0(px)?$/);
  });
});

describe("the window's own edges", () => {
  const edge = (side: "left" | "right" | "bottom") =>
    screen.getByRole("separator", { name: `Resize from the ${side} edge` });
  const width = () => window.localStorage.getItem(WIDTH_KEY);
  const height = () => window.localStorage.getItem(HEIGHT_KEY);

  it.each(["coach", "conversation", "prompter"] as const)(
    "%s: the left and right edges are the first and last thing in the row of columns, and the bottom edge is the last thing in the layout",
    async (view) => {
      await show(view);
      const row = edge("left").parentElement as HTMLElement;
      expect(row.firstElementChild).toBe(edge("left"));
      expect(row.lastElementChild).toBe(edge("right"));
      expect(follows(edge("left"), notesPane())).toBe(true);
      expect(follows(notesPane(), edge("right"))).toBe(true);
      expect(layout().lastElementChild).toBe(edge("bottom"));
      expect(layout().children).toHaveLength(2);
      expect(layout().firstElementChild).toContainElement(row);
      // The edges are part of the Splitters: the layout keeps no gap of its own.
      expect(layout().style.gap).toMatch(/^0(px)?$/);
    },
  );

  it("with columns at its sides the window is never narrower than they are at their least with the centre at the toolbar's width", async () => {
    await show("coach");
    const least =
      QUESTIONS_FLOOR + TOOLBAR_FALLBACK + SIDE_FLOOR + COLUMN_HANDLES;
    expect(least).toBe(1_072);
    for (const side of ["left", "right"] as const)
      expect(edge(side)).toHaveAttribute("aria-valuemin", String(least));
    pointer(edge("right"), "down", { x: 900 });
    pointer(edge("right"), "move", { x: 100 });
    pointer(edge("right"), "up", { x: 100 });
    expect(width()).toBe(String(least));
  });

  it("the side edges say the window's width between 480 px and the screen's, the bottom its height between 420 px and the screen's; each takes the mouse and the keyboard", async () => {
    await show("prompter");
    for (const side of ["left", "right"] as const) {
      expect(edge(side)).toHaveAttribute("aria-orientation", "vertical");
      expect(edge(side)).toHaveAttribute("aria-valuenow", "1000");
      expect(edge(side)).toHaveAttribute("aria-valuemin", "480");
      expect(edge(side)).toHaveAttribute("aria-valuemax", "1600");
    }
    expect(edge("left")).toHaveAttribute("data-edge", "start");
    expect(edge("right")).toHaveAttribute("data-edge", "end");
    expect(edge("bottom")).toHaveAttribute("data-edge", "end");
    expect(edge("bottom")).toHaveAttribute("aria-orientation", "horizontal");
    expect(edge("bottom")).toHaveAttribute("aria-valuenow", "768");
    expect(edge("bottom")).toHaveAttribute("aria-valuemin", "420");
    expect(edge("bottom")).toHaveAttribute("aria-valuemax", "1000");
    for (const side of ["left", "right", "bottom"] as const) {
      expect(edge(side)).toHaveAttribute("tabindex", "0");
      expect(edge(side)).toHaveAttribute("data-hit-surface");
    }
  });

  it("nothing is asked of the window until an edge is moved", async () => {
    await show("coach");
    expect(width()).toBeNull();
    expect(height()).toBeNull();
  });

  it.each([
    ["left", 100, 60, "1080"],
    ["left", 100, 150, "900"],
    ["right", 900, 940, "1080"],
    ["right", 900, 850, "900"],
  ] as const)(
    "dragging the %s edge from %i to %i asks for %s px: twice the distance, since the window grows about its centre",
    async (side, from, to, asked) => {
      await show("prompter");
      pointer(edge(side), "down", { x: from });
      pointer(edge(side), "move", { x: to });
      expect(width()).toBe(asked);
      pointer(edge(side), "up", { x: to });
      expect(width()).toBe(asked);
      expect(height()).toBeNull();
    },
  );

  it.each([
    [760, 800, "808"],
    [760, 700, "708"],
  ] as const)(
    "dragging the bottom edge from %i to %i asks for %s px: the bottom follows the pointer one for one",
    async (from, to, asked) => {
      await show("prompter");
      pointer(edge("bottom"), "down", { y: from });
      pointer(edge("bottom"), "move", { y: to });
      pointer(edge("bottom"), "up", { y: to });
      expect(height()).toBe(asked);
      expect(width()).toBeNull();
    },
  );

  it("a drag stops at 480 px wide and at the screen's width", async () => {
    await show("prompter");
    pointer(edge("right"), "down", { x: 900 });
    pointer(edge("right"), "move", { x: 100 });
    expect(width()).toBe("480");
    pointer(edge("right"), "move", { x: 5_000 });
    expect(width()).toBe("1600");
    pointer(edge("right"), "up", { x: 5_000 });
  });

  it("a drag stops at 420 px tall and at the screen's height", async () => {
    await show("coach");
    pointer(edge("bottom"), "down", { y: 760 });
    pointer(edge("bottom"), "move", { y: 0 });
    expect(height()).toBe("420");
    pointer(edge("bottom"), "move", { y: 5_000 });
    expect(height()).toBe("1000");
    pointer(edge("bottom"), "up", { y: 5_000 });
  });

  it.each([
    ["left", "up"],
    ["right", "cancel"],
    ["bottom", "up"],
    ["bottom", "cancel"],
  ] as const)(
    "the %s edge tells the shell not to move the window while it is held, until pointer %s",
    async (side, end) => {
      await show("coach");
      pointer(edge(side), "down", { x: 500, y: 500 });
      expect(held()).toBe(true);
      pointer(edge(side), "move", { x: 520, y: 520 });
      expect(held()).toBe(true);
      pointer(edge(side), end, { x: 520, y: 520 });
      expect(held()).toBe(false);
    },
  );

  it.each([
    ["left", "ArrowLeft", "1048"],
    ["left", "ArrowRight", "952"],
    ["right", "ArrowRight", "1048"],
    ["right", "ArrowLeft", "952"],
  ] as const)(
    "on the %s edge %s moves that edge 24 px, so the window is asked for %s px",
    async (side, key, asked) => {
      await show("prompter");
      fireEvent.keyDown(edge(side), { key });
      expect(width()).toBe(asked);
      expect(held()).toBe(false);
    },
  );

  it.each([
    ["ArrowDown", "792"],
    ["ArrowUp", "744"],
  ] as const)("on the bottom edge %s asks for %s px", async (key, asked) => {
    await show("coach");
    fireEvent.keyDown(edge("bottom"), { key });
    expect(height()).toBe(asked);
  });

  it("a double click on a side edge gives the window its own width back, and on the bottom edge its own height; each leaves the other", async () => {
    await show("coach");
    act(() => {
      setCoachWindowWidth(1_200);
      setCoachWindowHeight(800);
    });
    fireEvent.doubleClick(edge("left"));
    expect(width()).toBeNull();
    expect(height()).toBe("800");
    act(() => setCoachWindowWidth(1_200));
    fireEvent.doubleClick(edge("bottom"));
    expect(height()).toBeNull();
    expect(width()).toBe("1200");
    fireEvent.doubleClick(edge("right"));
    expect(width()).toBeNull();
  });

  it("moving an edge resizes no column and no room", async () => {
    await show("coach");
    pointer(edge("right"), "down", { x: 900 });
    pointer(edge("right"), "move", { x: 1_040 });
    pointer(edge("right"), "up", { x: 1_040 });
    expect(width()).toBe("1280");
    fireEvent.keyDown(edge("bottom"), { key: "ArrowDown" });
    expect(window.localStorage.getItem(SIZES_KEY)).toBeNull();
    expect(screen.getByTestId("pn-call-slot")).toHaveStyle({
      flex: "0 0 250px",
    });
  });
});

describe("the Layout menu", () => {
  const valueOf = (panel: string) =>
    Number(
      document
        .querySelector(`[data-slot="splitter-handle"][data-panel="${panel}"]`)
        ?.getAttribute("aria-valuenow"),
    );
  const values = () => ["questions", "side", "call"].map(valueOf);
  const window_ = () => [
    window.localStorage.getItem(WIDTH_KEY),
    window.localStorage.getItem(HEIGHT_KEY),
  ];

  it.each(["coach", "conversation", "prompter"] as const)(
    "%s: is a button in the notes' header, before the previous and next buttons, and is closed until pressed",
    async (view) => {
      await show(view);
      expect(notesPane()).toContainElement(layoutMenu());
      expect(layoutMenu().tagName).toBe("BUTTON");
      expect(layoutMenu()).toHaveAccessibleName("Layout");
      expect(layoutMenu()).toHaveAttribute("aria-haspopup", "menu");
      expect(layoutMenu()).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("menu")).toBeNull();
      expect(
        follows(
          layoutMenu(),
          screen.getByRole("button", { name: "Previous question" }),
        ),
      ).toBe(true);
      // The old reset button is gone: the menu's first row is the reset.
      expect(screen.queryByTestId("pn-coach-reset")).toBeNull();
    },
  );

  it("offers the layouts, each with what it does, in the order they are listed", async () => {
    await show("coach");
    openLayouts();
    expect(screen.getByRole("menu")).toHaveAccessibleName("Layout");
    const offered = screen.getAllByRole("menuitem");
    expect(offered.map((row) => row.getAttribute("data-item-id"))).toEqual([
      "default",
      "fill",
      "notes",
      "no-call",
    ]);
    expect(offered.map((row) => row.textContent)).toEqual(
      COACH_LAYOUTS.map((each) => `${each.label}${each.description}`),
    );
  });

  it("Default puts both columns and the call's room back, and the next session opens with them", async () => {
    window.localStorage.setItem(
      SIZES_KEY,
      JSON.stringify({ questions: 200, side: 520, call: 90 }),
    );
    await show("coach");
    expect(values()).toEqual([200, 520, 90]);
    resetLayout();
    expect(values()).toEqual([250, 400, 250]);
    expect(screen.getByTestId("pn-call-slot")).toHaveStyle({
      flex: "0 0 250px",
    });
    cleanup();
    await show("coach");
    expect(values()).toEqual([250, 400, 250]);
  });

  it("Default gives the window its own width and height back", async () => {
    await show("coach");
    act(() => {
      setCoachWindowWidth(1_200);
      setCoachWindowHeight(800);
    });
    expect(window_()).toEqual(["1200", "800"]);
    resetLayout();
    expect(window_()).toEqual([null, null]);
  });

  it("Fill the screen asks for the whole of the screen and resizes no column", async () => {
    await show("coach");
    chooseLayout("Fill the screen");
    expect(window_()).toEqual([
      String(SCREEN.availWidth),
      String(SCREEN.availHeight),
    ]);
    expect(values()).toEqual([250, 400, 250]);
  });

  it("Widest notes takes the questions and the answer to their narrowest and folds the call's room away", async () => {
    await show("coach");
    chooseLayout("Widest notes");
    expect(values()).toEqual([QUESTIONS_FLOOR, SIDE_FLOOR, 0]);
    expect(screen.getByTestId("pn-call-slot")).toHaveStyle({ flex: "0 0 0px" });
    expect(keptSizes()).toMatchObject({
      questions: QUESTIONS_FLOOR,
      side: SIDE_FLOOR,
      call: 0,
    });
    expect(window_()).toEqual([null, null]);
  });

  it("No room for the call folds only the call's room away, and its bar stays to bring it back", async () => {
    window.localStorage.setItem(
      SIZES_KEY,
      JSON.stringify({ questions: 200, side: 520 }),
    );
    await show("coach");
    chooseLayout("No room for the call");
    expect(values()).toEqual([200, 520, 0]);
    const bar = screen.getByRole("separator", { name: /room for the call/ });
    fireEvent.keyDown(bar, { key: "ArrowDown" });
    expect(valueOf("call")).toBe(24);
  });

  it("in the prompter, No room for the call gives the notes the whole height, and Default brings the room back", async () => {
    await show("prompter");
    chooseLayout("No room for the call");
    expect(screen.getByTestId("pn-call-slot")).toHaveStyle({ flex: "0 0 0px" });
    resetLayout();
    expect(screen.getByTestId("pn-call-slot")).toHaveStyle({
      flex: "0 0 250px",
    });
  });

  it("a layout leaves the question on show and its notes alone, and never holds the window", async () => {
    await show("coach");
    pickListed(1);
    for (const each of COACH_LAYOUTS) {
      chooseLayout(each.label);
      onShow(QUESTION_ONE);
      expect(screen.getByTestId("pn-coach-live")).toBeInTheDocument();
      expect(held()).toBe(false);
    }
  });

  it("the menu closes once a layout is chosen", async () => {
    await show("coach");
    chooseLayout("Widest notes");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("the colour of the panes inside a coach layout", () => {
  it.each(["coach", "conversation", "prompter"] as const)(
    "%s: the library panes take the notes' neutral grey, not their own blue",
    async (view) => {
      await show(view);
      const set = (name: string) => layout().style.getPropertyValue(name);
      expect(set("--oui-panel-bg")).toBe("#1c1c1e");
      expect(set("--oui-panel-dock-bg")).toBe(set("--oui-panel-bg"));
      expect(set("--oui-panel-divider")).toBe("#2c2c2f");
    },
  );
});

describe("a rephrasing or a follow-up the coach did not answer separately", () => {
  const FOLLOW_UP = "And how would you test that split in production?";
  // Asked at 0:30, between the two questions; the coach's note for the second
  // question (1:10) comes after it, so it belongs to the first.
  const withFollowUp = () =>
    session([
      transcript(2, QUESTION_ONE, { sourceId: "application-audio-r1" }),
      transcript(30, FOLLOW_UP, { sourceId: "application-audio-r1" }),
      transcript(60, QUESTION_TWO, { sourceId: "application-audio-r1" }),
    ]);
  const followUps = () => screen.queryAllByTestId("pn-coach-follow-up");

  it("has no row of its own in the list", async () => {
    await show("coach", withFollowUp());
    expect(screen.getByTestId("pn-coach-questions")).toHaveTextContent(
      "Questions · 2",
    );
    expect(rows()).toHaveLength(2);
    expect(screen.getByTestId("pn-coach-questions")).not.toHaveTextContent(
      "And how would you test",
    );
  });

  it("is shown under the question it belongs to, marked as a follow-up with its time", async () => {
    await show("coach", withFollowUp());
    expect(followUps()).toHaveLength(0);
    pickListed(1);
    onShow(QUESTION_ONE);
    expect(followUps()).toHaveLength(1);
    expect(
      slot(followUps()[0] as HTMLElement, "heard-line-label")?.textContent,
    ).toMatch(/^Follow-up · \d+:\d\d/);
    expect(followUps()[0]).toHaveTextContent(FOLLOW_UP);
    expect(notesPane()).toContainElement(followUps()[0] as HTMLElement);
  });

  it("is what was heard, cut to two lines, with the whole of it one hover away: it places the notes, it is not read out", async () => {
    await show("coach", withFollowUp());
    pickListed(1);
    const line = followUps()[0] as HTMLElement;
    expect(line).toHaveAttribute("data-slot", "heard-line");
    const said = heard(line) as HTMLElement;
    expect(said.textContent).toBe(FOLLOW_UP);
    expect(said).toHaveAttribute("title", FOLLOW_UP);
    expect(said.style.getPropertyValue("-webkit-line-clamp")).toBe("2");
    // It has no large title of its own: only the question on show has one.
    expect(slot(line, "heard-line-title")).toBeNull();
  });

  it("is the interviewer speaking: in the asking green, with the words that carry it lifted and the rest left quiet, and a rule sets it apart from the notes above", async () => {
    await show("coach", withFollowUp());
    pickListed(1);
    const line = followUps()[0] as HTMLElement;
    expect(line).toHaveAttribute("data-tone", "ask");
    const pieces = [...(heard(line)?.querySelectorAll("span") ?? [])];
    expect(pieces.map((piece) => piece.textContent)).toEqual([
      "And how would you test that ",
      "split ",
      "in ",
      "production?",
    ]);
    expect(
      pieces.map((piece) => piece.className.includes("font-medium")),
    ).toEqual([false, true, false, true]);
    // The rule stands between the note above and the follow-up.
    const rule = line.previousElementSibling as HTMLElement;
    expect(rule).toHaveAttribute("data-orientation", "horizontal");
    expect(rule.textContent).toBe("");
    expect(rule.previousElementSibling).toBe(blocks()[0]);
  });

  it("sits among the notes in the order they came", async () => {
    posted = [
      { ...FIRST, askId: "q-service" },
      SECOND,
      note(3, 45, { title: "Canary, then a probe", askId: "q-service" }),
    ];
    await show("coach", withFollowUp());
    pickListed(1);
    const order = [blocks()[0], followUps()[0], blocks()[1]] as HTMLElement[];
    expect(metaOf(order[0])).toContain("Name the criteria");
    expect(metaOf(order[2])).toContain("Canary, then a probe");
    for (const [at, element] of order.entries()) {
      const next = order[at + 1];
      if (next) expect(follows(element, next)).toBe(true);
    }
  });

  it("of two asked since the coach's last note, the earlier is a follow-up and only the newest waits", async () => {
    posted = [FIRST];
    await show("coach", withFollowUp());
    expect(rows()).toHaveLength(1);
    onShow(QUESTION_ONE);
    expect(followUps()).toHaveLength(1);
    expect(followUps()[0]).toHaveTextContent(FOLLOW_UP);
    expect(screen.getByTestId("pn-coach-waiting")).toHaveTextContent(
      QUESTION_TWO,
    );
  });
});

describe("the whole session", () => {
  it("the questions go back to the first one asked, however long the transcript has grown", async () => {
    // More typed lines than the transcript pane keeps (60).
    const entries = Array.from({ length: 70 }, (_, at) => ({
      key: `typed-${at}`,
      kind: "Typed",
      text: `Line ${at}`,
      at: Date.parse(minutesAfter(2, at)),
    }));
    await show(
      "coach",
      session(heardSoFar(), { entries } as unknown as Partial<PanelSession>),
    );
    expect(rows()).toHaveLength(2);
    expect(question(1)).toHaveAttribute("title", QUESTION_ONE);
    pickListed(1);
    onShow(QUESTION_ONE);
  });
});

describe("picking a question brings the studio's answer to it", () => {
  // The studio answered once under each question: at 0:30 and at 1:10.
  const answered = (select: PanelSession["select"]) =>
    session(heardSoFar(), { select }, [
      answerAction(codingAnswer([], "Split by team boundary."), {
        taskId: "task-1",
        createdAt: minutesAfter(0, 30),
        updatedAt: minutesAfter(0, 35),
      }),
      answerAction(codingAnswer([], "Use the Outbox."), {
        taskId: "task-2",
        createdAt: minutesAfter(1, 10),
        updatedAt: minutesAfter(1, 15),
      }),
    ]);

  it("from the list: the Answer pane is asked for that question's task", async () => {
    const select = vi.fn();
    await show("coach", answered(select));
    expect(select).not.toHaveBeenCalled();
    pickListed(1);
    expect(select).toHaveBeenLastCalledWith("task-1");
    pickListed(2);
    expect(select).toHaveBeenLastCalledWith("task-2");
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("with the previous and next buttons too", async () => {
    const select = vi.fn();
    await show("prompter", answered(select));
    fireEvent.click(screen.getByRole("button", { name: "Previous question" }));
    expect(select).toHaveBeenLastCalledWith("task-1");
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(select).toHaveBeenLastCalledWith("task-2");
  });

  it("asks for nothing when the studio has not answered that question", async () => {
    const select = vi.fn();
    await show("coach", session(heardSoFar(), { select }));
    pickListed(1);
    pickListed(2);
    onShow(QUESTION_TWO, ASK_TWO);
    expect(select).not.toHaveBeenCalled();
  });
});

describe("a replay's notes", () => {
  const REPLAYED = note(7, 70, {
    title: "From the replay",
    markdown: "- **Saga**: compensate, do not roll back",
    ask: ASK_TWO,
    askId: "q-consistency",
  });
  const tag = () => screen.queryByTestId("pn-coach-replay");
  const close = () => screen.queryByTestId("pn-coach-replay-close");

  it("both spaces are read: the person's own, and the replay's apart from them", async () => {
    await show("coach");
    expect(askedNotes()).toEqual([
      ["GET", "/api/v1/coach-notes"],
      ["GET", "/api/v1/coach-notes?space=replay"],
    ]);
  });

  it("while there are none the pane is the person's own: no tag, no Close replay, following live", async () => {
    await show("coach");
    expect(tag()).toBeNull();
    expect(close()).toBeNull();
    expect(notesPane()).toHaveTextContent("Following live");
    expect(metaOf(blocks()[0])).toContain("Name the techniques");
  });

  it.each(["coach", "conversation", "prompter"] as const)(
    "take the pane in the %s view: tagged Replay, with Close replay, and not said to follow live",
    async (view) => {
      replayed = [REPLAYED];
      await show(view);
      expect(tag()).toHaveTextContent("Replay");
      expect(within(notesPane()).getByTestId("pn-coach-replay")).toBe(tag());
      expect(close()).toHaveTextContent("Close replay");
      expect(close()).toHaveAttribute(
        "title",
        "Clear the replay's notes and show your own again.",
      );
      expect(notesPane()).not.toHaveTextContent("Following live");
      // The replay's notes are the ones drawn, never the person's own.
      expect(blocks()).toHaveLength(1);
      expect(metaOf(blocks()[0])).toContain("From the replay");
      expect(linesOf(blocks()[0])).toEqual([
        "Saga: compensate, do not roll back",
      ]);
      expect(notesPane()).not.toHaveTextContent("Outbox");
    },
  );

  it("arriving during the session take the pane on the next read", async () => {
    await show("coach");
    expect(tag()).toBeNull();
    postReplay(REPLAYED);
    await poll();
    expect(tag()).toHaveTextContent("Replay");
    expect(notesPane()).not.toHaveTextContent("Following live");
    expect(metaOf(blocks()[0])).toContain("From the replay");
  });

  it("Close replay clears the replay's notes, and only those: the person's own are back, untouched", async () => {
    replayed = [REPLAYED];
    await show("coach");
    vi.mocked(fetch).mockClear();
    fireEvent.click(close() as HTMLElement);
    // At once, before the server has answered.
    expect(tag()).toBeNull();
    expect(close()).toBeNull();
    await settle();
    expect(askedNotes().filter(([method]) => method === "DELETE")).toEqual([
      ["DELETE", "/api/v1/coach-notes?space=replay"],
    ]);
    expect(replayed).toEqual([]);
    expect(posted).toEqual([FIRST, SECOND]);
    expect(notesPane()).toHaveTextContent("Following live");
    expect(blocks()).toHaveLength(1);
    expect(metaOf(blocks()[0])).toContain("Name the techniques");
    expect(linesOf(blocks()[0])).toEqual(["Outbox: one transaction"]);
    // And it stays closed as the reads go on.
    await poll();
    expect(tag()).toBeNull();
  });

  it("the Context pane is given the replay's notes while they are on show", async () => {
    replayed = [REPLAYED];
    await show("coach");
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Context/ }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByTestId("pane-context")).toHaveAttribute(
      "data-notes",
      "From the replay",
    );
  });

  it("are not read while the session is not open", async () => {
    replayed = [REPLAYED];
    await show("coach", { ...session(), open: false } as PanelSession);
    expect(fetch).not.toHaveBeenCalled();
    expect(tag()).toBeNull();
  });
});
