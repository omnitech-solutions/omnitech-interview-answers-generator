// The one window, state by state, over the real store with a scripted service:
// the toolbar and its menus, the status strip and task chips, the answer and
// code panes, the conversation, click-through, and the ended card.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentation } from "../../focus-presentation";
import {
  configureSessionStores,
  resetSessionStores,
} from "../../session-registry";
import { SKILLS } from "../../shared/skills";
import { answerAction } from "../../testing/live-view-kit";
import {
  action,
  jsonResponse,
  minutesAfter,
  sessionView,
  snapshot,
  streamPage,
  transcript,
} from "../../testing/session-fixtures";
import {
  answerResult,
  codeResult,
  codingAnswer,
} from "../../testing/session-result-fixtures";
import {
  createTestServer,
  type TestServer,
} from "../../testing/session-test-server";
import { OverlayPage } from "../overlay-page";
import { resetCommandClaims } from "./commands";
import { TOAST_TEXT } from "./use-panel-session";

const live = (extra = {}) =>
  sessionView({ processingPolicy: "permitted-remote", ...extra });
let server: TestServer;
const submitFollowUp = vi.fn(async (..._args: unknown[]) => undefined);
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

// The session the server answers with; a test moves it on (ended, paused).
let current = live();
function serve(
  session = live(),
  actions: unknown[] = [],
  observations = [snapshot(1)],
) {
  current = session;
  server = createTestServer(() =>
    streamPage({
      session: current,
      observations,
      nextAfterSequence: observations.length,
      actions: actions as never,
      serverNow: minutesAfter(1, 10),
    }),
  );
  server.on("GET /current", () => jsonResponse({ session: current }));
  server.on("GET /:id", () => jsonResponse({ session: current }));
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
    submitFollowUp,
  });
}
async function show() {
  window.history.replaceState(
    {},
    "",
    "/t/local/p/interview/live/overlay?panel=single&host=native",
  );
  render(<OverlayPage />);
  await flush();
  await flush();
}

// The shell's presentation bridge, with click-through, whose mode a test flips.
function nativeHost(overrides: Record<string, unknown> = {}) {
  let listener: (on: boolean) => void = () => undefined;
  let mode = true;
  const setInteractionMode = vi.fn(async () => true);
  (window as { studioHost?: unknown }).studioHost = {
    presentation: {
      capabilities: ["click-through"],
      openSettings: async () => true,
      closeSettings: async () => true,
      setVisible: async () => true,
      setInteractionMode,
      interactionMode: () => mode,
      onInteractionMode: (next: (on: boolean) => void) => {
        listener = next;
        return () => undefined;
      },
      nativeToasts: true,
      ...overrides,
    },
  };
  return {
    setInteractionMode,
    set: (on: boolean) =>
      act(() => {
        mode = on;
        listener(on);
      }),
  };
}

const named = (text: string) =>
  answerAction(codingAnswer([], text), {
    createdAt: minutesAfter(1),
    updatedAt: minutesAfter(1, 5),
    generatedBy: { runtime: "claude-code", model: "claude-sonnet-5-5" },
    sourceSnapshots: [{ sourceId: "screen", eventId: "evt-1" }],
  });
