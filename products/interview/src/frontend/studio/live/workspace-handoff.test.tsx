import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioContext, type StudioContextValue } from "../context";
import { resetSessionStores } from "./session-registry";
import {
  action,
  jsonResponse,
  minutesAfter,
  SESSION_ID,
  sessionView,
  streamPage,
} from "./testing/session-fixtures";
import { codeResult, codingAnswer } from "./testing/session-result-fixtures";
import { createTestServer } from "./testing/session-test-server";
import {
  type SessionDraftLink,
  sessionDraftArtifactId,
  sessionDraftWorkspaceId,
  useSessionDraftLink,
} from "./workspace-handoff";

const WORKSPACE = `active-session:${SESSION_ID}`;
const outcome = (artifactRevision: number) => ({
  published: true,
  workspaceId: WORKSPACE,
  artifactId: "coding:task-1",
  artifactRevision,
});
const heldOutcome = (reason: string) => ({
  published: false,
  conflict: true,
  reason,
  expectedRevision: 2,
  foundRevision: reason === "draft_removed" ? null : 3,
});
const solved = (taskId: string, workspace: unknown) => [
  action({
    taskId,
    actionKind: "draft-answer",
    result: codingAnswer(["A constraint"]),
  }),
  action({
    taskId,
    actionKind: "solve-code",
    result: codeResult({ workspace }),
  }),
];

let session = sessionView();
let actions: ReturnType<typeof action>[] = [];

function install() {
  const server = createTestServer(() => streamPage({ session, actions }));
  server.on("GET /current", () => jsonResponse({ session }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/interview/t/local/sessions"))
        return server.fetch(url, init);
      return Response.json({}, { status: 404 });
    }),
  );
}

let link: SessionDraftLink | null | undefined;
function Probe({ taskId }: { taskId?: string }) {
  link = useSessionDraftLink(session, taskId);
  return (
    <span data-testid="probe">{link ? link.target.artifactId : "none"}</span>
  );
}
const openRoute = vi.fn();
function mount(taskId?: string, withShell = true) {
  const value = {
    openRoute,
  } as unknown as StudioContextValue;
  const tree: ReactNode = <Probe {...(taskId ? { taskId } : {})} />;
  return render(
    withShell ? (
      <StudioContext.Provider value={value}>{tree}</StudioContext.Provider>
    ) : (
      tree
    ),
  );
}
const settle = () => act(() => vi.advanceTimersByTimeAsync(10));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  resetSessionStores();
  session = sessionView();
  actions = [];
  link = undefined;
  openRoute.mockReset();
  install();
});
afterEach(() => {
  resetSessionStores();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("the session draft key", () => {
  it("is the one the backend writes", () => {
    expect(sessionDraftWorkspaceId(SESSION_ID)).toBe(WORKSPACE);
    expect(sessionDraftArtifactId("task-1")).toBe("coding:task-1");
  });
});

describe("useSessionDraftLink", () => {
  it("is null until the session has a draft for the task", async () => {
    actions = [
      action({
        taskId: "task-1",
        actionKind: "draft-answer",
        result: codingAnswer(["A constraint"]),
      }),
    ];
    mount("task-1");
    await settle();
    expect(screen.getByTestId("probe")).toHaveTextContent("none");
    expect(link).toBeNull();
  });

  it("is null without a session", async () => {
    function None() {
      return (
        <span data-testid="none">{String(useSessionDraftLink(null))}</span>
      );
    }
    render(<None />);
    expect(screen.getByTestId("none")).toHaveTextContent("null");
  });

  it("names the draft the session wrote and opens it through the studio route", async () => {
    actions = solved("task-1", outcome(2));
    mount("task-1");
    await settle();
    expect(link?.target).toEqual({
      workspaceId: WORKSPACE,
      artifactId: "coding:task-1",
      artifactRevision: 2,
    });
    link?.open();
    expect(openRoute).toHaveBeenCalledWith({
      view: "work",
      artifact: "coding:task-1",
      workspace: WORKSPACE,
    });
  });

  it("still finds the draft while a newer result is held for the owner", async () => {
    actions = [
      ...solved("task-1", outcome(2)),
      action({
        taskId: "task-1",
        taskRevision: 2,
        actionKind: "solve-code",
        result: codeResult({ workspace: heldOutcome("owner_edited") }),
      }),
    ];
    mount("task-1");
    await settle();
    expect(link?.target.artifactId).toBe("coding:task-1");
  });

  it("offers nothing for a draft the owner removed", async () => {
    actions = [
      action({
        taskId: "task-1",
        actionKind: "solve-code",
        result: codeResult({ workspace: heldOutcome("draft_removed") }),
      }),
    ];
    mount("task-1");
    await settle();
    expect(link).toBeNull();
  });

  it("without a task, picks the newest task that has a draft", async () => {
    actions = [
      ...solved("task-1", outcome(2)),
      ...solved("task-2", {
        ...outcome(1),
        artifactId: "coding:task-2",
      }),
    ].map((item, index) => ({
      ...item,
      createdAt: minutesAfter(1, index),
      updatedAt: minutesAfter(1, index),
    }));
    mount();
    await settle();
    expect(link?.target.artifactId).toBe("coding:task-2");
  });

  it("opens a linked draft in the product's own workspace the ordinary way", async () => {
    session = sessionView({
      workspaceDraft: { workspaceId: "interview", artifactId: "q1" },
    });
    mount();
    await settle();
    link?.open();
    expect(openRoute).toHaveBeenCalledWith({ view: "work", artifact: "q1" });
  });

  it("writes the address when there is no shell around it", async () => {
    window.history.replaceState({}, "", "/t/local/p/interview/live");
    const onPop = vi.fn();
    window.addEventListener("popstate", onPop);
    actions = solved("task-1", outcome(2));
    mount("task-1", false);
    await settle();
    link?.open();
    window.removeEventListener("popstate", onPop);
    expect(window.location.pathname).toBe("/t/local/p/interview/work");
    expect(window.location.search).toContain(
      `workspace=${encodeURIComponent(WORKSPACE)}`,
    );
    expect(onPop).toHaveBeenCalled();
  });
});
