import type { LiveStreamResponse } from "@omnitech/interview-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureSessionStores,
  getSessionStore,
  resetSessionStores,
} from "./session-registry";
import {
  action,
  jsonResponse,
  minutesAfter,
  SESSION_ID,
  sessionView,
  streamPage,
  transcript,
} from "./session-fixtures";
import { createTestServer, type TestServer } from "./session-test-server";

// Fake timers also fake Date.now, so the store's clock and its timers agree.
let visible = true;
let visibilityListeners: (() => void)[] = [];
const storage = new Map<string, string>();

function boot(server: TestServer) {
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => visible,
    onVisibilityChange: (listener) => {
      visibilityListeners.push(listener);
      return () => {
        visibilityListeners = visibilityListeners.filter((l) => l !== listener);
      };
    },
    storage: {
      read: (key) => storage.get(key) ?? null,
      write: (key, value) => void storage.set(key, value),
      remove: (key) => void storage.delete(key),
    },
  });
  return getSessionStore("local");
}
const setVisible = (value: boolean) => {
  visible = value;
  for (const listener of [...visibilityListeners]) listener();
};
const flush = () => vi.advanceTimersByTimeAsync(0);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function activeServer(stream?: () => LiveStreamResponse) {
  const server = createTestServer(stream);
  server.on("GET /current", () => jsonResponse({ session: sessionView() }));
  return server;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  visible = true;
  visibilityListeners = [];
  storage.clear();
  resetSessionStores();
});
afterEach(() => {
  resetSessionStores();
  vi.useRealTimers();
});

describe("hydration", () => {
  it("reads the current session when first subscribed, not before", async () => {
    const server = activeServer();
    const store = boot(server);
    expect(store.getSnapshot().hydration).toBe("pending");
    expect(server.calls).toEqual([]);
    const listener = vi.fn();
    store.subscribe(listener);
    await flush();
    expect(server.calls[0]).toBe("GET /current");
    expect(store.getSnapshot()).toMatchObject({
      hydration: "ready",
      session: { id: SESSION_ID, status: "active" },
    });
    expect(listener).toHaveBeenCalled();
  });

  it("treats a 404 as no session and does not poll", async () => {
    const server = createTestServer();
    const store = boot(server);
    store.subscribe(() => undefined);
    await advance(10_000);
    expect(store.getSnapshot()).toMatchObject({
      hydration: "ready",
      session: null,
    });
    expect(server.calls).toEqual(["GET /current"]);
  });

  it("re-hydrates after a reload from the server, not from memory", async () => {
    const server = activeServer(() =>
      streamPage({
        observations: [transcript(1, "Tell me about a recent project.")],
        nextAfterSequence: 1,
      }),
    );
    boot(server).subscribe(() => undefined);
    await flush();
    resetSessionStores(); // the page reloads: no store survives
    const reloaded = boot(server);
    expect(reloaded.getSnapshot().session).toBeNull();
    reloaded.subscribe(() => undefined);
    await flush();
    expect(server.count("GET /current")).toBe(2);
    expect(reloaded.getSnapshot().observations).toHaveLength(1);
    expect(reloaded.getSnapshot().session?.id).toBe(SESSION_ID);
  });

  it("retries a failed first read with backoff", async () => {
    const server = createTestServer();
    let attempts = 0;
    server.on("GET /current", () => {
      attempts += 1;
      return attempts < 3
        ? jsonResponse({ error: { code: "session_unavailable" } }, 500)
        : jsonResponse({ session: sessionView() });
    });
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    expect(store.getSnapshot()).toMatchObject({
      hydration: "failed",
      streamError: "session_unavailable",
    });
    await advance(5_000);
    expect(store.getSnapshot().hydration).toBe("failed");
    await advance(10_000);
    expect(store.getSnapshot()).toMatchObject({
      hydration: "ready",
      streamError: null,
    });
  });
});

