// Reactive by design: a pause or resume shows at once and reconciles with the
// server, a refusal puts the old state back, and "can't reach Studio" is said
// only after a real run of failed reads, never for one blip.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureSessionStores,
  getSessionStore,
  resetSessionStores,
} from "./session-registry";
import {
  deriveLiveModel,
  FAILED_READS_BEFORE_UNREACHABLE,
} from "./session-state";
import {
  jsonResponse,
  minutesAfter,
  SESSION_ID,
  sessionView,
  streamPage,
} from "./testing/session-fixtures";
import { createTestServer } from "./testing/session-test-server";

const flush = () => vi.advanceTimersByTimeAsync(0);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function boot(initial = sessionView()) {
  const server = createTestServer(() => streamPage({ session: initial }));
  server.on("GET /current", () => jsonResponse({ session: initial }));
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

describe("optimistic pause and resume", () => {
  it("shows Paused at once, then takes the server's record", async () => {
    const { server, store } = boot();
    await flush();
    await flush();
    let release!: (response: Response) => void;
    server.on(
      "POST /:id/control",
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const paused = store.actions.pause();
    await flush();
    // Before the server has answered.
    expect(store.getSnapshot().session?.status).toBe("paused");
    release(jsonResponse({ session: sessionView({ status: "paused" }) }));
    expect(await paused).toEqual({ ok: true });
    expect(store.getSnapshot().session?.status).toBe("paused");
  });

  it("shows Active at once on resume", async () => {
    const { server, store } = boot(sessionView({ status: "paused" }));
    await flush();
    await flush();
    let release!: (response: Response) => void;
    server.on(
      "POST /:id/control",
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const resumed = store.actions.resume();
    await flush();
    expect(store.getSnapshot().session?.status).toBe("active");
    release(jsonResponse({ session: sessionView({ status: "active" }) }));
    await resumed;
    expect(store.getSnapshot().session?.status).toBe("active");
  });

  it("puts the old status back when the server refuses", async () => {
    const { server, store } = boot();
    await flush();
    await flush();
    server.on("POST /:id/control", () =>
      jsonResponse({ error: { code: "status_refused" } }, 409),
    );
    expect(await store.actions.pause()).toEqual({
      ok: false,
      code: "status_refused",
    });
    expect(store.getSnapshot().session?.status).toBe("active");
  });

  it("is not undone by a stream page that began before the click", async () => {
    const { server, store } = boot();
    await flush();
    await flush();
    server.on("POST /:id/control", () =>
      jsonResponse({ session: sessionView({ status: "paused" }) }),
    );
    // A read in flight with the old status...
    let page!: (response: Response) => void;
    server.on(
      "GET /:id/stream",
      () =>
        new Promise<Response>((resolve) => {
          page = resolve;
        }),
    );
    await advance(1_100);
    const paused = store.actions.pause();
    await flush();
    page(
      jsonResponse(streamPage({ session: sessionView({ status: "active" }) })),
    );
    await paused;
    await flush();
    expect(store.getSnapshot().session?.status).toBe("paused");
    expect(store.getSnapshot().session?.id).toBe(SESSION_ID);
  });
});

describe("Can't reach Studio", () => {
  const base = {
    session: sessionView(),
    observations: [],
    actions: [],
    serverClockOffsetMs: 0,
    nowMs: Date.parse(minutesAfter(1)),
  };

  it("needs a run of failed reads, not one", () => {
    const one = deriveLiveModel({
      ...base,
      streamError: "network",
      readFailures: 1,
    });
    expect(one.streamStale).toBe(false);
    expect(one.barState).toBe("live");
    const run = deriveLiveModel({
      ...base,
      streamError: "network",
      readFailures: FAILED_READS_BEFORE_UNREACHABLE,
    });
    expect(run.streamStale).toBe(true);
    expect(run.barState).toBe("unreachable");
  });

  it("says nothing when nothing failed", () => {
    expect(
      deriveLiveModel({ ...base, streamError: null, readFailures: 0 })
        .streamStale,
    ).toBe(false);
  });

  it("counts failures in the store and clears them on the first good read", async () => {
    const { server, store } = boot();
    await flush();
    await flush();
    expect(store.getSnapshot().readFailures).toBe(0);
    server.on("GET /:id/stream", () =>
      jsonResponse({ error: { code: "network" } }, 503),
    );
    await advance(1_100);
    expect(store.getSnapshot().readFailures).toBe(1);
    expect(store.getSnapshot().streamError).not.toBeNull();
    server.on("GET /:id/stream", () =>
      jsonResponse(streamPage({ session: sessionView() })),
    );
    await advance(6_000);
    expect(store.getSnapshot().readFailures).toBe(0);
    expect(store.getSnapshot().streamError).toBeNull();
  });
});
