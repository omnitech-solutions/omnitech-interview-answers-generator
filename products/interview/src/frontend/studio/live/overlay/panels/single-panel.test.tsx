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
import { noteScreenProblem, resetScreenProblems } from "../../screen-problems";
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
import { setCoachWindowHeight, setCoachWindowWidth } from "./coach-columns";
import { resetCommandClaims } from "./commands";
import { GREEN_MENU_GRACE_MS, GREEN_MENU_HOVER_MS } from "./toolbar-config";
import { keyOpen, pointerOpen, tipOf } from "./toolbar-test-kit";
import { TOAST_TEXT } from "./use-panel-session";

const live = (extra = {}) =>
  sessionView({ processingPolicy: "permitted-remote", ...extra });
let server: TestServer;
const submitFollowUp = vi.fn(async (..._args: unknown[]) => undefined);
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const toolbar = () => screen.getByRole("toolbar", { name: "Session controls" });

// The session the server answers with; a test moves it on (ended, paused).
// `served` is the action list a later poll answers with (a new task arriving).
let current = live();
let served: unknown[] = [];
function serve(
  session = live(),
  actions: unknown[] = [],
  observations = [snapshot(1)],
) {
  current = session;
  served = actions;
  server = createTestServer(() =>
    streamPage({
      session: current,
      observations,
      nextAfterSequence: observations.length,
      actions: served as never,
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
  resetScreenProblems();
  submitFollowUp.mockClear();
  serve();
});
afterEach(() => {
  cleanup();
  resetSessionStores();
  delete (window as { studioHost?: unknown }).studioHost;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("capture button and mode menu", () => {
  const caret = () =>
    screen.getByRole("button", {
      name: /^(Screen to capture|Capture options)/,
    });
  const rows = () => [
    ...screen
      .getByRole("menu", { name: /^(Screen to capture|Capture options)/ })
      .querySelectorAll<HTMLElement>('[role^="menuitem"]'),
  ];

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
    expect(tipOf(stop)).toContain("⌘⇧S");
    // The ring replaces the icon while the run is analysing.
    expect(stop).toHaveAttribute("aria-busy", "true");
  });

  it("is ONE split control: the mode lives in the caret menu, with no mode pill", async () => {
    await show();
    expect(screen.queryByRole("button", { name: /^Capture mode/ })).toBeNull();
    const split = screen.getByTestId("pn-capture");
    expect(
      within(split).getByRole("button", { name: "Analyze screen" }),
    ).toBeVisible();
    expect(
      within(split).getByRole("button", {
        name: /^(Screen to capture|Capture options)/,
      }),
    ).toBeVisible();
    expect(split).not.toHaveTextContent("Manual");
    expect(split).not.toHaveTextContent("Auto");
  });

  it("opens a real menu: When to analyse (Manual, then Auto, with the Auto config), then the screen action", async () => {
    window.localStorage.setItem(
      "interview-studio.live.auto-interval.local",
      "12",
    );
    await show();
    pointerOpen(caret());
    const menu = screen.getByRole("menu", { name: /Capture options/ });
    expect(within(menu).queryByRole("combobox")).toBeNull();
    const items = rows();
    expect(items.map((item) => item.textContent)).toEqual([
      "ManualAnalyse only when you press ⌘⇧S",
      "AutoRe-analyse when the screen changes · checks every 12 s, at most 120 per session⌥⇧U",
      "Add screen to this problemNeeds a task first",
    ]);
    expect(
      within(menu).getByRole("group", { name: "When to analyse" }),
    ).toBeVisible();
    expect(items[1]).toHaveAttribute("aria-checked", "true");
    expect(items[2]).toHaveAttribute("aria-disabled", "true");
  });

  it("is tinted blue for Auto, neutral for Manual, and its tooltip names the mode", async () => {
    await show();
    const split = screen.getByTestId("pn-capture");
    const main = within(split).getByRole("button", { name: "Analyze screen" });
    expect(split).toHaveAttribute("data-tone", "accent");
    expect(tipOf(main)).toMatch(/^Auto/);
    await act(async () => {
      fireEvent.keyDown(window, { altKey: true, shiftKey: true, code: "KeyH" });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(split).toHaveAttribute("data-tone", "neutral");
    expect(tipOf(main)).toMatch(/^Manual/);
  });

  it("names the task the screen would be added to", async () => {
    serve(live(), [named("Rate limiter")]);
    await show();
    pointerOpen(caret());
    expect(
      screen.getByRole("menuitem", { name: /Add screen to T1/ }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("chooses Manual, remembers it in the one Auto preference and closes", async () => {
    await show();
    pointerOpen(caret());
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Manual/ }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByTestId("pn-capture")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
    expect(
      window.localStorage.getItem("interview-studio.live.auto.local"),
    ).toBe("off");
    // No second store for the same fact.
    expect(
      window.localStorage.getItem("interview-studio.panels.capture-mode.local"),
    ).toBeNull();
  });

  it("keeps the status out of the capture button and the toolbar triggers carry their value", async () => {
    await show();
    expect(
      screen.getByRole("button", {
        name: "Answer style: Data Structures & Algorithms",
      }),
    ).toBeVisible();
    const capture = screen.getByRole("button", { name: "Analyze screen" });
    expect(capture.querySelector('[role="status"]')).toBeNull();
    expect(screen.queryByTestId("pn-status")).toBeNull();
    expect(screen.queryByTestId("pn-dot")).toBeNull();
  });

  it("agrees with the Auto hotkey: one state feeds the menu check and the tint", async () => {
    await show();
    pointerOpen(caret());
    expect(
      screen.getByRole("menuitemradio", { name: /^Auto/ }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await act(async () => {
      fireEvent.keyDown(window, { altKey: true, shiftKey: true, code: "KeyH" });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(
      window.localStorage.getItem("interview-studio.live.auto.local"),
    ).toBe("off");
    pointerOpen(caret());
    expect(
      screen.getByRole("menuitemradio", { name: /^Manual/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemradio", { name: /^Auto/ }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("follows an Auto preference changed in another window", async () => {
    await show();
    window.localStorage.setItem("interview-studio.live.auto.local", "off");
    await act(async () => {
      window.dispatchEvent(new Event("storage"));
    });
    expect(screen.getByTestId("pn-capture")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
  });

  it("closes on Escape with focus back on the caret, and on a press outside", async () => {
    await show();
    keyOpen(caret());
    await flush();
    expect(
      screen.getByRole("menuitemradio", { name: /^Manual/ }),
    ).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    await flush();
    expect(caret()).toHaveFocus();
    pointerOpen(caret());
    // The menu starts listening for a press outside a tick after it opens.
    await flush();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves between items with the arrow keys", async () => {
    await show();
    keyOpen(caret());
    await flush();
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowDown",
    });
    await flush();
    expect(screen.getByRole("menuitemradio", { name: /^Auto/ })).toHaveFocus();
  });

  it("keeps one menu open at a time", async () => {
    await show();
    pointerOpen(caret());
    pointerOpen(screen.getByRole("button", { name: /^Answer style/ }));
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(screen.getByRole("menu")).toHaveAccessibleName("Answer style");
  });
});

describe("window controls", () => {
  const dot = (id: string) => screen.getByTestId(`pn-dot-${id}`);
  const mode = () => screen.getByTestId("pn-root").dataset["windowMode"];
  // A host with every window operation, recording what the page asked of it in
  // order. Toasts are drawn by the page here so they can be read.
  function windowHost(overrides: Record<string, unknown> = {}) {
    const calls: string[] = [];
    const record = (name: string) =>
      vi.fn(async (...args: unknown[]) => {
        calls.push(
          args.length === 0 ? name : `${name}(${JSON.stringify(args[0])})`,
        );
        return true;
      });
    const fns = {
      setVisible: record("setVisible"),
      setWindowSize: record("setWindowSize"),
      setFullScreen: record("setFullScreen"),
      quit: record("quit"),
    };
    const host = nativeHost({
      capabilities: ["click-through", "always-on-top"],
      nativeToasts: false,
      ...fns,
      ...overrides,
    });
    return { ...host, ...fns, calls };
  }
  const hover = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  const items = () =>
    within(screen.getByRole("menu", { name: "Window size" })).getAllByRole(
      "menuitemradio",
    );

  it("draws red, yellow and green, named, in order", async () => {
    windowHost();
    await show();
    const dots = within(screen.getByRole("group", { name: "Window controls" }))
      .getAllByRole("button")
      .map((button) => [
        button.getAttribute("aria-label"),
        button.getAttribute("data-colour"),
      ]);
    expect(dots).toEqual([
      ["Quit Interview Studio", "red"],
      ["Hide window", "yellow"],
      [
        "Full screen: click. Hold the pointer here for more window sizes",
        "green",
      ],
    ]);
    expect(dot("hide")).toHaveAttribute(
      "title",
      expect.stringContaining("⌘⇧V"),
    );
  });

  it("never offers hide, quit or sizes where nothing can bring the window back or do them", async () => {
    nativeHost();
    await show();
    expect(dot("hide")).toBeDisabled();
    expect(dot("quit")).toBeDisabled();
    expect(dot("size")).toBeDisabled();
  });

  describe("window height", () => {
    it("asks the panes' height back when they show in a short window (after a pause, or a short start)", async () => {
      const host = windowHost();
      const tall = window.innerHeight;
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 144,
      });
      try {
        await show();
        const sizes = host.calls.filter((call) =>
          call.startsWith("setWindowSize("),
        );
        expect(sizes.length).toBeGreaterThan(0);
        expect(sizes.at(-1)).toContain('"height":640');
      } finally {
        Object.defineProperty(window, "innerHeight", {
          configurable: true,
          value: tall,
        });
      }
    });

    it("leaves the person's own height alone when the window is already tall enough", async () => {
      const host = windowHost();
      const tall = window.innerHeight;
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 820,
      });
      try {
        await show();
        const sizes = host.calls.filter((call) =>
          call.startsWith("setWindowSize("),
        );
        expect(sizes.length).toBeGreaterThan(0);
        expect(sizes.at(-1)).not.toContain("height");
      } finally {
        Object.defineProperty(window, "innerHeight", {
          configurable: true,
          value: tall,
        });
      }
    });
  });

  describe("yellow hides", () => {
    it("pauses a capturing session first, then hides, and says it paused", async () => {
      const host = windowHost();
      const order: string[] = [];
      server.on("POST /:id/control", (request) => {
        order.push(
          `pause:${(request as { body?: { action?: string } }).body?.action}`,
        );
        current = live({ status: "paused" });
        return jsonResponse({ session: current });
      });
      host.setVisible.mockImplementation(async () => {
        order.push("setVisible(false)");
        return true;
      });
      await show();
      fireEvent.click(dot("hide"));
      await flush();
      await flush();
      expect(order).toEqual(["pause:pause", "setVisible(false)"]);
      expect(screen.getByTestId("pn-toasts")).toHaveTextContent(
        "Paused while hidden",
      );
    });

    it("hides a session that is already paused or ended without pausing again", async () => {
      serve(live({ status: "paused" }));
      const control = vi.fn(() => jsonResponse({ session: current }));
      server.on("POST /:id/control", control);
      const host = windowHost();
      await show();
      fireEvent.click(dot("hide"));
      await flush();
      expect(host.setVisible).toHaveBeenCalledWith(false);
      expect(control).not.toHaveBeenCalled();
      cleanup();
      serve(live({ status: "ended", endedAt: minutesAfter(5) }));
      const ended = windowHost();
      await show();
      fireEvent.click(dot("hide"));
      await flush();
      expect(ended.setVisible).toHaveBeenCalledWith(false);
    });

    it("stays visible, with the reason, when the pause is refused", async () => {
      const host = windowHost();
      server.on("POST /:id/control", () => jsonResponse({ error: "no" }, 500));
      await show();
      fireEvent.click(dot("hide"));
      await flush();
      await flush();
      expect(host.setVisible).not.toHaveBeenCalled();
    });
  });

  describe("red quits", () => {
    it("asks first, focuses Cancel, and Cancel does nothing", async () => {
      const host = windowHost();
      await show();
      fireEvent.click(dot("quit"));
      const dialog = screen.getByRole("alertdialog", {
        name: "Quit Interview Studio?",
      });
      expect(dialog).toHaveTextContent(
        "Your session stays on the server; capture and listening stop here.",
      );
      const cancel = within(dialog).getByRole("button", { name: "Cancel" });
      expect(cancel).toHaveFocus();
      fireEvent.click(cancel);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(host.quit).not.toHaveBeenCalled();
    });

    it("Quit calls the shell once; Escape cancels and returns focus to the dot", async () => {
      const host = windowHost();
      await show();
      fireEvent.click(dot("quit"));
      fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), {
        key: "Escape",
      });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(dot("quit")).toHaveFocus();
      expect(host.quit).not.toHaveBeenCalled();
      fireEvent.click(dot("quit"));
      fireEvent.click(screen.getByRole("button", { name: "Quit" }));
      expect(host.quit).toHaveBeenCalledTimes(1);
    });
  });

  describe("green", () => {
    it("a click toggles full screen on and off, and the window says which", async () => {
      const host = windowHost();
      await show();
      expect(mode()).toBe("normal");
      fireEvent.click(dot("size"));
      expect(host.calls).toContain("setFullScreen(true)");
      expect(mode()).toBe("full");
      fireEvent.click(dot("size"));
      expect(
        host.calls.filter((call) => call.startsWith("setFullScreen")),
      ).toEqual(["setFullScreen(true)", "setFullScreen(false)"]);
      expect(mode()).toBe("normal");
    });

    it("hover opens the menu after the delay and not before", async () => {
      windowHost();
      await show();
      fireEvent.mouseEnter(dot("size").parentElement as HTMLElement);
      await hover(GREEN_MENU_HOVER_MS - 1);
      expect(screen.queryByRole("menu", { name: "Window size" })).toBeNull();
      await hover(1);
      expect(items().map((item) => item.textContent)).toEqual([
        "NormalThe toolbar with the chat, answer and code panes",
        "Mini playerA small always-on-top card with the essentials",
        "Full screenFill this display with every pane · Esc leaves",
      ]);
      expect(items()[0]).toHaveAttribute("aria-checked", "true");
      expect(dot("size")).toHaveAttribute("aria-expanded", "true");
      expect(dot("size")).toHaveAttribute("aria-haspopup", "menu");
    });

    it("leaving before the delay cancels it; leaving the open menu closes it after a short grace", async () => {
      windowHost();
      await show();
      const area = dot("size").parentElement as HTMLElement;
      fireEvent.mouseEnter(area);
      await hover(500);
      fireEvent.mouseLeave(area);
      await hover(2000);
      expect(screen.queryByRole("menu", { name: "Window size" })).toBeNull();
      fireEvent.mouseEnter(area);
      await hover(GREEN_MENU_HOVER_MS);
      fireEvent.mouseLeave(area);
      await hover(GREEN_MENU_GRACE_MS - 1);
      expect(screen.getByRole("menu", { name: "Window size" })).toBeVisible();
      // Back over it before the grace ends keeps it open.
      fireEvent.mouseEnter(area);
      await hover(GREEN_MENU_GRACE_MS * 3);
      expect(screen.getByRole("menu", { name: "Window size" })).toBeVisible();
      fireEvent.mouseLeave(area);
      await hover(GREEN_MENU_GRACE_MS);
      expect(screen.queryByRole("menu", { name: "Window size" })).toBeNull();
    });

    it("ArrowDown and the context menu open it for keyboard and touch; Escape closes it and returns focus to the dot", async () => {
      windowHost();
      await show();
      dot("size").focus();
      fireEvent.keyDown(dot("size"), { key: "ArrowDown" });
      await hover(0);
      expect(items()[0]).toHaveFocus();
      fireEvent.keyDown(items()[0] as HTMLElement, { key: "ArrowDown" });
      await hover(0);
      expect(items()[1]).toHaveFocus();
      fireEvent.keyDown(items()[1] as HTMLElement, { key: "ArrowUp" });
      await hover(0);
      expect(items()[0]).toHaveFocus();
      fireEvent.keyDown(items()[0] as HTMLElement, { key: "Escape" });
      await hover(0);
      expect(screen.queryByRole("menu", { name: "Window size" })).toBeNull();
      expect(dot("size")).toHaveFocus();
      fireEvent.contextMenu(dot("size"));
      expect(screen.getByRole("menu", { name: "Window size" })).toBeVisible();
    });

    it("choosing Mini player asks for the mini size and draws the card without panes", async () => {
      const host = windowHost();
      await show();
      fireEvent.keyDown(dot("size"), { key: "ArrowDown" });
      fireEvent.click(items()[1] as HTMLElement);
      expect(mode()).toBe("mini");
      expect(host.calls).toContain(
        `setWindowSize(${JSON.stringify({ width: 440, height: 190 })})`,
      );
      expect(screen.getByTestId("pn-mini-card")).toBeVisible();
      expect(document.querySelector(".pn-single-body")).toBeNull();
      expect(screen.queryByTestId("pn-strip")).toBeNull();
    });

    it("a click from the Mini player goes back to Normal", async () => {
      const host = windowHost();
      await show();
      fireEvent.keyDown(dot("size"), { key: "ArrowDown" });
      fireEvent.click(items()[1] as HTMLElement);
      fireEvent.click(dot("size"));
      expect(mode()).toBe("normal");
      expect(host.setFullScreen).not.toHaveBeenCalled();
    });

    it("the menu checks the current size and Normal brings the panes and width back", async () => {
      const host = windowHost();
      await show();
      // Hide the answer pane, go Mini, come back: the same panes show.
      fireEvent.click(screen.getByRole("button", { name: "Answer" }));
      const before = document.querySelectorAll(".pn-single-pane[data-which]");
      expect(before).toHaveLength(2);
      fireEvent.keyDown(dot("size"), { key: "ArrowDown" });
      fireEvent.click(items()[1] as HTMLElement);
      fireEvent.keyDown(dot("size"), { key: "ArrowDown" });
      expect(items()[1]).toHaveAttribute("aria-checked", "true");
      fireEvent.click(items()[0] as HTMLElement);
      expect(mode()).toBe("normal");
      expect(
        [...document.querySelectorAll(".pn-single-pane[data-which]")].map(
          (pane) => pane.getAttribute("data-which"),
        ),
      ).toEqual(["chat", "code"]);
      // The width is asked for again without a height (the shell restores its own).
      const last = host.setWindowSize.mock.calls.at(-1)?.[0] as {
        width: number;
        height?: number;
      };
      expect(last.height).toBeUndefined();
      expect(last.width).toBeGreaterThan(440);
    });

    it("Back to normal leaves the Mini player; Escape does not (D27 names only full screen)", async () => {
      windowHost();
      await show();
      const toMini = () => {
        fireEvent.keyDown(dot("size"), { key: "ArrowDown" });
        fireEvent.click(items()[1] as HTMLElement);
      };
      toMini();
      fireEvent.click(screen.getByRole("button", { name: /Back to normal/ }));
      expect(mode()).toBe("normal");
      toMini();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(mode()).toBe("mini");
    });

    it("full screen keeps the dots and the footer, and Escape leaves it", async () => {
      const host = windowHost();
      await show();
      fireEvent.click(dot("size"));
      expect(screen.getByTestId("pn-dot-size")).toBeVisible();
      expect(screen.queryByText(/Visible window/)).toBeNull();
      expect(
        document.querySelectorAll(".pn-single-pane[data-which]"),
      ).toHaveLength(3);
      // The fit effect stays out of the shell's way.
      host.setWindowSize.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Code" }));
      expect(host.setWindowSize).not.toHaveBeenCalled();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(host.setFullScreen).toHaveBeenLastCalledWith(false);
      expect(mode()).toBe("normal");
    });

    it("Escape while typing in a field keeps full screen", async () => {
      const host = windowHost();
      await show();
      fireEvent.click(dot("size"));
      const field = document.createElement("textarea");
      document.body.append(field);
      field.focus();
      fireEvent.keyDown(field, { key: "Escape" });
      expect(mode()).toBe("full");
      field.remove();
      expect(host.setFullScreen).not.toHaveBeenLastCalledWith(false);
    });

    it("switching from full screen to Mini restores the frame first", async () => {
      const host = windowHost();
      await show();
      fireEvent.click(dot("size"));
      host.calls.length = 0;
      fireEvent.keyDown(dot("size"), { key: "ArrowDown" });
      fireEvent.click(items()[1] as HTMLElement);
      expect(host.calls[0]).toBe("setFullScreen(false)");
      expect(host.calls[1]).toMatch(/^setWindowSize/);
      expect(mode()).toBe("mini");
    });
  });
});

describe("the capture split control and the microphone with a native engine", () => {
  const engineState = {
    v: 1,
    pairing: "paired",
    listening: true,
    paused: false,
    sources: { microphone: "listening", "system-audio": "off", screen: "off" },
    lastHeardAgeSeconds: null,
    hint: null,
  };
  function withEngine(calls: string[], over: Record<string, unknown> = {}) {
    const ok = (name: string) => async () => {
      calls.push(name);
      return { ok: true, engine: engineState };
    };
    (
      window as unknown as { studioHost: { engine: unknown } }
    ).studioHost.engine = {
      start: ok("start"),
      stop: ok("stop"),
      pause: ok("pause"),
      resume: ok("resume"),
      status: ok("status"),
      onEvent: () => () => undefined,
      ...over,
    };
  }

  it("a held (paused) session locks the microphone control with the reason and its press never stops the engine", async () => {
    const calls: string[] = [];
    nativeHost();
    withEngine(calls);
    serve(live({ status: "paused" }));
    window.localStorage.setItem("omnitech:auto:t", "1");
    await show();
    const button = within(toolbar()).getByRole("button", {
      name: /microphone/,
    });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(tipOf(button)).toBe("Resume to capture");
    fireEvent.click(button);
    await flush();
    expect(calls).not.toContain("stop");
  });
});

describe("a paused session", () => {
  it("sizes the window for the toolbar alone, so the strip and footer are as wide as it, and back for the panes on resume", async () => {
    const sizes: number[] = [];
    nativeHost({
      capabilities: ["always-on-top"],
      setWindowSize: async (size: { width: number }) => {
        sizes.push(size.width);
        return true;
      },
      setFullScreen: async () => true,
      quit: async () => true,
    });
    serve(live({ status: "paused" }));
    await show();
    const held = sizes.at(-1) as number;
    cleanup();
    serve(live());
    await show();
    expect(sizes.at(-1) as number).toBeGreaterThan(held);
  });
  it("shows no body panels: the toolbar, the paused strip and the footer stay, and the pane toggles are locked with the reason", async () => {
    serve(live({ status: "paused" }));
    await show();
    expect(document.querySelector(".pn-single-body")).toBeNull();
    expect(toolbar()).toBeVisible();
    expect(screen.getByRole("group", { name: /paused$/ })).toHaveTextContent(
      "Paused",
    );
    expect(screen.queryByTestId("pn-strip")).toBeNull();
    expect(document.querySelector(".pn-single-foot")).not.toBeNull();
    for (const label of ["Chat", "Answer", "Code"]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(tipOf(button)).toBe("Paused. Resume the session to see this.");
    }
    cleanup();
    serve(live());
    await show();
    expect(document.querySelector(".pn-single-body")).not.toBeNull();
  });

  it("locks the capture button and the microphone (saying why), keeps the caret menu and its modes usable, and unlocks them once it runs", async () => {
    serve(live({ status: "paused" }));
    await show();
    const split = screen.getByTestId("pn-capture");
    expect(split).toHaveAttribute("data-tone", "dim");
    const main = within(split).getByRole("button", { name: "Analyze screen" });
    expect(main).toHaveAttribute("aria-disabled", "true");
    expect(tipOf(main)).toBe("Resume to capture");
    const mode = within(split).getByRole("button", {
      name: /^(Screen to capture|Capture options)/,
    });
    // The menu never waits: the mode can be changed while paused.
    expect(mode).toBeEnabled();
    expect(mode).not.toHaveAttribute("aria-disabled");
    pointerOpen(mode);
    expect(
      screen.getByRole("menuitemradio", { name: /^Manual/ }),
    ).not.toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("menuitemradio", { name: /^Auto/ }),
    ).not.toHaveAttribute("aria-disabled", "true");
    // Adding a screen needs the session to run: it says so.
    expect(
      screen.getByRole("menuitem", { name: /Add screen/ }),
    ).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(document.body, { key: "Escape" });
    const mic = within(toolbar()).getByRole("button", {
      name: /microphone/,
    });
    expect(mic).toHaveAttribute("aria-disabled", "true");
    expect(tipOf(mic)).toBe("Resume to capture");
    cleanup();
    serve(live());
    await show();
    expect(
      within(screen.getByTestId("pn-capture")).getByRole("button", {
        name: "Analyze screen",
      }),
    ).toBeEnabled();
  });
});

describe("popovers", () => {
  it("every toolbar popover is drawn inside the window's own root, on a library surface", async () => {
    nativeHost({
      capabilities: ["always-on-top"],
      setWindowSize: async () => true,
      setFullScreen: async () => true,
      quit: async () => true,
    });
    await show();
    const root = screen.getByTestId("pn-root");
    const opens: [string, () => void][] = [
      [
        "menu",
        () =>
          pointerOpen(
            screen.getByRole("button", {
              name: /^(Screen to capture|Capture options)/,
            }),
          ),
      ],
      [
        "menu",
        () =>
          pointerOpen(
            within(toolbar()).getByRole("button", {
              name: "Microphone options",
            }),
          ),
      ],
      [
        "menu",
        () =>
          pointerOpen(screen.getByRole("button", { name: /^Answer style/ })),
      ],
      [
        "dialog",
        () =>
          fireEvent.click(
            screen.getByRole("button", { name: "Keyboard shortcuts" }),
          ),
      ],
      [
        "menu",
        () =>
          fireEvent.keyDown(screen.getByTestId("pn-dot-size"), {
            key: "ArrowDown",
          }),
      ],
      ["alertdialog", () => fireEvent.click(screen.getByTestId("pn-dot-quit"))],
    ];
    for (const [role, open] of opens) {
      open();
      await flush();
      const panel = screen.getByRole(role);
      expect(panel.closest('[data-testid="pn-root"]')).toBe(root);
      expect(panel).toHaveAttribute("data-oui-surface");
      fireEvent.keyDown(panel, { key: "Escape" });
      await flush();
    }
  });
});

describe("the Mini player", () => {
  const mini = async (actions: unknown[] = [], session = live()) => {
    serve(session, actions);
    nativeHost({
      capabilities: ["click-through", "always-on-top"],
      setWindowSize: async () => true,
      setFullScreen: async () => true,
    });
    await show();
    fireEvent.keyDown(screen.getByTestId("pn-dot-size"), { key: "ArrowDown" });
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: /^Mini player/ }),
    );
  };

  it("shows the task's name, stage, a one-line headline and the clock, with the honest visible note", async () => {
    await mini([
      named(
        "Rate limiter. Use a token bucket per client. It refills over time.",
      ),
    ]);
    expect(screen.getByTestId("pn-mini-name")).toHaveTextContent("T1");
    expect(screen.getByTestId("pn-mini-stage")).toHaveTextContent(
      "Answer ready",
    );
    expect(screen.getByTestId("pn-mini-headline")).toHaveTextContent(/\.$/);
    expect(screen.getByTestId("pn-mini-headline").textContent).not.toContain(
      "token bucket per client",
    );
    expect(screen.queryByText(/Visible window/)).toBeNull();
    expect(screen.getByRole("group", { name: /^Session time/ })).toBeVisible();
  });

  it("says Drafting an answer and stops the session's work for real", async () => {
    const stopped = vi.fn(() => jsonResponse({ session: live() }));
    serve(live(), [
      action({
        actionKind: "draft-answer",
        dispatchStatus: "in_flight",
        result: null,
      }),
    ]);
    server.on("POST /:id/control", stopped);
    nativeHost({
      capabilities: ["always-on-top"],
      setWindowSize: async () => true,
      setFullScreen: async () => true,
    });
    await show();
    fireEvent.keyDown(screen.getByTestId("pn-dot-size"), { key: "ArrowDown" });
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: /^Mini player/ }),
    );
    expect(screen.getByTestId("pn-mini-stage")).toHaveTextContent(
      "Drafting an answer",
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop analysis" }));
    await flush();
    expect(stopped).toHaveBeenCalled();
  });

  it("pauses and resumes through the session", async () => {
    const control = vi.fn(() => jsonResponse({ session: current }));
    serve();
    server.on("POST /:id/control", (request) => {
      current = live({
        status:
          (request as { body?: { action?: string } }).body?.action === "pause"
            ? "paused"
            : "active",
      });
      return control();
    });
    nativeHost({
      capabilities: ["always-on-top"],
      setWindowSize: async () => true,
      setFullScreen: async () => true,
    });
    await show();
    fireEvent.keyDown(screen.getByTestId("pn-dot-size"), { key: "ArrowDown" });
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: /^Mini player/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await flush();
    await flush();
    expect(screen.getByRole("button", { name: "Resume" })).toBeVisible();
    expect(
      screen.getByRole("group", { name: /^Session time .*, paused$/ }),
    ).toHaveAttribute("data-state", "paused");
  });
});

describe("microphone", () => {
  it("shows its hotkey in the tooltip, and has no level bars", async () => {
    await show();
    const mic = within(screen.getByTestId("pn-pill")).getByRole("button", {
      name: "Start microphone",
    });
    expect(tipOf(mic)).toContain("⌥R");
    expect(screen.queryByTestId("pn-level")).toBeNull();
  });

  it("is red and slashed while not listening (muted), and neutral while listening", async () => {
    await show();
    const split = screen.getByTestId("pn-mic");
    expect(split).toHaveAttribute("data-tone", "danger");
    expect(
      within(split).getByRole("button", { name: "Start microphone" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});

describe("answer style", () => {
  it("shows the full name, lists every skill once in the Technical and Conversation groups, and writes the choice", async () => {
    await show();
    const button = screen.getByRole("button", { name: /^Answer style/ });
    expect(button).toHaveTextContent("Data Structures & Algorithms");
    pointerOpen(button);
    const menu = screen.getByRole("menu", { name: "Answer style" });
    expect(
      within(menu)
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-label")),
    ).toEqual(["Technical", "Conversation"]);
    const labels = within(menu)
      .getAllByRole("menuitemradio")
      .map((item) => item.textContent);
    expect(labels).toHaveLength(SKILLS.length);
    expect([...labels].sort()).toEqual(
      SKILLS.map((skill) => skill.label).sort(),
    );
    expect(
      within(
        within(menu).getByRole("group", { name: "Technical" }),
      ).getAllByRole("menuitemradio"),
    ).toHaveLength(5);
    expect(
      within(menu).getByRole("menuitemradio", {
        name: "Data Structures & Algorithms",
      }),
    ).toHaveAttribute("aria-checked", "true");
    // The hint row shows the app's real keys, not the designer's.
    expect(menu).toHaveTextContent("Previous / next");
    expect(menu).toHaveTextContent("⌥[ ⌥]");
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
      screen.getByRole("button", { name: /^Answer style/ }),
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

describe("See-through: one control, clear glass and pass-through by region", () => {
  const hitHost = () => {
    const setHitRegions = vi.fn(async () => true);
    const host = nativeHost({
      capabilities: ["hit-regions"],
      setHitRegions,
    });
    return { host, setHitRegions };
  };

  it("has no interactive or click-through icon: See-through is the only such control", async () => {
    hitHost();
    await show();
    expect(screen.queryByRole("button", { name: "Click-through" })).toBeNull();
    expect(screen.queryByRole("button", { name: /interactive/i })).toBeNull();
    expect(screen.queryByTestId("pn-clickthrough")).toBeNull();
    expect(screen.getAllByRole("button", { name: "See-through" })).toHaveLength(
      1,
    );
    // Not the whole-window click-through of old: this never calls it.
  });

  it("says in its tooltip exactly what is on, with the key where the shell can pass clicks", async () => {
    hitHost();
    await show();
    const button = screen.getByRole("button", { name: "See-through" });
    expect(tipOf(button)).toMatch(/is off/);
    expect(tipOf(button)).toContain("⌘⇧I");
    fireEvent.click(button);
    expect(tipOf(button)).toMatch(
      /clicks on empty glass reach the page underneath/,
    );
    expect(tipOf(button)).toMatch(/Toolbar, panes and menus still take clicks/);
  });

  it("reports its surfaces to the shell from the start (what is not drawn passes clicks through, glass clear or not), and null when the window goes", async () => {
    const { host, setHitRegions } = hitHost();
    await show();
    expect(setHitRegions).toHaveBeenCalled();
    // jsdom lays nothing out, so no surface is found: that is `null` (the
    // window stays interactive), never an empty list.
    const sent = setHitRegions.mock.calls as unknown[][];
    expect(sent.at(-1)?.[0]).toBeNull();
    // See-through changes the glass, not which surfaces are reported.
    fireEvent.click(screen.getByRole("button", { name: "See-through" }));
    expect(sent.at(-1)?.[0]).toBeNull();
    expect(host.setInteractionMode).not.toHaveBeenCalled();
    cleanup();
    expect(setHitRegions).toHaveBeenLastCalledWith(null);
  });

  it("is toggled by the shell's see-through.toggle intent (⌘⇧I, the menu-bar item), the same control", async () => {
    hitHost();
    await show();
    const button = screen.getByRole("button", { name: "See-through" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await act(async () => {
      fireEvent.keyDown(window, { altKey: true, shiftKey: true, code: "KeyI" });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("pn-root")).toHaveAttribute(
      "data-glass",
      "clear",
    );
  });

  it("toggles see-through from the shell intent even when the session is over (clear glass can be turned off)", async () => {
    hitHost();
    serve(live({ status: "ended", endedAt: minutesAfter(1, 9) }));
    await show();
    const press = async () => {
      await act(async () => {
        fireEvent.keyDown(window, {
          altKey: true,
          shiftKey: true,
          code: "KeyI",
        });
        await vi.advanceTimersByTimeAsync(2_000);
      });
    };
    const button = screen.getByRole("button", { name: "See-through" });
    await press();
    expect(button).toHaveAttribute("aria-pressed", "true");
    await press();
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("never marks the window inert: the dots stay live and nothing says click-through", async () => {
    hitHost();
    await show();
    fireEvent.click(screen.getByRole("button", { name: "See-through" }));
    const group = screen.getByRole("group", { name: "Window controls" });
    expect(group).not.toHaveAttribute("data-dimmed");
    expect(screen.queryByText(/Click-through is on/)).toBeNull();
  });

  it("is still the clear-glass switch on a host that cannot pass clicks, with no key in its tooltip", async () => {
    nativeHost({ capabilities: [] });
    await show();
    const button = screen.getByRole("button", { name: "See-through" });
    expect(tipOf(button)).not.toContain("⌘");
    fireEvent.click(button);
    expect(screen.getByTestId("pn-root")).toHaveAttribute(
      "data-glass",
      "clear",
    );
  });
});

describe("shortcut list", () => {
  it("lists the shortcuts in the five groups with macOS glyphs, closes on Escape and gives focus back", async () => {
    await show();
    const button = screen.getByRole("button", { name: "Keyboard shortcuts" });
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    await flush();
    expect(
      within(dialog)
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-label")),
    ).toEqual(["Capture", "Listening", "View", "Answer style", "App"]);
    // The glyphs are the real keys: the page's Alt chords for the commands and
    // the Mac shell's own chords for Show or hide and Settings.
    expect(dialog).toHaveTextContent("Capture & analyze");
    expect(dialog).toHaveTextContent("⌥⇧A");
    expect(dialog).toHaveTextContent("⌥R");
    expect(dialog).toHaveTextContent("Focus the chat");
    expect(dialog).toHaveTextContent("⌘⇧V");
    expect(dialog).toHaveTextContent("⌘,");
    expect(dialog).not.toHaveTextContent("Alt+");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("puts Clear session memory last, in the destructive colour", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const rows = [
      ...dialog.querySelectorAll<HTMLElement>('[data-slot="action-menu-item"]'),
    ];
    const last = rows.at(-1) as HTMLElement;
    expect(last).toHaveTextContent("Clear session memory");
    expect(last).toHaveAttribute("data-tone", "danger");
    expect(rows.filter((row) => row.dataset["tone"] === "danger")).toHaveLength(
      1,
    );
  });

  it("lists See-through on its key and never greys any key out", async () => {
    nativeHost();
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const row = (label: string) =>
      within(dialog)
        .getByText(label)
        .closest('[data-slot="action-menu-item"]') as HTMLElement;
    expect(row("See-through on or off")).toHaveTextContent("⌥⇧I");
    expect(screen.queryByText("Click-through")).toBeNull();
    for (const label of ["Previous skill", "Next skill"]) {
      expect(row(label)).not.toHaveAttribute("aria-disabled");
      expect(row(label)).not.toHaveTextContent("Only while interactive");
    }
  });
});

describe("status strip", () => {
  it("says Paused and resumes through the session", async () => {
    serve(live({ status: "paused" }));
    const resumed = vi.fn(() => jsonResponse({ session: live() }));
    server.on("POST /:id/control", resumed);
    await show();
    // One Resume session, in the footer, beside the Paused notice (not a second
    // one in a strip).
    expect(screen.queryByTestId("pn-strip")).toBeNull();
    const clock = screen.getByRole("group", { name: /paused$/ });
    expect(clock).toHaveTextContent("Paused");
    expect(clock).toHaveAttribute(
      "title",
      "Nothing is captured and no new work starts",
    );
    expect(
      screen.getAllByRole("button", { name: "Resume session" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Resume session" }));
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

  it("keeps saying work is running when Stop failed, and says so", async () => {
    serve(live(), [
      action({
        actionKind: "draft-answer",
        dispatchStatus: "in_flight",
        result: null,
      }),
    ]);
    server.on("POST /:id/control", () =>
      jsonResponse({ error: "unavailable" }, 503),
    );
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await flush();
    await flush();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Stop" })).toBeVisible();
    expect(screen.getByTestId("pn-strip")).toHaveAttribute(
      "data-state",
      "busy",
    );
  });

  it("ignores Stop while the screen is still being captured", async () => {
    window.localStorage.setItem("interview-studio.live.auto.local", "off");
    vi.stubGlobal("MediaStream", class {});
    (window as { studioHost?: unknown }).studioHost = {
      version: 1,
      hostKind: "native-macos",
      capabilities: ["capture-screen"],
      captureScreen: () => new Promise(() => undefined),
      pinOnTop: async () => false,
      openExternal: async () => undefined,
      onHotkey: () => () => undefined,
    };
    await show();
    await act(async () => {
      fireEvent.keyDown(window, { altKey: true, shiftKey: true, code: "KeyA" });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByTestId("pn-strip")).toHaveTextContent(/Capturing/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      fireEvent.keyDown(window, { altKey: true, shiftKey: true, code: "KeyA" });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(server.count("POST /:id/control")).toBe(0);
    expect(screen.getByTestId("pn-strip")).toHaveTextContent(/Capturing/);
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

describe("the Problem menu and the earlier task", () => {
  const twoTasks = () => [
    named("Rate limiter"),
    answerAction(answerResult(), {
      taskId: "task-2",
      createdAt: minutesAfter(1, 8),
      updatedAt: minutesAfter(1, 9),
    }),
  ];
  // The task bar's Problem menu (library ActionMenu): the trigger names the
  // problem on show; the list is newest first, the one on show checked.
  const problemButton = () => screen.getByTestId("pn-problem-button");
  const openProblems = () => {
    pointerOpen(problemButton());
    return within(screen.getByRole("menu", { name: "Problem" }));
  };
  const chooseProblem = (name: RegExp) => {
    fireEvent.click(openProblems().getByRole("menuitemradio", { name }));
  };

  it("lists a problem per task, newest first, and shows the earlier task with a way back", async () => {
    serve(live(), twoTasks());
    await show();
    expect(screen.queryByRole("group", { name: "Tasks" })).toBeNull();
    expect(problemButton()).toHaveTextContent(/^T2 · /);
    const items = openProblems().getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent?.slice(0, 2))).toEqual([
      "T2",
      "T1",
    ]);
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    expect(items[0]).toHaveTextContent("Current");
    expect(screen.queryByTestId("pn-earlier")).toBeNull();
    fireEvent.click(items[1] as HTMLElement);
    expect(screen.getByTestId("pn-earlier")).toHaveTextContent("earlier task");
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent("T1 · rev 1");
    expect(problemButton()).toHaveTextContent(/^T1 · /);
    fireEvent.click(screen.getByRole("button", { name: "Back to T2" }));
    expect(screen.queryByTestId("pn-earlier")).toBeNull();
    expect(problemButton()).toHaveTextContent(/^T2 · /);
  });

  it("shares its selection with the transcript", async () => {
    serve(live(), twoTasks());
    await show();
    const rows = document.querySelectorAll<HTMLElement>(
      '[data-slot="transcript-speech"][data-kind="assistant"]',
    );
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0] as HTMLElement);
    expect(problemButton()).toHaveTextContent(/^T1 · /);
    expect(screen.getByTestId("pn-earlier")).toBeVisible();
  });

  it("a new task takes the screen, even when an earlier one was chosen, and the box follows it", async () => {
    serve(live(), twoTasks());
    await show();
    chooseProblem(/^T1 · /);
    expect(screen.getByTestId("pn-earlier")).toBeVisible();
    expect(presentation.get().pinnedTaskId).toBe("task-1");
    // A third task arrives on a later poll: the earlier choice is forgotten.
    served = [
      ...twoTasks(),
      answerAction(answerResult(), {
        taskId: "task-3",
        createdAt: minutesAfter(1, 9),
        updatedAt: minutesAfter(1, 10),
      }),
    ];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(problemButton()).toHaveTextContent(/^T3 · /);
    expect(screen.queryByTestId("pn-earlier")).toBeNull();
    expect(presentation.get().pinnedTaskId).toBeNull();
    expect(screen.getByTestId("pn-task-line")).toHaveTextContent("T3 · rev 1");
    const box = screen.getByLabelText("Message");
    expect(box).toHaveAttribute(
      "placeholder",
      "Add context to T3, or ask a follow-up",
    );
    fireEvent.change(box, { target: { value: "about the newest" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await flush();
    expect(submitFollowUp).toHaveBeenCalledWith(
      expect.any(String),
      "about the newest",
      { taskId: "task-3", revision: 1 },
      expect.anything(),
    );
    // The earlier task is still there to go back to.
    chooseProblem(/^T1 · /);
    expect(screen.getByTestId("pn-earlier")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to T3" }));
    expect(screen.queryByTestId("pn-earlier")).toBeNull();
  });

  it("shares the pin with the shared presentation, as the web page does", async () => {
    serve(live(), twoTasks());
    await show();
    act(() => presentation.pin("task-1"));
    expect(screen.getByTestId("pn-earlier")).toBeVisible();
    chooseProblem(/^T2 · /);
    expect(presentation.get().pinnedTaskId).toBeNull();
  });

  it("sends a follow-up to the task on show, and says so in the box", async () => {
    serve(live(), twoTasks());
    await show();
    chooseProblem(/^T1 · /);
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
      screen
        .getByText(text)
        .closest('[data-slot="transcript-speech"]')
        ?.querySelector('[data-slot="transcript-label"]')?.textContent;
    expect(label("Walk me through it.")).toMatch(/^Interviewer · app audio · /);
    expect(label("Sure.")).toMatch(/^You · mic · /);
    expect(label("Something else.")).toMatch(/^Heard · /);
  });

  it("puts one chip per capture among the lines, and no task start or stop line", async () => {
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
    const log = within(screen.getByRole("log"));
    const chips = [
      ...document.querySelectorAll('[data-slot="transcript-event"]'),
    ].map((chip) => chip.textContent);
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.join(" ")).toMatch(/S1 captured/);
    expect(log.queryByText(/started/)).toBeNull();
    expect(log.queryByText(/stopped by you/)).toBeNull();
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

describe("typing follow-ups", () => {
  const send = async (text: string) => {
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: text },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await flush();
  };
  const texts = () => submitFollowUp.mock.calls.map((call) => call[1]);

  it("sends a second, different follow-up while the first is pending, in order", async () => {
    serve(live(), [named("Rate limiter")]);
    const releases: (() => void)[] = [];
    submitFollowUp.mockImplementation(
      () => new Promise((resolve) => releases.push(() => resolve(undefined))),
    );
    await show();
    await send("first question");
    expect(screen.getByLabelText("Message")).toBeEnabled();
    await send("second question");
    expect(texts()).toEqual(["first question", "second question"]);
    for (const release of releases) release();
    await flush();
    await flush();
    const typed = [
      ...document.querySelectorAll('[data-slot="transcript-message"]'),
    ];
    expect(typed.map((row) => row.textContent).join("|")).toMatch(
      /first question.*second question/,
    );
  });

  it("clears the box only for the text that was actually sent", async () => {
    serve(live(), [named("Rate limiter")]);
    let release: () => void = () => undefined;
    submitFollowUp.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(undefined))),
    );
    await show();
    await send("sent text");
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "typed meanwhile" },
    });
    release();
    await flush();
    await flush();
    expect(screen.getByLabelText("Message")).toHaveValue("typed meanwhile");
  });

  it("sends an identical double submit once", async () => {
    serve(live(), [named("Rate limiter")]);
    submitFollowUp.mockImplementation(() => new Promise(() => undefined));
    await show();
    await send("same words");
    await send("same words");
    expect(texts()).toEqual(["same words"]);
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
      "current",
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

describe("answer pane: error line and ended session", () => {
  it("shows one dismissible error line", async () => {
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
    const dismiss = () =>
      screen.queryByRole("button", { name: "Dismiss message" });
    expect(dismiss()).not.toBeNull();
    fireEvent.click(dismiss() as HTMLElement);
    expect(dismiss()).toBeNull();
  });

  it("an ended session shows no panes at all: no empty-state capture to press, only the ended card", async () => {
    serve(live({ status: "ended", endedAt: minutesAfter(1, 9) }), []);
    await show();
    expect(screen.queryByTestId("pn-analysis-empty")).toBeNull();
    expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
    expect(screen.getByTestId("pn-ended")).toBeVisible();
  });
});

describe("answer panel header (library Panel)", () => {
  const inFlight = () =>
    action({
      actionKind: "draft-answer",
      dispatchStatus: "in_flight",
      result: null,
    });
  const answerHeader = () => {
    const panel = screen.getByRole("region", { name: "Answer" });
    return {
      panel,
      header: panel.querySelector('[data-slot="panel-header"]') as HTMLElement,
    };
  };

  it("holds Stop in the Answer header while analysing, with the capture key, and Stop ends the run", async () => {
    serve(live(), [inFlight()]);
    await show();
    const { header } = answerHeader();
    fireEvent.click(within(header).getByRole("button", { name: /^Stop ⌘⇧S$/ }));
    await flush();
    expect(server.count("POST /:id/control")).toBe(1);
  });

  it("shows no Stop in the Answer header when nothing is running", async () => {
    serve(live(), [named("Rate limiter")]);
    await show();
    expect(
      within(answerHeader().header).queryByRole("button", { name: /Stop/ }),
    ).toBeNull();
  });

  it("is the one progress surface: the steps in the body, no banner and no chat line", async () => {
    serve(live(), [inFlight()]);
    await show();
    const { panel } = answerHeader();
    expect(within(panel).getByTestId("pn-steps")).toBeVisible();
    expect(screen.queryByText(/Capturing the screen…/)).toBeNull();
  });

  it("reads 'Last capture HH:MM · no question found' as the header meta, the first part alone as the title's lead", async () => {
    serve(live(), [
      {
        ...action({ actionKind: "draft-answer", result: null }),
        noQuestion: true,
      },
    ]);
    await show();
    const meta = within(answerHeader().header).getByTestId("pn-answer-meta");
    expect(meta).toHaveAttribute(
      "title",
      expect.stringMatching(/^Last capture .+ · no question found$/),
    );
    expect(meta).toHaveTextContent(/^Last capture .+ · no question found$/);
    // The empty-state line stays in the body.
    expect(screen.getByTestId("pn-no-question")).toBeVisible();
  });

  it("puts the empty-state capture button inside the Answer body", async () => {
    serve(live(), []);
    await show();
    const body = answerHeader().panel.querySelector(
      '[data-slot="panel-body"]',
    ) as HTMLElement;
    expect(
      within(body).getByRole("button", { name: /^Analyze screen/ }),
    ).toBeVisible();
  });

  it("names the task in the header subtitle", async () => {
    serve(live(), [named("Rate limiter")]);
    await show();
    const { header } = answerHeader();
    expect(header).toHaveTextContent("T1 · Rate limiter");
  });

  it("does not change what it shows when the Code panel is hidden", async () => {
    serve(live(), [named("Rate limiter"), solved()]);
    await show();
    const before = screen.getByTestId("pn-answer").innerHTML;
    fireEvent.click(screen.getByRole("button", { name: /^Code/ }));
    await flush();
    expect(screen.queryByTestId("pn-code-pane")).toBeNull();
    expect(screen.getByTestId("pn-answer").innerHTML).toBe(before);
  });
});

describe("code pane", () => {
  // Revision 2 of the task whose first revision has its code: its answer, and
  // optionally its code job.
  const second = (over: Record<string, unknown>) => ({
    ...named("Rate limiter, revised"),
    taskRevision: 2,
    createdAt: minutesAfter(1, 9),
    updatedAt: minutesAfter(1, 9),
    ...over,
  });
  const pickRevision = (revision: number) => {
    fireEvent.pointerDown(screen.getByTestId("pn-bar-revisions-button"), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Revisions" })).getByRole(
        "menuitemradio",
        { name: new RegExp(`^rev ${revision}\\b`) },
      ),
    );
  };

  it("spins while the newest revision's approach is redrafted, never showing the code of the revision before it; an earlier revision picked still shows its code", async () => {
    serve(live(), [
      named("Rate limiter"),
      solved(),
      second({ dispatchStatus: "in_flight", result: null }),
    ]);
    await show();
    const pane = screen.getByRole("region", { name: "Code" });
    expect(pane).toHaveTextContent("Working on the new revision…");
    expect(screen.queryByTestId("pn-code")).toBeNull();
    pickRevision(1);
    expect(screen.getByTestId("pn-code")).toBeVisible();
    expect(screen.getByRole("region", { name: "Code" })).not.toHaveTextContent(
      "Working on the new revision…",
    );
  });

  it("says the code is being written once the newest revision's code stage runs, still without the earlier code", async () => {
    serve(live(), [
      named("Rate limiter"),
      solved(),
      second({}),
      action({
        actionKind: "solve-code",
        taskRevision: 2,
        dispatchStatus: "in_flight",
        result: null,
        createdAt: minutesAfter(1, 9),
        updatedAt: minutesAfter(1, 9),
      }),
    ]);
    await show();
    const pane = screen.getByRole("region", { name: "Code" });
    expect(pane).toHaveTextContent(/Writing code…/);
    expect(pane).not.toHaveTextContent("Working on the new revision…");
    expect(screen.queryByTestId("pn-code")).toBeNull();
    pickRevision(1);
    expect(screen.getByTestId("pn-code")).toBeVisible();
  });

  it("shows the language, the server's own badges, the code and Copy code", async () => {
    serve(live(), [named("Rate limiter"), solved()]);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await show();
    // The Code card's own language tag. The task bar shows the owner's own
    // choice (auto here): a problem answered in TypeScript never rewrites it,
    // or one answer would turn every later capture into its language.
    expect(
      within(screen.getByTestId("pn-code")).getByTestId("pn-language"),
    ).toHaveTextContent("TYPESCRIPT");
    expect(screen.getByTestId("pn-task-bar-language")).toHaveTextContent(
      "Language: auto",
    );
    expect(screen.getByTestId("pn-task-bar")).not.toHaveTextContent(
      "TypeScript",
    );
    const badges = within(screen.getByLabelText(/established about this code/));
    expect(badges.getByText("Generated")).toBeVisible();
    expect(badges.getByText("5/5 generated tests")).toBeVisible();
    expect(badges.getByText("Not fully verified")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await flush();
    expect(writeText).toHaveBeenCalledWith("export const allow = () => true;");
  });

  describe("tests drawer in the window", () => {
    const sizeHost = () => {
      const setWindowSize = vi.fn(async (..._args: unknown[]) => true);
      nativeHost({
        capabilities: ["click-through", "always-on-top"],
        setWindowSize,
        setFullScreen: async () => true,
      });
      return setWindowSize;
    };

    it("opens and closes without asking the shell for another window size, and leaves the toolbar alone", async () => {
      serve(live(), [named("Rate limiter"), solved()]);
      const setWindowSize = sizeHost();
      await show();
      const toolbar = screen.getByRole("toolbar", {
        name: "Session controls",
      }).outerHTML;
      setWindowSize.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Tests" }));
      expect(screen.getByTestId("pn-tests-drawer")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Tests" }));
      await flush();
      expect(setWindowSize).not.toHaveBeenCalled();
      expect(
        screen.getByRole("toolbar", { name: "Session controls" }).outerHTML,
      ).toBe(toolbar);
    });

    it("is drawn in full screen and not in the Mini player", async () => {
      serve(live(), [named("Rate limiter"), solved()]);
      sizeHost();
      await show();
      fireEvent.click(screen.getByTestId("pn-dot-size"));
      expect(screen.getByRole("button", { name: "Tests" })).toBeVisible();
      fireEvent.keyDown(screen.getByTestId("pn-dot-size"), {
        key: "ArrowDown",
      });
      fireEvent.click(
        screen.getByRole("menuitemradio", { name: /^Mini player/ }),
      );
      expect(screen.getByTestId("pn-mini-card")).toBeVisible();
      expect(screen.queryByRole("button", { name: "Tests" })).toBeNull();
      expect(screen.queryByTestId("pn-tests-drawer")).toBeNull();
    });

    it("shows the server's counts and a known run reason once opened", async () => {
      serve(live(), [named("Rate limiter"), solved()]);
      await show();
      fireEvent.click(screen.getByRole("button", { name: "Tests" }));
      expect(screen.getByLabelText("Tests: 5 of 5 passed")).toBeVisible();
      expect(screen.getByTestId("pn-tests-notverified")).toHaveTextContent(
        "A stated constraint has no test of its own.",
      );
      expect(screen.queryByRole("button", { name: /run/i })).toBeNull();
    });
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
      "Starts automatically after the approach.",
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
    expect(
      screen.getByRole("group", { name: /^Session time \d+:\d\d$/ }),
    ).toHaveAttribute("data-state", "live");
  });

  it("marks the clock paused", async () => {
    serve(live({ status: "paused" }));
    await show();
    expect(
      screen.getByRole("group", { name: /^Session time .*, paused$/ }),
    ).toHaveAttribute("data-state", "paused");
  });

  it("shows the ended card with counts, hides the panes and the task bar, and offers the summary and a new session", async () => {
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
    // The confirmation is answered: it does not linger beside the ended card.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const ended = screen.getByTestId("pn-ended");
    expect(ended).toHaveTextContent("Session ended");
    expect(ended).toHaveTextContent("Nothing was submitted or typed for you.");
    expect(ended).toHaveTextContent("1 utterance");
    expect(ended).toHaveTextContent("1 task");
    expect(ended).toHaveTextContent("1 answer");
    expect(ended).toHaveTextContent("1 code draft");
    // Ended: the transcript, answer and code panes and the task bar are gone
    // (the summary holds what was said and answered).
    expect(screen.queryByTestId("pn-problem")).toBeNull();
    expect(screen.queryByTestId("pn-task-bar")).toBeNull();
    expect(screen.queryByRole("region", { name: "Answer" })).toBeNull();
    expect(document.querySelector(".pn-single-body")).toBeNull();
    expect(screen.queryByTestId("pn-strip")).toBeNull();
    expect(screen.queryByRole("group", { name: /^Session time/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Start a new session" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Open summary" }));
    expect(external).toHaveBeenCalledTimes(1);
    const [url] = external.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/^http.*\/t\/local\/p\/interview\/live\/0b1f6a52/);
  });

  it("shows the interview the session is for in the footer from the start, not in the task bar, and not once it has ended", async () => {
    const candidacyId = "22222222-2222-4222-8222-222222222222";
    serve(live({ candidacyId }), [named("Rate limiter"), solved()]);
    server.on("POST /:id/control", () => {
      current = live({
        candidacyId,
        status: "ended",
        endedAt: minutesAfter(5),
      });
      return jsonResponse({ session: current });
    });
    await show();
    const chip = screen.getByTestId("pn-context-chip");
    expect(chip).toHaveAccessibleName(/^Interview context: /);
    expect(
      within(screen.getByTestId("pn-task-bar")).queryByTestId(
        "pn-context-chip",
      ),
    ).toBeNull();
    // Before the build tag, when there is one, and before the session controls.
    expect(
      chip.compareDocumentPosition(
        screen.getByRole("button", { name: "End session" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    fireEvent.click(screen.getByRole("button", { name: "End now" }));
    await flush();
    await flush();
    expect(screen.getByTestId("pn-ended")).toBeVisible();
    expect(screen.queryByTestId("pn-context-chip")).toBeNull();
  });

  it("shows no interview chip for a session with no candidacy", async () => {
    serve(live(), [named("Rate limiter"), solved()]);
    await show();
    expect(screen.getByTestId("pn-task-bar")).toBeVisible();
    expect(screen.queryByTestId("pn-context-chip")).toBeNull();
  });

  it("Start a new session starts nothing: it leaves the ended session for the Start screen, where the interview is chosen", async () => {
    serve(live({ status: "ended", endedAt: minutesAfter(5) }));
    await show();
    expect(screen.getByTestId("pn-ended")).toBeVisible();
    const posted = () => server.calls.filter((call) => call.startsWith("POST"));
    const before = posted().length;
    const button = screen.getByRole("button", { name: "Start a new session" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await flush();
    await flush();
    // No session is started from here, and the finished one is dismissed.
    expect(posted()).toHaveLength(before);
    expect(screen.queryByTestId("pn-ended")).toBeNull();
    expect(screen.queryByRole("button", { name: "Starting…" })).toBeNull();
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

describe("See-through background", () => {
  const KEY = "interview-studio.panel.glass.v1";
  const root = () => screen.getByTestId("pn-root");
  const glassButton = () => screen.getByRole("button", { name: "See-through" });

  it("sets and clears data-glass on the panel root and flips aria-pressed", async () => {
    await show();
    expect(root()).not.toHaveAttribute("data-glass");
    expect(glassButton()).toHaveAttribute("aria-pressed", "false");
    expect(tipOf(glassButton())).toContain(
      "See-through is off. Press to make the background clear. Text stays readable",
    );
    fireEvent.click(glassButton());
    expect(root()).toHaveAttribute("data-glass", "clear");
    expect(glassButton()).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem(KEY)).toBe("clear");
    fireEvent.click(glassButton());
    expect(root()).not.toHaveAttribute("data-glass");
    expect(glassButton()).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem(KEY)).toBe("tinted");
  });

  it("is a real button, so Enter and Space operate it", async () => {
    await show();
    const button = glassButton();
    expect(button.tagName).toBe("BUTTON");
    button.focus();
    expect(button).toHaveFocus();
    // A button's click is what Enter and Space dispatch in a browser.
    fireEvent.click(button);
    expect(root()).toHaveAttribute("data-glass", "clear");
  });

  it("survives a reload with the attribute on the first render", async () => {
    window.localStorage.setItem(KEY, "clear");
    await show();
    expect(root()).toHaveAttribute("data-glass", "clear");
    expect(glassButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("follows a change made in another window", async () => {
    await show();
    window.localStorage.setItem(KEY, "clear");
    await act(async () => {
      window.dispatchEvent(new Event("storage"));
    });
    expect(root()).toHaveAttribute("data-glass", "clear");
    window.localStorage.setItem(KEY, "tinted");
    await act(async () => {
      window.dispatchEvent(new Event("storage"));
    });
    expect(root()).not.toHaveAttribute("data-glass");
  });

  it("keeps working in memory when storage is blocked", async () => {
    await show();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    fireEvent.click(glassButton());
    expect(root()).toHaveAttribute("data-glass", "clear");
  });

  it("is on the toolbar of an ended session too", async () => {
    serve(live({ status: "ended", endedAt: minutesAfter(5) }));
    await show();
    fireEvent.click(glassButton());
    expect(root()).toHaveAttribute("data-glass", "clear");
  });

  it("leaves the footer as it was: no See-through control there", async () => {
    await show();
    const foot = document.querySelector(".pn-single-foot") as HTMLElement;
    expect(
      within(foot).queryByRole("button", { name: "See-through" }),
    ).toBeNull();
    expect(within(foot).getByRole("button", { name: /^Pause/ })).toBeVisible();
  });
});

describe("toolbar contract: order, locks and the microphone press", () => {
  const engineState = {
    v: 1,
    pairing: "paired",
    listening: true,
    paused: false,
    sources: { microphone: "listening", "system-audio": "off", screen: "off" },
    lastHeardAgeSeconds: null,
    hint: null,
  };

  it("draws the session controls in one row, in this order", async () => {
    await show();
    const bar = within(
      screen.getByRole("toolbar", { name: "Session controls" }),
    );
    const order = [
      "Analyze screen",
      "Start microphone",
      /^Answer style/,
      "Chat",
      "Answer",
      "Code",
      "See-through",
      "Keyboard shortcuts",
    ];
    const buttons = bar.getAllByRole("button");
    const at = order.map((name) =>
      buttons.indexOf(bar.getByRole("button", { name })),
    );
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("an ended session locks the toolbar's session controls, each naming why", async () => {
    serve(live({ status: "ended", endedAt: minutesAfter(5) }));
    await show();
    const bar = within(
      screen.getByRole("toolbar", { name: "Session controls" }),
    );
    const states = Object.fromEntries(
      bar
        .getAllByRole("button")
        .map((button) => [
          button.getAttribute("aria-label") ?? button.textContent ?? "",
          (button as HTMLButtonElement).disabled ||
            button.getAttribute("aria-disabled") === "true",
        ]),
    );
    // Every session control is locked: capture, microphone, answer style, the
    // pane toggles and the shortcuts (the same lock as before a session
    // starts).
    for (const name of [
      "Analyze screen",
      "Capture options",
      "Start microphone",
      "Microphone options",
      "Answer style: Data Structures & Algorithms",
      "Chat",
      "Answer",
      "Code",
      "Keyboard shortcuts",
    ])
      expect(states[name], name).toBe(true);
  });

  it("pressing the microphone while it listens silences the microphone only: the engine restarts with the call audio, and the name follows the engine's report", async () => {
    const calls: string[] = [];
    nativeHost();
    const ok = (name: string) => async () => {
      calls.push(name);
      return { ok: true, engine: engineState };
    };
    (
      window as unknown as { studioHost: { engine: unknown } }
    ).studioHost.engine = {
      // The engine reports the microphone as listening only when it was asked
      // to listen to it.
      start: async (request: { sources: readonly string[] }) => {
        calls.push(`start:${request.sources.join("+")}`);
        return {
          ok: true,
          engine: {
            ...engineState,
            sources: {
              ...engineState.sources,
              microphone: request.sources.includes("microphone")
                ? "listening"
                : "off",
            },
          },
        };
      },
      stop: async () => {
        calls.push("stop");
        return { ok: true, engine: { ...engineState, listening: false } };
      },
      pause: ok("pause"),
      resume: ok("resume"),
      status: ok("status"),
      onEvent: () => () => undefined,
    };
    await show();
    await flush();
    const bar = within(
      screen.getByRole("toolbar", { name: "Session controls" }),
    );
    const mic = bar.getByRole("button", { name: "Stop microphone" });
    expect(mic).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(mic);
    await flush();
    await flush();
    // Stopped, then started again without the microphone: the call's audio
    // keeps being heard and the engine keeps answering the heartbeat.
    expect(calls).toEqual([
      "start:microphone+application-audio",
      "stop",
      "start:application-audio",
    ]);
    expect(
      bar.getByRole("button", { name: "Start microphone" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});

describe("toolbar menus are sized to the window", () => {
  it("the capture, answer-style and microphone menus cap their height to the room left and scroll inside", async () => {
    await show();
    for (const trigger of [
      () =>
        screen.getByRole("button", {
          name: /^(Screen to capture|Capture options)/,
        }),
      () => screen.getByRole("button", { name: /^Answer style/ }),
      () =>
        within(toolbar()).getByRole("button", { name: "Microphone options" }),
    ]) {
      pointerOpen(trigger());
      await flush();
      const menu = screen.getByRole("menu");
      expect(menu.style.maxHeight).toContain("available-height");
      expect(
        menu.querySelector('[data-slot="action-menu-scroll"]'),
      ).not.toBeNull();
      fireEvent.keyDown(menu, { key: "Escape" });
      await flush();
    }
  });
});

describe("microphone states (Zoom semantics) and its caret menu", () => {
  const base = {
    v: 1,
    pairing: "paired",
    listening: true,
    paused: false,
    lastHeardAgeSeconds: null,
    hint: null,
  };
  const listening = {
    ...base,
    sources: { microphone: "listening", "system-audio": "off", screen: "off" },
  };
  const lost = (extra: Record<string, unknown> = {}) => ({
    ...base,
    sources: { microphone: "lost", "system-audio": "off", screen: "off" },
    ...extra,
  });
  // A shell that reports `state` and records what the menu asks of it.
  function shell(state: unknown, over: Record<string, unknown> = {}) {
    const calls: string[] = [];
    nativeHost();
    const reply = (note: string) => async () => {
      calls.push(note);
      return { ok: true, engine: state };
    };
    (
      window as unknown as { studioHost: { engine: unknown } }
    ).studioHost.engine = {
      start: reply("start"),
      stop: reply("stop"),
      pause: reply("pause"),
      resume: reply("resume"),
      status: reply("status"),
      onEvent: () => () => undefined,
      ...over,
    };
    return calls;
  }
  const split = () => screen.getByTestId("pn-mic");
  const caret = () =>
    within(split()).getByRole("button", { name: "Microphone options" });

  it("listening is neutral and pressed; muted is red and slashed", async () => {
    shell(listening);
    await show();
    await flush();
    expect(split()).toHaveAttribute("data-tone", "neutral");
    expect(
      within(split()).getByRole("button", { name: "Stop microphone" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      split().querySelector('[data-slot="split-button-status"]'),
    ).toBeNull();
    cleanup();
    shell({ ...listening, listening: false });
    await show();
    await flush();
    expect(split()).toHaveAttribute("data-tone", "danger");
  });

  it("lost is an amber outline with a ! badge, and the caret says Trying again with the attempt and offers Retry now", async () => {
    const calls = shell(
      lost({
        microphoneRetryAttempt: 2,
        microphoneDevices: [
          { id: "built-in", name: "MacBook Pro Microphone" },
          { id: "usb", name: "USB Mic" },
        ],
        microphoneDeviceId: "built-in",
      }),
      {
        retryMicrophone: async () => {
          calls.push("retry");
          return { ok: true, engine: lost() };
        },
      },
    );
    await show();
    await flush();
    expect(split()).toHaveAttribute("data-tone", "warning");
    const badge = split().querySelector('[data-slot="split-button-status"]');
    expect(badge).toHaveTextContent("!");
    expect(
      tipOf(within(split()).getByRole("button", { name: /microphone$/ })),
    ).toContain("Trying again · attempt 2");
    pointerOpen(caret());
    const menu = screen.getByRole("menu", { name: "Microphone options" });
    expect(menu).toHaveTextContent("Microphone lost");
    expect(menu).toHaveTextContent("Trying again · attempt 2");
    // The notice leads the menu; the devices follow it.
    expect(
      within(menu).getByRole("menuitemradio", {
        name: /MacBook Pro Microphone/,
      }),
    ).toHaveAttribute("aria-checked", "true");
    // There is no "Microphone lost. Trying again." banner anywhere.
    expect(screen.queryByText("Microphone lost. Trying again.")).toBeNull();
    fireEvent.click(within(menu).getByText("Retry now"));
    await flush();
    expect(calls).toContain("retry");
  });

  it("choosing a device asks the shell for it", async () => {
    const calls = shell(
      { ...listening, microphoneDevices: [{ id: "usb", name: "USB Mic" }] },
      {
        selectMicrophone: async (id: string) => {
          calls.push(`select:${id}`);
          return { ok: true, engine: listening };
        },
      },
    );
    await show();
    await flush();
    pointerOpen(caret());
    fireEvent.click(screen.getByRole("menuitemradio", { name: "USB Mic" }));
    await flush();
    expect(calls).toContain("select:usb");
  });

  it("degrades without a device list or attempt: a plain Retry now that restarts, and no device rows", async () => {
    const calls = shell(lost());
    await show();
    await flush();
    pointerOpen(caret());
    const menu = screen.getByRole("menu", { name: "Microphone options" });
    expect(menu).toHaveTextContent("Microphone lost");
    expect(menu).not.toHaveTextContent("attempt");
    expect(within(menu).queryByRole("menuitemradio")).toBeNull();
    const before = calls.length;
    fireEvent.click(within(menu).getByText("Retry now"));
    await flush();
    await flush();
    // No retry on this shell: the engine restarts (stop, then start).
    expect(calls.slice(before)).toEqual(expect.arrayContaining(["start"]));
  });

  it("keeps Alt+R as the one toggle: the main press and the menu row do the same thing", async () => {
    const calls = shell(listening);
    await show();
    await flush();
    pointerOpen(caret());
    fireEvent.click(screen.getByRole("menuitem", { name: /Stop listening/ }));
    await flush();
    await flush();
    expect(calls).toContain("stop");
  });
});

describe("screen problems on the capture control", () => {
  const split = () => screen.getByTestId("pn-capture");
  const caret = () =>
    within(split()).getByRole("button", {
      name: /^(Screen to capture|Capture options)/,
    });

  it("a missing permission turns the control amber with a ! badge and leads the menu with the reason and its fix", async () => {
    await show();
    act(() =>
      noteScreenProblem({ kind: "problem", problem: "permission-missing" }),
    );
    expect(split()).toHaveAttribute("data-tone", "warning");
    expect(
      split().querySelector('[data-slot="split-button-status"]'),
    ).toHaveTextContent("!");
    expect(
      tipOf(within(split()).getByRole("button", { name: "Analyze screen" })),
    ).toBe("Screen Recording is off for Interview Studio");
    pointerOpen(caret());
    const menu = screen.getByRole("menu");
    expect(menu).toHaveTextContent(
      "Screen Recording is off for Interview Studio",
    );
    // The notice comes before the first section.
    expect(
      menu
        .querySelector('[data-slot="action-menu-notice"]')
        ?.compareDocumentPosition(
          menu.querySelector('[data-slot="action-menu-section"]') as Element,
        ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("a gone display offers Pick display, which opens the display menu on a host that can choose", async () => {
    (window as { studioHost?: unknown }).studioHost = {
      version: 1,
      hostKind: "native-macos",
      capabilities: ["display-selection"],
      listDisplays: async () => ({ ok: true, displays: [] }),
      setCaptureDisplay: async () => ({ ok: true, pinned: false }),
      presentation: {
        capabilities: [],
        openSettings: async () => true,
        closeSettings: async () => true,
        setVisible: async () => true,
        setInteractionMode: async () => true,
        interactionMode: () => true,
        onInteractionMode: () => () => undefined,
      },
    };
    await show();
    act(() =>
      noteScreenProblem({ kind: "problem", problem: "display-disconnected" }),
    );
    pointerOpen(caret());
    await flush();
    const menu = screen.getByRole("menu");
    expect(menu).toHaveTextContent("The chosen display was disconnected");
    fireEvent.click(within(menu).getByText("Pick display"));
    await flush();
    // The fix re-opens the menu with the Display section on show.
    expect(screen.getByRole("group", { name: "Display" })).toBeVisible();
  });

  it("the problem stays until a capture comes back", async () => {
    await show();
    act(() =>
      noteScreenProblem({ kind: "problem", problem: "capture-failed" }),
    );
    expect(split()).toHaveAttribute("data-tone", "warning");
    act(() => noteScreenProblem({ kind: "capture-ok" }));
    expect(split()).not.toHaveAttribute("data-tone", "warning");
  });

  it("is dim while paused, whatever the problem", async () => {
    serve(live({ status: "paused" }));
    await show();
    act(() =>
      noteScreenProblem({ kind: "problem", problem: "capture-failed" }),
    );
    expect(split()).toHaveAttribute("data-tone", "dim");
  });
});

describe("panel toggles are one segmented group", () => {
  it("is a single bordered group of Chat, Answer and Code whose last visible panel cannot be turned off", async () => {
    await show();
    const group = screen.getByTestId("pn-panes");
    expect(screen.getByRole("group", { name: "Panels" }).contains(group)).toBe(
      true,
    );
    expect(group).toHaveAttribute("data-appearance", "control");
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Chat", "Answer", "Code"]);
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    const last = screen.getByRole("button", { name: "Answer" });
    expect(last).toHaveAttribute("aria-pressed", "true");
    expect(last).toHaveAttribute("aria-disabled", "true");
    expect(tipOf(last)).toBe("At least one panel stays visible");
    fireEvent.click(last);
    expect(last).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("pn-analysis")).toBeVisible();
    // Another panel can come back, and then the first can go.
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByRole("button", { name: "Chat" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("the answer style trigger", () => {
  it("shows the full name capped at 260 px with the whole name on hover, and a fixed check column", async () => {
    await show();
    const button = screen.getByRole("button", { name: /^Answer style/ });
    expect(button.querySelector('[data-slot="button-label"]')).toHaveStyle({
      maxWidth: "var(--oui-control-label-max)",
    });
    pointerOpen(button);
    const rows = [
      ...screen
        .getByRole("menu", { name: "Answer style" })
        .querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ];
    // Every row keeps the check column, so the names line up.
    expect(
      rows.every((row) =>
        row.querySelector('[data-slot="action-menu-column"]'),
      ),
    ).toBe(true);
  });
});

// The suite's setup replaces useChatView with this value (reset after each test).
const chosenView = (
  globalThis as unknown as { chatViewForTests: { view: string } }
).chatViewForTests;
const VIEW_KEY = "omnitech.interview.view";

describe("the View menu", () => {
  const trigger = () => screen.getByTestId("pn-view");

  it("sits in the toolbar before the answer style and names the layout on show", async () => {
    await show();
    expect(toolbar()).toContainElement(trigger());
    expect(trigger()).toHaveAccessibleName("View: Original");
    expect(trigger()).toHaveTextContent("Original");
    expect(
      trigger().compareDocumentPosition(
        screen.getByRole("button", { name: /^Answer style/ }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("lists the coach layouts and the classic ones in two groups, and checks the one on show", async () => {
    await show();
    pointerOpen(trigger());
    const menu = screen.getByRole("menu", { name: "View" });
    expect(
      within(menu)
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-label")),
    ).toEqual(["Coach", "Classic"]);
    const rows = (group: string) =>
      within(within(menu).getByRole("group", { name: group }))
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent);
    expect(rows("Coach")).toEqual([
      expect.stringContaining("Call-first coach"),
      expect.stringContaining("Conversation under the call"),
      expect.stringContaining("Prompter only"),
    ]);
    expect(rows("Classic")).toEqual([
      expect.stringContaining("Original"),
      expect.stringContaining("Transcript only"),
    ]);
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .filter((item) => item.getAttribute("aria-checked") === "true")
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining("Original")]);
  });

  it("says under each layout what it is for", async () => {
    await show();
    pointerOpen(trigger());
    const menu = screen.getByRole("menu", { name: "View" });
    const hint = (label: string) =>
      within(menu).getByRole("menuitemradio", {
        name: new RegExp(`^${label}`),
      });
    for (const [label, text] of [
      ["Call-first coach", "Questions, coach, answer"],
      ["Conversation under the call", "Questions, notes, transcript"],
      ["Prompter only", "The call and one note"],
      ["Original", "Transcript, answer, code and the coach panel"],
      ["Transcript only", "For review or a record"],
    ] as const)
      expect(hint(label)).toHaveTextContent(text);
  });

  it.each([
    ["coach", "Call-first coach"],
    ["conversation", "Conversation under the call"],
    ["prompter", "Prompter only"],
    ["transcript", "Transcript only"],
  ])(
    "checks %s when it is the layout on show, and says so on the button",
    async (view, label) => {
      chosenView.view = view;
      await show();
      expect(trigger()).toHaveAccessibleName(`View: ${label}`);
      pointerOpen(trigger());
      expect(
        within(screen.getByRole("menu", { name: "View" }))
          .getAllByRole("menuitemradio")
          .filter((item) => item.getAttribute("aria-checked") === "true")
          .map((item) => item.textContent),
      ).toEqual([expect.stringContaining(label)]);
    },
  );

  it.each([
    ["Prompter only", "prompter"],
    ["Call-first coach", "coach"],
    ["Conversation under the call", "conversation"],
    ["Transcript only", "transcript"],
    ["Original", "original"],
  ])(
    "choosing %s keeps it as the view for the next session and closes the menu",
    async (label, id) => {
      await show();
      expect(window.localStorage.getItem(VIEW_KEY)).toBeNull();
      pointerOpen(trigger());
      fireEvent.click(
        within(screen.getByRole("menu", { name: "View" })).getByRole(
          "menuitemradio",
          { name: new RegExp(`^${label}`) },
        ),
      );
      await flush();
      expect(window.localStorage.getItem(VIEW_KEY)).toBe(id);
      expect(screen.queryByRole("menu", { name: "View" })).toBeNull();
    },
  );

  it("opens from the keyboard and closes on Escape with nothing chosen", async () => {
    await show();
    keyOpen(trigger());
    expect(screen.getByRole("menu", { name: "View" })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    await flush();
    expect(screen.queryByRole("menu", { name: "View" })).toBeNull();
    expect(window.localStorage.getItem(VIEW_KEY)).toBeNull();
  });

  it("is locked, saying why, once the session has ended", async () => {
    serve(live({ status: "ended", endedAt: minutesAfter(1, 9) }));
    await show();
    expect(trigger()).toBeDisabled();
    expect(trigger()).toHaveAttribute(
      "title",
      "The session has ended. Start a new session.",
    );
  });

  it("is live while the session runs or is paused", async () => {
    await show();
    expect(trigger()).toBeEnabled();
    cleanup();
    serve(live({ status: "paused" }));
    await show();
    expect(trigger()).toBeEnabled();
  });
});

describe("the layout chosen in the View menu", () => {
  const QUESTION =
    "How do you handle data consistency between multiple services?";
  const NOTE = {
    id: "00000000-0000-4000-8000-000000000001",
    createdAt: minutesAfter(1),
    title: "Name the techniques",
    tone: "say",
    points: ["Name the Outbox pattern"],
    links: [],
  };
  // The coach's notes are read with the page's own fetch, not the session's.
  const serveNotes = () => {
    const fetched = vi.fn(
      async () => new Response(JSON.stringify({ revision: 1, notes: [NOTE] })),
    );
    vi.stubGlobal("fetch", fetched);
    return fetched;
  };
  const asked = () =>
    serve(
      live(),
      [],
      [
        snapshot(1),
        transcript(2, QUESTION, { sourceId: "application-audio-r1" }),
      ],
    );
  const panesShown = () =>
    [...document.querySelectorAll(".pn-single-pane")].map((pane) =>
      pane.getAttribute("data-which"),
    );
  function sizes() {
    const asked: { width: number; height?: number }[] = [];
    nativeHost({
      capabilities: ["always-on-top"],
      setWindowSize: async (size: { width: number; height?: number }) => {
        asked.push(size);
        return true;
      },
      setFullScreen: async () => true,
      quit: async () => true,
    });
    return asked;
  }

  it("original: the transcript, the answer and the code, with the coach panel docked beside them", async () => {
    serveNotes();
    asked();
    await show();
    await flush();
    expect(panesShown()).toEqual(["chat", "analysis", "code"]);
    expect(screen.queryByTestId("pn-coach-layout")).toBeNull();
    expect(screen.getByTestId("pn-coach")).toHaveTextContent("Coach · 1 note");
  });

  it("transcript: only the chat pane, whatever panes are switched on, and the coach panel stays docked", async () => {
    chosenView.view = "transcript";
    serveNotes();
    asked();
    await show();
    await flush();
    expect(panesShown()).toEqual(["chat"]);
    expect(screen.getByTestId("pn-chat")).toHaveTextContent(QUESTION);
    expect(screen.queryByTestId("pn-coach-layout")).toBeNull();
    expect(screen.queryByTestId("pn-call-slot")).toBeNull();
    expect(screen.getByTestId("pn-coach")).toBeInTheDocument();
    // The toggles still say what the original layout would show.
    for (const label of ["Chat", "Answer", "Code"])
      expect(screen.getByRole("button", { name: label })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
  });

  it("transcript: asks for a narrower window than the three panes", async () => {
    const asked = sizes();
    await show();
    const three = asked.at(-1)?.width as number;
    cleanup();
    chosenView.view = "transcript";
    await show();
    expect(asked.at(-1)?.width as number).toBeLessThan(three);
  });

  it.each(["coach", "conversation", "prompter"] as const)(
    "%s: the coach layout takes the panes' place and draws the notes itself, so the docked coach panel stands down",
    async (view) => {
      chosenView.view = view;
      const fetched = serveNotes();
      asked();
      await show();
      await flush();
      const layout = screen.getByTestId("pn-coach-layout");
      expect(layout).toHaveAttribute("data-view", view);
      expect(layout).toHaveClass("pn-single-body");
      expect(document.querySelectorAll(".pn-single-body")).toHaveLength(1);
      expect(panesShown()).toEqual([]);
      expect(screen.queryByTestId("pn-coach")).toBeNull();
      // The notes are read by the layout.
      expect(fetched).toHaveBeenCalledWith(
        "/api/v1/coach-notes",
        expect.objectContaining({ method: "GET" }),
      );
      // The question in a few words (what was heard, cut), the whole beneath.
      expect(screen.getByTestId("pn-coach-asked").textContent).toBe(
        `${QUESTION.slice(0, 60).trimEnd()}…`,
      );
      expect(screen.getByTestId("pn-coach-heard").textContent).toBe(QUESTION);
      expect(screen.getByTestId("pn-coach-block")).toHaveTextContent(
        "Name the Outbox pattern",
      );
      // The toolbar above it and the footer beneath it are the same ones.
      expect(toolbar()).toBeVisible();
      expect(document.querySelector(".pn-single-foot")).not.toBeNull();
    },
  );

  it.each(["coach", "conversation", "prompter"] as const)(
    "%s: the toolbar draws no pane toggles, since the layout has its own columns; the View menu stays",
    async (view) => {
      chosenView.view = view;
      serveNotes();
      await show();
      expect(screen.queryByTestId("pn-panes")).toBeNull();
      expect(screen.queryByRole("group", { name: "Panels" })).toBeNull();
      for (const label of ["Chat", "Answer", "Code"])
        expect(
          within(toolbar()).queryByRole("button", { name: label }),
        ).toBeNull();
      expect(toolbar()).toContainElement(screen.getByTestId("pn-view"));
      expect(
        within(toolbar()).getByRole("button", { name: /^Answer style/ }),
      ).toBeInTheDocument();
    },
  );

  it.each(["original", "transcript"] as const)(
    "%s: the toolbar keeps the pane toggles",
    async (view) => {
      chosenView.view = view;
      serveNotes();
      await show();
      expect(screen.getByRole("group", { name: "Panels" })).toContainElement(
        screen.getByTestId("pn-panes"),
      );
    },
  );

  it.each([
    ["coach", 860],
    ["prompter", 780],
  ] as const)(
    "%s: a window dragged wider or narrower at its edge is asked for at that width, and Reset layout gives the layout's own back",
    async (view, height) => {
      chosenView.view = view;
      serveNotes();
      const asked = sizes();
      await show();
      const own = asked.at(-1)?.width as number;
      try {
        act(() => setCoachWindowWidth(own + 180));
        await flush();
        expect(asked.at(-1)).toEqual({ width: own + 180, height });
        fireEvent.click(screen.getByTestId("pn-coach-reset"));
        await flush();
        expect(asked.at(-1)).toEqual({ width: own, height });
      } finally {
        act(() => setCoachWindowWidth(null));
      }
    },
  );

  it("coach: the window is never asked to be narrower than its toolbar, whatever was dragged", async () => {
    chosenView.view = "coach";
    serveNotes();
    const asked = sizes();
    await show();
    try {
      act(() => setCoachWindowWidth(480));
      await flush();
      const narrow = asked.at(-1)?.width as number;
      expect(narrow).toBeGreaterThanOrEqual(480);
      expect(narrow).toBeLessThan(1340);
    } finally {
      act(() => setCoachWindowWidth(null));
    }
  });

  it("original: a width dragged in a coach layout is not used", async () => {
    const asked = sizes();
    await show();
    const own = asked.at(-1)?.width as number;
    try {
      act(() => setCoachWindowWidth(own + 400));
      await flush();
      expect(asked.at(-1)?.width).toBe(own);
    } finally {
      act(() => setCoachWindowWidth(null));
    }
  });

  it.each([
    ["coach", 860],
    ["prompter", 780],
  ] as const)(
    "%s: a window dragged taller or shorter at its bottom edge is asked for at that height, and Reset layout gives the layout's own back",
    async (view, own) => {
      chosenView.view = view;
      serveNotes();
      const asked = sizes();
      await show();
      const width = asked.at(-1)?.width as number;
      expect(asked.at(-1)).toEqual({ width, height: own });
      try {
        act(() => setCoachWindowHeight(own + 120));
        await flush();
        expect(asked.at(-1)).toEqual({ width, height: own + 120 });
        // Shorter than the layout opens at: the dragged height stands as given.
        act(() => setCoachWindowHeight(own - 300));
        await flush();
        expect(asked.at(-1)).toEqual({ width, height: own - 300 });
        fireEvent.click(screen.getByTestId("pn-coach-reset"));
        await flush();
        expect(asked.at(-1)).toEqual({ width, height: own });
      } finally {
        act(() => setCoachWindowHeight(null));
      }
    },
  );

  it("coach: a dragged height and a dragged width are asked for together", async () => {
    chosenView.view = "coach";
    serveNotes();
    const asked = sizes();
    await show();
    const own = asked.at(-1)?.width as number;
    try {
      act(() => {
        setCoachWindowWidth(own + 180);
        setCoachWindowHeight(700);
      });
      await flush();
      expect(asked.at(-1)).toEqual({ width: own + 180, height: 700 });
    } finally {
      act(() => {
        setCoachWindowWidth(null);
        setCoachWindowHeight(null);
      });
    }
  });

  it("original: a height dragged in a coach layout is not used", async () => {
    const asked = sizes();
    await show();
    const before = asked.at(-1);
    try {
      act(() => setCoachWindowHeight(700));
      await flush();
      expect(asked.at(-1)).toEqual(before);
      expect(asked.some((size) => size.height === 700)).toBe(false);
    } finally {
      act(() => setCoachWindowHeight(null));
    }
  });

  it("coach: the answer, the transcript and the code are the real panes behind the tabs", async () => {
    chosenView.view = "coach";
    serveNotes();
    asked();
    await show();
    const panel = () => screen.getByRole("tabpanel");
    // The library's tabs take a press, not a bare click event.
    const press = (tab: string) =>
      fireEvent.mouseDown(screen.getByTestId(tab), {
        button: 0,
        ctrlKey: false,
      });
    expect(within(panel()).getByTestId("pn-analysis")).toHaveAccessibleName(
      "Answer",
    );
    press("pn-coach-tab-transcript");
    expect(within(panel()).getByTestId("pn-chat")).toHaveTextContent(QUESTION);
    press("pn-coach-tab-code");
    expect(
      within(panel()).getByRole("region", { name: "Code" }),
    ).toBeInTheDocument();
    expect(within(panel()).queryByTestId("pn-chat")).toBeNull();
  });

  it.each([
    ["coach", 1340, 860],
    ["conversation", 1340, 860],
    ["prompter", 720, 780],
  ])(
    "%s: asks the window for %i px across and at least %i px of height",
    async (view, width, height) => {
      chosenView.view = view;
      serveNotes();
      const asked = sizes();
      await show();
      expect(asked.at(-1)).toEqual({ width, height });
    },
  );

  it("a coach layout leaves a window that is already tall enough at the person's own height", async () => {
    chosenView.view = "coach";
    serveNotes();
    vi.stubGlobal("innerHeight", 1_000);
    const asked = sizes();
    await show();
    expect(asked.at(-1)).toEqual({ width: 1340 });
  });

  it.each(["coach", "prompter"] as const)(
    "%s: a paused session holds the layout back and sizes the window for the toolbar alone",
    async (view) => {
      chosenView.view = view;
      serveNotes();
      const asked = sizes();
      serve(live({ status: "paused" }));
      await show();
      expect(screen.queryByTestId("pn-coach-layout")).toBeNull();
      expect(asked.at(-1)?.width as number).toBeLessThan(720);
    },
  );

  it("an ended session shows the ended card, not the coach layout", async () => {
    chosenView.view = "coach";
    serveNotes();
    serve(live({ status: "ended", endedAt: minutesAfter(1, 9) }));
    await show();
    expect(screen.queryByTestId("pn-coach-layout")).toBeNull();
    expect(screen.getByTestId("pn-ended")).toBeVisible();
  });
});
