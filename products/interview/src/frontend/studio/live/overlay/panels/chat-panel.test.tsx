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
import {
  minutesAfter,
  sessionView,
  snapshot,
  transcript,
} from "../../testing/session-fixtures";
import { FOCUS_INPUT_EVENT } from "./commands";
import { ChatPanel, type PanelSession } from "./panel-views";

const model = (observations: ReturnType<typeof transcript>[]) =>
  deriveLiveModel({
    session: sessionView({ processingPolicy: "permitted-remote" }),
    observations: [snapshot(1), ...observations],
    actions: [],
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
