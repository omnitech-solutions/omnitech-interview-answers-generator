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
import { answerAction } from "../../testing/live-view-kit";
import {
  type action,
  minutesAfter,
  sessionView,
  snapshot,
  transcript,
} from "../../testing/session-fixtures";
import { codingAnswer } from "../../testing/session-result-fixtures";
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
// The rows of the questions list as drawn: the newest question first.
const listed = () => screen.getAllByTestId("pn-coach-question");
// A row by its question's number (1 is the first one asked).
const question = (number: number) => {
  const row = listed().find((each) =>
    each.textContent?.startsWith(String(number)),
  );
  if (!row) throw new Error(`no question ${number} in the list`);
  return row;
};
const blocks = () => screen.queryAllByTestId("pn-coach-block");
const pickListed = (number: number) => fireEvent.click(question(number));
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
  it("lists what was asked newest first, numbered in the order asked, with the coach's wording where there is some", async () => {
    await show("coach");
    const questions = screen.getByTestId("pn-coach-questions");
    expect(questions).toHaveTextContent("Questions · 2");
    expect(questions).toHaveTextContent("newest first");
    const rows = listed();
    expect(rows).toHaveLength(2);
    // The top row is the newest question, so it has the highest number.
    expect(rows[0]).toHaveTextContent(/^2/);
    expect(rows[0]).toHaveAccessibleName(ASK_TWO);
    expect(rows[0]).toHaveTextContent(ASK_TWO);
    // The first has no restatement: what was heard, cut to 60 characters.
    const cut = `${QUESTION_ONE.slice(0, 60).trimEnd()}…`;
    expect(rows[1]).toHaveTextContent(/^1/);
    expect(rows[1]).toHaveAccessibleName(cut);
    expect(rows[1]).toHaveTextContent(cut);
    // The whole question is one hover away.
    expect(rows[1]).toHaveAttribute("title", QUESTION_ONE);
  });

  it("each row is a real button, so the keyboard reaches it and the shell never drags the window from it", async () => {
    await show("coach");
    for (const row of listed()) {
      expect(row.tagName).toBe("BUTTON");
      expect(row).toHaveAttribute("type", "button");
    }
    expect(
      within(screen.getByTestId("pn-coach-questions")).getAllByRole("button"),
    ).toEqual(listed());
  });

  it("a new question goes to the top and brings the list back to its top", async () => {
    // No coach yet: every question heard has a row.
    posted = [];
    const drawn = await show("coach");
    const list = question(1).parentElement as HTMLElement;
    list.scrollTop = 140;
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
    expect(listed().map((row) => row.textContent?.[0])).toEqual([
      "3",
      "2",
      "1",
    ]);
    expect(list.scrollTop).toBe(0);
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
    expect(listed()).toHaveLength(2);
    expect(question(2)).toHaveAttribute("data-live");
    post(note(5, 160, { title: "Pick one with numbers", askId: "q-project" }));
    await poll();
    expect(listed()).toHaveLength(3);
    expect(question(3)).toHaveAttribute("title", NEXT);
    expect(question(3)).toHaveAttribute("data-live");
    expect(question(2)).not.toHaveAttribute("data-live");
  });

  it("marks only the question on the table as live, and says how many notes each has", async () => {
    await show("coach");
    const [first, last] = [question(1), question(2)];
    expect(first).not.toHaveAttribute("data-live");
    expect(last).toHaveAttribute("data-live");
    expect(first).toHaveTextContent("1 note");
    expect(first).not.toHaveTextContent("live");
    expect(last).toHaveTextContent("1 note · live");
    post(note(3, 80, { askId: "q-consistency" }));
    await poll();
    expect(question(2)).toHaveTextContent("2 notes · live");
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
    expect(question(2)).toHaveAttribute("data-live");
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
    expect(question(2)).toHaveAttribute("aria-current", "true");
    expect(question(1)).not.toHaveAttribute("aria-current");
  });

  it("says so when no question has notes yet", async () => {
    posted = [];
    await show("conversation");
    expect(asked()).toHaveTextContent(QUESTION_TWO);
    expect(blocks()).toHaveLength(0);
    expect(within(notesPane()).getByRole("status")).toHaveTextContent(
      "No notes for this question yet.",
    );
    expect(notesPane()).toHaveTextContent("Following live");
    expect(screen.queryByTestId("pn-coach-waiting")).toBeNull();
  });

  it("moves on once the coach's notes for the next one arrive", async () => {
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
    // Until then the last notes stay on show.
    expect(asked()).toHaveTextContent(QUESTION_TWO);
    post(note(5, 160, { title: "Pick one with numbers", askId: "q-project" }));
    await poll();
    expect(asked()).toHaveTextContent(NEXT);
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]).toHaveTextContent("Pick one with numbers");
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
    expect(waiting()).toHaveTextContent(/^Being asked · \d+:\d\d/);
    expect(waiting()).toHaveTextContent(NEXT);
    expect(waiting()).toHaveTextContent(
      "Notes for this are on their way. The last notes stay below.",
    );
    // Beneath it, the last question the coach answered, with its notes.
    expect(asked()).toHaveTextContent(QUESTION_TWO);
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]).toHaveTextContent("Name the techniques");
    expect(
      waiting().compareDocumentPosition(asked()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(notesPane()).toContainElement(waiting());
    expect(notesPane()).not.toHaveTextContent("No notes for this question yet");
  });

  it("is written larger than a follow-up and never cut: it is what is being asked now", async () => {
    await show("coach", withNext());
    const said = within(waiting()).getByText(NEXT);
    expect(said.style.getPropertyValue("-webkit-line-clamp")).toBe("");
    expect(said.style.overflow).toBe("");
    expect(Number.parseFloat(said.style.fontSize)).toBeGreaterThan(14);
  });

  it("is still following live, and has no row of its own until its notes arrive", async () => {
    await show("coach", withNext());
    expect(notesPane()).toHaveTextContent("Following live");
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
    expect(notesPane()).toHaveTextContent(`Q2 · ${ASK_TWO}`);
    expect(listed()).toHaveLength(2);
    expect(question(2)).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("pn-coach-questions")).not.toHaveTextContent(
      "Tell me about a project",
    );
  });

  it("goes back to the latest question that has notes, however many were asked since", async () => {
    posted = [FIRST];
    await show("conversation");
    expect(waiting()).toHaveTextContent(QUESTION_TWO);
    expect(asked()).toHaveTextContent(QUESTION_ONE);
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]).toHaveTextContent("Name the criteria");
  });

  it("the box goes when its notes arrive, and the pane moves on to it", async () => {
    await show("coach", withNext());
    expect(waiting()).toBeInTheDocument();
    post(note(5, 160, { title: "Pick one with numbers", askId: "q-project" }));
    await poll();
    expect(screen.queryByTestId("pn-coach-waiting")).toBeNull();
    expect(asked()).toHaveTextContent(NEXT);
    expect(blocks()[0]).toHaveTextContent("Pick one with numbers");
  });

  it("there is no box while the question on the table has notes", async () => {
    await show("coach");
    expect(screen.queryByTestId("pn-coach-waiting")).toBeNull();
  });

  it("a picked question is shown as it is, with no box; back on the newest, the box returns", async () => {
    await show("coach", withNext());
    pickListed(1);
    expect(screen.queryByTestId("pn-coach-waiting")).toBeNull();
    expect(asked()).toHaveTextContent(QUESTION_ONE);
    expect(notesPane()).not.toHaveTextContent("Following live");
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(asked()).toHaveTextContent(QUESTION_TWO);
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
    expect(asked()).toHaveTextContent(NEXT);
    expect(listed()).toHaveLength(3);
  });

  it("is shown in the prompter too", async () => {
    await show("prompter", withNext());
    expect(waiting()).toHaveTextContent(NEXT);
    expect(asked()).toHaveTextContent(QUESTION_TWO);
  });
});

