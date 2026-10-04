// The overlay card in the tab, and the floating host that loads the chromeless
// overlay route in a Document Picture-in-Picture window, over the real store
// with a scripted service and a mocked window.documentPictureInPicture.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveCardHost } from "./card-host";
import { LiveFloatHost } from "./float-host";
import { presentation } from "./focus-presentation";
import { LiveSessionView } from "./live-view";
import { answerAction } from "./live-view-kit";
import {
  fakeStream,
  installDisplayMedia,
  installFakeCanvas,
  installVideoSize,
} from "./overlay/capture-fixtures";
import { resetPosition } from "./overlay/card-position";
import {
  action,
  jsonResponse,
  minutesAfter,
  SESSION_ID,
  sessionView,
  snapshot,
  streamPage,
} from "./session-fixtures";
import {
  configureSessionStores,
  getSessionStore,
  resetSessionStores,
} from "./session-registry";
import {
  answerResult,
  codeResult,
  codingAnswer,
} from "./session-result-fixtures";
import { createTestServer, type TestServer } from "./session-test-server";

const studio = {} as never;
let server: TestServer;
let page: ReturnType<typeof streamPage>;
const deps = {
  analyzeLatestCapture: vi.fn(async () => undefined),
  analyzeCapture: vi.fn(async () => undefined),
  submitFollowUp: vi.fn(async () => undefined),
};

// A fresh grab awaits a few promises before the store is called.
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await flush();
};
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

// A stand-in for the browser's PiP window: a real document (an iframe's), with
// the window methods the host uses.
function fakePip() {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const doc = frame.contentDocument as Document;
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  const win = {
    document: doc,
    close: vi.fn(),
    addEventListener: (type: string, fn: (event?: unknown) => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: (event?: unknown) => void) =>
      listeners.get(type)?.delete(fn),
    emit: (type: string, event?: unknown) => {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    },
  };
  const requestWindow = vi.fn(async () => win);
  Object.defineProperty(window, "documentPictureInPicture", {
    value: { requestWindow },
    configurable: true,
  });
  return { win, doc, requestWindow };
}
const overlayFrame = (pip: ReturnType<typeof fakePip>) =>
  pip.doc.querySelector("iframe");

async function openLive() {
  render(
    <>
      <LiveSessionView rest={[]} studio={studio} />
      <LiveCardHost />
      <LiveFloatHost />
    </>,
  );
  await flush();
  await flush();
}
const click = async (name: string | RegExp) => {
  fireEvent.click(screen.getByRole("button", { name }));
  await flush();
};
// Share a window from the card, as the person would: Capture & analyze opens the
// source menu, then "Share a window, tab or screen…".
async function shareSource() {
  await click(/Capture & analyze/);
  fireEvent.click(
    screen.getByRole("menuitem", { name: /Share a window, tab or screen/ }),
  );
  await settle();
}
// Analyze needs remote processing; tests that want device-only say so.
const remote = () => sessionView({ processingPolicy: "permitted-remote" });
const deviceOnly = () => sessionView({ processingPolicy: "device-only" });
const card = () => screen.getByTestId("overlay-card");
const inCard = () => within(card());

