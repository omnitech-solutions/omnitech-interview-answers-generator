// Asking the native companion to capture (use-companion-capture.ts, through the
// hands-free controller): the request's fields, how it is followed, and how it
// ends. Driven through a bare probe, not a product surface.
import {
  type LiveCompanionCapability,
  liveCaptureRequestSchema,
} from "@omnitech/interview-contracts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentation } from "../focus-presentation";
import {
  configureSessionStores,
  getSessionStore,
  resetSessionStores,
} from "../session-registry";
import { HandsFreeProbe } from "../testing/hands-free-probe";
import { answerAction } from "../testing/live-view-kit";
import {
  capabilityReport,
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
import {
  CAPTURED_SHOWN_MS,
  DEADLINE_GRACE_MS,
  POLL_MS,
} from "./use-companion-capture";

const OTHER = "1c2d3e4f-0000-4000-8000-00000000beef";
let server: TestServer;
let page: ReturnType<typeof streamPage>;
let requests: Record<string, unknown>[] = [];
// What the status route answers, per request id.
let status: (id: string, reads: number) => Record<string, unknown>;
let reads: Record<string, number> = {};

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const expiresAt = () => new Date(Date.now() + 20_000).toISOString();
const card = () => screen.getByTestId("hf-probe");
const progress = () => screen.queryByTestId("capture-progress");

const remote = (over: Parameters<typeof sessionView>[0] = {}) =>
  sessionView({
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
    ...over,
  });

// What the companion last reported: it takes capture requests and has a screen
// selected (the region's binding).
let report: LiveCompanionCapability | null;

function serve(view = remote(), extra: Partial<typeof page> = {}) {
  page = streamPage({
    session: view,
    observations: [snapshot(1, "Chrome · LeetCode")],
    nextAfterSequence: 1,
    actions: [answerAction(answerResult())],
    ...extra,
  });
  server = createTestServer(() => page);
  server.on("GET /current", () => jsonResponse({ session: view }));
  server.on("GET /companion-capability", () =>
    jsonResponse({ capability: report }),
  );
  server.on("POST /:id/capture-request", ({ body }) => {
    requests.push(body as Record<string, unknown>);
    return jsonResponse(
      {
        requestId: (body as { requestId: string }).requestId,
        status: "pending",
        expiresAt: expiresAt(),
      },
      202,
    );
  });
  server.on("GET /:id/capture-request/:rid", ({ url }) => {
    const id = url.pathname.split("/").pop() as string;
    reads[id] = (reads[id] ?? 0) + 1;
    return jsonResponse({
      requestId: id,
      expiresAt: expiresAt(),
      ...status(id, reads[id] as number),
    });
  });
  // The card reads the companion's report with the page's own fetch.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    server.fetch(String(input), init),
  );
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
}