describe("an earlier question", () => {
  it("picked from the list is shown with its own notes, and offers the way back to live", async () => {
    await show("coach");
    pickListed(1);
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
    expect(question(1)).toHaveAttribute("aria-current", "true");
    expect(question(2)).toHaveAttribute("data-live");
    expect(question(1)).not.toHaveAttribute("data-live");

    fireEvent.click(back);
    expect(asked()).toHaveTextContent(QUESTION_TWO);
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
    expect(notesPane()).toHaveTextContent("Following live");
  });

  it("picking the live question from the list is following it again", async () => {
    await show("conversation");
    pickListed(1);
    expect(screen.getByTestId("pn-coach-live")).toBeInTheDocument();
    pickListed(2);
    expect(asked()).toHaveTextContent(QUESTION_TWO);
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
    expect(asked()).toHaveTextContent(QUESTION_ONE);
    expect(screen.queryByTestId("pn-coach-waiting")).toBeNull();
    fireEvent.click(screen.getByTestId("pn-coach-live"));
    // The new one has no notes yet: it is named above the last notes.
    expect(screen.getByTestId("pn-coach-waiting")).toHaveTextContent(NEXT);
    expect(asked()).toHaveTextContent(QUESTION_TWO);
    expect(screen.queryByTestId("pn-coach-live")).toBeNull();
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
    expect(question(1)).toHaveTextContent("2 notes");
    pickListed(1);
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
    pickListed(1);
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
    pickListed(1);
    fireEvent.click(tab("transcript"));
    fireEvent.click(tab("code"));
    expect(asked()).toHaveTextContent(QUESTION_ONE);
    expect(blocks()[0]).toHaveTextContent("Name the criteria");
    expect(screen.getByTestId("pn-coach-live")).toBeInTheDocument();
  });
});

