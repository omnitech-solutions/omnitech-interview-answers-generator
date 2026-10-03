import type { AssistantConfig } from "@omnitech-assistant/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Studio } from "../studio";
import {
  jsonResponse,
  minutesAfter,
  SESSION_ID,
  sessionView,
  streamPage,
} from "./session-fixtures";
import { getSessionStore, resetSessionStores } from "./session-registry";
import { createTestServer } from "./session-test-server";

vi.mock("@omnitech-assistant/react", () => ({
  AssistantRoot: ({
    children,
  }: {
    config: AssistantConfig;
    children: React.ReactNode;
  }) => <div className="oa-root">{children}</div>,
  useAssistantHost: () => ({
    open: false,
    shortcut: "⌘J",
    toggle: () => undefined,
  }),
  Icon: () => <svg />,
}));
// The other views are stand-ins: this file is about the Live view and the bar.
vi.mock("../workspace/workspace-view", () => ({
  WorkspaceView: () => <div>Workspace view</div>,
}));
vi.mock("../briefings/briefings-view", () => ({
  BriefingsView: () => <div>Briefings view</div>,
}));
vi.mock("../documents/documents-view", () => ({
  DocumentsView: () => <div>Documents view</div>,
}));
vi.mock("../home/home-view", () => ({ HomeView: () => <div>Home view</div> }));
vi.mock("../rehearsal/rehearsal-view", () => ({
  RehearsalView: () => <div>Rehearsal view</div>,
}));
vi.mock("../../library", () => ({ Library: () => <div>Library view</div> }));

const assistant = {
  client: {} as never,
  workspaceId: "interview",
  profileId: "local-interview",
};

let server: ReturnType<typeof createTestServer>;
let session = sessionView();

function install() {
  server = createTestServer(() => streamPage({ session }));
  server.on("GET /current", () =>
    session.status === "ended"
      ? jsonResponse({ error: { code: "not_found" } }, 404)
      : jsonResponse({ session }),
  );
  server.on("GET /:id", () => jsonResponse({ session }));
  server.on("POST /:id/control", ({ body }) => {
    const action = (body as { action: string }).action;
    session = sessionView({
      status: action === "end" ? "ended" : "paused",
      ...(action === "end" ? { endedAt: minutesAfter(5) } : {}),
    });
    return jsonResponse({ session });
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/interview/t/local/sessions"))
        return server.fetch(url, init);
      if (url.includes("/artifacts")) return Response.json([]);
      if (url.includes("/briefs")) return Response.json({ briefs: [] });
      if (url.includes("/briefing/artifacts"))
        return Response.json({ artifacts: [] });
      return Response.json({}, { status: 404 });
    }),
  );
}

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