beforeEach(() => {
  installVideoSize();
  installFakeCanvas();
  installDisplayMedia(async () => fakeStream().stream);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  window.history.replaceState({}, "", "/");
  window.sessionStorage.clear();
  resetSessionStores();
  presentation.reset();
  resetPosition();
  page = streamPage({
    session: remote(),
    observations: [snapshot(1, "Chrome · LeetCode")],
    nextAfterSequence: 1,
    actions: [answerAction(answerResult())],
  });
  server = createTestServer(() => page);
  server.on("GET /current", () => jsonResponse({ session: remote() }));
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
    ...deps,
  });
});
afterEach(() => {
  cleanup();
  presentation.reset();
  resetSessionStores();
  Reflect.deleteProperty(window, "documentPictureInPicture");
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the card", () => {
  it("shows the session, locality, pinned profile, capture, task and slots from real data", async () => {
    server.on("GET /current", () => jsonResponse({ session: deviceOnly() }));
    page = { ...page, session: deviceOnly() };
    await openLive();
    await click("Card view");
    expect(card()).toHaveAttribute("data-variant", "tab");
    expect(card()).toHaveAttribute("data-size", "compact");
    expect(screen.getByTestId("ov-status")).toHaveTextContent(/^Live · 1:00$/);
    expect(screen.getByTestId("ov-title")).toHaveTextContent(/^Session/);
    expect(screen.getByTestId("ov-locality")).toHaveTextContent("On this Mac");
    expect(screen.getByText("Pinned at start")).toBeVisible();
    expect(screen.getByTestId("capture-id")).toHaveTextContent("S1");
    // The companion's own window label, not a hard-coded "Screen".
    expect(screen.getByTestId("capture-source")).toHaveTextContent(
      "Chrome · LeetCode",
    );
    expect(screen.getByTestId("task-tag")).toHaveTextContent("T1 · rev 1");
    expect(screen.getByTestId("slot-answer")).toHaveTextContent(
      /Rev 1 published/,
    );
    expect(screen.getByTestId("slot-code")).toHaveTextContent(
      "Not needed for this task",
    );
    expect(screen.getByTestId("ov-verification")).toHaveTextContent(
      /1 from your matrix/,
    );
    expect(
      screen.getByText("Visible window · shows in screen shares"),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Follow-up" })).toHaveAttribute(
      "placeholder",
      expect.stringMatching(/^Follow-up about T1 · rev 1$/),
    );
  });

  it("names the remote execution profile when processing is remote", async () => {
    await openLive();
    await click("Card view");
    expect(screen.getByTestId("ov-locality")).toHaveTextContent(
      "Remote · fast",
    );
  });

  it("shows the approach, validated, and a collapsible solution with the server's badges", async () => {
    page = {
      ...page,
      actions: [
        answerAction(codingAnswer(["No sorting allowed"])),
        action({
          actionKind: "solve-code",
          result: codeResult(),
        }),
      ],
    };
    await openLive();
    await click("Card view");
    expect(screen.getByText("APPROACH")).toBeVisible();
    expect(screen.getByText("Validated · rev 1")).toBeVisible();
    expect(inCard().getByText("No sorting allowed")).toBeVisible();
    const solution = within(screen.getByTestId("solution"));
    expect(solution.getByText(/Solution · typescript/)).toBeVisible();
    expect(
      solution.getByText("Tests passed, not fully verified"),
    ).toBeVisible();
    // Collapsed until opened.
    expect(solution.queryByText("Fully verified")).toBeNull();
    fireEvent.click(solution.getByRole("button", { name: /Solution/ }));
    expect(solution.getByText("Tests passed · 5/5")).toBeVisible();
    expect(solution.getByText("Fully verified")).toBeVisible();
    expect(solution.getByRole("button", { name: "Copy" })).toBeEnabled();
    expect(
      solution.getByRole("button", { name: "Open in Workspace" }),
    ).toBeEnabled();
  });

  it("with nothing shared, Capture & analyze opens the source menu with its three choices", async () => {
    await openLive();
    await click("Card view");
    await click(/Capture & analyze/);
    const menu = within(screen.getByRole("menu", { name: "Capture source" }));
    expect(
      menu.getByRole("menuitem", { name: /Share a window, tab or screen/ }),
    ).toBeEnabled();
    // The default session has no companion screen source.
    expect(
      menu.getByRole("menuitem", { name: /Analyze stored capture/ }),
    ).toBeDisabled();
    // No companion screen source here, so the companion can't be asked: both
    // choices are disabled, with the source's own reason.
    for (const name of [/Follow focused window/, /Companion · region/])
      expect(menu.getByRole("menuitem", { name })).toBeDisabled();
    expect(menu.getByTestId("focus-note")).toHaveTextContent(
      "This source wasn’t turned on when the session started.",
    );
  });

  it("shares a source, then offers New task and Attach for a FRESH capture and sends it", async () => {
    await openLive();
    await click("Card view");
    await shareSource();
    expect(screen.getByTestId("share-kind")).toHaveTextContent("Window");
    await click(/Capture & analyze/);
    const menu = within(
      screen.getByRole("menu", { name: "Capture & analyze" }),
    );
    expect(menu.getByText("New task from a fresh capture")).toBeVisible();
    expect(menu.getByText("Captures now and starts T2")).toBeVisible();
    expect(menu.getByText("Attach a fresh capture to T1 rev 1")).toBeVisible();
    fireEvent.click(
      menu.getByRole("menuitem", {
        name: /Attach a fresh capture to T1 rev 1/,
      }),
    );
    await settle();
    expect(deps.analyzeCapture).toHaveBeenCalledTimes(1);
    const [id, input] = deps.analyzeCapture.mock.calls[0] as unknown as [
      string,
      { image: Blob; label: string; target?: unknown },
    ];
    expect(id).toBe(SESSION_ID);
    expect(input.image).toBeInstanceOf(Blob);
    expect(input.label).toBe("Window");
    expect(input.target).toEqual({ taskId: "task-1", revision: 1 });
    expect(deps.analyzeLatestCapture).not.toHaveBeenCalled();
  });

  it("starts a new task from a fresh capture without a target", async () => {
    await openLive();
    await click("Card view");
    await shareSource();
    await click(/Capture & analyze/);
    fireEvent.click(
      screen.getByRole("menuitem", { name: /New task from a fresh capture/ }),
    );
    await settle();
    const input = (
      deps.analyzeCapture.mock.calls[0] as unknown as [string, unknown]
    )[1] as {
      target?: unknown;
    };
    expect(input.target).toBeUndefined();
  });

  it("offers only New task before any task exists, and Escape closes the menu", async () => {
    page = { ...page, actions: [] };
    await openLive();
    await click("Card view");
    await shareSource();
    await click(/Capture & analyze/);
    const menu = screen.getByRole("menu", { name: "Capture & analyze" });
    expect(within(menu).queryByText(/Attach/)).toBeNull();
    fireEvent.keyDown(within(menu).getAllByRole("menuitem")[0] as HTMLElement, {
      key: "Escape",
    });
    expect(
      screen.queryByRole("menu", { name: "Capture & analyze" }),
    ).toBeNull();
  });

  it("disables Analyze in a device-only session, says why, and keeps follow-ups", async () => {
    server.on("GET /current", () => jsonResponse({ session: deviceOnly() }));
    page = { ...page, session: deviceOnly() };
    await openLive();
    await click("Card view");
    const analyze = screen.getByRole("button", { name: /Capture & analyze/ });
    expect(analyze).toBeDisabled();
    expect(analyze).toHaveAttribute(
      "title",
      "Device-only mode never sends a screenshot to an assistant.",
    );
    expect(screen.getByTestId("analyze-note")).toHaveTextContent(
      "Device-only mode never sends a screenshot to an assistant.",
    );
    fireEvent.click(analyze);
    expect(screen.queryByRole("menu", { name: "Analyze" })).toBeNull();
    expect(screen.getByLabelText("Follow-up")).toBeEnabled();
  });

  it("sends a trimmed follow-up through the store, without moving focus on new answers", async () => {
    await openLive();
    await click("Card view");
    const input = screen.getByLabelText("Follow-up");
    fireEvent.change(input, { target: { value: "  and the cost?  " } });
    input.focus();
    await click("Send follow-up");
    expect(deps.submitFollowUp).toHaveBeenCalledWith(
      expect.any(String),
      "and the cost?",
      { skill: "auto", language: "auto" },
    );
    expect(input).toHaveValue("");
    input.focus();
    page = {
      ...page,
      actions: [
        ...page.actions,
        answerAction(answerResult(), { taskId: "task-2" }),
      ],
    };
    await advance(1_500);
    expect(screen.getByRole("button", { name: "Task 2" })).toBeVisible();
    expect(document.activeElement).toBe(input);
  });

  it("disables the input controls with a clear note when the server has no route", async () => {
    resetSessionStores();
    configureSessionStores({
      fetch: server.fetch,
      isVisible: () => true,
      storage: { read: () => null, write: () => {}, remove: () => {} },
      analyzeLatestCapture: undefined,
      analyzeCapture: undefined,
      submitFollowUp: undefined,
    } as never);
    await openLive();
    await click("Card view");
    await shareSource();
    await click(/Capture & analyze/);
    fireEvent.click(
      screen.getByRole("menuitem", { name: /New task from a fresh capture/ }),
    );
    await settle();
    expect(inCard().getByRole("alert")).toHaveTextContent("Not available yet");
    expect(
      screen.getByRole("button", { name: /Capture & analyze/ }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Follow-up")).toBeDisabled();
    expect(inCard().getByRole("button", { name: "Pause" })).toBeEnabled();
  });

  it("pins an older task as presentation only: nothing is submitted", async () => {
    page = {
      ...page,
      actions: [
        answerAction(answerResult()),
        answerAction(answerResult(), { taskId: "task-2" }),
      ],
    };
    await openLive();
    await click("Card view");
    const before = server.calls.filter((call) => call.startsWith("POST"));
    await click("Task 1");
    expect(screen.getByText(/Viewing an earlier task/)).toBeVisible();
    expect(presentation.get().pinnedTaskId).toBe("task-1");
    expect(server.calls.filter((call) => call.startsWith("POST"))).toEqual(
      before,
    );
    await click("Back to now");
    expect(presentation.get().pinnedTaskId).toBeNull();
  });

  it("shows the Paused banner and a Resume control", async () => {
    server.on("GET /current", () =>
      jsonResponse({ session: sessionView({ status: "paused" }) }),
    );
    page = { ...page, session: sessionView({ status: "paused" }) };
    await openLive();
    await click("Card view");
    expect(
      screen.getByText("Paused. Nothing is captured and no new work starts."),
    ).toBeVisible();
    expect(inCard().getByRole("button", { name: "Resume" })).toBeVisible();
  });

  it("confirms End before ending, and Keep going leaves the session as it was", async () => {
    await openLive();
    await click("Card view");
    fireEvent.click(inCard().getByRole("button", { name: "End" }));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    await click("Keep going");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(server.calls.some((call) => call.endsWith("/control"))).toBe(false);
  });

  it("returns to the dashboard's ended summary when the open session ends", async () => {
    await openLive();
    await click("Card view");
    page = {
      ...page,
      session: sessionView({ status: "ended", endedAt: minutesAfter(3) }),
    };
    await advance(1_500);
    expect(presentation.get().mode).toBe("full");
    expect(screen.queryByTestId("overlay-card")).toBeNull();
  });

  it("Details opens the full dashboard, and Close leaves the card", async () => {
    await openLive();
    await click("Card view");
    await click("Details");
    expect(presentation.get().mode).toBe("full");
    expect(screen.queryByTestId("overlay-card")).toBeNull();
    expect(screen.getByTestId("live-panel")).toBeVisible();
    await click("Card view");
    await click("Close overlay");
    expect(presentation.get().mode).toBe("full");
  });
});

describe("floating host", () => {
  it("opens the PiP window with the overlay route in an iframe, not a portal", async () => {
    const pip = fakePip();
    await openLive();
    await click("Float");
    expect(pip.requestWindow).toHaveBeenCalledTimes(1);
    const frame = overlayFrame(pip);
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("src")).toBe(
      "/t/local/p/interview/live/overlay?host=pip",
    );
    // The overlay page shares a window or screen from the PiP's own document.
    expect(frame?.getAttribute("allow")).toBe(
      "clipboard-write; display-capture",
    );
    // The page keeps the dashboard; no React was portalled into the window.
    expect(screen.getByTestId("live-panel")).toBeVisible();
    expect(pip.doc.querySelector('[data-testid="overlay-card"]')).toBeNull();
    expect(presentation.get().float).toBe("pip");
  });

  it("closing the window returns to the mode it opened from, and never commands the session", async () => {
    for (const from of ["full", "card", "maximized"] as const) {
      cleanup();
      presentation.reset();
      resetSessionStores();
      configureSessionStores({
        fetch: server.fetch,
        isVisible: () => true,
        storage: { read: () => null, write: () => {}, remove: () => {} },
        ...deps,
      });
      const pip = fakePip();
      await openLive();
      act(() => presentation.setMode(from));
      act(() => presentation.setMode("floating"));
      await flush();
      expect(overlayFrame(pip)).not.toBeNull();
      act(() => pip.win.emit("pagehide"));
      await flush();
      expect(overlayFrame(pip)).toBeNull();
      expect(pip.win.close).toHaveBeenCalled();
      expect(presentation.get()).toMatchObject({ mode: from, float: "closed" });
    }
    expect(server.calls.filter((call) => call.startsWith("POST"))).toEqual([]);
    expect(server.calls.filter((call) => call.startsWith("DELETE"))).toEqual(
      [],
    );
  });

  it("closes when the overlay page asks (Back to Studio) or reports lost access, from its own iframe only", async () => {
    const pip = fakePip();
    await openLive();
    act(() => presentation.setMode("card"));
    act(() => presentation.setMode("floating"));
    await flush();
    const frame = overlayFrame(pip) as HTMLIFrameElement;
    // The overlay iframe's `parent` is the PiP window, so the message lands
    // there (not on the opener window). A message from anywhere else, or one
    // posted to the opener window, is ignored.
    act(() => {
      pip.win.emit("message", {
        data: { kind: "interview-overlay", event: "close" },
        source: window,
      });
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { kind: "interview-overlay", event: "close" },
          source: frame.contentWindow,
        }),
      );
    });
    expect(presentation.get().mode).toBe("floating");
    act(() => {
      pip.win.emit("message", {
        data: { kind: "interview-overlay", event: "close" },
        source: frame.contentWindow,
      });
    });
    await flush();
    expect(overlayFrame(pip)).toBeNull();
    expect(presentation.get().mode).toBe("card");
    expect(server.calls.some((call) => call.startsWith("POST"))).toBe(false);
  });

  it("keeps the pin when the float closes", async () => {
    page = {
      ...page,
      actions: [
        answerAction(answerResult()),
        answerAction(answerResult(), { taskId: "task-2" }),
      ],
    };
    const pip = fakePip();
    await openLive();
    act(() => presentation.pin("task-1"));
    await click("Float");
    act(() => pip.win.emit("pagehide"));
    await flush();
    expect(presentation.get().pinnedTaskId).toBe("task-1");
  });

  it("falls back to the draggable card in the tab when the API is absent", async () => {
    await openLive();
    await click("Float");
    expect(card()).toHaveAttribute("data-variant", "tab");
    expect(presentation.get().float).toBe("fallback");
    // Closing the in-tab fallback returns to where it came from.
    await click("Close overlay");
    expect(presentation.get().mode).toBe("full");
  });

  it("falls back when the browser refuses the window (no user activation)", async () => {
    const pip = fakePip();
    pip.requestWindow.mockRejectedValueOnce(new Error("no activation"));
    await openLive();
    await click("Float");
    expect(card()).toHaveAttribute("data-variant", "tab");
    expect(overlayFrame(pip)).toBeNull();
  });
});

