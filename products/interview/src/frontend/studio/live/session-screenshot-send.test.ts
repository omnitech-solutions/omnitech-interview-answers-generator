// D35: the "Screenshots to the model" save, through the real client and store:
// one POST with the strict body, the saved value adopted from the server's
// record, and a refusal leaving the saved value as it was.
import { liveSessionScreenshotSendRequestSchema } from "@omnitech/interview-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureSessionStores,
  getSessionStore,
  resetSessionStores,
} from "./session-registry";
import {
  jsonResponse,
  minutesAfter,
  sessionView,
  streamPage,
} from "./testing/session-fixtures";
import { createTestServer } from "./testing/session-test-server";

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  resetSessionStores();
});
afterEach(() => {
  resetSessionStores();
  vi.useRealTimers();
});

function boot(session = sessionView()) {
  let current = session;
  const server = createTestServer(() => streamPage({ session: current }));
  server.on("GET /current", () => jsonResponse({ session: current }));
  server.on("GET /:id", () => jsonResponse({ session: current }));
  configureSessionStores({
    fetch: server.fetch,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
  const store = getSessionStore("local");
  store.subscribe(() => undefined);
  return {
    server,
    store,
    set: (next: typeof current) => {
      current = next;
    },
  };
}

describe("setScreenshotSend", () => {
  it("posts the strict body once and shows the server's saved value", async () => {
    const { server, store } = boot();
    const bodies: unknown[] = [];
    server.on("POST /:id/screenshot-send", ({ body }) => {
      bodies.push(body);
      return jsonResponse({
        session: sessionView({ screenshotSend: "text-only-when-text" }),
      });
    });
    await flush();
    expect(store.getSnapshot().session?.screenshotSend).toBeUndefined();
    await expect(
      store.actions.setScreenshotSend("text-only-when-text"),
    ).resolves.toEqual({ ok: true });
    expect(bodies).toEqual([{ screenshotSend: "text-only-when-text" }]);
    expect(
      liveSessionScreenshotSendRequestSchema.safeParse(bodies[0]).success,
    ).toBe(true);
    expect(store.getSnapshot().session?.screenshotSend).toBe(
      "text-only-when-text",
    );
    expect(server.count("POST /:id/screenshot-send")).toBe(1);
  });

  it("shares one call for the same value asked twice", async () => {
    const { server, store } = boot();
    server.on("POST /:id/screenshot-send", () =>
      jsonResponse({ session: sessionView({ screenshotSend: "never" }) }),
    );
    await flush();
    const first = store.actions.setScreenshotSend("never");
    const second = store.actions.setScreenshotSend("never");
    await Promise.all([first, second]);
    expect(server.count("POST /:id/screenshot-send")).toBe(1);
  });

  it("reports an ended session's refusal and keeps the saved value", async () => {
    const { server, store } = boot(sessionView({ screenshotSend: "never" }));
    server.on("POST /:id/screenshot-send", () =>
      jsonResponse({ error: { code: "status_refused" } }, 409),
    );
    await flush();
    const result = await store.actions.setScreenshotSend("always");
    expect(result).toMatchObject({ ok: false, code: "status_refused" });
    expect(store.getSnapshot().session?.screenshotSend).toBe("never");
  });
});
