// The screen picker in the real toolbar, over the fake native host: shown only
// with "display-selection", live thumbnails only while the menu is open, pin and
// fallback states, accessibility.
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
import { noteSource, resetCaptureSource } from "../../host-display";
import { resetScreenProblems } from "../../screen-problems";
import {
  configureSessionStores,
  resetSessionStores,
} from "../../session-registry";
import {
  jsonResponse,
  minutesAfter,
  sessionView,
  snapshot,
  streamPage,
} from "../../testing/session-fixtures";
import {
  createTestServer,
  type TestServer,
} from "../../testing/session-test-server";
import { OverlayPage } from "../overlay-page";
import { resetCommandClaims } from "./commands";
import { PIN_DROPPED_NOTE } from "./display-picker-model";
import { keyOpen, pointerOpen, tipOf } from "./toolbar-test-kit";

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

const JPEG = btoa("\xff\xd8\xff\xe0JFIF");
const d1 = { id: 1, name: "Built-in Retina", index: 1, count: 2 };
const d2 = { id: 2, name: "DELL U2720Q", index: 2, count: 2 };
const preview = (display: typeof d1) => ({
  display,
  thumbnail: { mediaType: "image/jpeg", base64: JPEG },
});

// A native bridge that offers display selection; each test scripts the answers.
function host(
  options: {
    list?: () => Promise<unknown>;
    select?: (id: number | null) => Promise<unknown>;
    selection?: boolean;
  } = {},
) {
  const listDisplays = vi.fn(
    options.list ??
      (async () => ({ ok: true, displays: [preview(d1), preview(d2)] })),
  );
  const setCaptureDisplay = vi.fn(
    options.select ??
      (async (id: number | null) =>
        id === null
          ? { ok: true, pinned: false }
          : { ok: true, pinned: true, display: id === 1 ? d1 : d2 }),
  );
  (window as { studioHost?: unknown }).studioHost = {
    version: 1,
    hostKind: "native-macos",
    capabilities: options.selection === false ? [] : ["display-selection"],
    listDisplays,
    setCaptureDisplay,
    presentation: {
      capabilities: ["click-through"],
      openSettings: async () => true,
      closeSettings: async () => true,
      setVisible: async () => true,
      setInteractionMode: async () => true,
      interactionMode: () => true,
      onInteractionMode: () => () => undefined,
    },
  };
  return { listDisplays, setCaptureDisplay };
}

// Listings that took thumbnails: the mount-time pin read asks for none.
const previewCalls = (fn: { mock: { calls: unknown[][] } }) =>
  fn.mock.calls.filter(([request]) => {
    return (
      (request as { thumbnails?: boolean } | undefined)?.thumbnails !== false
    );
  }).length;

const capture = () => screen.getByRole("button", { name: "Analyze screen" });
// The caret of the capture control: the screen menu's trigger.
const button = () => screen.getByRole("button", { name: /^Screen to capture/ });
const open = async () => {
  pointerOpen(button());
  await flush();
};
// The Display rows of the capture menu (the mode rows are the first two).
const displayRows = () =>
  screen
    .getAllByRole("menuitemradio")
    .filter(
      (row) =>
        !/^(Manual|Auto)/.test(row.textContent ?? "") &&
        row.getAttribute("aria-disabled") !== "true",
    );
