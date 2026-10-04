// The Studio live view is the hands-free view: the same bar, Auto line, capture
// strip and follow-up box as the card, in a band under the session bar. This
// document owns the microphone and Auto when it is the only one, mirrors when
// another document owns them, adopts the share "Start hands-free" parked, and
// never runs a second Auto when the card is opened inside the page.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveCardHost } from "../card-host";
import { presentation } from "../focus-presentation";
import { LiveSessionView } from "../live-view";
import {
  jsonResponse,
  minutesAfter,
  sessionView,
  snapshot,
  streamPage,
} from "../session-fixtures";
import {
  configureSessionStores,
  getSessionStore,
  resetSessionStores,
} from "../session-registry";
import { createTestServer } from "../session-test-server";
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
import { resetPosition } from "./card-position";
import { HandsFreeProvider } from "./hands-free-context";
import { announceHandsFree, dropParkedShare, parkShare } from "./share-handoff";

const SESSION = "1c2d3e4f-0000-4000-8000-000000000001";
const studio = {} as never;
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await flush();
};
const autoOn = () =>
  window.localStorage.setItem("interview-studio.live.auto.local", "on");

function serve() {
  const session = sessionView({
    id: SESSION,
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
  });
  const page = streamPage({
    session,
    observations: [snapshot(1, "Chrome · LeetCode")],
    nextAfterSequence: 1,
    actions: [],
  });
  const server = createTestServer(() => page);
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

async function openStudioView() {
  serve();
  render(
    <HandsFreeProvider>
      <LiveSessionView rest={[]} studio={studio} />
      <LiveCardHost />
    </HandsFreeProvider>,
  );
  await settle();
}
const band = () => screen.getByTestId("hands-free-band");

beforeEach(() => {
  resetCaptureTrigger();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetSessionStores();
  presentation.reset();
  resetPosition();
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

describe("the Studio live view hosts hands-free", () => {
  it("shows the bar, capture strip and follow-up box under the session bar", async () => {
    await openStudioView();
    expect(band()).toHaveAttribute("data-owner", "this-window");
    expect(screen.getByTestId("command-bar")).toBeInTheDocument();
    expect(screen.getByTestId("auto-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("ov-capture")).toBeInTheDocument();
    expect(screen.getByLabelText("Follow-up")).toBeInTheDocument();
    expect(screen.getByTestId("light-mic")).toHaveTextContent("Mic off");
    expect(screen.getByTestId("light-screen")).toHaveTextContent(
      "Screen not shared",
    );
    // The page's other panels stay below it.
    expect(screen.getByTestId("live-panel")).toBeInTheDocument();
  });

  it("owns Auto when it is the only document: listens, and says so", async () => {
    autoOn();
    await openStudioView();
    expect(screen.getByTestId("auto-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(FakeRecognition.instances.length).toBeGreaterThan(0);
    expect(screen.getByTestId("auto-status")).toHaveTextContent(/^Auto ·/);
    // Turned off in one click, from this view.
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
    await openStudioView();
    // It asked for the same lock the panels use, and was not granted it.
    expect(request).toHaveBeenCalledWith(
      "interview-studio.panel-owner.local",
      expect.anything(),
      expect.any(Function),
    );
    expect(band()).toHaveAttribute("data-owner", "other-window");
    expect(screen.getByTestId("auto-mirror")).toHaveTextContent(
      /running in another Studio window/,
    );
    expect(screen.queryByTestId("auto-status")).toBeNull();
    expect(FakeRecognition.instances).toHaveLength(0);
    // No second share picker either: the strip asks the owner instead.
    expect(screen.getByTestId("ov-capture-mirror")).toBeInTheDocument();
  });

  it("adopts the share parked by Start hands-free, and says hands-free is on", async () => {
    autoOn();
    parkShare(await startShare());
    announceHandsFree("Hands-free is on.");
    await openStudioView();
    expect(screen.getByTestId("share-kind")).toBeInTheDocument();
    expect(screen.getByTestId("light-screen")).toHaveAttribute(
      "data-state",
      "on",
    );
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
    render(
      <HandsFreeProvider>
        <LiveSessionView rest={[]} studio={studio} />
      </HandsFreeProvider>,
    );
    await settle();
    expect(screen.queryByTestId("hands-free-band")).toBeNull();
    autoOn();
    current = session;
    await act(() => getSessionStore("local").actions.refresh());
    await settle();
    expect(band()).toHaveAttribute("data-owner", "this-window");
    expect(screen.getByTestId("auto-status")).toBeInTheDocument();
    expect(FakeRecognition.instances.length).toBeGreaterThan(0);
  });

  it("reuses the page's owner when the card is opened inside it: one Auto, one set of controls", async () => {
    autoOn();
    await openStudioView();
    const listeners = FakeRecognition.instances.length;
    act(() => presentation.setMode("card"));
    await settle();
    expect(screen.getByTestId("overlay-card")).toBeVisible();
    // No second recogniser, one bar, one Auto line, and the band points at it.
    expect(FakeRecognition.instances).toHaveLength(listeners);
    expect(screen.getAllByTestId("command-bar")).toHaveLength(1);
    expect(screen.getAllByTestId("auto-status")).toHaveLength(1);
    expect(screen.getByTestId("band-in-card")).toBeInTheDocument();
    // Closing the card gives the controls back to the band.
    act(() => presentation.setMode("full"));
    await settle();
    expect(screen.queryByTestId("band-in-card")).toBeNull();
    expect(screen.getAllByTestId("command-bar")).toHaveLength(1);
  });

  it("shows the device-only notice once, in the band", async () => {
    autoOn();
    const session = sessionView({
      id: SESSION,
      processingPolicy: "device-only",
      captureSources: ["microphone"],
    });
    const page = streamPage({
      session,
      observations: [],
      nextAfterSequence: 0,
      actions: [],
    });
    const server = createTestServer(() => page);
    server.on("GET /current", () => jsonResponse({ session }));
    configureSessionStores({
      fetch: server.fetch,
      isVisible: () => true,
      storage: { read: () => null, write: () => {}, remove: () => {} },
    });
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      server.fetch(String(input), init),
    );
    render(
      <HandsFreeProvider>
        <LiveSessionView rest={[]} studio={studio} />
        <LiveCardHost />
      </HandsFreeProvider>,
    );
    await settle();
    expect(screen.getAllByTestId("device-only-card")).toHaveLength(1);
  });
});