async function openStudio(path = "/t/local/p/interview") {
  window.history.replaceState({}, "", path);
  render(<Studio assistant={assistant} />);
  await flush();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  resetSessionStores();
  // The companion has made contact: without it the bar says it is waiting.
  session = sessionView({ lastHeartbeatAt: minutesAfter(1) });
  install();
});
afterEach(() => {
  resetSessionStores();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Live session in the Studio shell", () => {
  it("adds a Live session entry that opens setup when nothing is running", async () => {
    server.on("GET /current", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    await openStudio();
    const nav = screen.getByRole("navigation", { name: "Views" });
    expect(nav).toHaveTextContent("Live session");
    fireEvent.click(screen.getByTitle("Live session"));
    expect(window.location.pathname).toBe("/t/local/p/interview/live");
    expect(screen.getByRole("banner")).toHaveTextContent("Live session");
    expect(screen.getByTestId("live-setup")).toBeVisible();
    expect(screen.getByTitle("Live session")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByTestId("session-bar")).toBeNull();
  });

  it("opens the Live view from the G L shortcut", async () => {
    server.on("GET /current", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    await openStudio();
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "l" });
    expect(window.location.pathname).toBe("/t/local/p/interview/live");
  });

  it("shows the bar on every page while a session is open, and on Live as its header", async () => {
    await openStudio();
    expect(screen.getByTestId("session-bar")).toHaveAttribute(
      "data-variant",
      "bar",
    );
    expect(screen.getByTestId("session-bar")).toHaveTextContent("Live");

    for (const view of ["Knowledge", "Rehearsal", "Documents"]) {
      fireEvent.click(screen.getByTitle(view));
      expect(screen.getAllByTestId("session-bar")).toHaveLength(1);
      expect(screen.getByTestId("session-bar")).toHaveAttribute(
        "data-variant",
        "bar",
      );
    }
    fireEvent.click(screen.getByTitle("Live session"));
    expect(screen.getByTestId("live-panel")).toBeVisible();
    expect(screen.getAllByTestId("session-bar")).toHaveLength(1);
    expect(screen.getByTestId("session-bar")).toHaveAttribute(
      "data-variant",
      "header",
    );
  });

  it("returns to the session from the bar's Open", async () => {
    await openStudio("/t/local/p/interview/knowledge");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(window.location.pathname).toBe("/t/local/p/interview/live");
    expect(screen.getByTestId("live-panel")).toBeVisible();
  });

  it("pauses from any page and is still paused after moving to another", async () => {
    await openStudio("/t/local/p/interview/knowledge");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await flush();
    expect(screen.getByTestId("session-bar")).toHaveTextContent("Paused");
    fireEvent.click(screen.getByTitle("Documents"));
    expect(screen.getByTestId("session-bar")).toHaveTextContent("Paused");
    expect(screen.getByRole("button", { name: "Resume" })).toBeVisible();
  });

  it("keeps following the session while pages change, reading about once a second", async () => {
    await openStudio();
    const start = server.count("GET /:id/stream");
    for (const view of ["Knowledge", "Workspace", "Briefings", "Home"]) {
      fireEvent.click(screen.getByTitle(view));
      await advance(1_000);
    }
    // Four seconds, four pages visited: still one read per second, no more.
    expect(server.count("GET /:id/stream") - start).toBe(4);
    expect(server.count("GET /current")).toBe(1);
  });

  it("re-hydrates after a reload and the bar comes back", async () => {
    const first = render(<Studio assistant={assistant} />);
    await flush();
    expect(screen.getByTestId("session-bar")).toBeVisible();
    first.unmount();
    resetSessionStores(); // a reload drops every module-level store
    await openStudio();
    expect(server.count("GET /current")).toBe(2);
    expect(screen.getByTestId("session-bar")).toBeVisible();
  });

  it("stops reading when the shell goes away", async () => {
    const { unmount } = render(<Studio assistant={assistant} />);
    await flush();
    unmount();
    const reads = server.count("GET /:id/stream");
    await advance(10_000);
    expect(server.count("GET /:id/stream")).toBe(reads);
  });

  it("switches between setup, live and ended from the store", async () => {
    server.on("GET /current", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    server.on("POST /", () => {
      session = sessionView({ status: "created" });
      return jsonResponse(
        {
          session,
          credential: { value: "one-time", expiresAt: minutesAfter(120) },
        },
        201,
      );
    });
    await openStudio("/t/local/p/interview/live");
    expect(screen.getByTestId("live-setup")).toBeVisible();

    await act(async () => {
      await getSessionStore("local").actions.start({
        processingPolicy: "device-only",
        captureSources: ["microphone"],
      });
    });
    expect(screen.getByTestId("live-panel")).toBeVisible();
    expect(screen.queryByTestId("live-setup")).toBeNull();

    await act(async () => {
      await getSessionStore("local").actions.end();
    });
    expect(screen.getByTestId("live-ended")).toBeVisible();
    expect(screen.queryByTestId("session-bar")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Start another session" }),
    );
    expect(screen.getByTestId("live-setup")).toBeVisible();
  });

  it("shows the ended summary after a reload, from the remembered session", async () => {
    session = sessionView({ status: "ended", endedAt: minutesAfter(5) });
    sessionStorage.setItem(
      "interview-studio.live.ended-session.local",
      SESSION_ID,
    );
    await openStudio("/t/local/p/interview/live");
    expect(screen.getByTestId("live-ended")).toBeVisible();
    sessionStorage.clear();
  });

  it("reads a finished session addressed by id", async () => {
    session = sessionView({ status: "ended", endedAt: minutesAfter(5) });
    await openStudio(`/t/local/p/interview/live/${SESSION_ID}`);
    expect(screen.getByTestId("live-ended")).toBeVisible();
  });

  it("offers a retry when the session service cannot be reached", async () => {
    server.on("GET /current", () => {
      throw new TypeError("offline");
    });
    await openStudio("/t/local/p/interview/live");
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t reach/i);
  });
});
