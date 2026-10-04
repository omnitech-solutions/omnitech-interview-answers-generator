// Switching sessions on the one store: results and errors of reads that began
// under the session left behind are ignored, and only the latest request wins.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  jsonResponse,
  minutesAfter,
  SESSION_ID,
  sessionView,
  streamPage,
} from "./session-fixtures";
import {
  configureSessionStores,
  getSessionStore,
  resetSessionStores,
} from "./session-registry";
import { createTestServer } from "./session-test-server";

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

function boot() {
  const server = createTestServer();
  server.on("GET /current", () => jsonResponse({ session: views[SESSION_ID] }));
  server.on("GET /:id", ({ url }) =>
    jsonResponse({ session: views[idOf(url)] }),
  );
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
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
