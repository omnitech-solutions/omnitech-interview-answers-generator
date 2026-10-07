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
import { GREEN_MENU_GRACE_MS, GREEN_MENU_HOVER_MS } from "./toolbar-config";
import { TOAST_TEXT } from "./use-panel-session";

const live = (extra = {}) =>
  sessionView({ processingPolicy: "permitted-remote", ...extra });
let server: TestServer;
const submitFollowUp = vi.fn(async (..._args: unknown[]) => undefined);
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

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
    expect(stop).toHaveAttribute("title", expect.stringContaining("⌘⇧S"));
  });

  it("opens a real menu whose items carry subtitles from the Auto config", async () => {
    window.localStorage.setItem(
      "interview-studio.live.auto-interval.local",
      "12",
    );
    await show();
    fireEvent.click(screen.getByRole("button", { name: /^Capture mode/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /^Capture mode/ }));
    expect(
      screen.getByRole("menuitem", { name: /Add screen to T1/ }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("chooses Manual, remembers it in the one Auto preference, closes and returns focus to the trigger", async () => {
    await show();
    const trigger = screen.getByRole("button", { name: /^Capture mode/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Manual/ }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveTextContent("Manual");
    expect(trigger).toHaveFocus();
    expect(
      window.localStorage.getItem("interview-studio.live.auto.local"),
    ).toBe("off");
    // No second store for the same fact.
    expect(
      window.localStorage.getItem("interview-studio.panels.capture-mode.local"),
    ).toBeNull();
  });

  it("names the toolbar triggers with their value and keeps the status out of the capture button", async () => {
    await show();
    expect(
      screen.getByRole("button", {
        name: "Answer style: Data Structures & Algorithms",
      }),
    ).toBeVisible();
    const capture = screen.getByRole("button", { name: "Analyze screen" });
    // The state the dot colours is announced beside the button, not inside it.
    expect(capture.querySelector('[role="status"]')).toBeNull();
    expect(screen.getByTestId("pn-status")).toHaveTextContent(/Live|Recording/);
    expect(screen.getByTestId("pn-dot")).toHaveAttribute("aria-hidden", "true");
  });

  it("agrees with the Auto hotkey: one state feeds the menu check and the label", async () => {
    await show();
    const trigger = screen.getByRole("button", { name: /^Capture mode/ });
    expect(trigger).toHaveAccessibleName("Capture mode: Auto");
    await act(async () => {
      fireEvent.keyDown(window, { altKey: true, shiftKey: true, code: "KeyH" });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(trigger).toHaveAccessibleName("Capture mode: Manual");
    expect(
      window.localStorage.getItem("interview-studio.live.auto.local"),
    ).toBe("off");
    fireEvent.click(trigger);
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
    expect(
      screen.getByRole("button", { name: /^Capture mode/ }),
    ).toHaveAccessibleName("Capture mode: Manual");
  });

  it("closes on Escape with focus back on the trigger, and on a press outside", async () => {
    await show();
    const trigger = screen.getByRole("button", { name: /^Capture mode/ });
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
    fireEvent.click(screen.getByRole("button", { name: /^Capture mode/ }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(
      screen.getByRole("menuitemradio", { name: /^Manual/ }),
    ).toHaveFocus();
  });

  it("keeps one menu open at a time", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: /^Capture mode/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Answer style/ }));
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
      expect(items()[0]).toHaveFocus();
      fireEvent.keyDown(items()[0] as HTMLElement, { key: "ArrowDown" });
      expect(items()[1]).toHaveFocus();
      fireEvent.keyDown(items()[1] as HTMLElement, { key: "ArrowUp" });
      expect(items()[0]).toHaveFocus();
      fireEvent.keyDown(items()[0] as HTMLElement, { key: "Escape" });
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
    const ok = (name: string) => async () => (
      calls.push(name), { ok: true, engine: engineState }
    );
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

  it("a held (paused) session disables the microphone control and its press never stops the engine", async () => {
    const calls: string[] = [];
    nativeHost();
    withEngine(calls);
    serve(live({ status: "paused" }));
    window.localStorage.setItem("omnitech:auto:t", "1");
    await show();
    const button = document.querySelector(".pn-mic-button") as HTMLElement;
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("data-held", "true");
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
  it("shows no body panels: the toolbar, the paused strip and the footer stay, and the pane buttons are disabled with the reason", async () => {
    serve(live({ status: "paused" }));
    await show();
    expect(document.querySelector(".pn-single-body")).toBeNull();
    expect(screen.getByRole("toolbar")).toBeVisible();
    expect(screen.getByTestId("ov-footer-notice")).toHaveTextContent("Paused");
    expect(screen.queryByTestId("pn-strip")).toBeNull();
    expect(document.querySelector(".pn-single-foot")).not.toBeNull();
    for (const label of ["Chat", "Answer", "Code"]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute(
        "title",
        "Paused. Resume the session to see this.",
      );
    }
    cleanup();
    serve(live());
    await show();
    expect(document.querySelector(".pn-single-body")).not.toBeNull();
  });

  it("disables the capture button and its screen menu (never the mode menu), saying why, and enables them again once it runs", async () => {
    serve(live({ status: "paused" }));
    await show();
    const split = document.querySelector(".pn-split") as HTMLElement;
    const buttons = within(split).getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    // The capture button and the screen menu wait; the mode menu never does.
    const mode = within(split).getByRole("button", { name: /Capture mode/ });
    expect(mode).toBeEnabled();
    for (const button of buttons.filter((each) => each !== mode))
      expect(button).toBeDisabled();
    fireEvent.click(mode);
    expect(
      within(document.body).getAllByRole("menuitemradio").length,
    ).toBeGreaterThanOrEqual(2);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(
      within(split).getByRole("button", { name: /Analyze screen/ }),
    ).toHaveAttribute("title", "Paused. Resume the session to capture.");
    cleanup();
    serve(live());
    await show();
    const running = within(document.querySelector(".pn-split") as HTMLElement);
    expect(
      running.getByRole("button", { name: /Analyze screen/ }),
    ).toBeEnabled();
  });
});

describe("popovers", () => {
  it("every toolbar popover is drawn inside the toolbar, in its stacking layer", async () => {
    nativeHost({
      capabilities: ["always-on-top"],
      setWindowSize: async () => true,
      setFullScreen: async () => true,
      quit: async () => true,
    });
    await show();
    const pill = screen.getByTestId("pn-pill");
    const opens: [string, () => void][] = [
      [
        "menu",
        () =>
          fireEvent.click(
            screen.getByRole("button", { name: /^Capture mode/ }),
          ),
      ],
      [
        "menu",
        () =>
          fireEvent.click(
            screen.getByRole("button", { name: /^Answer style/ }),
          ),
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
      const panel = screen.getByRole(role);
      expect(panel.closest(".pn-pill")).toBe(pill);
      expect(panel).toHaveClass("pn-menu");
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
    fireEvent.click(screen.getByTestId("pn-size-mini"));
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
    expect(screen.getByTestId("ov-clock")).toBeVisible();
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
    fireEvent.click(screen.getByTestId("pn-size-mini"));
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
    fireEvent.click(screen.getByTestId("pn-size-mini"));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await flush();
    await flush();
    expect(screen.getByRole("button", { name: "Resume" })).toBeVisible();
    expect(screen.getByTestId("ov-clock")).toHaveAttribute(
      "data-paused",
      "true",
    );
  });
});

describe("microphone", () => {
  it("shows its hotkey, and bars only while listening", async () => {
    await show();
    const mic = within(screen.getByTestId("pn-pill")).getByRole("button", {
      name: "Start microphone",
    });
    expect(mic).toHaveAttribute("title", expect.stringContaining("⌥R"));
    expect(screen.queryByTestId("pn-level")).toBeNull();
  });
});

describe("answer style", () => {
  it("lists every skill from the contract table and writes the choice", async () => {
    await show();
    const button = screen.getByRole("button", { name: /^Answer style/ });
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
    expect(button).toHaveAttribute("title", expect.stringMatching(/is off/));
    expect(button).toHaveAttribute("title", expect.stringContaining("⌘⇧I"));
    fireEvent.click(button);
    expect(button).toHaveAttribute(
      "title",
      expect.stringMatching(/clicks on empty glass reach the page underneath/),
    );
    expect(button).toHaveAttribute(
      "title",
      expect.stringMatching(/Toolbar, panes and menus still take clicks/),
    );
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
    expect(button).toHaveAttribute("title", expect.not.stringContaining("⌘"));
    fireEvent.click(button);
    expect(screen.getByTestId("pn-root")).toHaveAttribute(
      "data-glass",
      "clear",
    );
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

describe("shortcut list", () => {
  const row = (label: string) =>
    screen.getByText(label).closest("li") as HTMLElement;

  it("lists See-through on ⌘⇧I and never greys any key out", async () => {
    nativeHost();
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(row("See-through on or off")).toHaveTextContent("⌘⇧I");
    expect(screen.queryByText("Click-through")).toBeNull();
    for (const label of ["Previous answer style", "Next answer style"]) {
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
    const notice = screen.getByTestId("ov-footer-notice");
    expect(notice).toHaveTextContent("Paused");
    expect(notice).toHaveTextContent(
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
      '[data-slot="transcript-speech"][data-kind="assistant"]',
    );
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0] as HTMLElement);
    expect(screen.getByRole("button", { name: /^T1 · / })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("pn-earlier")).toBeVisible();
  });

  it("keeps an earlier pinned task when a new one arrives, and aims at it", async () => {
    serve(live(), twoTasks());
    await show();
    fireEvent.click(screen.getByRole("button", { name: /^T1 · / }));
    expect(screen.getByTestId("pn-earlier")).toBeVisible();
    // A third task arrives on a later poll.
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
    expect(screen.getByRole("button", { name: /^T3 · / })).toBeVisible();
    expect(screen.getByTestId("pn-earlier")).toBeVisible();
    expect(screen.getByRole("button", { name: /^T1 · / })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(presentation.get().pinnedTaskId).toBe("task-1");
    const box = screen.getByLabelText("Message");
    expect(box).toHaveAttribute(
      "placeholder",
      "Add context to T1, or ask a follow-up",
    );
    fireEvent.change(box, { target: { value: "still about the first" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await flush();
    expect(submitFollowUp).toHaveBeenCalledWith(
      expect.any(String),
      "still about the first",
      { taskId: "task-1", revision: 1 },
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to T3" }));
    expect(screen.queryByTestId("pn-earlier")).toBeNull();
    expect(presentation.get().pinnedTaskId).toBeNull();
  });

  it("shares the pin with the shared presentation, as the web page does", async () => {
    serve(live(), twoTasks());
    await show();
    act(() => presentation.pin("task-1"));
    expect(screen.getByTestId("pn-earlier")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^T2 · / }));
    expect(presentation.get().pinnedTaskId).toBeNull();
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
      const toolbar = screen.getByRole("toolbar").outerHTML;
      setWindowSize.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Tests" }));
      expect(screen.getByTestId("pn-tests-drawer")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Tests" }));
      await flush();
      expect(setWindowSize).not.toHaveBeenCalled();
      expect(screen.getByRole("toolbar").outerHTML).toBe(toolbar);
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
      fireEvent.click(screen.getByTestId("pn-size-mini"));
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
    // The confirmation is answered: it does not linger beside the ended card.
    expect(screen.queryByRole("alertdialog")).toBeNull();
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

describe("See-through background", () => {
  const KEY = "interview-studio.panel.glass.v1";
  const root = () => screen.getByTestId("pn-root");
  const glassButton = () => screen.getByRole("button", { name: "See-through" });

  it("sets and clears data-glass on the panel root and flips aria-pressed", async () => {
    await show();
    expect(root()).not.toHaveAttribute("data-glass");
    expect(glassButton()).toHaveAttribute("aria-pressed", "false");
    expect(glassButton()).toHaveAttribute(
      "title",
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