async function open(view = remote(), extra: Partial<typeof page> = {}) {
  serve(view, extra);
  const result = render(<HandsFreeProbe />);
  await flush();
  await flush();
  return result;
}
const CHOICES = new Map<string, string>([
  ["^Follow focused window", "analyze-focused-new"],
  ["Attach the focused window to T1 rev 1", "analyze-focused-attach"],
  ["Analyze stored capture", "analyze-stored"],
]);
async function choose(item: RegExp) {
  const id = CHOICES.get(item.source);
  if (!id) throw new Error(`no probe button for ${item.source}`);
  fireEvent.click(screen.getByTestId(id));
  await flush();
  await flush();
}
const polls = () =>
  server.calls.filter((call) => call === "GET /:id/capture-request/:rid")
    .length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetSessionStores();
  presentation.reset();
  requests = [];
  reads = {};
  report = capabilityReport({
    captureRequests: true,
    screenSelection: "sel-1",
  });
  status = () => ({ status: "pending" });
});
afterEach(() => {
  cleanup();
  presentation.reset();
  resetSessionStores();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Follow focused window", () => {
  it("posts a focused-window request that the contract accepts, with the hints and no region", async () => {
    window.localStorage.setItem(
      "interview-studio.live.capture-settings.local",
      JSON.stringify({ skill: "dsa", language: "typescript" }),
    );
    await open();
    await choose(/^Follow focused window/);
    expect(requests).toHaveLength(1);
    const request = requests[0] as Record<string, unknown>;
    expect(liveCaptureRequestSchema.safeParse(request).success).toBe(true);
    expect(request).toMatchObject({
      mode: "focused-window",
      skill: "dsa",
      language: "typescript",
    });
    expect(request["requestId"]).toMatch(/^r-/);
    expect(request).not.toHaveProperty("region");
    expect(request).not.toHaveProperty("targetTaskId");
    expect(progress()).toHaveAttribute("data-phase", "asking");
  });

  it("attaches to the task being looked at when asked", async () => {
    await open();
    await choose(/Attach the focused window to T1 rev 1/);
    expect(requests[0]).toMatchObject({
      mode: "focused-window",
      targetTaskId: "task-1",
      targetRevision: 1,
    });
    expect(liveCaptureRequestSchema.safeParse(requests[0]).success).toBe(true);
  });

  it("follows the request about once a second, then says Captured, analyzing…", async () => {
    status = (_id, count) => ({ status: count < 3 ? "pending" : "captured" });
    await open();
    await choose(/^Follow focused window/);
    expect(polls()).toBe(0);
    await advance(POLL_MS);
    expect(polls()).toBe(1);
    expect(progress()).toHaveAttribute("data-phase", "asking");
    await advance(POLL_MS);
    await advance(POLL_MS);
    expect(polls()).toBe(3);
    expect(progress()).toHaveAttribute("data-phase", "captured");
    // Terminal: no more polling.
    await advance(5 * POLL_MS);
    expect(polls()).toBe(3);
  });

  it("clears 'Captured, analyzing…' once the analysis shows up as work, or after a while", async () => {
    status = () => ({ status: "captured" });
    await open();
    await choose(/^Follow focused window/);
    await advance(POLL_MS);
    expect(progress()).toHaveAttribute("data-phase", "captured");
    page = {
      ...page,
      actions: [
        ...page.actions,
        answerAction(answerResult(), { taskId: "task-i.new" }),
      ],
    };
    await advance(1_500);
    expect(progress()).toBeNull();
    // And with no new work, it still goes away.
    await choose(/^Follow focused window/);
    await advance(POLL_MS);
    expect(progress()).not.toBeNull();
    await advance(CAPTURED_SHOWN_MS + 1_000);
    expect(progress()).toBeNull();
  });

  it("says the companion did not answer when the request expires", async () => {
    status = () => ({ status: "expired" });
    await open();
    await choose(/^Follow focused window/);
    await advance(POLL_MS);
    expect(progress()).toHaveAttribute("data-phase", "expired");
    await advance(5 * POLL_MS);
    expect(polls()).toBe(1);
  });

  it("shows the device-only sentence when the request is refused for it", async () => {
    status = () => ({ status: "refused", reason: "vision_device_only" });
    await open();
    await choose(/^Follow focused window/);
    await advance(POLL_MS);
    expect(progress()).toHaveAttribute("data-phase", "refused");
    expect(progress()).toHaveAttribute("data-reason", "vision_device_only");
  });

  it("names the code for any other refusal", async () => {
    status = () => ({ status: "refused", reason: "vision_unavailable" });
    await open();
    await choose(/^Follow focused window/);
    await advance(POLL_MS);
    expect(progress()).toHaveAttribute("data-phase", "refused");
    expect(progress()).toHaveAttribute("data-reason", "vision_unavailable");
  });

  it.each([
    ["no-focused-window"],
    ["permission-denied"],
    ["source-gone"],
    ["source-changed"],
    ["capture-failed"],
  ])(
    "says a companion failure (%s) at once, never waiting for expiry",
    async (reason) => {
      status = () => ({ status: "failed", reason });
      await open();
      await choose(/^Follow focused window/);
      await advance(POLL_MS);
      expect(progress()).toHaveAttribute("data-phase", "failed");
      expect(progress()).toHaveAttribute("data-reason", reason);
      await advance(5 * POLL_MS);
      expect(polls()).toBe(1);
    },
  );

  it.each([
    ["companion_update_required"],
    ["source_changed"],
    ["capture_request_stale"],
    ["limit_reached"],
  ])("explains the refusal %s in plain words", async (reason) => {
    status = () => ({ status: "refused", reason });
    await open();
    await choose(/^Follow focused window/);
    await advance(POLL_MS);
    expect(progress()).toHaveAttribute("data-phase", "refused");
    expect(progress()).toHaveAttribute("data-reason", reason);
  });

  it("shows an immediate refusal from the request itself", async () => {
    await open();
    server.on("POST /:id/capture-request", ({ body }) =>
      jsonResponse(
        {
          requestId: (body as { requestId: string }).requestId,
          status: "refused",
          expiresAt: expiresAt(),
          reason: "vision_device_only",
        },
        202,
      ),
    );
    await choose(/^Follow focused window/);
    expect(progress()).toHaveAttribute("data-phase", "refused");
    expect(progress()).toHaveAttribute("data-reason", "vision_device_only");
    expect(polls()).toBe(0);
  });

  it("reports a failed request, and shows no progress", async () => {
    await open();
    server.on("POST /:id/capture-request", () =>
      jsonResponse({ error: { code: "status_refused" } }, 409),
    );
    await choose(/^Follow focused window/);
    expect(progress()).toBeNull();
    expect(within(card()).getByRole("alert")).toHaveTextContent(
      /status_refused/,
    );
  });
});

