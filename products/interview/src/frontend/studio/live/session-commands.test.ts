import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  jsonResponse,
  minutesAfter,
  SESSION_ID,
  sessionView,
  streamPage,
  transcript,
} from "./session-fixtures";
import { elapsedMs } from "./session-merge";
import {
  configureSessionStores,
  getSessionStore,
  resetSessionStores,
} from "./session-registry";
import { createTestServer, type TestServer } from "./session-test-server";

const storage = new Map<string, string>();
const flush = () => vi.advanceTimersByTimeAsync(0);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function boot(server: TestServer) {
  configureSessionStores({
    fetch: server.fetch,
    storage: {
      read: (key) => storage.get(key) ?? null,
      write: (key, value) => void storage.set(key, value),
      remove: (key) => void storage.delete(key),
    },
  });
  return getSessionStore("local");
}

// A server whose session record the control route changes, like the real one.
function controlledServer() {
  let session = sessionView();
  const server = createTestServer(() => streamPage({ session }));
  server.on("GET /current", () => jsonResponse({ session }));
  server.on("GET /:id", () => jsonResponse({ session }));
  server.on("POST /:id/control", ({ body }) => {
    const action = (body as { action: string }).action;
    session = sessionView({
      status:
        action === "pause" ? "paused" : action === "end" ? "ended" : "active",
      ...(action === "end" ? { endedAt: minutesAfter(5) } : {}),
    });
    return jsonResponse({ session });
  });
  return server;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  storage.clear();
  resetSessionStores();
});
afterEach(() => {
  resetSessionStores();
  vi.useRealTimers();
});

