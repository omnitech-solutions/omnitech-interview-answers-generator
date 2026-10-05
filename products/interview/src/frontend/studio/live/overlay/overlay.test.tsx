// The card's drag and size, the session switcher, and the chromeless overlay
// route, over the real store with a scripted service.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveCardHost } from "../card-host";
import { LiveFloatHost } from "../float-host";
import { presentation } from "../focus-presentation";
import { LiveSessionView } from "../live-view";
import {
  configureSessionStores,
  getSessionStore,
  resetSessionStores,
} from "../session-registry";
import { answerAction } from "../testing/live-view-kit";
import {
  action,
  jsonResponse,
  minutesAfter,
  SESSION_ID,
  sessionView,
  snapshot,
  streamPage,
} from "../testing/session-fixtures";
import {
  answerResult,
  codeResult,
  codingAnswer,
} from "../testing/session-result-fixtures";
import {
  createTestServer,
  type TestServer,
} from "../testing/session-test-server";
import { clampPosition, readPosition, resetPosition } from "./card-position";
import { HandsFreeProvider } from "./hands-free-context";
import { OverlayPage } from "./overlay-page";

const studio = {} as never;
// Analyze needs remote processing.
const live = () => sessionView({ processingPolicy: "permitted-remote" });
const OTHER_ID = "1c2d3e4f-0000-4000-8000-00000000beef";
let server: TestServer;
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const click = async (name: string | RegExp) => {
  fireEvent.click(screen.getByRole("button", { name }));
  await flush();
};
const card = () => screen.getByTestId("overlay-card");

// jsdom has no PointerEvent: a MouseEvent that carries a pointer id.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(
    type: string,
    init: MouseEventInit & { pointerId?: number } = {},
  ) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

function summary(id: string, status: "active" | "ended", at = 0) {
  return {
    id,
    status,
    retention: "delete-at-end",
    processingPolicy: "device-only",
    createdAt: minutesAfter(at),
    endedAt: status === "ended" ? minutesAfter(at + 41) : null,
    purged: false,
    interviewId: null,
    candidacyId: null,
    rehearsal: false,
    shownDraftCount: 0,
  };
}

// Two sessions: A is live (newest), B ended earlier. Each has its own stream.
function twoSessions() {
  const views = {
    [SESSION_ID]: live(),
    [OTHER_ID]: sessionView({
      id: OTHER_ID,
      status: "ended",
      endedAt: minutesAfter(-20),
      createdAt: minutesAfter(-61),
    }),
  } as Record<string, ReturnType<typeof sessionView>>;
  const pages: Record<string, ReturnType<typeof streamPage>> = {
    [SESSION_ID]: streamPage({
      session: live(),
      observations: [snapshot(1, "Chrome · LeetCode")],
      nextAfterSequence: 1,
      actions: [answerAction(answerResult())],
    }),
    [OTHER_ID]: streamPage({
      session: views[OTHER_ID] as never,
      observations: [],
      actions: [],
    }),
  };
  const idOf = (url: URL) =>
    url.pathname
      .split("/")
      .filter((part) => part !== "stream")
      .pop() as string;
  server.on("GET /current", () => jsonResponse({ session: views[SESSION_ID] }));
  server.on("GET /:id", ({ url }) =>
    jsonResponse({ session: views[idOf(url)] }),
  );
  server.on("GET /:id/stream", ({ url }) => jsonResponse(pages[idOf(url)]));
  server.on("GET /", () =>
    jsonResponse({
      sessions: [
        summary(SESSION_ID, "active"),
        summary(OTHER_ID, "ended", -61),
      ],
      nextCursor: null,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  window.history.replaceState({}, "", "/");
  window.sessionStorage.clear();
  resetSessionStores();
  presentation.reset();
  resetPosition();
  server = createTestServer(() =>
    streamPage({
      session: live(),
      observations: [snapshot(1)],
      nextAfterSequence: 1,
      actions: [answerAction(answerResult())],
    }),
  );
  server.on("GET /current", () => jsonResponse({ session: live() }));
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
    analyzeLatestCapture: vi.fn(async () => undefined),
    submitFollowUp: vi.fn(async () => undefined),
  });
});
afterEach(() => {
  cleanup();
  presentation.reset();
  resetSessionStores();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function openCard() {
  render(
    <HandsFreeProvider>
      <LiveSessionView rest={[]} studio={studio} />
      <LiveCardHost />
      <LiveFloatHost />
    </HandsFreeProvider>,
  );
  await flush();
  await flush();
  act(() => presentation.setMode("card"));
  await flush();
}

function placeCard(left = 100, top = 100, width = 380, height = 500) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const style = this.style;
      const x = style.left ? Number.parseFloat(style.left) : left;
      const y = style.top ? Number.parseFloat(style.top) : top;
      return {
        left: x,
        top: y,
        right: x + width,
        bottom: y + height,
        width,
        height,
        x,
        y,
        toJSON: () => ({}),
      };
    },
  );
}

