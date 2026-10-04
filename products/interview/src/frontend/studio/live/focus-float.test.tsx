// The Focus presentation and the floating (Document Picture-in-Picture) host,
// over the real store with a scripted service and a mocked
// window.documentPictureInPicture.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveFloatHost } from "./float-host";
import { presentation } from "./focus-presentation";
import { LiveSessionView } from "./live-view";
import { answerAction } from "./live-view-kit";
import {
  jsonResponse,
  minutesAfter,
  sessionView,
  snapshot,
  streamPage,
} from "./session-fixtures";
import {
  configureSessionStores,
  getSessionStore,
  resetSessionStores,
} from "./session-registry";
import { answerResult } from "./session-result-fixtures";
import { createTestServer, type TestServer } from "./session-test-server";

const studio = {} as never;
let visible = true;
let visibilityListeners: (() => void)[] = [];
let server: TestServer;
let page: ReturnType<typeof streamPage>;
const deps = {
  analyzeLatestCapture: vi.fn(async () => undefined),
  submitFollowUp: vi.fn(async () => undefined),
};

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

// A stand-in for the browser's PiP window: a real document (an iframe's), with
// the window methods the host uses.
function fakePip() {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const doc = frame.contentDocument as Document;
  const listeners = new Map<string, Set<() => void>>();
  const win = {
    document: doc,
    close: vi.fn(),
    addEventListener: (type: string, fn: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: () => void) =>
      listeners.get(type)?.delete(fn),
    emit: (type: string) => {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
  };
  const requestWindow = vi.fn(async () => win);
  Object.defineProperty(window, "documentPictureInPicture", {
    value: { requestWindow },
    configurable: true,
  });
  return { win, doc, requestWindow };
}
const inFloat = (pip: ReturnType<typeof fakePip>) =>
  pip.doc.querySelector('[data-testid="focus-view"]');

// The Studio shell mounts the float host beside the page, so the float
// persists across pages; the test mounts the same pair.
async function openLive() {
  render(
    <>
      <LiveSessionView rest={[]} studio={studio} />
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  visible = true;
  visibilityListeners = [];
  window.history.replaceState({}, "", "/");
  resetSessionStores();
  presentation.reset();
  page = streamPage({
    observations: [snapshot(1)],
    nextAfterSequence: 1,
    actions: [answerAction(answerResult())],
  });
  server = createTestServer(() => page);
  server.on("GET /current", () => jsonResponse({ session: sessionView() }));
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => visible,
    onVisibilityChange: (listener) => {
      visibilityListeners.push(listener);
      return () => {
        visibilityListeners = visibilityListeners.filter((l) => l !== listener);
      };
    },
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

describe("Focus", () => {
  it("shows the task and revision, answer, capture age, locality and verification", async () => {
    await openLive();
    await click("Focus view");
    const view = screen.getByTestId("focus-view");
    expect(view).toHaveAttribute("data-variant", "tab");
    expect(screen.getByText(/Task rev 1/)).toBeVisible();
    expect(screen.getByText("Suggested answer")).toBeVisible();
    expect(screen.getByTestId("focus-capture")).toHaveTextContent(
      "Screen capture less than a minute ago",
    );
    expect(screen.getByTestId("focus-locality")).toHaveTextContent(
      "On this Mac only",
    );
    expect(screen.getByTestId("focus-verification")).toHaveTextContent(
      /1 from your matrix/,
    );
    expect(screen.getByTestId("focus-sources")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: /Analyze latest capture.*Screen · less than a minute ago/,
      }),
    ).toBeEnabled();
  });

  it("sends Analyze and a trimmed follow-up through the store, without moving focus on new answers", async () => {
    await openLive();
    await click("Focus view");
    await click(/Analyze latest capture/);
    expect(deps.analyzeLatestCapture).toHaveBeenCalledTimes(1);
    const input = screen.getByLabelText("Follow-up");
    fireEvent.change(input, { target: { value: "  and the cost?  " } });
    input.focus();
    await click("Send follow-up");
    expect(deps.submitFollowUp).toHaveBeenCalledWith(
      expect.any(String),
      "and the cost?",
    );
    expect(input).toHaveValue("");
    // A new answer arrives while the person is typing.
    input.focus();
    page = {
      ...page,
      actions: [
        ...page.actions,
        answerAction(answerResult(), { taskId: "task-2" }),
      ],
    };
    await advance(1_500);
    expect(screen.getByText(/Task 2 ·/)).toBeVisible();
    expect(document.activeElement).toBe(input);
  });

  it("disables the input controls with a clear note when the server has no route", async () => {
    resetSessionStores();
    configureSessionStores({
      fetch: server.fetch,
      isVisible: () => visible,
      storage: { read: () => null, write: () => {}, remove: () => {} },
      // A server build without the owner-input route: no method at all.
      analyzeLatestCapture: undefined,
      submitFollowUp: undefined,
    } as never);
    await openLive();
    await click("Focus view");
    await click(/Analyze latest capture/);
    expect(screen.getByRole("alert")).toHaveTextContent("Not available yet");
    expect(
      screen.getByRole("button", { name: /Analyze latest capture/ }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Follow-up")).toBeDisabled();
    // The rest of the view still works.
    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
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
    await click("Focus view");
    const before = server.calls.filter((call) => call.startsWith("POST"));
    await click(/Task 1/);
    expect(screen.getByText(/Viewing an earlier task/)).toBeVisible();
    expect(presentation.get().pinnedTaskId).toBe("task-1");
    expect(server.calls.filter((call) => call.startsWith("POST"))).toEqual(
      before,
    );
    expect(deps.analyzeLatestCapture).not.toHaveBeenCalled();
    expect(deps.submitFollowUp).not.toHaveBeenCalled();
    await click("Back to now");
    expect(presentation.get().pinnedTaskId).toBeNull();
  });
});

describe("floating host", () => {
  it("moves Full to Focus to floating and back, mounting Focus in the PiP document", async () => {
    const pip = fakePip();
    await openLive();
    expect(screen.getByTestId("live-panel")).toBeVisible();
    await click("Float");
    expect(pip.requestWindow).toHaveBeenCalledTimes(1);
    expect(inFloat(pip)).not.toBeNull();
    expect(inFloat(pip)).toHaveAttribute("data-variant", "float");
    // The tab keeps the full view while the float is open.
    expect(screen.getByTestId("live-panel")).toBeVisible();
    // The float's controls are the explicit ones, and clicks reach them.
    expect(pip.doc.body.textContent).toContain("Analyze latest capture");
    const analyze = [...pip.doc.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Analyze latest capture"),
    ) as HTMLButtonElement;
    fireEvent.click(analyze);
    await flush();
    expect(deps.analyzeLatestCapture).toHaveBeenCalledTimes(1);
  });

  it("closing the float changes layout only: no pause, end or purge", async () => {
    const pip = fakePip();
    await openLive();
    await click("Float");
    const close = [...pip.doc.querySelectorAll("button")].find(
      (b) => b.textContent === "Close float",
    ) as HTMLButtonElement;
    fireEvent.click(close);
    await flush();
    expect(pip.win.close).toHaveBeenCalled();
    expect(inFloat(pip)).toBeNull();
    expect(presentation.get().mode).toBe("full");
    expect(screen.getByTestId("live-panel")).toBeVisible();
    // The person closing the window themselves is the same.
    expect(server.calls.filter((call) => call.startsWith("POST"))).toEqual([]);
    expect(server.calls.filter((call) => call.startsWith("DELETE"))).toEqual(
      [],
    );
  });

  it("closing the window itself (pagehide in the float) only changes layout", async () => {
    const pip = fakePip();
    await openLive();
    await click("Float");
    act(() => pip.win.emit("pagehide"));
    await flush();
    expect(inFloat(pip)).toBeNull();
    expect(server.calls.some((call) => call.startsWith("POST"))).toBe(false);
    expect(screen.getByTestId("live-panel")).toBeVisible();
  });

  it("falls back to Focus in the tab when the API is absent", async () => {
    await openLive();
    await click("Float");
    expect(screen.getByTestId("focus-view")).toHaveAttribute(
      "data-variant",
      "tab",
    );
    expect(presentation.get().float).toBe("fallback");
  });

  it("falls back when the browser refuses the window", async () => {
    const pip = fakePip();
    pip.requestWindow.mockRejectedValueOnce(new Error("no activation"));
    await openLive();
    await click("Float");
    expect(screen.getByTestId("focus-view")).toHaveAttribute(
      "data-variant",
      "tab",
    );
  });

  it("keeps the pin above the portal when the float closes", async () => {
    page = {
      ...page,
      actions: [
        answerAction(answerResult()),
        answerAction(answerResult(), { taskId: "task-2" }),
      ],
    };
    const pip = fakePip();
    await openLive();
    await click("Float");
    const chip = [...pip.doc.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Task 1"),
    ) as HTMLButtonElement;
    fireEvent.click(chip);
    await flush();
    expect(presentation.get().pinnedTaskId).toBe("task-1");
    expect(server.calls.some((call) => call.startsWith("POST"))).toBe(false);
    act(() => pip.win.emit("pagehide"));
    await flush();
    expect(presentation.get().pinnedTaskId).toBe("task-1");
  });

  it("keeps polling with Studio hidden while the float is visible", async () => {
    const pip = fakePip();
    await openLive();
    await click("Float");
    visible = false;
    act(() => {
      for (const listener of [...visibilityListeners]) listener();
    });
    const before = server.count("GET /:id/stream");
    await advance(3_000);
    expect(server.count("GET /:id/stream")).toBeGreaterThan(before);
    // The float hidden as well: polling stops.
    Object.defineProperty(pip.doc, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    act(() => pip.doc.dispatchEvent(new Event("visibilitychange")));
    await advance(1_500);
    const held = server.count("GET /:id/stream");
    await advance(5_000);
    expect(server.count("GET /:id/stream")).toBe(held);
  });
});

describe("float unmounts and closes when access is lost", () => {
  const closed = (pip: ReturnType<typeof fakePip>) => {
    expect(pip.win.close).toHaveBeenCalled();
    expect(inFloat(pip)).toBeNull();
    expect(presentation.get()).toMatchObject({ mode: "full", float: "closed" });
  };
  const ended = (status: "ended" | "purging") =>
    streamPage({ session: sessionView({ status, purged: false }) });
  const errorBody = (code: string, status: number) => () =>
    jsonResponse({ error: { code } }, status);

  async function floating() {
    const pip = fakePip();
    await openLive();
    await click("Float");
    expect(inFloat(pip)).not.toBeNull();
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

  it("on session end", async () => {
    const pip = await floating();
    page = ended("ended");
    await advance(1_500);
    closed(pip);
  });

  it("on purge", async () => {
    const pip = await floating();
    page = ended("purging");
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
    closed(pip);
    // Layout only: the session was never commanded.
    expect(server.calls.some((call) => call.startsWith("POST"))).toBe(false);
  });

  it("persists across pages and closes only when the shell unmounts", async () => {
    const pip = fakePip();
    const view = render(<LiveSessionView rest={[]} studio={studio} />);
    const host = render(<LiveFloatHost />);
    await flush();
    await flush();
    await click("Float");
    expect(inFloat(pip)).not.toBeNull();
    // Leaving the Live page changes the page, not the float.
    view.unmount();
    await flush();
    expect(inFloat(pip)).not.toBeNull();
    expect(pip.win.close).not.toHaveBeenCalled();
    host.unmount();
    await flush();
    closed(pip);
    expect(getSessionStore("local").getSnapshot().session).not.toBeNull();
  });
});
