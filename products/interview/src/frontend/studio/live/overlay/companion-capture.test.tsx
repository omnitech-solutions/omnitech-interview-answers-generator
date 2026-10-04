// Asking the native companion to capture: follow the focused window, or a region
// of the main display. The request's fields, how it is followed, what is said
// when it ends, and why the choices are disabled when they cannot be used.
import { liveCaptureRequestSchema } from "@omnitech/interview-contracts";
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
import { answerAction } from "../live-view-kit";
import {
  disconnected,
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
import { answerResult } from "../session-result-fixtures";
import { createTestServer, type TestServer } from "../session-test-server";
import { resetPosition } from "./card-position";
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
const click = async (name: string | RegExp) => {
  fireEvent.click(screen.getByRole("button", { name }));
  await flush();
};
const expiresAt = () => new Date(Date.now() + 20_000).toISOString();
const card = () => screen.getByTestId("overlay-card");
const progress = () => screen.queryByTestId("capture-progress");

const remote = (over: Parameters<typeof sessionView>[0] = {}) =>
  sessionView({
    processingPolicy: "permitted-remote",
    captureSources: ["microphone", "screen"],
    ...over,
  });

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
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
}

async function open(view = remote(), extra: Partial<typeof page> = {}) {
  serve(view, extra);
  const result = render(<LiveCardHost />);
  act(() => presentation.setMode("card"));
  await flush();
  await flush();
  return result;
}
async function choose(item: RegExp) {
  await click(/Capture & analyze/);
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
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
  resetPosition();
  requests = [];
  reads = {};
  status = () => ({ status: "pending" });
});
afterEach(() => {
  cleanup();
  presentation.reset();
  resetSessionStores();
  vi.restoreAllMocks();
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
    expect(progress()).toHaveTextContent(
      "Asking the companion to capture your focused window…",
    );
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
    expect(progress()).toHaveTextContent("Captured, analyzing…");
    // Terminal: no more polling.
    await advance(5 * POLL_MS);
    expect(polls()).toBe(3);
  });

  it("clears 'Captured, analyzing…' once the analysis shows up as work, or after a while", async () => {
    status = () => ({ status: "captured" });
    await open();
    await choose(/^Follow focused window/);
    await advance(POLL_MS);
    expect(progress()).toHaveTextContent("Captured, analyzing…");
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
    expect(progress()).toHaveTextContent(
      "The companion did not answer within 20 s. Is it running with the screen source selected?",
    );
    await advance(5 * POLL_MS);
    expect(polls()).toBe(1);
  });

  it("shows the device-only sentence when the request is refused for it", async () => {
    status = () => ({ status: "refused", reason: "vision_device_only" });
    await open();
    await choose(/^Follow focused window/);
    await advance(POLL_MS);
    expect(progress()).toHaveTextContent(
      "Device-only mode never sends a screenshot to an assistant.",
    );
  });

  it("names the code for any other refusal", async () => {
    status = () => ({ status: "refused", reason: "vision_unavailable" });
    await open();
    await choose(/^Follow focused window/);
    await advance(POLL_MS);
    expect(progress()).toHaveTextContent("refused (vision_unavailable)");
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
    expect(progress()).toHaveTextContent("Device-only mode never sends");
    expect(polls()).toBe(0);
  });

  it("reports a failed request in the card, and shows no progress", async () => {
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
  it("stops when the card goes away", async () => {
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
    await click("Capture screen");
    fireEvent.click(
      screen.getByRole("menuitem", { name: /^Follow focused window/ }),
    );
    await flush();
    await flush();
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

describe("Companion · region", () => {
  it("opens the editor for the region of the main display, with no preview", async () => {
    await open();
    await choose(/^Companion · region/);
    const editor = screen.getByTestId("mask-editor");
    expect(editor).toHaveAttribute("aria-label", "Region of your main display");
    expect(
      within(editor).getByText("Region of your main display"),
    ).toBeVisible();
    expect(
      within(editor).getByText(
        /only this part of your main display; nothing outside it is sent/,
      ),
    ).toBeVisible();
    expect(within(editor).queryByTestId("local-preview")).toBeNull();
    expect(requests).toEqual([]);
  });

  it("posts the region, normalised to the display, and stores it apart from the browser mask", async () => {
    await open();
    await choose(/^Companion · region/);
    await click("Right side");
    await click("Save & capture");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      mode: "region",
      region: { x: 0.5, y: 0, width: 0.5, height: 1 },
    });
    expect(liveCaptureRequestSchema.safeParse(requests[0]).success).toBe(true);
    expect(
      JSON.parse(
        window.localStorage.getItem(
          "interview-studio.live.capture-display-mask.local",
        ) ?? "null",
      ),
    ).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    // The browser-share region is untouched.
    expect(
      window.localStorage.getItem("interview-studio.live.capture-mask.local"),
    ).toBeNull();
    expect(screen.queryByTestId("region-chip")).toBeNull();
    expect(progress()).toHaveTextContent(
      "Asking the companion to capture your region…",
    );
  });

  it("reopens on the saved display region, not the browser one", async () => {
    window.localStorage.setItem(
      "interview-studio.live.capture-mask.local",
      JSON.stringify({ x: 0, y: 0, w: 0.3, h: 0.3 }),
    );
    window.localStorage.setItem(
      "interview-studio.live.capture-display-mask.local",
      JSON.stringify({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }),
    );
    await open();
    await choose(/^Companion · region/);
    expect(screen.getByTestId("mask-rect").style.width).toBe("50%");
  });

  it("never asks for a region that spills past the display", async () => {
    window.localStorage.setItem(
      "interview-studio.live.capture-display-mask.local",
      JSON.stringify({ x: 0.3333, y: 0.3333, w: 0.6667, h: 0.6667 }),
    );
    await open();
    await choose(/^Companion · region/);
    await click("Save & capture");
    const region = (
      requests[0] as {
        region: { x: number; y: number; width: number; height: number };
      }
    ).region;
    expect(region.x + region.width).toBeLessThanOrEqual(1);
    expect(region.y + region.height).toBeLessThanOrEqual(1);
    expect(liveCaptureRequestSchema.safeParse(requests[0]).success).toBe(true);
  });

  it("sends nothing when the editor is cancelled", async () => {
    await open();
    await choose(/^Companion · region/);
    await click("Cancel");
    expect(requests).toEqual([]);
    expect(screen.queryByTestId("mask-sheet")).toBeNull();
  });
});

describe("when the companion cannot be asked", () => {
  async function reasonFor(
    view: ReturnType<typeof sessionView>,
    extra: Partial<typeof page> = {},
  ) {
    await open(view, extra);
    await click(/Capture & analyze/);
    const menu = within(screen.getByRole("menu", { name: "Capture source" }));
    for (const name of [/^Follow focused window/, /^Companion · region/])
      expect(menu.getByRole("menuitem", { name })).toBeDisabled();
    return menu.getByTestId("focus-note").textContent;
  }

  it("is disabled, with the reason, when the screen source is not part of the session", async () => {
    expect(await reasonFor(remote({ captureSources: ["microphone"] }))).toBe(
      "This source wasn’t turned on when the session started.",
    );
  });

  it("is disabled, with the reason, when the companion has not made contact", async () => {
    expect(await reasonFor(remote(), { observations: [] })).toBe(
      "The capture companion hasn’t made contact yet.",
    );
  });

  it("is disabled, with the reason, when the screen permission was revoked", async () => {
    expect(
      await reasonFor(remote(), {
        observations: [
          snapshot(1),
          disconnected(2, "screen", "permission-revoked"),
        ],
        nextAfterSequence: 2,
      }),
    ).toBe("macOS no longer lets the capture companion use Screen Recording.");
  });

  it("is disabled, with the reason, when the screen device was lost", async () => {
    expect(
      await reasonFor(remote(), {
        observations: [snapshot(1), disconnected(2, "screen", "device-lost")],
        nextAfterSequence: 2,
      }),
    ).toBe("Device lost: no on-screen window matched the title you selected.");
  });

  it("is enabled when the screen source is receiving, even before any capture", async () => {
    await open(remote({ lastHeartbeatAt: minutesAfter(0, 59) }), {
      observations: [],
    });
    await click(/Capture & analyze/);
    expect(
      screen.getByRole("menuitem", { name: /^Follow focused window/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole("menuitem", { name: /^Companion · region/ }),
    ).toBeEnabled();
    // Nothing to use as "latest capture" yet.
    expect(
      screen.getByRole("menuitem", { name: /companion’s latest capture/ }),
    ).toBeDisabled();
  });

  it("while a request is being followed, Capture & analyze waits", async () => {
    await open();
    await choose(/^Follow focused window/);
    expect(
      screen.getByRole("button", { name: /Analyzing…|Capture & analyze/ }),
    ).toBeDisabled();
  });
});