describe("how following stops", () => {
  it("stops when the controller goes away", async () => {
    const view = await open();
    await choose(/^Follow focused window/);
    await advance(POLL_MS);
    const before = polls();
    view.unmount();
    await advance(10 * POLL_MS);
    expect(polls()).toBe(before);
  });

  it("stops when the session is switched", async () => {
    await open();
    const ended = sessionView({
      id: OTHER,
      status: "ended",
      endedAt: minutesAfter(-20),
      createdAt: minutesAfter(-61),
    });
    server.on("GET /:id", () => jsonResponse({ session: ended }));
    await choose(/^Follow focused window/);
    await advance(POLL_MS);
    const before = polls();
    await act(() => getSessionStore("local").actions.switchSession(OTHER));
    await advance(10 * POLL_MS);
    expect(polls()).toBe(before);
    expect(progress()).toBeNull();
  });

  it("follows only the newest request when a newer one replaces it", async () => {
    await open();
    await choose(/^Follow focused window/);
    await advance(POLL_MS);
    const first = requests[0]?.["requestId"] as string;
    expect(reads[first]).toBe(1);
    // Asked again while the first is still pending (the bar's capture button
    // stays available while Capture & analyze waits).
    await choose(/^Follow focused window/);
    const second = requests[1]?.["requestId"] as string;
    expect(second).not.toBe(first);
    await advance(3 * POLL_MS);
    expect(reads[first]).toBe(1);
    expect(reads[second] ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("stops quietly when the request is gone", async () => {
    await open();
    await choose(/^Follow focused window/);
    server.on("GET /:id/capture-request/:rid", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    await advance(POLL_MS);
    expect(progress()).toBeNull();
    const before = polls();
    await advance(5 * POLL_MS);
    expect(polls()).toBe(before);
  });

  it("keeps following through a failing poll, then calls it expired past the deadline", async () => {
    await open();
    await choose(/^Follow focused window/);
    server.on("GET /:id/capture-request/:rid", () =>
      jsonResponse({ error: { code: "network" } }, 500),
    );
    await advance(POLL_MS);
    expect(progress()).toHaveAttribute("data-phase", "asking");
    await advance(20_000 + DEADLINE_GRACE_MS + POLL_MS);
    expect(progress()).toHaveAttribute("data-phase", "expired");
  });
});

describe("when the companion cannot be asked", () => {
  it("offers no stored capture before any capture exists", async () => {
    await open(remote({ lastHeartbeatAt: minutesAfter(0, 59) }), {
      observations: [],
    });
    expect(screen.getByTestId("analyze-stored")).toBeDisabled();
  });

  it("analyzes exactly the stored capture it named", async () => {
    const analyzeLatestCapture = vi.fn(async () => undefined);
    serve();
    configureSessionStores({
      fetch: server.fetch,
      isVisible: () => true,
      storage: { read: () => null, write: () => {}, remove: () => {} },
      analyzeLatestCapture,
    });
    render(<HandsFreeProbe />);
    await flush();
    await flush();
    await choose(/Analyze stored capture/);
    expect(analyzeLatestCapture).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      expect.anything(),
      { sourceId: "screen", eventId: "evt-1" },
    );
  });

  it.each(["refused", "expired"])(
    "a fresh capture that ends %s never analyzes the older stored image",
    async (outcome) => {
      const analyzeLatestCapture = vi.fn(async () => undefined);
      status = () => ({ status: outcome, reason: "vision_unavailable" });
      serve();
      configureSessionStores({
        fetch: server.fetch,
        isVisible: () => true,
        storage: { read: () => null, write: () => {}, remove: () => {} },
        analyzeLatestCapture,
      });
      render(<HandsFreeProbe />);
      await flush();
      await flush();
      await choose(/^Follow focused window/);
      await advance(POLL_MS * 3);
      expect(analyzeLatestCapture).not.toHaveBeenCalled();
      expect(server.count("POST /:id/input")).toBe(0);
    },
  );

  it("a fresh capture request that fails outright never analyzes the stored image", async () => {
    const analyzeLatestCapture = vi.fn(async () => undefined);
    serve();
    server.on("POST /:id/capture-request", () =>
      jsonResponse({ error: { code: "conflict" } }, 409),
    );
    configureSessionStores({
      fetch: server.fetch,
      isVisible: () => true,
      storage: { read: () => null, write: () => {}, remove: () => {} },
      analyzeLatestCapture,
    });
    render(<HandsFreeProbe />);
    await flush();
    await flush();
    await choose(/^Follow focused window/);
    expect(analyzeLatestCapture).not.toHaveBeenCalled();
  });

  it("while a request is being followed, Capture & analyze waits", async () => {
    await open();
    await choose(/^Follow focused window/);
    expect(screen.getByTestId("capture-now")).toBeDisabled();
  });
});