describe("a note named as its question", () => {
  it("does not repeat its title above the note: the question is said once", async () => {
    post(
      note(3, 80, {
        title: QUESTION_TWO,
        points: ["Start from the Outbox"],
        askId: "q-consistency",
      }),
    );
    await show("coach");
    expect(blocks()).toHaveLength(2);
    expect(blocks()[1]).toHaveTextContent("Start from the Outbox");
    expect(blocks()[1]).not.toHaveTextContent(QUESTION_TWO);
    expect(within(notesPane()).getAllByText(QUESTION_TWO)).toEqual([asked()]);
    // Any other title is still said above its note.
    expect(blocks()[0]).toHaveTextContent("Name the techniques");
  });

  it("still names a warning, whatever its title", async () => {
    post(
      note(3, 80, {
        title: QUESTION_TWO,
        tone: "watch",
        points: ["Do not promise exactly-once"],
        askId: "q-consistency",
      }),
    );
    await show("coach");
    expect(blocks()[1]).toHaveAttribute("data-tone", "watch");
    expect(blocks()[1]).toHaveTextContent(QUESTION_TWO);
  });
});

describe("a note under the call", () => {
  it("is drawn as talking points: one bullet to a sentence", async () => {
    post(
      note(3, 80, {
        title: "Then the Saga",
        markdown: "Each step has an undo. “Say compensating action.”",
        askId: "q-consistency",
      }),
    );
    await show("coach");
    expect(
      within(blocks()[1] as HTMLElement)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Each step has an undo.", "Say compensating action."]);
  });
});

describe("where the notes pane opens and what moves it", () => {
  it("a picked question opens at its top, with no pill", async () => {
    await show("coach");
    const pane = scroller();
    scrollTo(pane, 500);
    pickListed(1);
    expect(asked()).toHaveTextContent(QUESTION_ONE);
    expect(pane.scrollTop).toBe(0);
    expect(screen.queryByTestId("pn-coach-below")).toBeNull();
  });

  it("going back to live opens the live question at its top too", async () => {
    await show("coach");
    pickListed(1);
    const pane = scroller();
    scrollTo(pane, 500);
    fireEvent.click(screen.getByTestId("pn-coach-live"));
    expect(asked()).toHaveTextContent(QUESTION_TWO);
    expect(pane.scrollTop).toBe(0);
  });

  it("a note for another question neither scrolls the one on show nor shows the pill", async () => {
    posted = [{ ...FIRST, askId: "q-service" }, SECOND];
    await show("coach");
    const pane = scroller();
    scrollTo(pane, 120);
    post(note(3, 90, { title: "Add the team-size point", askId: "q-service" }));
    await poll();
    expect(question(1)).toHaveTextContent("2 notes");
    expect(blocks()).toHaveLength(1);
    expect(pane.scrollTop).toBe(120);
    expect(screen.queryByTestId("pn-coach-below")).toBeNull();
  });

  it("a note for another question leaves a reader at the bottom where they are", async () => {
    posted = [{ ...FIRST, askId: "q-service" }, SECOND];
    await show("coach");
    const pane = scroller();
    scrollTo(pane, 700);
    post(note(3, 90, { title: "Add the team-size point", askId: "q-service" }));
    await poll();
    expect(pane.scrollTop).toBe(700);
  });

  it("a question that fits its pane counts as read to the bottom: its next note is followed, not announced", async () => {
    await show("coach");
    pickListed(1);
    pickListed(2);
    const pane = scroller(300, 300);
    post(note(3, 80, { title: "Then the Saga", askId: "q-consistency" }));
    await poll();
    expect(blocks()).toHaveLength(2);
    expect(pane.scrollTop).toBe(300);
    expect(screen.queryByTestId("pn-coach-below")).toBeNull();
  });
});

describe("the bars that resize the layout", () => {
  const COLUMNS_KEY = "omnitech.interview.coach.columns";
  const SLOT_KEY = "omnitech.interview.call-slot.height";
  const splitter = (side: "left" | "right") =>
    screen.getByTestId(`pn-coach-splitter-${side}`);
  const edge = (side: "left" | "right") =>
    screen.getByTestId(`pn-coach-edge-${side}`);
  const follows = (before: Element, after: Element) =>
    Boolean(
      before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING,
    );

  it.each(["coach", "conversation"] as const)(
    "%s: a bar stands between the questions and the centre, and between the centre and the right column",
    async (view) => {
      await show(view);
      const row = [...layout().children];
      expect(row.map((each) => each.getAttribute("data-testid"))).toEqual([
        "pn-coach-edge-left",
        null,
        "pn-coach-splitter-left",
        null,
        "pn-coach-splitter-right",
        null,
        "pn-coach-edge-right",
      ]);
      expect(row[1]).toContainElement(screen.getByTestId("pn-coach-questions"));
      expect(row[3]).toContainElement(notesPane());
      expect(row[3]).toContainElement(screen.getByTestId("pn-call-slot"));
      expect(row[5]).toContainElement(
        view === "coach"
          ? screen.getByRole("tablist")
          : screen.getByTestId("pn-chat"),
      );
      expect(splitter("left")).toHaveAccessibleName(
        "Width of the questions column",
      );
      expect(splitter("right")).toHaveAccessibleName(
        "Width of the right column",
      );
      // The side columns open 250 and 400 px wide; the centre takes the rest.
      expect(splitter("left")).toHaveAttribute("aria-valuenow", "250");
      expect(splitter("right")).toHaveAttribute("aria-valuenow", "400");
      expect(row[1]).toHaveStyle({ flex: "0 0 250px" });
      expect(row[5]).toHaveStyle({ flex: "0 0 400px" });
    },
  );

  it("prompter: no columns to resize, only the window's own edges around the centre", async () => {
    await show("prompter");
    expect(screen.queryByTestId("pn-coach-splitter-left")).toBeNull();
    expect(screen.queryByTestId("pn-coach-splitter-right")).toBeNull();
    expect(layout().firstElementChild).toBe(edge("left"));
    expect(layout().lastElementChild).toBe(edge("right"));
    expect(layout().children).toHaveLength(3);
    expect(layout().children[1]).toContainElement(notesPane());
  });

  it.each(["coach", "conversation", "prompter"] as const)(
    "%s: the window's edges are the first and last thing in the row, which keeps no gap of its own",
    async (view) => {
      await show(view);
      expect(layout().firstElementChild).toBe(edge("left"));
      expect(layout().lastElementChild).toBe(edge("right"));
      expect(follows(edge("left"), notesPane())).toBe(true);
      expect(follows(notesPane(), edge("right"))).toBe(true);
      expect(layout().style.gap).toMatch(/^0(px)?$/);
    },
  );

  it("a column takes the width kept from an earlier session", async () => {
    window.localStorage.setItem(
      COLUMNS_KEY,
      JSON.stringify({ left: 180, right: 520 }),
    );
    await show("conversation");
    expect(splitter("left")).toHaveAttribute("aria-valuenow", "180");
    expect(splitter("right")).toHaveAttribute("aria-valuenow", "520");
    expect(layout().children[1]).toHaveStyle({ flex: "0 0 180px" });
    expect(layout().children[5]).toHaveStyle({ flex: "0 0 520px" });
  });

  it("a double click on a bar puts that column back and leaves the other", async () => {
    window.localStorage.setItem(
      COLUMNS_KEY,
      JSON.stringify({ left: 180, right: 520 }),
    );
    await show("coach");
    fireEvent.doubleClick(splitter("right"));
    expect(splitter("right")).toHaveAttribute("aria-valuenow", "400");
    expect(splitter("left")).toHaveAttribute("aria-valuenow", "180");
    expect(layout().children[5]).toHaveStyle({ flex: "0 0 400px" });
  });

  it.each(["coach", "conversation", "prompter"] as const)(
    "%s: Reset layout is in the notes' header, before the previous and next buttons",
    async (view) => {
      await show(view);
      const reset = screen.getByTestId("pn-coach-reset");
      expect(notesPane()).toContainElement(reset);
      expect(reset).toHaveTextContent("Reset layout");
      expect(reset).toHaveAttribute(
        "title",
        "Put the columns and the call's room back to their sizes",
      );
      expect(
        follows(
          reset,
          screen.getByRole("button", { name: "Previous question" }),
        ),
      ).toBe(true);
    },
  );

  it("Reset layout puts both columns and the call's room back, and keeps that for the next session", async () => {
    window.localStorage.setItem(
      COLUMNS_KEY,
      JSON.stringify({ left: 180, right: 520 }),
    );
    window.localStorage.setItem(SLOT_KEY, "90");
    vi.stubGlobal("innerHeight", 768);
    await show("coach");
    expect(screen.getByTestId("pn-call-slot")).toHaveStyle({
      flex: "0 0 90px",
    });
    fireEvent.click(screen.getByTestId("pn-coach-reset"));
    expect(splitter("left")).toHaveAttribute("aria-valuenow", "250");
    expect(splitter("right")).toHaveAttribute("aria-valuenow", "400");
    expect(screen.getByTestId("pn-call-slot")).toHaveStyle({
      flex: "0 0 250px",
    });
    expect(JSON.parse(window.localStorage.getItem(COLUMNS_KEY) ?? "")).toEqual({
      left: 250,
      right: 400,
    });
    expect(window.localStorage.getItem(SLOT_KEY)).toBe("250");
  });

  it("Reset layout leaves the question on show and its notes alone", async () => {
    await show("coach");
    pickListed(1);
    fireEvent.click(screen.getByTestId("pn-coach-reset"));
    expect(asked()).toHaveTextContent(QUESTION_ONE);
    expect(screen.getByTestId("pn-coach-live")).toBeInTheDocument();
  });

  it("Reset layout brings a folded call room back in the prompter too", async () => {
    window.localStorage.setItem(SLOT_KEY, "0");
    vi.stubGlobal("innerHeight", 768);
    await show("prompter");
    fireEvent.click(screen.getByTestId("pn-coach-reset"));
    expect(screen.getByTestId("pn-call-slot")).toHaveStyle({
      flex: "0 0 250px",
    });
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
    expect(listed()).toHaveLength(2);
    expect(screen.getByTestId("pn-coach-questions")).not.toHaveTextContent(
      "And how would you test",
    );
  });

  it("is shown under the question it belongs to, marked as a follow-up with its time", async () => {
    await show("coach", withFollowUp());
    expect(followUps()).toHaveLength(0);
    pickListed(1);
    expect(asked()).toHaveTextContent(QUESTION_ONE);
    expect(followUps()).toHaveLength(1);
    expect(followUps()[0]).toHaveTextContent(/^Follow-up · \d+:\d\d/);
    expect(followUps()[0]).toHaveTextContent(FOLLOW_UP);
    expect(notesPane()).toContainElement(followUps()[0] as HTMLElement);
  });

  it("is small, grey and cut to two lines, with the whole of it one hover away: it places the notes, it is not read out", async () => {
    await show("coach", withFollowUp());
    pickListed(1);
    const said = within(followUps()[0] as HTMLElement).getByText(FOLLOW_UP);
    expect(said).toHaveAttribute("title", FOLLOW_UP);
    expect(said.style.overflow).toBe("hidden");
    expect(said.style.getPropertyValue("-webkit-line-clamp")).toBe("2");
    // Smaller than the question above it.
    expect(Number.parseFloat(said.style.fontSize)).toBeLessThan(
      Number.parseFloat(asked().style.fontSize),
    );
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
    expect(order[0]).toHaveTextContent("Name the criteria");
    expect(order[2]).toHaveTextContent("Canary, then a probe");
    for (const [at, element] of order.entries()) {
      const next = order[at + 1];
      if (next)
        expect(
          element.compareDocumentPosition(next) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    }
  });

  it("of two asked since the coach's last note, the earlier is a follow-up and only the newest waits", async () => {
    posted = [FIRST];
    await show("coach", withFollowUp());
    expect(listed()).toHaveLength(1);
    expect(asked()).toHaveTextContent(QUESTION_ONE);
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
    expect(listed()).toHaveLength(2);
    expect(question(1)).toHaveAttribute("title", QUESTION_ONE);
    pickListed(1);
    expect(asked()).toHaveTextContent(QUESTION_ONE);
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
    expect(asked()).toHaveTextContent(QUESTION_TWO);
    expect(select).not.toHaveBeenCalled();
  });
});
