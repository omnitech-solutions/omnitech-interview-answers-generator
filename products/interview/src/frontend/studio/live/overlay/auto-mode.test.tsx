// Hands-free Auto through the real card, store and client against a scripted
// service, with a fake display stream, canvas pixels and SpeechRecognition
// (ADR-0022): a heard question is sent as speech with no button; a changed
// screen is analysed once, within the limits; nothing stays stuck.
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
import { presentation } from "../focus-presentation";
import {
  configureSessionStores,
  resetSessionStores,
} from "../session-registry";
import { answerAction } from "../testing/live-view-kit";
import {
  jsonResponse,
  minutesAfter,
  sessionView,
  snapshot,
  streamPage,
} from "../testing/session-fixtures";
import { answerResult } from "../testing/session-result-fixtures";
import {
  createTestServer,
  type TestServer,
} from "../testing/session-test-server";
import { AUTO_MIN_GAP_MS } from "./auto-gate";
import { clearOwnerPaused, markOwnerPaused } from "./auto-owner-pause";
import { RESTART_BASE_MS } from "./auto-restart";
import {
  FakeRecognition,
  fakeStream,
  installDisplayMedia,
  installFakeCanvas,
  installRecognition,
  installVideoSize,
  paintScreen,
} from "./capture-fixtures";
import { resetCaptureTrigger } from "./capture-trigger";
import { resetPosition } from "./card-position";
import { AUTO_CAPTURE_LABEL } from "./use-hands-free";

const SESSION = "1c2d3e4f-0000-4000-8000-000000000001";
let server: TestServer;
let page: ReturnType<typeof streamPage>;
let view = sessionView();
type Posted = { entries: [string, FormDataEntryValue][] };
let captures: Posted[] = [];
let inputs: Record<string, unknown>[] = [];
let controls: string[] = [];
let display = fakeStream();

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await flush();
};
const card = () => screen.getByTestId("overlay-card");
const line = () => screen.queryByTestId("auto-status");
// A session with no screen source: only listening is in play.
const micOnly = () => remote({ captureSources: ["microphone"] });
const remote = (over: Parameters<typeof sessionView>[0] = {}) =>
  sessionView({
    id: SESSION,
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
    ...over,
  });
const recognition = () =>
  FakeRecognition.instances[
    FakeRecognition.instances.length - 1
  ] as FakeRecognition;
const labelsOf = () =>
  captures.map(
    (post) => post.entries.find(([key]) => key === "label")?.[1] as string,
  );

function serve(session: ReturnType<typeof sessionView>) {
  view = session;
  page = streamPage({
    session,
    observations: [snapshot(1, "Chrome · LeetCode")],
    nextAfterSequence: 1,
    actions: [answerAction(answerResult())],
  });
  server = createTestServer(() => page);
  server.on("GET /current", () => jsonResponse({ session: view }));
  server.on("POST /:id/capture", ({ body }) => {
    captures.push({ entries: [...(body as FormData).entries()] });
    return jsonResponse(
      {
        input: { requestId: "r", sequence: 9 },
        snapshot: { sourceId: "browser", eventId: "evt-9" },
      },
      202,
    );
  });
  server.on("POST /:id/input", ({ body }) => {
    inputs.push(body as Record<string, unknown>);
    return jsonResponse({ input: { requestId: "r", sequence: 10 } }, 202);
  });
  server.on("POST /:id/control", ({ body }) => {
    const action = (body as { action: string }).action;
    controls.push(action);
    view = { ...view, status: action === "resume" ? "active" : "paused" };
    return jsonResponse({ session: view });
  });
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
}

async function openCard(session = remote()) {
  serve(session);
  render(<LiveCardHost />);
  act(() => presentation.setMode("card"));
  await settle();
}
async function shareSource() {
  fireEvent.click(screen.getByRole("button", { name: /Capture & analyze/ }));
  await flush();
  fireEvent.click(
    screen.getByRole("menuitem", { name: /Share a window, tab or screen/ }),
  );
  await settle();
}
const autoOn = () =>
  window.localStorage.setItem("interview-studio.live.auto.local", "on");