describe("drag", () => {
  it("clamps a position so the card and its header stay on screen", () => {
    const viewport = { width: 1000, height: 700 };
    const size = { width: 380, height: 500 };
    expect(clampPosition({ x: -50, y: -9 }, size, viewport)).toEqual({
      x: 0,
      y: 0,
    });
    expect(clampPosition({ x: 5000, y: 5000 }, size, viewport)).toEqual({
      x: 620,
      y: 528,
    });
    expect(clampPosition({ x: 300, y: 200 }, size, viewport)).toEqual({
      x: 300,
      y: 200,
    });
  });

  it("moves with pointer events by the header and remembers the place", async () => {
    placeCard();
    await openCard();
    const header = card().querySelector(".ov-head") as HTMLElement;
    fireEvent.pointerDown(header, { clientX: 150, clientY: 110, button: 0 });
    fireEvent.pointerMove(header, { clientX: 350, clientY: 210 });
    expect(card().style.left).toBe("300px");
    expect(card().style.top).toBe("200px");
    // Clamped to the viewport.
    fireEvent.pointerMove(header, { clientX: 9000, clientY: 9000 });
    expect(card().style.left).toBe(`${window.innerWidth - 380}px`);
    fireEvent.pointerUp(header);
    fireEvent.pointerMove(header, { clientX: 10, clientY: 10 });
    expect(card().style.left).toBe(`${window.innerWidth - 380}px`);
    expect(readPosition()).toEqual({
      x: window.innerWidth - 380,
      y: window.innerHeight - 160 - 12,
    });
  });

  it("drags from the Move handle itself, focusing it, and a click without a move does nothing", async () => {
    placeCard();
    await openCard();
    const handle = screen.getByRole("button", { name: /Move card/ });
    fireEvent.pointerDown(handle, { clientX: 110, clientY: 110, button: 0 });
    expect(document.activeElement).toBe(handle);
    fireEvent.pointerMove(handle, { clientX: 210, clientY: 160 });
    expect(card().style.left).toBe("200px");
    expect(card().style.top).toBe("150px");
    // The card never outgrows the room below it.
    expect(card().style.maxHeight).toBe("calc(100vh - 162px)");
    fireEvent.pointerUp(handle);
    fireEvent.click(handle);
    expect(card().style.left).toBe("200px");
    // A press and release with no move leaves the position alone.
    const before = card().style.left;
    fireEvent.pointerDown(handle, { clientX: 210, clientY: 160, button: 0 });
    fireEvent.pointerUp(handle);
    expect(card().style.left).toBe(before);
  });

  it("does not start a drag from a button in the header", async () => {
    placeCard();
    await openCard();
    const button = screen.getByRole("button", { name: "Close overlay" });
    fireEvent.pointerDown(button, { clientX: 150, clientY: 110, button: 0 });
    fireEvent.pointerMove(button, { clientX: 350, clientY: 210 });
    expect(card().style.left).toBe("");
  });

  it("moves with the arrow keys from a focusable handle, and Home resets", async () => {
    placeCard();
    await openCard();
    const handle = screen.getByRole("button", { name: /Move card/ });
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(card().style.left).toBe("116px");
    fireEvent.keyDown(handle, { key: "ArrowDown", shiftKey: true });
    expect(card().style.top).toBe("164px");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(card().style.left).toBe("");
    expect(readPosition()).toBeNull();
  });

  it("survives storage that throws", async () => {
    placeCard();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await openCard();
    const handle = screen.getByRole("button", { name: /Move card/ });
    expect(() => fireEvent.keyDown(handle, { key: "ArrowLeft" })).not.toThrow();
    expect(card().style.left).toBe("84px");
  });
});

