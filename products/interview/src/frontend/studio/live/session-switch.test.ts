// Switching sessions on the one store: results and errors of reads that began
// under the session left behind are ignored, and only the latest request wins.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreDeps } from "./session-deps";
import {
  configureSessionStores,
  getSessionStore,
  resetSessionStores,
} from "./session-registry";
import {
  jsonResponse,
  minutesAfter,
  SESSION_ID,
  sessionView,
  streamPage,
} from "./testing/session-fixtures";
import { createTestServer } from "./testing/session-test-server";

const OTHER = "1c2d3e4f-0000-4000-8000-00000000beef";
const THIRD = "1c2d3e4f-0000-4000-8000-00000000cafe";
const flush = () => vi.advanceTimersByTimeAsync(0);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

const views = {
  [SESSION_ID]: sessionView(),
  [OTHER]: sessionView({ id: OTHER, createdAt: minutesAfter(-30) }),
  [THIRD]: sessionView({ id: THIRD, createdAt: minutesAfter(-60) }),
} as Record<string, ReturnType<typeof sessionView>>;
const idOf = (url: URL) =>
  url.pathname
    .split("/")
    .filter((p) => p !== "stream")
    .pop() as string;

// A promise a test settles by hand.
function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function boot(extra: Partial<StoreDeps> = {}) {
  const server = createTestServer();
  server.on("GET /current", () => jsonResponse({ session: views[SESSION_ID] }));
  server.on("GET /:id", ({ url }) =>
    jsonResponse({ session: views[idOf(url)] }),
  );
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
    ...extra,
  });
  const store = getSessionStore("local");
  store.subscribe(() => undefined);
  return { server, store };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  resetSessionStores();
});
afterEach(() => {
  resetSessionStores();
  vi.useRealTimers();
});

describe("a read of the session left behind", () => {
  it("cannot halt or flag the session switched to when it fails late", async () => {
    const { server, store } = boot();
    const held = gate<Response>();
    server.on("GET /:id/stream", ({ url }) =>
      idOf(url) === SESSION_ID
        ? held.promise
        : jsonResponse(streamPage({ session: views[OTHER] as never })),
    );
    await flush();
    await flush();
    expect(store.getSnapshot().session?.id).toBe(SESSION_ID);
    // The live session's read is in flight when the owner switches away.
    await store.actions.switchSession(OTHER);
    held.resolve(jsonResponse({ error: { code: "unauthorized" } }, 401));
    await flush();
    await advance(3_000);
    const snap = store.getSnapshot();
    expect(snap.session?.id).toBe(OTHER);
    expect(snap.streamError).toBeNull();
    // And B keeps polling: nothing halted it.
    const reads = server.count("GET /:id/stream");
    await advance(3_000);
    expect(server.count("GET /:id/stream")).toBeGreaterThan(reads);
  });

  it("cannot overwrite the session switched to with its own late page", async () => {
    const { server, store } = boot();
    const held = gate<Response>();
    server.on("GET /:id/stream", ({ url }) =>
      idOf(url) === SESSION_ID
        ? held.promise
        : jsonResponse(streamPage({ session: views[OTHER] as never })),
    );
    await flush();
    await flush();
    await store.actions.switchSession(OTHER);
    held.resolve(
      jsonResponse(
        streamPage({
          session: views[SESSION_ID] as never,
          observations: [],
          actions: [],
        }),
      ),
    );
    await flush();
    await advance(1_500);
    expect(store.getSnapshot().session?.id).toBe(OTHER);
  });

  it("a hydration that began before the switch cannot replace the pinned session", async () => {
    const { server, store } = boot();
    const held = gate<Response>();
    // Hold the very first "current" read, then switch before it answers.
    server.on("GET /current", () => held.promise);
    server.on("GET /:id/stream", ({ url }) =>
      jsonResponse(streamPage({ session: views[idOf(url)] as never })),
    );
    await flush();
    await store.actions.switchSession(OTHER);
    held.resolve(jsonResponse({ session: views[SESSION_ID] }));
    await flush();
    await advance(1_500);
    expect(store.getSnapshot().session?.id).toBe(OTHER);
    expect(store.getSnapshot().observations).toEqual([]);
  });

  it("a purge check of the old session cannot adopt it again", async () => {
    const { server, store } = boot();
    const ended = sessionView({
      status: "ended",
      endedAt: minutesAfter(2),
      retention: "delete-at-end",
    });
    views[SESSION_ID] = ended;
    const held = gate<Response>();
    let first = true;
    server.on("GET /:id", ({ url }) => {
      const id = idOf(url);
      if (id === SESSION_ID && first) {
        first = false;
        return held.promise;
      }
      return Promise.resolve(jsonResponse({ session: views[id] }));
    });
    server.on("GET /:id/stream", ({ url }) =>
      jsonResponse(streamPage({ session: views[idOf(url)] as never })),
    );
    await flush();
    await flush();
    await store.actions.switchSession(OTHER);
    held.resolve(jsonResponse({ session: ended }));
    await flush();
    await advance(2_000);
    expect(store.getSnapshot().session?.id).toBe(OTHER);
    views[SESSION_ID] = sessionView();
  });
});