beforeEach(() => {
  resetCaptureTrigger();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearOwnerPaused(SESSION);
  resetSessionStores();
  presentation.reset();
  resetPosition();
  captures = [];
  inputs = [];
  controls = [];
  display = fakeStream();
  installVideoSize();
  installFakeCanvas();
  paintScreen("rising");
  installDisplayMedia(async () => display.stream);
  installRecognition(true);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    server.fetch(String(input), init),
  );
});
afterEach(() => {
  cleanup();
  presentation.reset();
  resetSessionStores();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Auto is a visible, stoppable control", () => {
  it("is off until the owner turns it on, and then is remembered", async () => {
    await openCard(micOnly());
    expect(line()).toBeNull();
    expect(FakeRecognition.instances).toHaveLength(0);
    fireEvent.click(screen.getByTestId("auto-toggle"));
    await settle();
    expect(line()).toHaveTextContent(/^Auto · listening/);
    expect(
      window.localStorage.getItem("interview-studio.live.auto.local"),
    ).toBe("on");
    // The footer still says the window is visible.
    expect(card()).toHaveTextContent(/Visible window/);
  });

  it("starts on for a new session once the owner has opted in, and turns off in one click", async () => {
    autoOn();
    await openCard();
    expect(screen.getByTestId("auto-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(recognition().start).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("auto-stop"));
    await settle();
    expect(line()).toBeNull();
    expect(
      window.localStorage.getItem("interview-studio.live.auto.local"),
    ).toBe("off");
    expect(recognition().stop).toHaveBeenCalled();
  });
});

describe("question heard → speech sent, no button", () => {
  it("sends phrases a pause apart as heard speech, in order, and not as a follow-up", async () => {
    autoOn();
    await openCard(micOnly());
    act(() =>
      recognition().say({
        text: "Walk me through binary search?",
        final: true,
      }),
    );
    await settle();
    await advance(900);
    act(() => recognition().say({ text: "and its complexity", final: true }));
    await settle();
    await advance(900);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      operation: "heard",
      text: "Walk me through binary search?",
    });
    expect(inputs[0]?.["requestId"]).toEqual(expect.stringMatching(/^h-/));
    expect(Object.keys(inputs[0] ?? {}).sort()).toEqual([
      "operation",
      "requestId",
      "text",
    ]);
    expect(screen.getByLabelText("Follow-up")).toHaveValue("");
    // Interim words are never sent.
    act(() => recognition().say({ text: "still talking", final: false }));
    await settle();
    expect(inputs).toHaveLength(2);
    expect(line()).toHaveTextContent(/heard \d+ s ago/);
  });

  it("coalesces finals that arrive together into ONE question", async () => {
    autoOn();
    await openCard(micOnly());
    act(() => recognition().say({ text: "Walk me through", final: true }));
    await advance(300);
    act(() => recognition().say({ text: "binary search", final: true }));
    await advance(300);
    expect(inputs).toHaveLength(0);
    await advance(900);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      operation: "heard",
      text: "Walk me through binary search",
    });
  });

  it("retries a phrase once under the same request id", async () => {
    autoOn();
    await openCard();
    let attempts = 0;
    server.on("POST /:id/input", ({ body }) => {
      attempts += 1;
      inputs.push(body as Record<string, unknown>);
      return attempts === 1
        ? jsonResponse({ error: { code: "session_unavailable" } }, 503)
        : jsonResponse({ input: { requestId: "r", sequence: 10 } }, 202);
    });
    act(() => recognition().say({ text: "What is a closure?", final: true }));
    await settle();
    await advance(900);
    await advance(1_500);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]?.["requestId"]).toBe(inputs[0]?.["requestId"]);
  });

  it("keeps listening: restarts at once after silence, then backs off without a storm", async () => {
    autoOn();
    await openCard();
    const rec = recognition();
    expect(rec.start).toHaveBeenCalledTimes(1);
    act(() => rec.onend?.());
    expect(rec.start).toHaveBeenCalledTimes(2);
    // Runs that keep dying young wait longer each time.
    act(() => rec.onend?.());
    expect(rec.start).toHaveBeenCalledTimes(2);
    await advance(RESTART_BASE_MS);
    expect(rec.start).toHaveBeenCalledTimes(3);
    act(() => rec.onend?.());
    await advance(RESTART_BASE_MS);
    expect(rec.start).toHaveBeenCalledTimes(3);
    await advance(RESTART_BASE_MS);
    expect(rec.start).toHaveBeenCalledTimes(4);
    // A phrase heard makes the next restart immediate again.
    act(() => rec.say({ text: "hello there", final: true }));
    act(() => rec.onend?.());
    expect(rec.start).toHaveBeenCalledTimes(5);
  });

  it("shows ONE line with the one action when the microphone is not allowed, and does not retry", async () => {
    autoOn();
    await openCard();
    const rec = recognition();
    act(() => rec.onerror?.({ error: "not-allowed" }));
    act(() => rec.onend?.());
    await settle();
    expect(line()).toHaveTextContent(/microphone not allowed/);
    expect(line()).toHaveAttribute("data-tone", "problem");
    const starts = FakeRecognition.log.filter(
      (entry) => entry === "start",
    ).length;
    await advance(30_000);
    expect(
      FakeRecognition.log.filter((entry) => entry === "start"),
    ).toHaveLength(starts);
  });

  it("does not turn silence into an error", async () => {
    autoOn();
    await openCard();
    act(() => recognition().onerror?.({ error: "no-speech" }));
    await settle();
    expect(within(card()).queryByRole("alert")).toBeNull();
  });
});

