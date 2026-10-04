// Owner-input actions and the shared visibility loop of the session store.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionApiError } from "./session-client";
import {
  jsonResponse,
  minutesAfter,
  SESSION_ID,
  sessionView,
} from "./session-fixtures";
import {
  configureSessionStores,
  getSessionStore,
  resetSessionStores,
} from "./session-registry";
import { createTestServer } from "./session-test-server";

let visible = true;
let visibilityListeners: (() => void)[] = [];
const flush = () => vi.advanceTimersByTimeAsync(0);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function boot(extra: Parameters<typeof configureSessionStores>[0] = {}) {
  const server = createTestServer();
  server.on("GET /current", () => jsonResponse({ session: sessionView() }));
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => visible,
    onVisibilityChange: (listener) => {
      visibilityListeners.push(listener);
      return () => {
        visibilityListeners = visibilityListeners.filter((l) => l !== listener);
      };
    },
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
  visible = true;
  visibilityListeners = [];
  resetSessionStores();
});
afterEach(() => {
  resetSessionStores();
  vi.useRealTimers();
});

describe("owner input actions", () => {
  it("answer unavailable, without a request or a crash, when the deps have no method", async () => {
    // A server build without the owner-input route: no method at all.
    const { server, store } = boot({
      analyzeLatestCapture: undefined,
      submitFollowUp: undefined,
    } as never);
    await flush();
    const before = server.calls.length;
    expect(await store.actions.analyzeLatestCapture()).toEqual({
      ok: false,
      code: "unavailable",
    });
    expect(await store.actions.submitFollowUp("and the cost?")).toEqual({
      ok: false,
      code: "unavailable",
    });
    expect(server.calls.length).toBe(before);
    expect(store.getSnapshot().commandError).toBe("unavailable");
  });

  it("call the deps method with the session id and the trimmed text", async () => {
    const analyzeLatestCapture = vi.fn(async () => undefined);
    const submitFollowUp = vi.fn(async () => undefined);
    const { store } = boot({ analyzeLatestCapture, submitFollowUp });
    await flush();
    expect(await store.actions.analyzeLatestCapture()).toEqual({ ok: true });
    expect(await store.actions.submitFollowUp("  and the cost?  ")).toEqual({
      ok: true,
    });
    expect(analyzeLatestCapture).toHaveBeenCalledWith(
      SESSION_ID,
      undefined,
      undefined,
    );
    expect(submitFollowUp).toHaveBeenCalledWith(
      SESSION_ID,
      "and the cost?",
      undefined,
    );
  });

  it("refuse an empty follow-up and return a thrown code", async () => {
    const submitFollowUp = vi.fn(async () => {
      throw new SessionApiError("status_refused", 409);
    });
    const { store } = boot({ submitFollowUp });
    await flush();
    expect(await store.actions.submitFollowUp("   ")).toEqual({
      ok: false,
      code: "invalid_input",
    });
    expect(submitFollowUp).not.toHaveBeenCalled();
    expect(await store.actions.submitFollowUp("next")).toEqual({
      ok: false,
      code: "status_refused",
    });
  });
});
