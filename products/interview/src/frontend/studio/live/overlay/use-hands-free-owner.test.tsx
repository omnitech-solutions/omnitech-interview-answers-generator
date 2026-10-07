// Which document owns the microphone, the screen and Auto (use-hands-free.ts):
// this one when it is the only one, a mirror when another owns them, the share
// "Start hands-free" parked is adopted, and a session that opens after Setup
// turned hands-free on starts Auto. Driven through a bare probe.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentation } from "../focus-presentation";
import {
  configureSessionStores,
  getSessionStore,
  resetSessionStores,
} from "../session-registry";
import { NO_QUESTION_STATUS } from "../shared/no-question";
import { HandsFreeProbe } from "../testing/hands-free-probe";
import {
  action,
  jsonResponse,
  minutesAfter,
  sessionView,
  snapshot,
  streamPage,
} from "../testing/session-fixtures";
import { answerResult } from "../testing/session-result-fixtures";
import { createTestServer } from "../testing/session-test-server";
import {
  FakeRecognition,
  fakeStream,
  installDisplayMedia,
  installFakeCanvas,
  installRecognition,
  installVideoSize,
  paintScreen,
} from "./capture-fixtures";
import { startShare } from "./capture-source";
import { resetCaptureTrigger } from "./capture-trigger";
import { announceHandsFree, dropParkedShare, parkShare } from "./share-handoff";

const SESSION = "1c2d3e4f-0000-4000-8000-000000000001";
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await flush();
};
const autoOn = () =>
  window.localStorage.setItem("interview-studio.live.auto.local", "on");

// The control actions the server received, in order.
const controls: string[] = [];

function serve(actions: ReturnType<typeof action>[] = []) {
  const session = sessionView({
    id: SESSION,
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
  });
  const page = streamPage({
    session,
    observations: [snapshot(1, "Chrome · LeetCode")],
    nextAfterSequence: 1,
    actions,
  });
  const server = createTestServer(() => page);
  server.on("POST /:id/control", ({ body }) => {
    controls.push((body as { action: string }).action);
    return jsonResponse({ session });
  });
  server.on("GET /current", () => jsonResponse({ session }));
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    server.fetch(String(input), init),
  );
}

// Another document that holds the owner lock for as long as the test runs.
function anotherDocumentOwns() {
  const request = vi.fn(
    (_name: string, _options: unknown, _callback: () => Promise<void>) =>
      new Promise<void>(() => undefined),
  );
  Object.defineProperty(navigator, "locks", {
    value: { request },
    configurable: true,
  });
  return request;
}

async function openProbe(actions: ReturnType<typeof action>[] = []) {
  serve(actions);
  render(<HandsFreeProbe />);
  await settle();
}
const probe = () => screen.getByTestId("hf-probe");

