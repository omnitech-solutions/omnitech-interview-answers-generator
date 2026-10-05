// The "Live session" nav item carries a red dot while a session is open, read
// from the session store, and only on the item whose config asks for it.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { views } from "./config/views";
import {
  configureSessionStores,
  resetSessionStores,
} from "./live/session-registry";
import {
  jsonResponse,
  minutesAfter,
  sessionView,
  streamPage,
} from "./live/testing/session-fixtures";
import { createTestServer } from "./live/testing/session-test-server";
import { Sidebar } from "./sidebar";

const lists = {
  questions: [],
  briefings: [],
  briefs: [],
  status: "ready" as const,
  refresh: () => undefined,
};

async function renderWith(status: "active" | "paused" | "ended" | null) {
  const session = status ? sessionView({ status }) : null;
  const server = createTestServer(() =>
    streamPage({ session: session ?? sessionView() }),
  );
  server.on("GET /current", () =>
    session
      ? jsonResponse({ session })
      : jsonResponse({ error: { code: "not_found" } }, 404),
  );
  configureSessionStores({
    fetch: server.fetch,
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
  render(
    <Sidebar
      view="home"
      artifact=""
      lists={lists}
      theme="light"
      onGo={() => undefined}
      onOpenArtifact={() => undefined}
      onOpenPalette={() => undefined}
      onToggleTheme={() => undefined}
    />,
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  await act(() => vi.advanceTimersByTimeAsync(0));
}
const liveItem = () => screen.getByRole("button", { name: /Live session/ });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  window.history.replaceState({}, "", "/t/local/p/interview");
  resetSessionStores();
});
afterEach(() => {
  cleanup();
  resetSessionStores();
  vi.useRealTimers();
});

describe("the live nav dot", () => {
  it("is configured on the Live session view only", () => {
    expect(
      views.filter((view) => view.indicator).map((view) => view.id),
    ).toEqual(["live"]);
  });

  it.each(["active", "paused"] as const)(
    "shows while a session is %s",
    async (status) => {
      await renderWith(status);
      expect(
        liveItem().querySelector('[aria-label="Session in progress"]'),
      ).not.toBeNull();
    },
  );

  it("is absent with no session, and once it has ended", async () => {
    await renderWith(null);
    expect(liveItem().querySelector(".studio-nav-live")).toBeNull();
    cleanup();
    resetSessionStores();
    await renderWith("ended");
    expect(liveItem().querySelector(".studio-nav-live")).toBeNull();
  });
});