const solved = () =>
  action({
    actionKind: "solve-code",
    result: codeResult(),
    createdAt: minutesAfter(1, 6),
    updatedAt: minutesAfter(1, 9),
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1, 10)));
  window.localStorage.clear();
  resetSessionStores();
  presentation.reset();
  resetCommandClaims();
  submitFollowUp.mockClear();
  serve();
});
afterEach(() => {
  cleanup();
  resetSessionStores();
  delete (window as { studioHost?: unknown }).studioHost;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("capture button and mode menu", () => {
  it("is labelled, shows its hotkey, and turns into Stop while work runs", async () => {
    serve(live(), [
      action({
        actionKind: "draft-answer",
        dispatchStatus: "in_flight",
        result: null,
      }),
    ]);
    await show();
    const stop = screen.getByRole("button", { name: "Stop" });
    expect(stop).toHaveTextContent("⌘⇧S");
  });

  it("opens a real menu whose items carry subtitles from the Auto config", async () => {
    window.localStorage.setItem(
      "interview-studio.live.auto-interval.local",
      "12",
    );
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Capture mode" }));
    const menu = screen.getByRole("menu", { name: "Capture mode" });
    expect(within(menu).queryByRole("combobox")).toBeNull();
    const items = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual([
      "AutoRe-analyse when the screen changes · checks every 12 s, at most 120 per session",
      "ManualAnalyse only when you press ⌘⇧S",
      "Add screen to this problemNeeds a task first",
    ]);
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    expect(items[2]).toHaveAttribute("aria-disabled", "true");
  });

  it("names the task the screen would be added to", async () => {
    serve(live(), [named("Rate limiter")]);
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Capture mode" }));
    expect(
      screen.getByRole("menuitem", { name: /Add screen to T1/ }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("chooses Manual, remembers it, closes and returns focus to the trigger", async () => {
    await show();
    const trigger = screen.getByRole("button", { name: "Capture mode" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Manual/ }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveTextContent("Manual");
    expect(trigger).toHaveFocus();
    expect(
      window.localStorage.getItem("interview-studio.panels.capture-mode.local"),
    ).toBe("manual");
  });

  it("closes on Escape with focus back on the trigger, and on a press outside", async () => {
    await show();
    const trigger = screen.getByRole("button", { name: "Capture mode" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: /^Auto/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves between items with the arrow keys", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Capture mode" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(
      screen.getByRole("menuitemradio", { name: /^Manual/ }),
    ).toHaveFocus();
  });

  it("keeps one menu open at a time", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Capture mode" }));
    fireEvent.click(screen.getByRole("button", { name: "Answer style" }));
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(screen.getByRole("menu")).toHaveAccessibleName("Answer style");
  });
});

describe("microphone", () => {
  it("shows its hotkey, and bars only while listening", async () => {
    await show();
    const mic = within(screen.getByTestId("pn-pill")).getByRole("button", {
      name: "Start microphone",
    });
    expect(mic).toHaveTextContent("⌥R");
    expect(screen.queryByTestId("pn-level")).toBeNull();
  });
});

describe("answer style", () => {
  it("lists every skill from the contract table and writes the choice", async () => {
    await show();
    const button = screen.getByRole("button", { name: "Answer style" });
    expect(button).toHaveTextContent("Data Structures & Algorithms");
    fireEvent.click(button);
    const menu = screen.getByRole("menu", { name: "Answer style" });
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(SKILLS.map((skill) => skill.label));
    fireEvent.click(
      within(menu).getByRole("menuitemradio", { name: "System Design" }),
    );
    await flush();
    expect(button).toHaveTextContent("System Design");
    expect(
      window.localStorage.getItem(
        "interview-studio.live.capture-settings.local",
      ),
    ).toContain("system-design");
  });

  it("follows the skill the keys change", async () => {
    await show();
    await act(async () => {
      fireEvent.keyDown(window, { altKey: true, code: "BracketRight" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByRole("button", { name: "Answer style" }),
    ).toHaveTextContent("System Design");
  });
});

describe("model chip and pane toggles", () => {
  it("names the model that produced the task on show", async () => {
    serve(live(), [named("Rate limiter")]);
    await show();
    expect(screen.getByTestId("pn-model")).toHaveTextContent(
      "Claude · claude-sonnet-5-5",
    );
  });

  it("has no chip before an answer", async () => {
    await show();
    expect(screen.queryByTestId("pn-model")).toBeNull();
  });

  it("labels the pane toggles and hides a pane when toggled", async () => {
    await show();
    for (const label of ["Chat", "Answer", "Code"])
      expect(screen.getByRole("button", { name: label })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    expect(screen.getByTestId("pn-chat")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.queryByTestId("pn-chat")).toBeNull();
    expect(screen.getByRole("button", { name: "Chat" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("click-through", () => {
  it("toggles through the host and shows only a hint when it is on", async () => {
    const host = nativeHost();
    await show();
    expect(screen.queryByTestId("pn-clickthrough")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Click-through" }));
    expect(host.setInteractionMode).toHaveBeenLastCalledWith(false);
    await host.set(false);
    const hint = screen.getByTestId("pn-clickthrough");
    expect(hint).toHaveTextContent(
      "Click-through is on. Clicks reach the page underneath. Press ⌘⇧I to interact.",
    );
    expect(within(hint).queryByRole("button")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Click-through" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Click-through" }));
    expect(host.setInteractionMode).toHaveBeenLastCalledWith(true);
  });

  it("has no button where the host cannot click through", async () => {
    nativeHost({ capabilities: [] });
    await show();
    expect(screen.queryByRole("button", { name: "Click-through" })).toBeNull();
  });
});

describe("shortcut list", () => {
  it("lists the native shortcuts, closes on Escape and gives focus back", async () => {
    await show();
    const button = screen.getByRole("button", { name: "Keyboard shortcuts" });
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveTextContent("Analyze / stop");
    expect(dialog).toHaveTextContent("⌘⇧S");
    expect(dialog).toHaveTextContent("Focus chat");
    expect(dialog).toHaveTextContent("⌘,");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
  });
});

describe("status strip", () => {
  it("says Paused and resumes through the session", async () => {
    serve(live({ status: "paused" }));
    const resumed = vi.fn(() => jsonResponse({ session: live() }));
    server.on("POST /:id/control", resumed);
    await show();
    const strip = screen.getByTestId("pn-strip");
    expect(strip).toHaveTextContent("Paused");
    expect(strip).toHaveTextContent(
      "Nothing is captured and no new work starts",
    );
    fireEvent.click(within(strip).getByRole("button", { name: "Resume" }));
    await flush();
    expect(resumed).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ action: "resume" }),
      }),
    );
  });

  it("shows the working step and a Stop analysis button that stops the session's work", async () => {
    serve(live(), [
      action({
        actionKind: "draft-answer",
        dispatchStatus: "in_flight",
        result: null,
      }),
    ]);
    const stopped = vi.fn(() => jsonResponse({ session: live() }));
    server.on("POST /:id/control", stopped);
    await show();
    const strip = screen.getByTestId("pn-strip");
    expect(strip).toHaveAttribute("data-state", "busy");
    expect(strip).toHaveTextContent("Drafting an answer");
    expect(strip).toHaveTextContent("T1");
    fireEvent.click(
      within(strip).getByRole("button", { name: "Stop analysis" }),
    );
    await flush();
    expect(stopped).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ action: "stop-work" }),
      }),
    );
  });

  it("says what Auto needs when it cannot do its job, ahead of everything calm", async () => {
    await show();
    const strip = screen.getByTestId("pn-strip");
    expect(strip).toHaveAttribute("data-state", "auto-problem");
    expect(strip).toHaveTextContent("Auto · this browser can’t listen");
  });

  it("says Finished for a task that just completed, with the time it took", async () => {
    window.localStorage.setItem("interview-studio.live.auto.local", "off");
    serve(live(), [named("Rate limiter"), solved()]);
    await show();
    const strip = screen.getByTestId("pn-strip");
    expect(strip).toHaveAttribute("data-state", "finished");
    expect(strip).toHaveTextContent("Finished · 9s");
    expect(strip).toHaveTextContent("T1 · press ⌘⇧S for the next problem");
  });
});

describe("task chips and the earlier task", () => {
  const twoTasks = () => [
    named("Rate limiter"),
    answerAction(answerResult(), {
      taskId: "task-2",
      createdAt: minutesAfter(1, 8),
      updatedAt: minutesAfter(1, 9),
    }),
  ];

  it("lists a chip per task and shows the earlier task with a way back", async () => {
    serve(live(), twoTasks());
    await show();
    const chips = within(screen.getByRole("group", { name: "Tasks" }));
    expect(chips.getAllByRole("button")).toHaveLength(2);
    expect(chips.getByRole("button", { name: /^T1 · / })).toBeVisible();
    expect(chips.getByRole("button", { name: /^T2 · / })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByTestId("pn-earlier")).toBeNull();
    fireEvent.click(chips.getByRole("button", { name: /^T1 · / }));
    expect(screen.getByTestId("pn-earlier")).toHaveTextContent("earlier task");
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent("T1 · rev 1");
    fireEvent.click(screen.getByRole("button", { name: "Back to T2" }));
    expect(screen.queryByTestId("pn-earlier")).toBeNull();
  });

  it("shares its selection with the transcript", async () => {
    serve(live(), twoTasks());
    await show();
    const rows = document.querySelectorAll<HTMLElement>(
      '.pn-row[data-kind="assistant"]',
    );
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0] as HTMLElement);
    expect(screen.getByRole("button", { name: /^T1 · / })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("pn-earlier")).toBeVisible();
  });

  it("sends a follow-up to the task on show, and says so in the box", async () => {
    serve(live(), twoTasks());
    await show();
    fireEvent.click(screen.getByRole("button", { name: /^T1 · / }));
    const box = screen.getByLabelText("Message");
    expect(box).toHaveAttribute(
      "placeholder",
      "Add context to T1, or ask a follow-up",
    );
    fireEvent.change(box, { target: { value: "and the cost?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await flush();
    expect(submitFollowUp).toHaveBeenCalledWith(
      expect.any(String),
      "and the cost?",
      { taskId: "task-1", revision: 1 },
      expect.anything(),
    );
  });
});

describe("conversation", () => {
  it("labels what was heard by the source it arrived on, and nothing more", async () => {
    serve(
      live(),
      [],
      [
        snapshot(1),
        transcript(2, "Walk me through it.", {
          sourceId: "application-audio-r1",
        }),
        transcript(3, "Sure.", { sourceId: "microphone-r1" }),
        transcript(4, "Something else.", { sourceId: "mystery" }),
      ],
    );
    await show();
    const label = (text: string) =>
      screen.getByText(text).closest(".pn-row")?.querySelector(".pn-who-label")
        ?.textContent;
    expect(label("Walk me through it.")).toBe("Interviewer · app audio");
    expect(label("Sure.")).toBe("You · mic");
    expect(label("Something else.")).toBe("Heard");
  });

  it("marks where a task started, with its screenshot, and where it was stopped", async () => {
    serve(live(), [
      named("Rate limiter"),
      action({
        taskId: "task-2",
        actionKind: "draft-answer",
        dispatchStatus: "suppressed",
        suppressionReason: "owner_stopped",
        createdAt: minutesAfter(1, 8),
        updatedAt: minutesAfter(1, 9),
      }),
    ]);
    await show();
    const markers = screen
      .getAllByTestId("pn-marker")
      .map((marker) => marker.textContent);
    expect(markers).toContain("S1 captured · T1 started");
    expect(markers).toContain("T2 started");
    expect(markers).toContain("T2 stopped by you · nothing published");
  });

  it("shows a pending reply while a follow-up is in flight", async () => {
    serve(live(), [named("Rate limiter")]);
    submitFollowUp.mockImplementation(() => new Promise(() => undefined));
    await show();
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "why?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await flush();
    expect(screen.getByTestId("pn-pending")).toHaveTextContent(
      "Answering your follow-up…",
    );
  });
});

describe("answer pane", () => {
  it("is empty before anything is analysed, with a button that captures", async () => {
    await show();
    const empty = screen.getByTestId("pn-analysis-empty");
    expect(empty).toHaveTextContent("Nothing analysed yet");
    expect(empty).toHaveTextContent("Auto is on");
    expect(
      within(empty).getByRole("button", { name: /^Analyze screen/ }),
    ).toHaveTextContent("⌘⇧S");
  });

  it("lists the steps of a job in flight, with real time only on the active one", async () => {
    serve(live(), [
      action({
        actionKind: "draft-answer",
        dispatchStatus: "in_flight",
        result: null,
      }),
    ]);
    await show();
    const steps = within(screen.getByTestId("pn-steps")).getAllByRole(
      "listitem",
    );
    expect(steps.map((step) => step.getAttribute("data-state"))).toEqual([
      "done",
      "done",
      "active",
    ]);
    expect(steps[0]).toHaveTextContent("Capturing the screen");
    expect(steps[1]).toHaveTextContent("Reading the problem");
    expect(steps[2]).toHaveTextContent("Drafting an answer");
    expect(steps[1]).not.toHaveTextContent(/\d+s/);
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(steps[2]).toHaveTextContent("3s");
    expect(steps[0]).not.toHaveTextContent(/\d+s/);
  });

  it("says what was stopped, and that nothing was published", async () => {
    serve(live(), [
      action({
        actionKind: "draft-answer",
        dispatchStatus: "suppressed",
        suppressionReason: "owner_stopped",
      }),
    ]);
    await show();
    expect(screen.getByTestId("pn-stopped")).toHaveTextContent(
      "You stopped this analysis. Nothing was published for it. Press ⌘⇧S to start a fresh task.",
    );
  });

  it("describes the task from the shared card: id, revision, screenshot, name, kind", async () => {
    serve(live(), [named("Rate limiter")]);
    await show();
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent(
      "T1 · rev 1from S1",
    );
    expect(screen.getByTestId("pn-problem")).toHaveTextContent("Rate limiter");
    expect(screen.getByTestId("pn-type")).toHaveTextContent(
      "Programming challenge",
    );
  });

  it("copies the answer, saying Copied only after the clipboard accepted it", async () => {
    serve(live(), [named("Rate limiter")]);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    await flush();
    expect(writeText).toHaveBeenCalledWith(
      "A small rate limiter with a configurable window.",
    );
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
  });

  it("says plainly when the clipboard refused", async () => {
    serve(live(), [named("Rate limiter")]);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
      configurable: true,
    });
    document.execCommand = vi.fn(() => false);
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    await flush();
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
    expect(
      screen
        .getAllByRole("alert")
        .some((each) =>
          /Couldn’t copy the answer/.test(each.textContent ?? ""),
        ),
    ).toBe(true);
  });
});

describe("code pane", () => {
  it("shows the language, the server's own badges, the code and Copy code", async () => {
    serve(live(), [named("Rate limiter"), solved()]);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await show();
    expect(screen.getByTestId("pn-language")).toHaveTextContent("TYPESCRIPT");
    const badges = within(screen.getByLabelText(/established about this code/));
    expect(badges.getByText("Generated")).toBeVisible();
    expect(badges.getByText("5/5 generated tests")).toBeVisible();
    expect(badges.getByText("Not fully verified")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await flush();
    expect(writeText).toHaveBeenCalledWith("export const allow = () => true;");
  });

  it("waits for the approach while the steps show", async () => {
    serve(live(), [
      action({
        actionKind: "draft-answer",
        dispatchStatus: "in_flight",
        result: null,
      }),
    ]);
    await show();
    expect(screen.getByTestId("pn-code-placeholder")).toHaveTextContent(
      "Waits for the approach. Starts automatically.",
    );
  });

  it("says Writing code while the code is being written", async () => {
    serve(live(), [
      named("Rate limiter"),
      action({
        actionKind: "solve-code",
        dispatchStatus: "in_flight",
        result: null,
        createdAt: minutesAfter(1, 6),
        updatedAt: minutesAfter(1, 6),
      }),
    ]);
    await show();
    expect(screen.getByTestId("pn-code-placeholder")).toHaveTextContent(
      "Writing code…",
    );
  });

  it("says why there is no code on a device-only session", async () => {
    serve(live({ processingPolicy: "device-only" }), [named("Rate limiter")]);
    await show();
    expect(screen.getByTestId("pn-code-placeholder")).toHaveTextContent(
      "Device-only mode: the code runner does not run on this Mac.",
    );
  });

  it("says it stopped before code when the owner stopped it", async () => {
    serve(live(), [
      named("Rate limiter"),
      action({
        actionKind: "solve-code",
        dispatchStatus: "suppressed",
        suppressionReason: "owner_stopped",
        createdAt: minutesAfter(1, 6),
        updatedAt: minutesAfter(1, 7),
      }),
    ]);
    await show();
    expect(screen.getByTestId("pn-code-placeholder")).toHaveTextContent(
      "Stopped before code was written.",
    );
  });
});

describe("footer and the ended session", () => {
  it("shows a live dot with the session clock while open", async () => {
    await show();
    expect(screen.getByTestId("ov-clock")).toHaveAccessibleName(
      /^Session time \d+:\d\d$/,
    );
  });

  it("marks the clock paused", async () => {
    serve(live({ status: "paused" }));
    await show();
    expect(screen.getByTestId("ov-clock")).toHaveAttribute(
      "data-paused",
      "true",
    );
  });

  it("shows the ended card with counts, keeps the last answer readable, and offers the summary and a new session", async () => {
    serve(
      live(),
      [named("Rate limiter"), solved()],
      [snapshot(1), transcript(2, "Walk me through it.")],
    );
    const external = vi.fn(async () => undefined);
    (window as { studioHost?: unknown }).studioHost = {
      version: 1,
      hostKind: "native-macos",
      capabilities: ["open-external"],
      captureScreen: async () => ({ ok: false }),
      pinOnTop: async () => false,
      openExternal: external,
      onHotkey: () => () => undefined,
    };
    server.on("POST /:id/control", () => {
      current = live({ status: "ended", endedAt: minutesAfter(5) });
      return jsonResponse({ session: current });
    });
    await show();
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    fireEvent.click(screen.getByRole("button", { name: "End now" }));
    await flush();
    await flush();
    const ended = screen.getByTestId("pn-ended");
    expect(ended).toHaveTextContent("Session ended");
    expect(ended).toHaveTextContent("Nothing was submitted or typed for you.");
    expect(ended).toHaveTextContent("1 utterance");
    expect(ended).toHaveTextContent("1 task");
    expect(ended).toHaveTextContent("1 answer");
    expect(ended).toHaveTextContent("1 code draft");
    expect(screen.getByTestId("pn-problem")).toBeVisible();
    expect(screen.queryByTestId("pn-strip")).toBeNull();
    expect(screen.queryByTestId("ov-clock")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Start a new session" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Open summary" }));
    expect(external).toHaveBeenCalledTimes(1);
    const [url] = external.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/^http.*\/t\/local\/p\/interview\/live\/0b1f6a52/);
  });
});

describe("chat.focus", () => {
  it("focuses the message box, opening the chat first when it is hidden", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.queryByTestId("pn-chat")).toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { altKey: true, shiftKey: true, code: "KeyF" });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByLabelText("Message")).toHaveFocus();
  });
});

describe("toast wording", () => {
  it("names what was copied, with no detail line", () => {
    expect(TOAST_TEXT.copied("answer")).toEqual({
      title: "Copied answer",
      detail: "",
    });
  });
});