const MENU = { name: /^Screen to capture/ };
const CAPTURE_TIP =
  /^(Auto|Manual): Capture the screen and analyse it as a new problem: /;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1, 10)));
  window.localStorage.clear();
  resetSessionStores();
  presentation.reset();
  resetCommandClaims();
  resetScreenProblems();
  resetCaptureSource();
  serve();
});
afterEach(() => {
  cleanup();
  resetSessionStores();
  resetCaptureSource();
  delete (window as { studioHost?: unknown }).studioHost;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the screen caret", () => {
  it("is absent without display-selection: the caret is only Capture options", async () => {
    host({ selection: false });
    await show();
    expect(
      screen.queryByRole("button", { name: /^Screen to capture/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Capture options" }),
    ).toBeVisible();
  });

  it("is named by the current choice and its tooltip says it", async () => {
    host();
    await show();
    expect(button()).toHaveAccessibleName(
      "Screen to capture: Following your browser",
    );
    expect(tipOf(button())).toBe("Screen to capture: Following your browser");
    expect(button()).toHaveAttribute("aria-haspopup", "menu");
  });

  it("takes no thumbnails while the menu is closed: one pin read on mount, nothing after", async () => {
    const bridge = host();
    await show();
    // Reads on mount only (the window may mount its toolbar once while loading,
    // and once for the session): none while it sits idle, and no thumbnails ever.
    const afterMount = bridge.listDisplays.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(bridge.listDisplays.mock.calls).toHaveLength(afterMount);
    expect(
      bridge.listDisplays.mock.calls.every(
        (call) =>
          JSON.stringify(call) === JSON.stringify([{ thumbnails: false }]),
      ),
    ).toBe(true);
  });

  it("shows a saved pin on mount, before the menu is ever opened", async () => {
    host({
      list: async () => ({
        ok: true,
        displays: [{ display: d1 }, { display: d2 }],
        pinnedDisplayId: 2,
      }),
    });
    await show();
    expect(button()).toHaveAccessibleName(
      "Screen to capture: Pinned: Display 2 of 2",
    );
    expect(tipOf(capture())).toContain("Display 2 of 2 (pinned)");
  });

  it("says once that a saved pin's display is gone", async () => {
    // The shell reports the dropped pin once, then follows the browser.
    let told = false;
    host({
      list: async () => {
        const first = !told;
        told = true;
        return {
          ok: true,
          displays: [{ display: d1 }],
          pinnedDisplayId: null,
          ...(first ? { pinFallback: "display-unavailable" as const } : {}),
        };
      },
    });
    await show();
    expect(screen.getAllByText(PIN_DROPPED_NOTE)).toHaveLength(1);
    expect(button()).toHaveAccessibleName(
      "Screen to capture: Following your browser",
    );
  });
});

describe("the menu", () => {
  it("lists When to analyse, then Follow my browser and each display by name and position (no thumbnails)", async () => {
    host();
    await show();
    await open();
    const menu = screen.getByRole("menu", MENU);
    expect(
      within(menu).getByRole("group", { name: "When to analyse" }),
    ).toBeVisible();
    const rows = displayRows();
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Follow my browser"),
      "Built-in Retina1 of 2",
      "DELL U2720Q2 of 2",
    ]);
    expect(rows[0]).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByRole("group", { name: "Display" })).toBeVisible();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("refreshes at most every 2 s while open and stops when closed", async () => {
    const bridge = host();
    await show();
    await open();
    expect(previewCalls(bridge.listDisplays)).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(1900));
    expect(previewCalls(bridge.listDisplays)).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(previewCalls(bridge.listDisplays)).toBe(2);
    fireEvent.keyDown(screen.getByRole("menu", MENU), {
      key: "Escape",
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(previewCalls(bridge.listDisplays)).toBe(2);
    expect(screen.queryByText(/DELL U2720Q/)).toBeNull();
  });

  it("ignores a response that arrives after the menu closed", async () => {
    let finish: (value: unknown) => void = () => undefined;
    const bridge = host({
      list: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await show();
    await open();
    expect(screen.getByText("Looking for displays…")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await act(async () => finish({ ok: true, displays: [preview(d1)] }));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(previewCalls(bridge.listDisplays)).toBe(1);
    expect(screen.queryByText(/Built-in Retina/)).toBeNull();
  });

  it.each([
    [
      "permission-denied",
      "Screen recording is not allowed",
      "Grant Screen Recording to the app",
    ],
    ["capture-failed", "Could not read the displays", null],
  ])("says so when the list fails: %s", async (reason, text, help) => {
    host({ list: async () => ({ ok: false, reason }) });
    await show();
    await open();
    expect(screen.getByText(text, { exact: false })).toBeVisible();
    if (help) expect(screen.getByText(help)).toBeVisible();
    expect(displayRows()).toHaveLength(1);
  });

  it("says when there are no displays", async () => {
    host({ list: async () => ({ ok: true, displays: [] }) });
    await show();
    await open();
    expect(screen.getByText("No displays found")).toBeVisible();
  });

  it("treats a malformed answer as a failure, never a half menu", async () => {
    host({
      list: async () => ({
        ok: true,
        displays: [
          { display: d1, thumbnail: { mediaType: "text/html", base64: "x" } },
        ],
      }),
    });
    await show();
    await open();
    expect(screen.getByText("Could not read the displays")).toBeVisible();
    expect(screen.queryByText(/Built-in Retina/)).toBeNull();
  });

  it("moves with the arrow keys and closes on Escape, returning focus to the caret", async () => {
    host();
    await show();
    keyOpen(button());
    await flush();
    const modes = screen.getAllByRole("menuitemradio");
    expect(modes[0]).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowDown",
    });
    await flush();
    expect(modes[1]).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    await flush();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button()).toHaveFocus();
  });
});

describe("one split control: capture, with the screen target attached", () => {
  it("is one capture button and its caret, and no separate screen icon", async () => {
    host();
    await show();
    expect(
      screen.getAllByRole("button", { name: "Analyze screen" }),
    ).toHaveLength(1);
    // The caret is inside the same split control as the capture button.
    expect(button().closest('[data-slot="split-button"]')).toBe(
      capture().closest('[data-slot="split-button"]'),
    );
    expect(button().querySelector("svg")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Built-in Retina Display" }),
    ).toBeNull();
  });

  it("says in the capture tooltip the mode, what it does, the target and the key", async () => {
    host();
    await show();
    expect(tipOf(capture())).toMatch(CAPTURE_TIP);
    expect(tipOf(capture())).toMatch(/following your browser, ⌘⇧S$/);
  });

  it("opens the menu from the caret, a right-click or ArrowDown on the capture button; a plain click only captures; Escape returns focus to the caret", async () => {
    host();
    await show();
    fireEvent.click(capture());
    expect(screen.queryByRole("menu", MENU)).toBeNull();
    fireEvent.contextMenu(capture());
    await flush();
    expect(button()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", MENU)).toBeVisible();
    fireEvent.keyDown(screen.getByRole("menu", MENU), {
      key: "Escape",
    });
    await flush();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button()).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(capture(), { key: "ArrowDown" });
    await flush();
    expect(screen.getByRole("menu", MENU)).toBeVisible();
  });

  it("has no screen caret, no Display section and a plain tooltip where the host cannot choose a screen", async () => {
    host({ selection: false });
    await show();
    expect(tipOf(capture())).not.toContain("following your browser");
    fireEvent.contextMenu(capture());
    expect(screen.queryByRole("menu")).toBeNull();
    pointerOpen(screen.getByRole("button", { name: "Capture options" }));
    expect(screen.queryByRole("group", { name: "Display" })).toBeNull();
    expect(
      screen.getByRole("group", { name: "When to analyse" }),
    ).toBeVisible();
  });
});

describe("pinning", () => {
  it("pins the chosen display, names it on the caret and the tooltip, and closes", async () => {
    const bridge = host();
    await show();
    await open();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /DELL U2720Q/ }));
    await flush();
    expect(bridge.setCaptureDisplay).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button()).toHaveAccessibleName(
      "Screen to capture: Pinned: Display 2 of 2",
    );
    expect(tipOf(button())).toBe("Screen to capture: Pinned: Display 2 of 2");
    expect(screen.queryByTestId("pn-source")).toBeNull();
    expect(tipOf(capture())).toMatch(/Display 2 of 2 \(pinned\), ⌘⇧S$/);
    await open();
    expect(
      screen.getByRole("menuitemradio", { name: /DELL U2720Q/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("unpins with Follow my browser", async () => {
    const bridge = host();
    await show();
    await open();
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: /Built-in Retina/ }),
    );
    await flush();
    await open();
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: /Follow my browser/ }),
    );
    await flush();
    expect(bridge.setCaptureDisplay).toHaveBeenLastCalledWith(null);
    expect(button()).toHaveAccessibleName(
      "Screen to capture: Following your browser",
    );
  });

  it("says the pin was dropped when the display is gone, refreshes the list and keeps the menu open", async () => {
    const bridge = host({
      select: async () => ({ ok: false, reason: "display-unavailable" }),
    });
    await show();
    await open();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /DELL U2720Q/ }));
    await flush();
    await flush();
    expect(screen.getByText(PIN_DROPPED_NOTE)).toBeVisible();
    expect(previewCalls(bridge.listDisplays)).toBe(2);
    expect(screen.getByRole("menu")).toBeVisible();
    expect(button()).toHaveAccessibleName(
      "Screen to capture: Following your browser",
    );
  });
});

