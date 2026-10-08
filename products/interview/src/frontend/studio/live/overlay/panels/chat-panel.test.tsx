// The transcript and chat panel on its own, over a scripted panel session: what
// a bubble says, the composer's states, following the newest line with the jump
// control, copy, and focusing the box. Written by role, label and text so it
// holds for the panel however it is drawn.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveLiveModel } from "../../session-state";
import { answerAction } from "../../testing/live-view-kit";
import {
  minutesAfter,
  sessionView,
  snapshot,
  transcript,
} from "../../testing/session-fixtures";
import { answerResult } from "../../testing/session-result-fixtures";
import { FOCUS_INPUT_EVENT } from "./commands";
import { ChatPanel, type PanelSession } from "./panel-views";

const model = (
  observations: ReturnType<typeof transcript>[],
  actions: ReturnType<typeof answerAction>[] = [],
) =>
  deriveLiveModel({
    session: sessionView({ processingPolicy: "permitted-remote" }),
    observations: [snapshot(1), ...observations],
    actions,
    serverClockOffsetMs: 0,
    nowMs: Date.parse(minutesAfter(2)),
  });

function fake(extra: Record<string, unknown> = {}) {
  const calls = {
    press: vi.fn(),
    send: vi.fn(async () => ({ ok: true })),
    toast: vi.fn(),
    notify: vi.fn(),
    setDraft: vi.fn(),
  };
  const session = {
    model: model([]),
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
    // Nothing staged: the conversation ends with the last real row.
    tray: { intent: "add", items: [] },
    live: { mic: "off", interim: "" },
    select: () => undefined,
    setDraft: calls.setDraft,
    send: calls.send,
    press: calls.press,
    toast: calls.toast,
    notify: calls.notify,
    ...extra,
  } as unknown as PanelSession;
  return { session, calls };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const box = () => screen.getByLabelText("Message");
const send = () => screen.getByRole("button", { name: "Send message" });

describe("bubbles", () => {
  it("marks a phrase that grew after it first appeared as edited, once", () => {
    const { session } = fake({
      model: model([
        transcript(2, "Just to kick things off", {
          sourceId: "application-audio-r1",
        }),
        transcript(3, "I would like to understand why.", {
          sourceId: "application-audio-r1",
        }),
        transcript(30, "Sure.", { sourceId: "microphone-r1" }),
      ]),
    });
    render(<ChatPanel s={session} />);
    expect(screen.getAllByText("edited")).toHaveLength(1);
    expect(
      screen.getByText(/Just to kick things off, I would like/),
    ).toBeVisible();
  });

  it("names who spoke, and copies a bubble's words with a toast", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: write } });
    const { session, calls } = fake({
      model: model([
        transcript(2, "Walk me through it.", {
          sourceId: "application-audio-r1",
        }),
      ]),
    });
    render(<ChatPanel s={session} />);
    expect(screen.getByText(/Interviewer · app audio/)).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    });
    expect(write).toHaveBeenCalledWith("Walk me through it.");
    expect(calls.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Copied message" }),
    );
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("says so when the clipboard refuses, and never says Copied", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => false,
    });
    const { session, calls } = fake({
      model: model([
        transcript(2, "Walk me through it.", { sourceId: "microphone-r1" }),
      ]),
    });
    render(<ChatPanel s={session} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    });
    expect(calls.notify).toHaveBeenCalledWith(
      "Couldn’t copy the message. Select it and copy by hand.",
    );
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("shows the words being heard and a note that needs attention", () => {
    const { session } = fake({
      live: { mic: "listening", interim: "OK can you explain the" },
      note: "The reply did not arrive.",
    });
    render(<ChatPanel s={session} />);
    expect(screen.getByText("OK can you explain the")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The reply did not arrive.",
    );
  });
});

describe("the composer", () => {
  it("holds the text in the session's draft and sends it trimmed", async () => {
    const { session, calls } = fake({ draft: "  and the cost?  " });
    render(<ChatPanel s={session} />);
    fireEvent.change(box(), { target: { value: "and the cost? x" } });
    expect(calls.setDraft).toHaveBeenCalledWith("and the cost? x");
    await act(async () => {
      fireEvent.click(send());
    });
    expect(calls.send).toHaveBeenCalledWith("and the cost?");
  });

  it("keeps Send muted until there is text (blank text is none)", () => {
    const empty = fake({ draft: "" });
    const { rerender } = render(<ChatPanel s={empty.session} />);
    expect(send()).toBeDisabled();
    rerender(<ChatPanel s={fake({ draft: "   " }).session} />);
    expect(send()).toBeDisabled();
    rerender(<ChatPanel s={fake({ draft: "why?" }).session} />);
    expect(send()).toBeEnabled();
  });

  it("toggles the microphone: pressed only while it listens", () => {
    const off = fake();
    const { rerender } = render(<ChatPanel s={off.session} />);
    const start = screen.getByRole("button", { name: "Start microphone" });
    expect(start).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(start);
    expect(off.calls.press).toHaveBeenCalledWith("toggle-mic");
    rerender(
      <ChatPanel
        s={fake({ live: { mic: "listening", interim: "" } }).session}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Stop microphone" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("is all disabled once the session is not open", () => {
    render(<ChatPanel s={fake({ open: false, draft: "late" }).session} />);
    expect(box()).toBeDisabled();
    expect(send()).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Start microphone" }),
    ).toBeDisabled();
  });

  it("says which task the box is about", () => {
    render(<ChatPanel s={fake({ target: { targetLabel: "T2" } }).session} />);
    expect(
      screen.getByPlaceholderText("Add context to T2, or ask a follow-up"),
    ).toBeVisible();
  });

  it("takes focus when the focus-chat command fires", () => {
    render(<ChatPanel s={fake().session} />);
    expect(box()).not.toHaveFocus();
    act(() => {
      window.dispatchEvent(new Event(FOCUS_INPUT_EVENT));
    });
    expect(box()).toHaveFocus();
  });
});