describe("float closes when access is lost", () => {
  const closed = (pip: ReturnType<typeof fakePip>) => {
    expect(pip.win.close).toHaveBeenCalled();
    expect(overlayFrame(pip)).toBeNull();
    expect(presentation.get()).toMatchObject({ mode: "full", float: "closed" });
  };
  const errorBody = (code: string, status: number) => () =>
    jsonResponse({ error: { code } }, status);

  async function floating() {
    const pip = fakePip();
    await openLive();
    await click("Float");
    expect(overlayFrame(pip)).not.toBeNull();
    return pip;
  }

  it.each([
    ["401", errorBody("unauthorized", 401)],
    ["404", errorBody("not_found", 404)],
    ["membership loss (403)", errorBody("origin_forbidden", 403)],
  ])("on %s from the stream", async (_name, respond) => {
    const pip = await floating();
    server.on("GET /:id/stream", respond);
    await advance(1_500);
    closed(pip);
  });

  it.each(["ended", "purging"] as const)("on session %s", async (status) => {
    const pip = await floating();
    page = streamPage({ session: sessionView({ status, purged: false }) });
    await advance(1_500);
    closed(pip);
  });

  it("on tenant switch", async () => {
    const pip = await floating();
    window.history.pushState({}, "", "/t/other/p/interview/live");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await flush();
    closed(pip);
  });

  it("on pagehide", async () => {
    const pip = await floating();
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await flush();
    expect(overlayFrame(pip)).toBeNull();
    expect(server.calls.some((call) => call.startsWith("POST"))).toBe(false);
  });

  it("persists across pages and closes only when the shell unmounts", async () => {
    const pip = fakePip();
    const view = render(<LiveSessionView rest={[]} studio={studio} />);
    const host = render(
      <>
        <LiveCardHost />
        <LiveFloatHost />
      </>,
    );
    await flush();
    await flush();
    await click("Float");
    expect(overlayFrame(pip)).not.toBeNull();
    view.unmount();
    await flush();
    expect(overlayFrame(pip)).not.toBeNull();
    expect(pip.win.close).not.toHaveBeenCalled();
    host.unmount();
    await flush();
    closed(pip);
    expect(getSessionStore("local").getSnapshot().session).not.toBeNull();
  });
});