describe("pin fallback from a capture or a watch change", () => {
  it("shows ONE line and clears the pin", async () => {
    host();
    await show();
    await open();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /DELL U2720Q/ }));
    await flush();
    expect(button()).toHaveAccessibleName(
      "Screen to capture: Pinned: Display 2 of 2",
    );
    act(() =>
      noteSource({
        kind: "capture",
        display: d1,
        pinned: false,
        pinFallback: "display-unavailable",
      }),
    );
    await flush();
    expect(screen.getAllByText(PIN_DROPPED_NOTE)).toHaveLength(1);
    expect(button()).toHaveAccessibleName(
      "Screen to capture: Following your browser",
    );
    // A later capture without a fallback says nothing more.
    act(() => noteSource({ kind: "capture", display: d1, pinned: false }));
    await flush();
    expect(screen.getAllByText(PIN_DROPPED_NOTE)).toHaveLength(1);
  });

  it("has no chip with the display name beside the capture control: the target lives in the tooltip and the menu", async () => {
    host();
    await show();
    act(() => noteSource({ kind: "capture", display: d1 }));
    expect(screen.queryByTestId("pn-source")).toBeNull();
    expect(tipOf(capture())).toContain("following your browser");
    act(() => noteSource({ kind: "watch", display: d2 }));
    expect(screen.queryByTestId("pn-source")).toBeNull();
  });
});