describe("rapid switches", () => {
  it("the latest request wins whatever order the answers arrive in", async () => {
    const { server, store } = boot();
    server.on("GET /:id/stream", ({ url }) =>
      jsonResponse(streamPage({ session: views[idOf(url)] as never })),
    );
    await flush();
    await flush();
    const slow = gate<Response>();
    const fast = gate<Response>();
    server.on("GET /:id", ({ url }) =>
      idOf(url) === OTHER ? slow.promise : fast.promise,
    );
    const first = store.actions.switchSession(OTHER);
    const second = store.actions.switchSession(THIRD);
    expect(store.getSnapshot().pending).toEqual(["switch", "switch"]);
    // The later request answers first, then the earlier one.
    fast.resolve(jsonResponse({ session: views[THIRD] }));
    await flush();
    slow.resolve(jsonResponse({ session: views[OTHER] }));
    await flush();
    expect(await second).toEqual({ ok: true });
    expect(await first).toEqual({ ok: true });
    expect(store.getSnapshot().session?.id).toBe(THIRD);
    expect(store.getSnapshot().pending).toEqual([]);
    // Switching only reads.
    expect(server.calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });

  it("switching away and straight back keeps the session it started on", async () => {
    const { server, store } = boot();
    server.on("GET /:id/stream", ({ url }) =>
      jsonResponse(streamPage({ session: views[idOf(url)] as never })),
    );
    await flush();
    await flush();
    const gateB = gate<Response>();
    server.on("GET /:id", ({ url }) =>
      idOf(url) === OTHER
        ? gateB.promise
        : Promise.resolve(jsonResponse({ session: views[idOf(url)] })),
    );
    const away = store.actions.switchSession(OTHER);
    const back = store.actions.switchSession(SESSION_ID);
    gateB.resolve(jsonResponse({ session: views[OTHER] }));
    await flush();
    await away;
    await back;
    expect(store.getSnapshot().session?.id).toBe(SESSION_ID);
  });
});

const notFound = () => jsonResponse({ error: { code: "not_found" } }, 404);
const conflict = () => jsonResponse({ error: { code: "conflict" } }, 409);

describe("a hydration failure of the binding left behind", () => {
  it("cannot clear the pin or the switched-to marker of the session now bound", async () => {
    const { server, store } = boot();
    const ended = sessionView({
      id: THIRD,
      status: "ended",
      endedAt: minutesAfter(2),
      createdAt: minutesAfter(-60),
    });
    views[THIRD] = ended;
    server.on("GET /:id/stream", ({ url }) =>
      jsonResponse(streamPage({ session: views[idOf(url)] as never })),
    );
    await flush();
    await flush();
    await store.actions.switchSession(OTHER);
    // A refresh begins under the pin on OTHER, and its read is held.
    const held = gate<Response>();
    let holding = true;
    server.on("GET /:id", ({ url }) => {
      const id = idOf(url);
      if (id === OTHER && holding) {
        holding = false;
        return held.promise;
      }
      return Promise.resolve(jsonResponse({ session: views[id] }));
    });
    void store.actions.refresh();
    await flush();
    // The owner switches to the finished THIRD, then the old read fails.
    await store.actions.switchSession(THIRD);
    expect(store.getSnapshot().switchedTo).toBe(THIRD);
    held.resolve(notFound());
    await flush();
    await advance(1_500);
    expect(store.getSnapshot().switchedTo).toBe(THIRD);
    expect(store.getSnapshot().session?.id).toBe(THIRD);
    // The pin survives: a refresh reads THIRD, not "current".
    const current = server.count("GET /current");
    await store.actions.refresh();
    expect(server.count("GET /current")).toBe(current);
    expect(store.getSnapshot().session?.id).toBe(THIRD);
  });
});

describe("a command of the binding left behind", () => {
  const control = (
    server: ReturnType<typeof boot>["server"],
    answer: (action: string) => Promise<Response>,
  ) =>
    server.on("POST /:id/control", ({ body }) =>
      answer((body as { action: string }).action),
    );

  it("a late pause cannot adopt the session left behind again", async () => {
    const { server, store } = boot();
    server.on("GET /:id/stream", ({ url }) =>
      jsonResponse(streamPage({ session: views[idOf(url)] as never })),
    );
    await flush();
    await flush();
    const held = gate<Response>();
    control(server, () => held.promise);
    const pausing = store.actions.pause();
    await flush();
    expect(store.getSnapshot().pending).toEqual(["pause"]);
    await store.actions.switchSession(OTHER);
    // The pending mark belongs to A: B shows none.
    expect(store.getSnapshot().pending).toEqual([]);
    held.resolve(
      jsonResponse({ session: { ...views[SESSION_ID], status: "paused" } }),
    );
    await expect(pausing).resolves.toEqual({ ok: true });
    await flush();
    expect(store.getSnapshot().session).toMatchObject({
      id: OTHER,
      status: "active",
    });
    expect(store.getSnapshot().pending).toEqual([]);
  });

  it("a late resume cannot adopt the session left behind again", async () => {
    const { server, store } = boot();
    server.on("GET /:id/stream", ({ url }) =>
      jsonResponse(streamPage({ session: views[idOf(url)] as never })),
    );
    await flush();
    await flush();
    const held = gate<Response>();
    control(server, () => held.promise);
    const resuming = store.actions.resume();
    await flush();
    await store.actions.switchSession(OTHER);
    held.resolve(jsonResponse({ session: views[SESSION_ID] }));
    await resuming;
    await flush();
    expect(store.getSnapshot().session?.id).toBe(OTHER);
  });

  it("a late failure neither sets the error nor rolls back the session now bound", async () => {
    const { server, store } = boot();
    server.on("GET /:id/stream", ({ url }) =>
      jsonResponse(streamPage({ session: views[idOf(url)] as never })),
    );
    await flush();
    await flush();
    const held = gate<Response>();
    control(server, () => held.promise);
    const pausing = store.actions.pause();
    await flush();
    expect(store.getSnapshot().session?.status).toBe("paused");
    await store.actions.switchSession(OTHER);
    held.resolve(conflict());
    await expect(pausing).resolves.toMatchObject({ ok: false });
    expect(store.getSnapshot().commandError).toBeNull();
    expect(store.getSnapshot().session).toMatchObject({
      id: OTHER,
      status: "active",
    });
  });

  it("the same command on two sessions is two operations", async () => {
    const { server, store } = boot();
    server.on("GET /:id/stream", ({ url }) =>
      jsonResponse(streamPage({ session: views[idOf(url)] as never })),
    );
    await flush();
    await flush();
    const heldA = gate<Response>();
    const heldB = gate<Response>();
    let calls = 0;
    control(server, () => (++calls === 1 ? heldA.promise : heldB.promise));
    const pauseA = store.actions.pause();
    await flush();
    await store.actions.switchSession(OTHER);
    const pauseB = store.actions.pause();
    await flush();
    expect(calls).toBe(2);
    expect(store.getSnapshot().pending).toEqual(["pause"]);
    heldB.resolve(
      jsonResponse({ session: { ...views[OTHER], status: "paused" } }),
    );
    await pauseB;
    expect(store.getSnapshot().session).toMatchObject({
      id: OTHER,
      status: "paused",
    });
    heldA.resolve(jsonResponse({ session: views[SESSION_ID] }));
    await pauseA;
    expect(store.getSnapshot().session?.id).toBe(OTHER);
  });
});

describe("capture requests across a switch", () => {
  const pendingState = {
    requestId: "req-1",
    status: "pending" as const,
    expiresAt: minutesAfter(5),
  };

  it("polls the session that made the request, and stops once another is bound", async () => {
    const requestCapture = vi.fn(async () => pendingState);
    const captureStatus = vi.fn(async () => pendingState);
    const { store } = boot({ requestCapture, captureStatus });
    await flush();
    await flush();
    await store.actions.requestCapture({ mode: "focused-window" });
    await store.actions.captureStatus("req-1");
    expect(captureStatus).toHaveBeenLastCalledWith(SESSION_ID, "req-1");
    await store.actions.switchSession(OTHER);
    const after = await store.actions.captureStatus("req-1");
    expect(after).toEqual({ ok: false, code: "not_found" });
    expect(captureStatus).toHaveBeenCalledTimes(1);
  });

  it("drops a poll answer that arrives after the switch", async () => {
    const held = gate<typeof pendingState>();
    const captureStatus = vi.fn(() => held.promise);
    const { store } = boot({
      requestCapture: async () => pendingState,
      captureStatus,
    });
    await flush();
    await flush();
    await store.actions.requestCapture({ mode: "focused-window" });
    const polling = store.actions.captureStatus("req-1");
    await flush();
    await store.actions.switchSession(OTHER);
    held.resolve({ ...pendingState, status: "captured" as never });
    await expect(polling).resolves.toEqual({ ok: false, code: "not_found" });
  });

  it("a request answered after the switch sets no error and clears its own pending mark", async () => {
    const held = gate<typeof pendingState>();
    const { store } = boot({ requestCapture: () => held.promise });
    await flush();
    await flush();
    const asking = store.actions.requestCapture({ mode: "focused-window" });
    await flush();
    await store.actions.switchSession(OTHER);
    expect(store.getSnapshot().pending).toEqual([]);
    held.reject(new Error("boom"));
    await expect(asking).resolves.toMatchObject({ ok: false });
    expect(store.getSnapshot().commandError).toBeNull();
    expect(store.getSnapshot().pending).toEqual([]);
  });

  it("a browser capture finishing after the switch sends to its own session and updates nothing", async () => {
    const held = gate<undefined>();
    const analyzeCapture = vi.fn(() => held.promise as Promise<void>);
    const { store } = boot({ analyzeCapture });
    await flush();
    await flush();
    const sending = store.actions.analyzeCapture({
      image: new Blob(["x"]),
    });
    await flush();
    expect(analyzeCapture).toHaveBeenCalledWith(SESSION_ID, expect.anything());
    await store.actions.switchSession(OTHER);
    held.reject(new Error("late"));
    await expect(sending).resolves.toMatchObject({ ok: false });
    expect(store.getSnapshot().commandError).toBeNull();
    expect(store.getSnapshot().session?.id).toBe(OTHER);
    expect(store.getSnapshot().pending).toEqual([]);
  });
});