describe("following the newest line", () => {
  // The element that scrolls: the log itself, or the panel body around it.
  const scroller = (): HTMLElement => {
    const log = screen.getByRole("log");
    return (log.closest('[data-slot="panel-body"]') as HTMLElement) ?? log;
  };
  const geometry = (box: HTMLElement) => {
    Object.defineProperty(box, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(box, "clientHeight", {
      configurable: true,
      value: 200,
    });
  };
  const speech = (count: number) =>
    model(
      Array.from({ length: count }, (_, at) =>
        transcript(10 + at * 20, `line ${at}`, {
          sourceId: "application-audio-r1",
        }),
      ),
    );
  const scrollUp = (box: HTMLElement) => {
    fireEvent.wheel(box);
    box.scrollTop = 0;
    fireEvent.scroll(box);
  };

  it("offers a way back once the person scrolls up, counts what came, and returns on a press", () => {
    const { rerender } = render(
      <ChatPanel s={fake({ model: speech(2) }).session} />,
    );
    const body = scroller();
    geometry(body);
    expect(
      screen.queryByRole("button", { name: /^Jump to the latest/ }),
    ).toBeNull();
    scrollUp(body);
    expect(
      screen.getByRole("button", { name: /^Jump to the latest/ }),
    ).toBeVisible();
    rerender(<ChatPanel s={fake({ model: speech(3) }).session} />);
    expect(screen.getByText(/1 new/)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: /^Jump to the latest/ }),
    );
    expect(
      screen.queryByRole("button", { name: /^Jump to the latest/ }),
    ).toBeNull();
    expect(body.scrollTop).toBe(1000);
  });

  it("does not stop following when the content merely grows", () => {
    render(<ChatPanel s={fake({ model: speech(2) }).session} />);
    const body = scroller();
    geometry(body);
    // No wheel, touch, key or press: this scroll is the layout's, not the person's.
    body.scrollTop = 0;
    fireEvent.scroll(body);
    expect(
      screen.queryByRole("button", { name: /^Jump to the latest/ }),
    ).toBeNull();
  });
});

describe("what the transcript holds", () => {
  it("draws a capture as one chip among the lines, never as a bubble", () => {
    render(<ChatPanel s={fake().session} />);
    const chips = document.querySelectorAll('[data-slot="transcript-event"]');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent(/^S1 captured/);
    expect(
      document.querySelector('[data-slot="transcript-speech"]'),
    ).toBeNull();
  });

  it("hides the chips and lines of what was cleared", () => {
    const { session } = fake({ clearedAt: Date.parse(minutesAfter(5)) });
    render(<ChatPanel s={session} />);
    expect(document.querySelector('[data-slot="transcript-event"]')).toBeNull();
  });

  it("ends with a 'Studio · New problem' row while a new capture is staged, and never for one that adds", () => {
    const staged = { id: "staged-1" };
    const { rerender } = render(
      <ChatPanel
        s={fake({ tray: { intent: "new", items: [staged, staged] } }).session}
      />,
    );
    const rows = document.querySelectorAll('[data-slot="transcript-speech"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Studio · New problem");
    expect(rows[0]).toHaveTextContent("2 screenshots staged");
    rerender(
      <ChatPanel
        s={fake({ tray: { intent: "add", items: [staged] } }).session}
      />,
    );
    expect(
      document.querySelector('[data-slot="transcript-speech"]'),
    ).toBeNull();
  });

  it("has no record dot and no system line while the microphone listens", () => {
    render(
      <ChatPanel
        s={fake({ live: { mic: "listening", interim: "" } }).session}
      />,
    );
    expect(screen.queryByRole("status", { name: "Recording" })).toBeNull();
    expect(screen.queryByText(/Recording in Progress/)).toBeNull();
    expect(screen.queryByText(/System/)).toBeNull();
  });
});

describe("an answer in the transcript", () => {
  const withAnswer = (draft: string, extra: Record<string, unknown> = {}) =>
    fake({
      model: model([], [answerAction(answerResult({ draft }))]),
      ...extra,
    });
  const bubble = () => screen.getByTitle("Show this answer");

  it("is a button that shows its task, by press or by Enter or Space, and its copy control never presses it", () => {
    const { session } = withAnswer("A plan.");
    const select = vi.fn();
    render(<ChatPanel s={{ ...session, select } as PanelSession} />);
    expect(bubble()).toHaveAttribute("role", "button");
    expect(bubble()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(bubble());
    expect(select).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(bubble(), { key: "Enter" });
    fireEvent.keyDown(bubble(), { key: " " });
    expect(select).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    expect(select).toHaveBeenCalledTimes(3);
  });

  it("marks the chosen answer pressed", () => {
    const first = withAnswer("A plan.");
    const taskId = first.session.model.tasks[0]?.taskId;
    const { session } = withAnswer("A plan.", { selected: { taskId } });
    render(<ChatPanel s={session} />);
    expect(bubble()).toHaveAttribute("aria-pressed", "true");
  });

  it("shows fenced code as a highlighted code block in the coding language", () => {
    const { session } = withAnswer("Plan:\n```\nconst a = 1;\n```", {
      prefs: { settings: { language: "typescript" } },
    });
    render(<ChatPanel s={session} />);
    const block = document.querySelector('[data-slot="transcript-code"]');
    expect(block).not.toBeNull();
    expect(block?.querySelector(".hljs-keyword")).toHaveTextContent("const");
  });
});

describe("sending with the keyboard", () => {
  it("Enter sends the text, and Enter on blank text sends nothing", async () => {
    const full = fake({ draft: "why?" });
    const { rerender } = render(<ChatPanel s={full.session} />);
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Enter" });
    });
    expect(full.calls.send).toHaveBeenCalledWith("why?");
    const blank = fake({ draft: "  " });
    rerender(<ChatPanel s={blank.session} />);
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Enter" });
    });
    expect(blank.calls.send).not.toHaveBeenCalled();
  });

  it("Shift+Enter never sends: the owner is still writing", async () => {
    const full = fake({ draft: "why?" });
    render(<ChatPanel s={full.session} />);
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    });
    expect(full.calls.send).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(box(), { key: "Enter" });
    });
    expect(full.calls.send).toHaveBeenCalledTimes(1);
  });
});