describe("session commands", () => {
  it("pauses and resumes from the server's record and changes the cadence", async () => {
    const server = controlledServer();
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();

    await expect(store.actions.pause()).resolves.toEqual({ ok: true });
    expect(store.getSnapshot().session?.status).toBe("paused");
    await flush();
    const before = server.count("GET /:id/stream");
    await advance(4_000);
    expect(server.count("GET /:id/stream")).toBe(before);

    await store.actions.resume();
    expect(store.getSnapshot().session?.status).toBe("active");
    expect(server.calls.filter((c) => c === "POST /:id/control")).toHaveLength(
      2,
    );
  });

  it("ends the session, reads the last page once, remembers the id and stops", async () => {
    const server = controlledServer();
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    const before = server.count("GET /:id/stream");
    await store.actions.end();
    expect(store.getSnapshot()).toMatchObject({
      session: { status: "ended" },
      endedSessionId: SESSION_ID,
    });
    expect(server.count("GET /:id/stream")).toBe(before + 1);
    expect(storage.get("interview-studio.live.ended-session.local")).toBe(
      SESSION_ID,
    );
    await advance(30_000);
    expect(server.count("GET /:id/stream")).toBe(before + 1);
  });

  it("reads the ended session after a reload from the remembered id", async () => {
    const server = controlledServer();
    boot(server).subscribe(() => undefined);
    await flush();
    await getSessionStore("local").actions.end();
    resetSessionStores();
    // After End /current answers 404; the tab still remembers the id.
    server.on("GET /current", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    const reloaded = boot(server);
    reloaded.subscribe(() => undefined);
    await flush();
    // The session is delete-at-end and not yet seen purged, so after the
    // drain the record is checked again for the purge.
    expect(server.calls.slice(-4)).toEqual([
      "GET /current",
      "GET /:id",
      "GET /:id/stream",
      "GET /:id",
    ]);
    expect(reloaded.getSnapshot().session?.status).toBe("ended");
    const reads = server.count("GET /:id/stream");
    await advance(10_000);
    expect(server.count("GET /:id/stream")).toBe(reads);
  });

  it("forgets a remembered id the server no longer knows", async () => {
    storage.set("interview-studio.live.ended-session.local", SESSION_ID);
    const server = createTestServer();
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    expect(store.getSnapshot()).toMatchObject({
      session: null,
      endedSessionId: null,
    });
    expect(storage.has("interview-studio.live.ended-session.local")).toBe(
      false,
    );
  });

  it("returns a refusal as a fixed code and keeps the record", async () => {
    const server = controlledServer();
    server.on("POST /:id/control", () =>
      jsonResponse({ error: { code: "credential_renewal_required" } }, 409),
    );
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    await expect(store.actions.resume()).resolves.toEqual({
      ok: false,
      code: "credential_renewal_required",
    });
    expect(store.getSnapshot()).toMatchObject({
      commandError: "credential_renewal_required",
      pending: [],
      session: { status: "active" },
    });
  });

  it("does not let an older stream page undo a command's answer", async () => {
    const server = controlledServer();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hold = false;
    const original = server.fetch;
    const store = (() => {
      configureSessionStores({
        // The page is read first and delivered late: a stale record.
        fetch: async (url, init) => {
          const response = await original(url, init);
          if (hold && url.includes("/stream")) await gate;
          return response;
        },
        storage: {
          read: () => null,
          write: () => undefined,
          remove: () => undefined,
        },
      });
      return getSessionStore("local");
    })();
    store.subscribe(() => undefined);
    await flush();
    hold = true;
    await advance(1_000); // a page is now in flight, holding the old record
    await store.actions.pause();
    hold = false;
    release();
    await flush();
    expect(store.getSnapshot().session?.status).toBe("paused");
  });

  it("starts a session and holds the credential only in the snapshot", async () => {
    const server = createTestServer();
    server.on("POST /", () =>
      jsonResponse(
        {
          session: sessionView({ status: "created" }),
          credential: {
            value: "pairing-secret-xyz",
            expiresAt: minutesAfter(120),
          },
        },
        201,
      ),
    );
    const localSet = vi.spyOn(Storage.prototype, "setItem");
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    await store.actions.start({
      processingPolicy: "device-only",
      captureSources: ["microphone"],
    });
    expect(store.getSnapshot().pairing?.value).toBe("pairing-secret-xyz");
    expect(store.getSnapshot().session?.status).toBe("created");
    expect(storage.size).toBe(0);
    expect(JSON.stringify([...localSet.mock.calls])).not.toContain(
      "pairing-secret-xyz",
    );
    expect(JSON.stringify(window.localStorage)).not.toContain("pairing-secret");
    expect(JSON.stringify(window.sessionStorage)).not.toContain(
      "pairing-secret",
    );

    store.actions.dismissPairing();
    expect(store.getSnapshot().pairing).toBeNull();
    localSet.mockRestore();
  });

  it("replaces the held credential on renewal and drops it on reload", async () => {
    const server = controlledServer();
    server.on("POST /:id/credential", () =>
      jsonResponse({
        credential: { value: "renewed-secret", expiresAt: minutesAfter(240) },
      }),
    );
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    await store.actions.renewCredential();
    expect(store.getSnapshot().pairing?.value).toBe("renewed-secret");
    resetSessionStores();
    const reloaded = boot(server);
    reloaded.subscribe(() => undefined);
    await flush();
    expect(reloaded.getSnapshot().pairing).toBeNull();
  });

  it("revokes by reading the record back, not guessing", async () => {
    const server = controlledServer();
    let session = sessionView();
    server.on("GET /:id", () => jsonResponse({ session }));
    server.on("DELETE /:id/credential", () => {
      session = sessionView({ status: "paused", credentialRevoked: true });
      return new Response(null, { status: 204 });
    });
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    await store.actions.revokeCredential();
    expect(store.getSnapshot().session).toMatchObject({
      status: "paused",
      credentialRevoked: true,
    });
  });

  it("tightens locality, shortens retention and deletes from the response", async () => {
    const server = controlledServer();
    server.on("POST /:id/policy", () =>
      jsonResponse({
        session: sessionView({ processingPolicy: "device-only" }),
      }),
    );
    server.on("POST /:id/retention", ({ body }) =>
      jsonResponse({
        session: sessionView({
          retention: (body as { retention: "delete-at-end" }).retention,
        }),
      }),
    );
    server.on("DELETE /:id", () =>
      jsonResponse({ session: sessionView({ status: "purging" }) }, 202),
    );
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    await store.actions.tightenLocality();
    expect(store.getSnapshot().session?.processingPolicy).toBe("device-only");
    await store.actions.shortenRetention("delete-at-end");
    expect(store.getSnapshot().session?.retention).toBe("delete-at-end");
    await store.actions.deleteSession();
    expect(store.getSnapshot().session?.status).toBe("purging");
  });

  it("holds no content once a session is purging, and settles to the record", async () => {
    let session = sessionView({ status: "ended", endedAt: minutesAfter(5) });
    const server = createTestServer(() =>
      streamPage({
        session,
        observations: [transcript(1, "A private sentence.")],
        nextAfterSequence: 1,
      }),
    );
    server.on("GET /current", () => jsonResponse({ session }));
    server.on("GET /:id", () => jsonResponse({ session }));
    server.on("DELETE /:id", () => {
      session = sessionView({ status: "purging" });
      return jsonResponse({ session }, 202);
    });
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    expect(store.getSnapshot().observations).toHaveLength(1);
    await store.actions.deleteSession();
    expect(store.getSnapshot().observations).toEqual([]);
    session = sessionView({
      status: "ended",
      purged: true,
      purgeOutcome: "done",
    });
    await advance(3_000);
    expect(store.getSnapshot().session?.purged).toBe(true);
    expect(store.getSnapshot().observations).toEqual([]);
    const reads = server.count("GET /:id");
    await advance(30_000);
    expect(server.count("GET /:id")).toBe(reads);
  });

  it("opens a finished session by address, but never displaces an open one", async () => {
    const server = createTestServer();
    server.on("GET /:id", () =>
      jsonResponse({
        session: sessionView({ status: "ended", endedAt: minutesAfter(2) }),
      }),
    );
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    await store.actions.openSession(SESSION_ID);
    expect(store.getSnapshot().session?.status).toBe("ended");
    await store.actions.openSession("11111111-1111-4111-8111-111111111111");
    expect(store.getSnapshot().session?.id).toBe(SESSION_ID);
  });

  it("dismisses a finished session for a fresh setup, but never an open one", async () => {
    const server = controlledServer();
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    store.actions.dismissFinished();
    expect(store.getSnapshot().session?.status).toBe("active");
    await store.actions.end();
    expect(storage.has("interview-studio.live.ended-session.local")).toBe(true);
    store.actions.dismissFinished();
    expect(store.getSnapshot()).toMatchObject({
      session: null,
      observations: [],
      actions: [],
      endedSessionId: null,
    });
    expect(storage.has("interview-studio.live.ended-session.local")).toBe(
      false,
    );
  });

  it("reports an address the server does not know", async () => {
    const server = createTestServer();
    const store = boot(server);
    store.subscribe(() => undefined);
    await flush();
    await store.actions.openSession("22222222-2222-4222-8222-222222222222");
    expect(store.getSnapshot()).toMatchObject({
      session: null,
      notFoundSessionId: "22222222-2222-4222-8222-222222222222",
    });
  });
});

describe("elapsed time", () => {
  it("is server time minus a server timestamp, not the browser clock alone", () => {
    const session = sessionView({ createdAt: "2026-10-03T12:00:00.000Z" });
    // The browser clock is 10 minutes behind the server.
    const browserNow = Date.parse("2026-10-03T12:05:00.000Z");
    const offset = 10 * 60_000;
    expect(elapsedMs(session, offset, browserNow)).toBe(15 * 60_000);
    expect(elapsedMs(session, 0, browserNow)).toBe(5 * 60_000);
  });

  it("stops at the end and is never negative", () => {
    const ended = sessionView({
      createdAt: "2026-10-03T12:00:00.000Z",
      endedAt: "2026-10-03T12:07:30.000Z",
    });
    expect(elapsedMs(ended, 0, Date.parse("2026-10-03T13:00:00.000Z"))).toBe(
      450_000,
    );
    expect(elapsedMs(sessionView(), 0, 0)).toBe(0);
  });
});