beforeEach(() => {
  controls.length = 0;
  resetCaptureTrigger();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetSessionStores();
  presentation.reset();
  installVideoSize();
  installFakeCanvas();
  paintScreen("rising");
  installDisplayMedia(async () => fakeStream().stream);
  installRecognition(true);
});
afterEach(() => {
  cleanup();
  dropParkedShare();
  presentation.reset();
  resetSessionStores();
  Reflect.deleteProperty(navigator, "locks");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("work in flight", () => {
  it("knows work is running, and Stop analysis is the real session-wide stop-work", async () => {
    await openProbe([action({ dispatchStatus: "in_flight", result: null })]);
    expect(probe()).toHaveAttribute("data-working", "true");
    fireEvent.click(screen.getByTestId("stop-analysis"));
    await settle();
    expect(controls).toEqual(["stop-work"]);
  });

  it("is idle when nothing runs", async () => {
    await openProbe();
    expect(probe()).toHaveAttribute("data-working", "false");
  });
});

describe("the no-question line", () => {
  it("says so when the newest capture had no question (Manual line, then the Auto holding line)", async () => {
    await openProbe([
      action({
        taskId: "x1",
        noQuestion: true,
        result: answerResult({ category: "no-question", draft: "Nothing." }),
        createdAt: minutesAfter(0),
      }),
    ]);
    expect(screen.getByTestId("no-question")).toHaveTextContent(
      NO_QUESTION_STATUS.manual,
    );
    fireEvent.click(screen.getByTestId("auto-toggle"));
    await settle();
    expect(screen.getByTestId("no-question")).toHaveTextContent(
      NO_QUESTION_STATUS.auto,
    );
  });

  it("shows no no-question line when there is none", async () => {
    await openProbe();
    expect(screen.queryByTestId("no-question")).toBeNull();
  });
});

describe("one owner, the rest mirror", () => {
  it("is Manual and owns this window until the owner turns Auto on", async () => {
    await openProbe();
    expect(probe()).toHaveAttribute("data-owner", "this-window");
    expect(probe()).toHaveAttribute("data-live-auto", "false");
    expect(probe()).toHaveAttribute("data-live-mic", "off");
    expect(probe()).toHaveAttribute("data-live-sharing", "false");
    expect(screen.getByTestId("auto-toggle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByTestId("auto-toggle"));
    await settle();
    expect(screen.getByTestId("auto-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("owns Auto when it is the only document: listens, and says so", async () => {
    autoOn();
    await openProbe();
    expect(screen.getByTestId("auto-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(FakeRecognition.instances.length).toBeGreaterThan(0);
    expect(screen.getByTestId("auto-status")).toHaveTextContent(/^Auto ·/);
    // Turned off in one click.
    fireEvent.click(screen.getByTestId("auto-stop"));
    await settle();
    expect(screen.queryByTestId("auto-status")).toBeNull();
    expect(
      window.localStorage.getItem("interview-studio.live.auto.local"),
    ).toBe("off");
  });

  it("mirrors, and never listens, when another document owns the microphone", async () => {
    autoOn();
    const request = anotherDocumentOwns();
    await openProbe();
    // It asked for the same lock the panels use, and was not granted it.
    expect(request).toHaveBeenCalledWith(
      "interview-studio.panel-owner.local",
      expect.anything(),
      expect.any(Function),
    );
    expect(probe()).toHaveAttribute("data-owner", "other-window");
    expect(probe()).toHaveAttribute("data-live-auto", "true");
    expect(screen.queryByTestId("auto-status")).toBeNull();
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it("learns from the panel bus that the owner is the native app", async () => {
    autoOn();
    anotherDocumentOwns();
    await openProbe();
    expect(probe()).toHaveAttribute("data-live-native", "false");
    // The native window reports its state over the panel bus.
    const bus = new BroadcastChannel("interview-studio.panels");
    bus.postMessage({
      type: "state",
      state: {
        auto: true,
        mic: "listening",
        interim: "",
        sharing: false,
        phase: null,
        native: true,
      },
    });
    await vi.waitFor(() =>
      expect(probe()).toHaveAttribute("data-live-native", "true"),
    );
    bus.close();
    expect(probe()).toHaveAttribute("data-live-mic", "listening");
    expect(probe()).toHaveAttribute("data-live-auto", "true");
  });

  it("adopts the share parked by Start hands-free, and says hands-free is on", async () => {
    autoOn();
    parkShare(await startShare());
    announceHandsFree("Hands-free is on.");
    await openProbe();
    expect(probe()).toHaveAttribute("data-live-sharing", "true");
    expect(probe().getAttribute("data-share-kind")).not.toBe("");
    expect(screen.getByTestId("hands-free-on")).toHaveTextContent(
      "Hands-free is on.",
    );
    // Auto sees a share, so it does not ask for the click the browser needs.
    expect(screen.getByTestId("auto-status")).toHaveAttribute(
      "data-tone",
      "ok",
    );
  });

  it("starts Auto when the session opens after Setup turned hands-free on", async () => {
    // The shell is up before any session: Setup saves the preference, then the
    // session starts.
    const session = sessionView({
      id: SESSION,
      processingPolicy: "permitted-remote",
      captureSources: ["microphone"],
    });
    let current: typeof session | null = null;
    const page = streamPage({
      session,
      observations: [],
      nextAfterSequence: 0,
      actions: [],
    });
    const server = createTestServer(() => page);
    server.on("GET /current", () => jsonResponse({ session: current }));
    configureSessionStores({
      fetch: server.fetch,
      isVisible: () => true,
      storage: { read: () => null, write: () => {}, remove: () => {} },
    });
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      server.fetch(String(input), init),
    );
    render(<HandsFreeProbe />);
    await settle();
    expect(screen.queryByTestId("auto-status")).toBeNull();
    autoOn();
    current = session;
    await act(() => getSessionStore("local").actions.refresh());
    await settle();
    expect(probe()).toHaveAttribute("data-owner", "this-window");
    expect(screen.getByTestId("auto-status")).toBeInTheDocument();
    expect(FakeRecognition.instances.length).toBeGreaterThan(0);
  });
});