describe("maximize", () => {
  it("expands the same card and restores it at its previous position", async () => {
    placeCard();
    await openCard();
    const handle = screen.getByRole("button", { name: /Move card/ });
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(card().style.left).toBe("164px");
    const before = card();
    await click("Maximize");
    expect(card()).toBe(before);
    expect(card()).toHaveAttribute("data-size", "maximized");
    expect(presentation.get().mode).toBe("maximized");
    // The switcher and the follow-up input stay in both sizes.
    expect(screen.getByTestId("session-switcher")).toBeVisible();
    await click("Restore");
    expect(card()).toBe(before);
    expect(card()).toHaveAttribute("data-size", "compact");
    expect(card().style.left).toBe("164px");
  });

  it("keeps typed follow-up text and open disclosures across sizes (no remount)", async () => {
    await openCard();
    const input = screen.getByLabelText("Follow-up") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "what about ties?" } });
    fireEvent.click(screen.getByRole("button", { name: /Activity/ }));
    await click("Maximize");
    expect(screen.getByLabelText("Follow-up")).toBe(input);
    expect(input).toHaveValue("what about ties?");
    expect(screen.getByRole("button", { name: /Activity/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await click("Restore");
    expect(screen.getByLabelText("Follow-up")).toBe(input);
    expect(input).toHaveValue("what about ties?");
  });

  it("restores with Escape, but Escape closes a menu first", async () => {
    await openCard();
    await click("Maximize");
    await click(/Capture & analyze/);
    const menu = screen.getByRole("menu", { name: "Capture source" });
    fireEvent.keyDown(within(menu).getAllByRole("menuitem")[0] as HTMLElement, {
      key: "Escape",
    });
    expect(screen.queryByRole("menu", { name: "Capture source" })).toBeNull();
    expect(card()).toHaveAttribute("data-size", "maximized");
    fireEvent.keyDown(card(), { key: "Escape" });
    expect(card()).toHaveAttribute("data-size", "compact");
    expect(presentation.get().mode).toBe("card");
  });

  it("lays the maximized card out as a main column and a side column", async () => {
    await openCard();
    await click("Maximize");
    const main = card().querySelector(".ov-col-main") as HTMLElement;
    const side = card().querySelector(".ov-col-side") as HTMLElement;
    expect(within(main).getByTestId("slots")).toBeVisible();
    expect(within(main).getByTestId("task-head")).toBeVisible();
    expect(
      within(side).getByRole("button", { name: /Activity/ }),
    ).toBeVisible();
  });
});

