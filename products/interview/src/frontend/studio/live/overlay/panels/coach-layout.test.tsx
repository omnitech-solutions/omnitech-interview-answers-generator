// The coach layouts over a scripted session and scripted coach notes: which
// columns each one has, the question on the table and an earlier one, how a
// note is drawn, what happens to a note that arrives while the person reads
// further up, and the tabs of the right column.
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
import {
  minutesAfter,
  sessionView,
  snapshot,
  transcript,
} from "../../testing/session-fixtures";
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
function session(observations = heardSoFar()): PanelSession {
  return {
    model: deriveLiveModel({
      session: sessionView({ processingPolicy: "permitted-remote" }),
      observations: [snapshot(1), ...observations],
      actions: [],
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
  points: [],
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

const layout = () => screen.getByTestId("pn-coach-layout");
const notesPane = () => screen.getByTestId("pn-coach-notes");
const asked = () => screen.getByTestId("pn-coach-asked");
const listed = () => screen.getAllByTestId("pn-coach-question");
const blocks = () => screen.queryAllByTestId("pn-coach-block");
const pickListed = (at: number) =>
  fireEvent.click(within(listed()[at] as HTMLElement).getByRole("button"));
// The pane the notes scroll in. jsdom lays nothing out, so a test gives it a size.
function scroller(scrollHeight = 1_000, clientHeight = 300) {
  const element = notesPane().querySelector<HTMLElement>(
    ":scope > [data-text-surface]",
  );
  if (!element) throw new Error("the notes pane has no scroller");
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  return element;
}
function scrollTo(element: HTMLElement, top: number) {
  element.scrollTop = top;
  fireEvent.scroll(element);
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  posted = [FIRST, SECOND];
  revision = 1;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ revision, notes: posted })),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("the three layouts", () => {
  it("coach: the questions, the call over the coach's notes, and the answer, transcript and code as tabs", async () => {
    await show("coach");
    expect(layout()).toHaveAttribute("data-view", "coach");
    expect(screen.getByTestId("pn-coach-questions")).toHaveAccessibleName(
      "Questions",
    );
    expect(screen.getByTestId("pn-call-slot")).toBeInTheDocument();
    expect(notesPane()).toHaveAccessibleName("Coach");
    expect(
      screen.getByRole("tablist", { name: "Answer, transcript or code" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Answer",
      "Transcript",
      "Code",
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
      if (next)
        expect(
          element.compareDocumentPosition(next) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
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
    expect(screen.queryByTestId("pn-coach-question")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByTestId("pn-chat")).toBeNull();
    expect(screen.queryByTestId("pane-answer")).toBeNull();
  });

  it.each(["coach", "conversation", "prompter"] as const)(
    "%s: the room for the call sits directly above the notes, with the bar to resize it",
    async (view) => {
      await show(view);
      const slot = screen.getByTestId("pn-call-slot");
      const bar = screen.getByTestId("pn-call-slot-resize");
      expect(slot.parentElement).toBe(notesPane().parentElement);
      expect(bar.nextElementSibling).toBe(notesPane());
      expect(slot.nextElementSibling).toBe(bar);
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

describe("the questions list", () => {
  it("lists what was asked in order, numbered, with the coach's wording where there is some", async () => {
    await show("coach");
    expect(screen.getByTestId("pn-coach-questions")).toHaveTextContent(
      "Questions · 2",
    );
    const rows = listed();
    expect(rows).toHaveLength(2);
    // The first has no restatement: what was heard, cut to 60 characters.
    expect(
      within(rows[0] as HTMLElement).getByRole("button"),
    ).toHaveTextContent(`${QUESTION_ONE.slice(0, 60).trimEnd()}…`);
    expect(rows[0]).toHaveTextContent(/^1/);
    expect(
      within(rows[1] as HTMLElement).getByRole("button"),
    ).toHaveTextContent(ASK_TWO);
    expect(rows[1]).toHaveTextContent(/^2/);
    // The whole question is one hover away.
    expect(within(rows[0] as HTMLElement).getByRole("button")).toHaveAttribute(
      "title",
      QUESTION_ONE,
    );
  });

  it("marks only the question on the table as live, and says how many notes each has", async () => {
    await show("coach");
    const [first, last] = listed();
    expect(first).not.toHaveAttribute("data-live");
    expect(last).toHaveAttribute("data-live");
    expect(first).toHaveTextContent("1 note");
    expect(first).not.toHaveTextContent("live");
    expect(last).toHaveTextContent("1 note · live");
    post(note(3, 80, { askId: "q-consistency" }));
    await poll();
    expect(listed()[1]).toHaveTextContent("2 notes · live");
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
    expect(listed()).toHaveLength(2);
    expect(listed()[1]).toHaveAttribute("data-live");
  });

  it("is empty before anything is asked, and the notes pane says what will appear", async () => {
    posted = [];
    await show("coach", session([]));
    expect(screen.getByTestId("pn-coach-questions")).toHaveTextContent(
      "Questions · 0",
    );
    expect(screen.queryByTestId("pn-coach-question")).toBeNull();
    expect(screen.queryByTestId("pn-coach-asked")).toBeNull();
    expect(within(notesPane()).getByRole("status")).toHaveTextContent(
      "The question being asked appears here",
    );
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
  });
});

describe("the question on the table", () => {
  it("is shown whole with its notes beneath, marked as being asked and followed live", async () => {
    await show("coach");
    expect(asked()).toHaveTextContent(QUESTION_TWO);
    expect(notesPane()).toHaveTextContent("Being asked · ");
    expect(notesPane()).toHaveTextContent(`Q2 · ${ASK_TWO}`);
    expect(notesPane()).toHaveTextContent("Following live");
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]).toHaveTextContent("Name the techniques");
    expect(blocks()[0]).toHaveTextContent("Outbox: one transaction");
    // Its row in the list is the current one.
    expect(
      within(listed()[1] as HTMLElement).getByRole("button"),
    ).toHaveAttribute("aria-current", "true");
    expect(
      within(listed()[0] as HTMLElement).getByRole("button"),
    ).not.toHaveAttribute("aria-current");
  });

  it("says so when it has no notes yet", async () => {
    posted = [FIRST];
    await show("conversation");
    expect(asked()).toHaveTextContent(QUESTION_TWO);
    expect(blocks()).toHaveLength(0);
    expect(within(notesPane()).getByRole("status")).toHaveTextContent(
      "No notes for this question yet.",
    );
  });

  it("moves on when the interviewer asks the next one", async () => {
    const drawn = await show("coach");
    expect(asked()).toHaveTextContent(QUESTION_TWO);
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
    expect(listed()).toHaveLength(3);
    expect(listed()[2]).toHaveAttribute("data-live");
    expect(listed()[1]).not.toHaveAttribute("data-live");
    expect(asked()).toHaveTextContent(NEXT);
    expect(notesPane()).toHaveTextContent("Following live");
  });
});

describe("an earlier question", () => {
  it("picked from the list is shown with its own notes, and offers the way back to live", async () => {
    await show("coach");
    pickListed(0);
    expect(asked()).toHaveTextContent(QUESTION_ONE);
    expect(notesPane()).toHaveTextContent("Asked · ");
    expect(notesPane()).not.toHaveTextContent("Being asked");
    expect(notesPane()).not.toHaveTextContent("Following live");
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]).toHaveTextContent("Name the criteria");
    expect(blocks()[0]).toHaveTextContent("Team boundary");
    expect(notesPane()).not.toHaveTextContent("Outbox");
    const back = screen.getByTestId("pn-coach-live");
    expect(back).toHaveTextContent("Back to live");
    // The list shows which is on show; the live one is still marked live.
    expect(
      within(listed()[0] as HTMLElement).getByRole("button"),
    ).toHaveAttribute("aria-current", "true");
    expect(listed()[1]).toHaveAttribute("data-live");
    expect(listed()[0]).not.toHaveAttribute("data-live");

    fireEvent.click(back);
    expect(asked()).toHaveTextContent(QUESTION_TWO);
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
    expect(notesPane()).toHaveTextContent("Following live");
  });

  it("picking the live question from the list is following it again", async () => {
    await show("conversation");
    pickListed(0);
    expect(screen.getByTestId("pn-coach-live")).toBeInTheDocument();
    pickListed(1);
    expect(asked()).toHaveTextContent(QUESTION_TWO);
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
  });

  it("stays on show when a new question is asked, with the way back to the new one", async () => {
    const drawn = await show("coach");
    pickListed(0);
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
    expect(asked()).toHaveTextContent(QUESTION_ONE);
    fireEvent.click(screen.getByTestId("pn-coach-live"));
    expect(asked()).toHaveTextContent(NEXT);
  });

  it("is reached with the previous and next buttons where there is no list (the prompter)", async () => {
    await show("prompter");
    const previous = screen.getByRole("button", { name: "Previous question" });
    const next = screen.getByRole("button", { name: "Next question" });
    expect(next).toBeDisabled();
    expect(previous).toBeEnabled();
    fireEvent.click(previous);
    expect(asked()).toHaveTextContent(QUESTION_ONE);
    expect(screen.getByTestId("pn-coach-live")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous question" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(asked()).toHaveTextContent(QUESTION_TWO);
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
  });
});

describe("how a note is drawn", () => {
  it("a note to say is a plain block under its title; a note to watch is a warning block", async () => {
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
    expect(say).toHaveAttribute("data-tone", "say");
    expect(watch).toHaveAttribute("data-tone", "watch");
    expect(watch).toHaveTextContent("Do not promise exactly-once");
    expect(watch).toHaveTextContent(
      "Say at-least-once with idempotent consumers",
    );
    // Amber marks a warning and nothing else.
    expect(watch?.style.border).toContain("245, 184, 74");
    expect(watch?.style.background).toContain("245, 184, 74");
    expect(say?.style.border).toBe("");
    expect(say?.style.background).toBe("");
  });

  it("a follow-up that names the question is added beneath the earlier note, never in its place", async () => {
    await show("coach");
    expect(blocks().map((block) => block.getAttribute("data-tone"))).toEqual([
      "say",
    ]);
    post(
      note(3, 80, { title: "Then the Saga", askId: "q-consistency" }),
      note(4, 85, { title: "Pace", tone: "watch", askId: "q-consistency" }),
    );
    await poll();
    expect(blocks().map((block) => block.textContent)).toEqual([
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
    expect(listed()[0]).toHaveTextContent("2 notes");
    pickListed(0);
    expect(blocks().map((block) => block.textContent)).toEqual([
      expect.stringContaining("Name the criteria"),
      expect.stringContaining("Add the team-size point"),
    ]);
  });
});

describe("a note that arrives while reading", () => {
  const FOLLOW_UP = note(3, 80, {
    title: "Then the Saga",
    askId: "q-consistency",
  });

  it("is followed to the bottom when the reader is already there", async () => {
    await show("coach");
    const pane = scroller();
    scrollTo(pane, 700);
    post(FOLLOW_UP);
    await poll();
    expect(blocks()).toHaveLength(2);
    expect(pane.scrollTop).toBe(1_000);
    expect(screen.queryByTestId("pn-coach-below")).toBeNull();
  });

  it("counts as at the bottom within 48 px of it", async () => {
    await show("coach");
    const pane = scroller();
    scrollTo(pane, 652);
    post(FOLLOW_UP);
    await poll();
    expect(screen.queryByTestId("pn-coach-below")).toBeNull();
    expect(pane.scrollTop).toBe(1_000);
  });

  it("leaves the scroll where it is when the reader is further up, and shows the pill instead", async () => {
    await show("coach");
    const pane = scroller();
    scrollTo(pane, 120);
    expect(screen.queryByTestId("pn-coach-below")).toBeNull();
    post(FOLLOW_UP);
    await poll();
    expect(blocks()).toHaveLength(2);
    expect(pane.scrollTop).toBe(120);
    expect(screen.getByTestId("pn-coach-below")).toHaveTextContent(
      "New note added below",
    );
    // The pill sits after the notes, inside the pane that scrolls.
    expect(pane).toContainElement(screen.getByTestId("pn-coach-below"));
  });

  it("the pill takes the reader to the new note and goes", async () => {
    await show("coach");
    const pane = scroller();
    scrollTo(pane, 120);
    post(FOLLOW_UP);
    await poll();
    fireEvent.click(screen.getByTestId("pn-coach-below"));
    expect(pane.scrollTop).toBe(1_000);
    expect(screen.queryByTestId("pn-coach-below")).toBeNull();
  });

  it("the pill goes when the reader scrolls down to the bottom", async () => {
    await show("coach");
    const pane = scroller();
    scrollTo(pane, 120);
    post(FOLLOW_UP);
    await poll();
    expect(screen.getByTestId("pn-coach-below")).toBeInTheDocument();
    scrollTo(pane, 400);
    expect(screen.getByTestId("pn-coach-below")).toBeInTheDocument();
    scrollTo(pane, 700);
    expect(screen.queryByTestId("pn-coach-below")).toBeNull();
  });

  it("the pill goes with the question it was for", async () => {
    await show("coach");
    const pane = scroller();
    scrollTo(pane, 120);
    post(FOLLOW_UP);
    await poll();
    expect(screen.getByTestId("pn-coach-below")).toBeInTheDocument();
    pickListed(0);
    expect(screen.queryByTestId("pn-coach-below")).toBeNull();
  });

  it("a poll that brings nothing new changes nothing", async () => {
    await show("coach");
    const pane = scroller();
    scrollTo(pane, 120);
    await poll();
    await poll();
    expect(pane.scrollTop).toBe(120);
    expect(screen.queryByTestId("pn-coach-below")).toBeNull();
    expect(blocks()).toHaveLength(1);
  });
});

describe("the right column of the coach view", () => {
  const tab = (id: "answer" | "transcript" | "code") =>
    screen.getByTestId(`pn-coach-tab-${id}`);
  const selected = () =>
    screen
      .getAllByRole("tab")
      .filter((each) => each.getAttribute("aria-selected") === "true")
      .map((each) => each.textContent);
  const panel = () => screen.getByRole("tabpanel");

  it("opens on the answer, and draws one pane at a time", async () => {
    await show("coach");
    expect(selected()).toEqual(["Answer"]);
    expect(within(panel()).getByTestId("pane-answer")).toBeInTheDocument();
    expect(screen.queryByTestId("pn-chat")).toBeNull();
    expect(screen.queryByTestId("pane-code")).toBeNull();
  });

  it("the Transcript tab shows the transcript and its message box in the answer's place", async () => {
    await show("coach");
    fireEvent.click(tab("transcript"));
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
    fireEvent.click(tab("code"));
    expect(selected()).toEqual(["Code"]);
    expect(within(panel()).getByTestId("pane-code")).toBeInTheDocument();
    expect(screen.queryByTestId("pn-chat")).toBeNull();
    expect(screen.queryByTestId("pane-answer")).toBeNull();
    fireEvent.click(tab("answer"));
    expect(selected()).toEqual(["Answer"]);
    expect(within(panel()).getByTestId("pane-answer")).toBeInTheDocument();
    expect(screen.queryByTestId("pane-code")).toBeNull();
  });

  it("switching tabs leaves the question on show and its notes alone", async () => {
    await show("coach");
    pickListed(0);
    fireEvent.click(tab("transcript"));
    fireEvent.click(tab("code"));
    expect(asked()).toHaveTextContent(QUESTION_ONE);
    expect(blocks()[0]).toHaveTextContent("Name the criteria");
    expect(screen.getByTestId("pn-coach-live")).toBeInTheDocument();
  });
});