describe("the conversation views (chosen from the View menu)", () => {
  const QUESTION = "How do you decide when a feature should be a microservice";
  const chosen = (
    globalThis as unknown as { chatViewForTests: { view: string } }
  ).chatViewForTests;
  // The conversation reads the coach's notes itself; none are posted here.
  const serveNotes = () => {
    const fetched = vi.fn(
      async () =>
        new Response(JSON.stringify({ revision: 0, notes: [] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetched);
    return fetched;
  };
  const asked = () =>
    fake({
      model: model([
        transcript(2, QUESTION, { sourceId: "application-audio-r1" }),
      ]),
    }).session;
  afterEach(() => window.localStorage.clear());

  it("the transcript layout shows the transcript, with the View menu in its header, and reads no coach notes", async () => {
    const fetched = serveNotes();
    render(<ChatPanel s={asked()} />);
    expect(screen.getByLabelText("Transcript and chat")).toBeInTheDocument();
    expect(screen.queryByTestId("pn-conversation")).toBeNull();
    expect(screen.queryByTestId("pn-call-slot")).toBeNull();
    expect(screen.getByTestId("pn-chat-view")).toHaveAccessibleName(
      "Conversation view",
    );
    await act(async () => undefined);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("the conversation layout shows the questions in place of the transcript, and keeps the View menu and the message box", async () => {
    chosen.view = "conversation";
    const fetched = serveNotes();
    render(<ChatPanel s={asked()} />);
    expect(screen.getByTestId("pn-conversation")).toHaveTextContent(QUESTION);
    expect(screen.queryByLabelText("Transcript and chat")).toBeNull();
    expect(screen.getByTestId("pn-chat-view")).toBeInTheDocument();
    expect(box()).toBeEnabled();
    // No room is kept for the call window in this layout.
    expect(screen.queryByTestId("pn-call-slot")).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
    // The notes are read here, since the coach panel stands down.
    await act(async () => undefined);
    expect(fetched).toHaveBeenCalledWith(
      "/api/v1/coach-notes",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("the conversation under the call keeps room for the call window above it, with a bar to resize that room", async () => {
    chosen.view = "conversation-slot";
    serveNotes();
    render(<ChatPanel s={asked()} />);
    await act(async () => undefined);
    const slot = screen.getByTestId("pn-call-slot");
    const conversation = screen.getByTestId("pn-conversation");
    expect(conversation).toHaveTextContent(QUESTION);
    // The room comes first: the conversation reads directly beneath the call.
    expect(
      slot.compareDocumentPosition(conversation) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // It sits outside the pane's card, so the call shows through it.
    expect(screen.getByTestId("pn-chat")).not.toContainElement(slot);
    const bar = screen.getByRole("slider", {
      name: "Height of the room for the call window",
    });
    expect(bar).toHaveAttribute("data-testid", "pn-call-slot-resize");
    // A surface of its own, so it takes the mouse outside any card.
    expect(bar).toHaveAttribute("data-hit-surface");
    expect(screen.getByTestId("pn-chat-view")).toBeInTheDocument();
  });
});