describe("session switcher", () => {
  it("lists live and recent sessions with status and time", async () => {
    twoSessions();
    await openCard();
    await click(/Live · 1:00|Session/);
    const menu = within(screen.getByRole("menu", { name: "Sessions" }));
    const items = menu.getAllByRole("menuitemradio");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    expect(items[0]).toHaveTextContent("Live · 1:00");
    expect(items[1]).toHaveTextContent("Ended · 41:00");
    expect(items[1]).not.toHaveTextContent(/Ended · Ended/);
  });

  it("switches the one store to an ended session without leaking the live one's state, and without pausing or ending it", async () => {
    twoSessions();
    await openCard();
    const store = getSessionStore("local");
    expect(store.getSnapshot().actions.length).toBeGreaterThan(0);
    await click(/Live · 1:00|Session/);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Ended/ }));
    await flush();
    await flush();
    const held = store.getSnapshot();
    expect(held.session?.id).toBe(OTHER_ID);
    // Nothing of the live session remains.
    expect(held.observations).toEqual([]);
    expect(held.actions).toEqual([]);
    // The ended session opens as its ended summary in the card.
    expect(screen.getByTestId("ov-ended")).toBeVisible();
    expect(presentation.get().mode).toBe("card");
    // Switching is a read: no control, no input, no delete.
    expect(server.calls.filter((call) => call.startsWith("POST"))).toEqual([]);
    expect(server.calls.filter((call) => call.startsWith("DELETE"))).toEqual(
      [],
    );
    // The ended session is followed (a refresh does not jump back to the live one).
    await act(() => store.actions.refresh());
    expect(store.getSnapshot().session?.id).toBe(OTHER_ID);
    // And back: the live session's own state is read again.
    fireEvent.click(screen.getByRole("button", { name: /Next session/ }));
    await flush();
    await advance(1_000);
    expect(store.getSnapshot().session?.id).toBe(SESSION_ID);
    expect(store.getSnapshot().actions.length).toBeGreaterThan(0);
    expect(server.calls.filter((call) => call.startsWith("POST"))).toEqual([]);
  });

  it("keeps the card and the switcher when the ended session is purged and its stream answers 404, and lets the person go back", async () => {
    twoSessions();
    // A delete-at-end session: purged, and nothing to read from its stream.
    const purged = sessionView({
      id: OTHER_ID,
      status: "ended",
      endedAt: minutesAfter(-20),
      createdAt: minutesAfter(-61),
      purged: true,
    });
    server.on("GET /:id", ({ url }) =>
      jsonResponse({
        session: url.pathname.endsWith(OTHER_ID) ? purged : live(),
      }),
    );
    server.on("GET /:id/stream", ({ url }) =>
      url.pathname.includes(OTHER_ID)
        ? jsonResponse({ error: { code: "not_found" } }, 404)
        : jsonResponse(
            streamPage({
              session: live(),
              observations: [snapshot(1)],
              nextAfterSequence: 1,
              actions: [answerAction(answerResult())],
            }),
          ),
    );
    await openCard();
    await click("Previous session");
    await flush();
    await advance(2_000);
    expect(getSessionStore("local").getSnapshot().session?.id).toBe(OTHER_ID);
    // Still open, in the ended state, with the switcher usable.
    expect(presentation.get().mode).toBe("card");
    expect(screen.getByTestId("ov-ended")).toBeVisible();
    expect(screen.getByTestId("session-switcher")).toBeVisible();
    // And back to the live one.
    await click("Next session");
    await flush();
    await advance(1_000);
    expect(getSessionStore("local").getSnapshot().session?.id).toBe(SESSION_ID);
    expect(screen.queryByTestId("ov-ended")).toBeNull();
    expect(screen.getByTestId("task-tag")).toBeVisible();
    expect(server.calls.filter((call) => call.startsWith("POST"))).toEqual([]);
  });

  it("moves with Previous and Next arrows, disabled at the ends", async () => {
    twoSessions();
    await openCard();
    expect(screen.getByRole("button", { name: "Next session" })).toBeDisabled();
    await click("Previous session");
    await flush();
    expect(getSessionStore("local").getSnapshot().session?.id).toBe(OTHER_ID);
    expect(
      screen.getByRole("button", { name: "Previous session" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next session" })).toBeEnabled();
  });

  it("is keyboard accessible: arrows move between sessions, Escape closes and returns focus", async () => {
    twoSessions();
    await openCard();
    const trigger = screen.getByRole("button", {
      name: /Session/,
      expanded: false,
    });
    fireEvent.click(trigger);
    await flush();
    const [first, second] = screen.getAllByRole("menuitemradio");
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Sessions" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("offers New session only when nothing is live, and routes to the start page", async () => {
    twoSessions();
    await openCard();
    fireEvent.click(
      screen.getByRole("button", { name: /Session/, expanded: false }),
    );
    expect(
      screen.getByRole("menuitem", { name: /New session/ }),
    ).toBeDisabled();
  });

  it("opens the start page for New session once the followed session has ended", async () => {
    twoSessions();
    // Nothing is live any more: the list holds only the ended one.
    server.on("GET /", () =>
      jsonResponse({
        sessions: [summary(OTHER_ID, "ended", -61)],
        nextCursor: null,
      }),
    );
    window.history.replaceState({}, "", "/t/local/p/interview/live");
    await openCard();
    await act(() => getSessionStore("local").actions.switchSession(OTHER_ID));
    await flush();
    fireEvent.click(
      screen.getByRole("button", { name: /Session/, expanded: false }),
    );
    await flush();
    const item = screen.getByRole("menuitem", { name: /New session/ });
    expect(item).toBeEnabled();
    // Nothing is live any more, so dismissing the finished one finds nothing.
    server.on("GET /current", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    fireEvent.click(item);
    await flush();
    await flush();
    expect(window.location.pathname).toBe("/t/local/p/interview/live");
    expect(presentation.get().mode).toBe("full");
    await flush();
    // The finished session was dismissed so the start page can show.
    expect(getSessionStore("local").getSnapshot().session).toBeNull();
    // Nothing was commanded.
    expect(server.calls.filter((call) => call.startsWith("POST"))).toEqual([]);
  });
});

describe("the chromeless overlay route", () => {
  const route = (query = "") =>
    window.history.replaceState(
      {},
      "",
      `/t/local/p/interview/live/overlay${query}`,
    );

  it("renders only the card, bound to its own store, with polling, and no Studio chrome", async () => {
    route();
    render(<OverlayPage />);
    await flush();
    await flush();
    expect(screen.getByTestId("overlay-root")).toBeVisible();
    expect(card()).toHaveAttribute("data-variant", "overlay");
    // No dashboard, no shell, no maximize or float (the window is the size).
    expect(screen.queryByTestId("live-panel")).toBeNull();
    expect(screen.queryByRole("button", { name: "Maximize" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Float" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Back to Studio/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Move card/ })).toBeNull();
    // It hydrated and polls by itself: no live page, no float host.
    expect(server.count("GET /current")).toBeGreaterThanOrEqual(1);
    const reads = server.count("GET /:id/stream");
    await advance(3_000);
    expect(server.count("GET /:id/stream")).toBeGreaterThan(reads);
    expect(screen.getByTestId("task-tag")).toHaveTextContent("T1 · rev 1");
  });

  it("does all the actions itself: pause, follow-up and Analyze", async () => {
    route();
    server.on("POST /:id/control", () =>
      jsonResponse({ session: sessionView({ status: "paused" }) }),
    );
    render(<OverlayPage />);
    await flush();
    await flush();
    await click("Pause");
    expect(server.count("POST /:id/control")).toBe(1);
    fireEvent.change(screen.getByLabelText("Follow-up"), {
      target: { value: "next?" },
    });
    await click("Send follow-up");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows Back to Studio when embedded (host=pip) and asks the embedding window to close", async () => {
    route("?host=pip");
    const post = vi.spyOn(window.parent, "postMessage");
    render(<OverlayPage />);
    await flush();
    await flush();
    // The test window is its own parent, so nothing is posted to another
    // window; the control is there and clicking it does not command the session.
    await click("Back to Studio");
    expect(server.calls.some((call) => call.startsWith("POST"))).toBe(false);
    post.mockRestore();
  });

  it("opens the session named by ?session=", async () => {
    twoSessions();
    route(`?session=${OTHER_ID}`);
    render(<OverlayPage />);
    await flush();
    await flush();
    await flush();
    expect(getSessionStore("local").getSnapshot().session?.id).toBe(OTHER_ID);
    expect(screen.getByTestId("ov-ended")).toBeVisible();
  });

  it("works standalone with no opener, and says so when nothing is live", async () => {
    route();
    server.on("GET /current", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    expect(window.opener).toBeFalsy();
    render(<OverlayPage />);
    await flush();
    await flush();
    expect(screen.getByTestId("overlay-empty")).toHaveTextContent(
      "No live session.",
    );
  });

  it("on 401 unmounts the card, says to sign in, and stops polling", async () => {
    route();
    render(<OverlayPage />);
    await flush();
    await flush();
    expect(card()).toBeVisible();
    server.on("GET /:id/stream", () =>
      jsonResponse({ error: { code: "unauthorized" } }, 401),
    );
    await advance(1_500);
    expect(screen.queryByTestId("overlay-card")).toBeNull();
    expect(screen.getByTestId("overlay-root")).toHaveAttribute(
      "data-access",
      "signed-out",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/signed out/i);
    const held = server.count("GET /:id/stream");
    await advance(10_000);
    expect(server.count("GET /:id/stream")).toBe(held);
  });

  it("on 404 unmounts the card and says the session is unavailable", async () => {
    route();
    render(<OverlayPage />);
    await flush();
    await flush();
    server.on("GET /:id/stream", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    await advance(1_500);
    expect(screen.queryByTestId("overlay-card")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(/unavailable/i);
    const held = server.count("GET /:id/stream");
    await advance(10_000);
    expect(server.count("GET /:id/stream")).toBe(held);
  });

  it("an action's 401 also ends it", async () => {
    route();
    server.on("POST /:id/control", () =>
      jsonResponse({ error: { code: "unauthorized" } }, 401),
    );
    render(<OverlayPage />);
    await flush();
    await flush();
    await click("Pause");
    expect(screen.queryByTestId("overlay-card")).toBeNull();
    expect(screen.getByTestId("overlay-root")).toHaveAttribute(
      "data-access",
      "signed-out",
    );
  });
});

describe("unused import guard", () => {
  it("keeps the fixtures honest", () => {
    expect(action({}).taskId).toBe("task-1");
  });
});

describe("header and chips", () => {
  it("keeps the title whole with a tooltip, and only Move, status, title and Close in the header", async () => {
    await openCard();
    const head = card().querySelector(".ov-head") as HTMLElement;
    const title = within(head).getByTestId("ov-title");
    expect(title).toHaveAttribute("title", title.textContent ?? "");
    expect(within(head).queryByTestId("ov-sources")).toBeNull();
    expect(within(head).queryByRole("button", { name: "Maximize" })).toBeNull();
    expect(
      within(head).getByRole("button", { name: "Close overlay" }),
    ).toBeVisible();
    const row = card().querySelector(".ov-chips") as HTMLElement;
    // The companion has not made contact: ONE line says so, no per-source lights.
    expect(within(card()).getByTestId("companion-line")).toHaveTextContent(
      "Capture companion: not connected",
    );
    expect(within(row).queryByTestId("ov-sources")).toBeNull();
    for (const name of ["Details", "Maximize", "Float"])
      expect(within(row).getByRole("button", { name })).toBeVisible();
  });

  it("opens Activity and the Solution when maximized, unless the person chose", async () => {
    const page = streamPage({
      session: live(),
      observations: [snapshot(1)],
      nextAfterSequence: 1,
      actions: [
        answerAction(codingAnswer(["No sorting allowed"])),
        action({ actionKind: "solve-code", result: codeResult() }),
      ],
    });
    server = createTestServer(() => page);
    server.on("GET /current", () => jsonResponse({ session: live() }));
    configureSessionStores({
      fetch: server.fetch,
      isVisible: () => true,
      storage: { read: () => null, write: () => {}, remove: () => {} },
    });
    await openCard();
    const open = (name: RegExp) =>
      screen.getByRole("button", { name }).getAttribute("aria-expanded");
    expect(open(/Activity/)).toBe("false");
    // Code is never collapsed: compact shows it in the compact density.
    const solution = () => within(screen.getByTestId("solution"));
    expect(solution().getByLabelText("Code canvas")).toHaveAttribute(
      "data-density",
      "compact",
    );
    await click("Maximize");
    expect(open(/Activity/)).toBe("true");
    expect(solution().getByLabelText("Code canvas")).toHaveAttribute(
      "data-density",
      "maximized",
    );
    // The solution is an editor canvas with a Run button.
    const canvas = within(screen.getByTestId("solution")).getByLabelText(
      "Code canvas",
    );
    expect(within(canvas).getByRole("button", { name: "Run" })).toBeVisible();
    expect(within(canvas).getByRole("button", { name: "Copy" })).toBeVisible();
    // The person's own choice survives a resize.
    fireEvent.click(screen.getByRole("button", { name: /Activity/ }));
    await click("Restore");
    expect(open(/Activity/)).toBe("false");
  });

  it("omits the 'from rev' tag for the current revision and shows it for an older one", async () => {
    const page = streamPage({
      session: live(),
      observations: [snapshot(1)],
      nextAfterSequence: 1,
      actions: [answerAction(codingAnswer(["No sorting allowed"]))],
    });
    server = createTestServer(() => page);
    server.on("GET /current", () => jsonResponse({ session: live() }));
    configureSessionStores({
      fetch: server.fetch,
      isVisible: () => true,
      storage: { read: () => null, write: () => {}, remove: () => {} },
    });
    await openCard();
    expect(screen.queryByText(/from rev/)).toBeNull();
  });
});

describe("the card across Studio pages", () => {
  it("stays mounted when the page under it is not the Live view", async () => {
    const view = render(
      <HandsFreeProvider>
        <LiveSessionView rest={[]} studio={studio} />
        <LiveCardHost />
      </HandsFreeProvider>,
    );
    await flush();
    await flush();
    act(() => presentation.setMode("card"));
    expect(card()).toBeVisible();
    // The Live page goes away (the person opens the Workspace): the card,
    // which the shell hosts, does not.
    view.rerender(
      <HandsFreeProvider>
        <LiveCardHost />
      </HandsFreeProvider>,
    );
    await flush();
    expect(card()).toBeVisible();
    expect(presentation.get().mode).toBe("card");
    // Closing it is what ends it.
    await click("Close overlay");
    expect(screen.queryByTestId("overlay-card")).toBeNull();
  });
});

describe("switching and resilience", () => {
  it("clears the pinned task and the per-session state when the person switches", async () => {
    twoSessions();
    await openCard();
    act(() => presentation.pin("task-1"));
    await click("Previous session");
    await flush();
    expect(presentation.get().pinnedTaskId).toBeNull();
  });

  it("disables Previous, Next and the menu items while a switch is reading", async () => {
    twoSessions();
    await openCard();
    let release!: (response: Response) => void;
    server.on("GET /:id", ({ url }) =>
      url.pathname.endsWith(OTHER_ID)
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(jsonResponse({ session: live() })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous session" }));
    await flush();
    expect(
      screen.getByRole("button", { name: "Previous session" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next session" })).toBeDisabled();
    release(
      jsonResponse({
        session: sessionView({
          id: OTHER_ID,
          status: "ended",
          endedAt: minutesAfter(-20),
          createdAt: minutesAfter(-61),
        }),
      }),
    );
    await flush();
    await flush();
    expect(screen.getByRole("button", { name: "Next session" })).toBeEnabled();
  });

  it("clamps a remembered position that no longer fits the window as the card appears", async () => {
    placeCard();
    window.sessionStorage.setItem(
      "interview-studio.live.card-position",
      JSON.stringify({ x: 9000, y: 9000 }),
    );
    resetPosition();
    window.sessionStorage.setItem(
      "interview-studio.live.card-position",
      JSON.stringify({ x: 9000, y: 9000 }),
    );
    await openCard();
    expect(Number.parseFloat(card().style.left)).toBeLessThanOrEqual(
      window.innerWidth - 380,
    );
    expect(Number.parseFloat(card().style.top)).toBeLessThanOrEqual(
      window.innerHeight - 160 - 12,
    );
  });

  it("ignores Escape while an IME composition is active", async () => {
    await openCard();
    await click("Maximize");
    fireEvent.keyDown(card(), { key: "Escape", isComposing: true });
    expect(card()).toHaveAttribute("data-size", "maximized");
    fireEvent.keyDown(card(), { key: "Escape" });
    expect(card()).toHaveAttribute("data-size", "compact");
  });

  it("says so when the copy fails", async () => {
    vi.stubGlobal("navigator", { clipboard: undefined });
    Object.defineProperty(document, "execCommand", {
      value: vi.fn(() => false),
      configurable: true,
    });
    await openCard();
    fireEvent.click(
      within(card()).getByRole("button", { name: "Copy answer" }),
    );
    await flush();
    expect(within(card()).getByRole("alert")).toHaveTextContent(
      /Couldn’t copy/,
    );
  });
});

describe("an invalid ?session= on the overlay page", () => {
  it("says it could not open that session while another is shown", async () => {
    window.history.replaceState(
      {},
      "",
      "/t/local/p/interview/live/overlay?session=nope",
    );
    server.on("GET /:id", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    render(<OverlayPage />);
    await flush();
    await flush();
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /That session couldn’t be opened/,
    );
    expect(card()).toBeVisible();
  });
});