describe("screen changed → one analyze", () => {
  async function watching() {
    autoOn();
    await openCard();
    await shareSource();
  }

  it("analyses the first frame at the first interval, labelled as automatic", async () => {
    await watching();
    expect(line()).toHaveTextContent(/capturing every 8 s/);
    await advance(7_000);
    expect(captures).toHaveLength(0);
    await advance(2_000);
    expect(captures).toHaveLength(1);
    expect(labelsOf()).toEqual([AUTO_CAPTURE_LABEL]);
    expect(
      within(screen.getByTestId("chat-log")).getByText(AUTO_CAPTURE_LABEL),
    ).toBeVisible();
    await advance(2_000);
    expect(line()).toHaveTextContent(/last analyzed \d+ s ago/);
  });

  it("drops unchanged frames on the device: nothing is uploaded", async () => {
    await watching();
    await advance(9_000);
    expect(captures).toHaveLength(1);
    // The same picture, even with a speck of noise, is never uploaded again.
    paintScreen("rising-noisy");
    await advance(40_000);
    expect(captures).toHaveLength(1);
  });

  it("analyses a changed frame once, at least 15 s after the last", async () => {
    await watching();
    await advance(9_000);
    expect(captures).toHaveLength(1);
    paintScreen("falling");
    // Changed at the 16 s tick, 8 s after the last analysis: held by the gap.
    await advance(8_000);
    expect(captures).toHaveLength(1);
    await advance(AUTO_MIN_GAP_MS);
    expect(captures).toHaveLength(2);
    await advance(30_000);
    expect(captures).toHaveLength(2);
  });

  it("never exceeds one analysis per gap while the screen keeps changing", async () => {
    await watching();
    for (let i = 0; i < 8; i += 1) {
      paintScreen(i % 2 === 0 ? "falling" : "rising");
      await advance(8_000);
    }
    expect(captures.length).toBeGreaterThan(1);
    expect(captures.length).toBeLessThanOrEqual(
      Math.floor(64_000 / AUTO_MIN_GAP_MS) + 1,
    );
  });

  it("takes none while a previous capture is still in flight", async () => {
    await watching();
    let release!: (response: Response) => void;
    server.on("POST /:id/capture", ({ body }) => {
      captures.push({ entries: [...(body as FormData).entries()] });
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    await advance(9_000);
    expect(captures).toHaveLength(1);
    paintScreen("falling");
    await advance(AUTO_MIN_GAP_MS + 8_000);
    expect(captures).toHaveLength(1);
    release(
      jsonResponse(
        {
          input: { requestId: "r", sequence: 9 },
          snapshot: { sourceId: "b", eventId: "e" },
        },
        202,
      ),
    );
    await advance(9_000);
    expect(captures).toHaveLength(2);
  });

  it("never watches a device-only session, and says why", async () => {
    autoOn();
    await openCard(remote({ processingPolicy: "device-only" }));
    expect(line()).not.toHaveTextContent(/screen not analysed/);
    expect(screen.getByTestId("device-only-card")).toBeInTheDocument();
    await advance(30_000);
    expect(captures).toHaveLength(0);
  });

  it("takes none while paused, and none for a session that ended", async () => {
    await watching();
    markOwnerPaused(SESSION);
    page.session = { ...view, status: "paused" };
    view = { ...view, status: "paused" };
    await advance(2_000);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(captures).toHaveLength(0);
    expect(line()).toHaveTextContent(/paused by you/);
  });

  it("says one plain line, with the click the browser needs, when the share is lost", async () => {
    await watching();
    act(() => display.endFromBrowser());
    await settle();
    expect(line()).toHaveTextContent(/needs one click to share again/);
    await advance(30_000);
    expect(captures).toHaveLength(0);
  });
});

describe("paused sessions", () => {
  it("resumes itself when it was not the owner who paused it", async () => {
    autoOn();
    await openCard(remote({ status: "paused" }));
    await advance(2_000);
    expect(controls).toContain("resume");
  });

  it("never resumes a session the owner deliberately paused", async () => {
    autoOn();
    markOwnerPaused(SESSION);
    await openCard(remote({ status: "paused" }));
    await advance(30_000);
    expect(controls).toEqual([]);
    expect(line()).toHaveTextContent(/paused by you/);
  });

  it("does not resume while Auto is off", async () => {
    await openCard(remote({ status: "paused" }));
    await advance(30_000);
    expect(controls).toEqual([]);
  });
});