describe("stream subscription", () => {
  it("polls about once a second with the observation and action cursors", async () => {
    let page = 0;
    const server = activeServer(() => {
      page += 1;
      return streamPage({
        observations: [transcript(page, `line ${page}`)],
        nextAfterSequence: page,
        nextActionCursor: `cursor-${page}`,
      });
    });
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    expect(server.streamQueries[0]?.toString()).toBe("afterSequence=0");
    await advance(1_000);
    expect(server.streamQueries[1]?.toString()).toBe(
      "afterSequence=1&actionCursor=cursor-1",
    );
    await advance(1_000);
    expect(server.count("GET /:id/stream")).toBe(3);
    expect(store.getSnapshot().observations.map((o) => o.sequence)).toEqual([
      1, 2, 3,
    ]);
  });

  it("reads again at once while more is waiting, then settles to the poll", async () => {
    let calls = 0;
    const server = activeServer(() => {
      calls += 1;
      return streamPage({
        hasMoreObservations: calls < 3,
        nextAfterSequence: calls,
        observations: [transcript(calls, `line ${calls}`)],
      });
    });
    boot(server).subscribe(() => undefined);
    await flush();
    expect(server.count("GET /:id/stream")).toBe(3);
    await advance(999);
    expect(server.count("GET /:id/stream")).toBe(3);
    await advance(1);
    expect(server.count("GET /:id/stream")).toBe(4);
  });

  it("polls a paused session slowly", async () => {
    const server = createTestServer(() =>
      streamPage({ session: sessionView({ status: "paused" }) }),
    );
    server.on("GET /current", () =>
      jsonResponse({ session: sessionView({ status: "paused" }) }),
    );
    boot(server).subscribe(() => undefined);
    await flush();
    await advance(4_900);
    expect(server.count("GET /:id/stream")).toBe(1);
    await advance(200);
    expect(server.count("GET /:id/stream")).toBe(2);
  });

  it("stops polling once a session kept after the call has ended", async () => {
    const server = activeServer(() =>
      streamPage({
        session: sessionView({
          status: "ended",
          retention: "thirty-days",
          endedAt: minutesAfter(2),
        }),
      }),
    );
    const store = boot(server);
    store.subscribe(() => undefined);
    await advance(20_000);
    expect(store.getSnapshot().session?.status).toBe("ended");
    expect(server.count("GET /:id/stream")).toBe(1);
    expect(server.count("GET /:id")).toBe(0);
  });

  it("keeps checking an ended delete-at-end session until the purge is observed, then drops its content", async () => {
    let purged = false;
    const ended = (overrides = {}) =>
      sessionView({
        status: "ended",
        retention: "delete-at-end",
        endedAt: minutesAfter(2),
        ...overrides,
      });
    const server = activeServer(() =>
      streamPage({
        session: ended(),
        observations: [transcript(1, "Tell me about a recent project.")],
        nextAfterSequence: 1,
      }),
    );
    server.on("GET /:id", () =>
      jsonResponse({
        session: purged ? ended({ purged: true }) : ended(),
      }),
    );
    const store = boot(server);
    store.subscribe(() => undefined);
    await advance(1_000);
    expect(store.getSnapshot().observations).toHaveLength(1);
    // Not purged yet: the store re-reads the record at the settle cadence.
    await advance(9_000);
    expect(server.count("GET /:id")).toBeGreaterThanOrEqual(3);
    expect(store.getSnapshot().session?.purged).toBe(false);
    purged = true;
    await advance(3_100);
    expect(store.getSnapshot().session?.purged).toBe(true);
    expect(store.getSnapshot().observations).toEqual([]);
    // Once observed it stops asking.
    const reads = server.count("GET /:id");
    await advance(20_000);
    expect(server.count("GET /:id")).toBe(reads);
  });

  it("gives up on a purge that never settles after a bounded number of checks", async () => {
    const server = activeServer(() =>
      streamPage({
        session: sessionView({
          status: "ended",
          retention: "delete-at-end",
          endedAt: minutesAfter(2),
        }),
      }),
    );
    server.on("GET /:id", () =>
      jsonResponse({
        session: sessionView({
          status: "ended",
          retention: "delete-at-end",
          endedAt: minutesAfter(2),
        }),
      }),
    );
    const store = boot(server);
    store.subscribe(() => undefined);
    await advance(300_000);
    expect(server.count("GET /:id")).toBe(20);
  });

  it("merges a re-read action by id: the newest updatedAt wins", async () => {
    const running = action({
      taskId: "t1",
      dispatchStatus: "in_flight",
      updatedAt: minutesAfter(1, 1),
    });
    const settled = {
      ...running,
      dispatchStatus: "succeeded" as const,
      updatedAt: minutesAfter(1, 9),
    };
    const lateOldCopy = { ...running, updatedAt: minutesAfter(1, 3) };
    const pages = [[running], [settled], [lateOldCopy]];
    const server = activeServer(() =>
      streamPage({ actions: pages.shift() ?? [] }),
    );
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    expect(store.getSnapshot().actions[0]?.dispatchStatus).toBe("in_flight");
    await advance(1_000);
    expect(store.getSnapshot().actions[0]?.dispatchStatus).toBe("succeeded");
    await advance(1_000);
    expect(store.getSnapshot().actions).toHaveLength(1);
    expect(store.getSnapshot().actions[0]?.dispatchStatus).toBe("succeeded");
  });

  it("estimates the server clock from serverNow", async () => {
    const server = activeServer(() =>
      streamPage({ serverNow: new Date(Date.now() + 600_000).toISOString() }),
    );
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    expect(store.getSnapshot().serverClockOffsetMs).toBe(600_000);
  });

  it("reports a stream failure and recovers on the next try", async () => {
    let fail = true;
    const server = activeServer(() => streamPage());
    server.on("GET /:id/stream", () =>
      fail
        ? jsonResponse({ error: { code: "session_unavailable" } }, 500)
        : jsonResponse(streamPage()),
    );
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    expect(store.getSnapshot().streamError).toBe("session_unavailable");
    fail = false;
    await advance(5_000);
    expect(store.getSnapshot().streamError).toBeNull();
  });

  it("stops for good on a terminal answer until refreshed", async () => {
    const server = activeServer();
    server.on("GET /:id/stream", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    const store = boot(server);
    store.subscribe(() => undefined);
    await advance(60_000);
    expect(server.count("GET /:id/stream")).toBe(1);
    expect(store.getSnapshot().streamError).toBe("not_found");
  });
});

describe("lifetime", () => {
  it("does not start a second poll when a view remounts", async () => {
    const server = activeServer();
    const store = boot(server);
    const first = store.subscribe(() => undefined);
    await flush();
    first(); // the view unmounts
    const second = store.subscribe(() => undefined); // and mounts again
    await flush();
    // The remount refreshes once; after that it is still one read a second.
    expect(server.count("GET /:id/stream")).toBe(2);
    await advance(3_000);
    expect(server.count("GET /:id/stream")).toBe(5);
    expect(server.count("GET /current")).toBe(1);
    second();
  });

  it("keeps running while any subscriber remains, stops with the last", async () => {
    const server = activeServer();
    const store = boot(server);
    const a = store.subscribe(() => undefined);
    const b = store.subscribe(() => undefined);
    await flush();
    a();
    await advance(2_000);
    const whileOne = server.count("GET /:id/stream");
    expect(whileOne).toBe(3);
    b();
    await advance(10_000);
    expect(server.count("GET /:id/stream")).toBe(whileOne);
  });

  it("pauses polling while the page is hidden and resumes at once", async () => {
    const server = activeServer();
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    setVisible(false);
    await advance(10_000);
    expect(server.count("GET /:id/stream")).toBe(1);
    setVisible(true);
    await flush();
    expect(server.count("GET /:id/stream")).toBe(2);
    await advance(1_000);
    expect(server.count("GET /:id/stream")).toBe(3);
  });

  it("cancels its timers on reset", async () => {
    const server = activeServer();
    boot(server).subscribe(() => undefined);
    await flush();
    resetSessionStores();
    await advance(10_000);
    expect(server.count("GET /:id/stream")).toBe(1);
  });
});
