import type { LiveSessionSummary } from "@omnitech/interview-contracts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioActions } from "../config/commands";
import { LiveSessionView } from "./live-view";
import {
  action,
  jsonResponse,
  minutesAfter,
  SESSION_ID,
  sessionView,
  streamPage,
  transcript,
} from "./session-fixtures";
import { getSessionStore, resetSessionStores } from "./session-registry";
import {
  answerResult,
  codeResult,
  codingAnswer,
} from "./session-result-fixtures";
import { createTestServer } from "./session-test-server";

// The Workspace hand-off is another unit's file: the ended view only asks it
// for a link, so the link is scripted here.
const draftLink = vi.hoisted(() => ({
  current: null as null | {
    target: { workspaceId: string; artifactId: string };
    open: () => void;
  },
}));
vi.mock("./workspace-handoff", () => ({
  useSessionDraftLink: () => draftLink.current,
}));

const ENDED_KEY = "interview-studio.live.ended-session.local";
const studio = {
  go: vi.fn(),
  openArtifact: vi.fn(),
} as unknown as StudioActions;

let server: ReturnType<typeof createTestServer>;
let session = sessionView();
let page = streamPage();

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

function ended(overrides: Parameters<typeof sessionView>[0] = {}) {
  return sessionView({
    status: "ended",
    endedAt: minutesAfter(5),
    ...overrides,
  });
}

// Mounts the Live view for a finished session this tab remembers (or, with
// `address`, addresses it as live/<id>).
async function mount(
  finished: ReturnType<typeof sessionView>,
  content: Parameters<typeof streamPage>[0] = {},
  address?: string,
) {
  session = finished;
  page = streamPage({ session: finished, ...content });
  window.history.replaceState({}, "", "/t/local/p/interview/live");
  if (!address) sessionStorage.setItem(ENDED_KEY, finished.id);
  render(<LiveSessionView rest={address ? [address] : []} studio={studio} />);
  await flush();
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(10)));
  resetSessionStores();
  sessionStorage.clear();
  draftLink.current = null;
  vi.mocked(studio.go).mockClear();
  server = createTestServer(() => page);
  server.on("GET /current", () =>
    jsonResponse({ error: { code: "not_found" } }, 404),
  );
  server.on("GET /:id", () => jsonResponse({ session }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      server.fetch(String(input), init),
    ),
  );
});
afterEach(() => {
  resetSessionStores();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const answerAction = (overrides = {}) =>
  action({
    taskId: "task-a",
    actionKind: "draft-answer",
    result: answerResult(),
    ...overrides,
  });
const codingActions = (code: Record<string, unknown> | null = codeResult()) => [
  action({
    taskId: "task-c",
    actionKind: "draft-answer",
    result: codingAnswer(["O(1) per call"]),
  }),
  ...(code
    ? [action({ taskId: "task-c", actionKind: "solve-code", result: code })]
    : []),
];

describe("the ended view: header and results", () => {
  it("says what happened, with the server-clock duration and no overclaim", async () => {
    await mount(ended());
    const view = screen.getByTestId("live-ended");
    expect(view).toHaveTextContent("Session ended · 5:00");
    expect(view).toHaveTextContent(
      "Studio no longer accepts capture, and any result that arrives now is discarded. Nothing was submitted or sent for you.",
    );
    expect(view).toHaveTextContent("No interview linked");
  });

  it("moves focus to the heading when the bar goes away, so it does not fall to the page", async () => {
    await mount(ended());
    expect(
      screen.getByRole("heading", { name: /Session ended/ }),
    ).toHaveFocus();
  });

  it("lists answer drafts by claim kind and the coding draft by its three states", async () => {
    draftLink.current = {
      target: {
        workspaceId: `active-session:${SESSION_ID}`,
        artifactId: "coding:task-c",
      },
      open: vi.fn(),
    };
    await mount(
      ended({
        workspaceDraft: {
          workspaceId: `active-session:${SESSION_ID}`,
          artifactId: "coding:task-c",
        },
      }),
      {
        actions: [answerAction(), ...codingActions()],
        observations: [transcript(1, "Tell me about a migration.")],
      },
    );
    const [answer] = screen.getAllByTestId("ended-answer");
    expect(answer).toHaveTextContent(
      "1 matrix-backed · 1 interpretation · 1 general knowledge",
    );
    // generated / tests passed / fully verified are said separately.
    expect(screen.getByTestId("ended-coding")).toHaveTextContent(
      "5 of 5 generated tests passed · not fully verified",
    );
    expect(screen.getByTestId("ended-stats")).toHaveTextContent("Utterances1");
    fireEvent.click(
      screen.getByRole("button", { name: "Open Workspace draft" }),
    );
    expect(draftLink.current?.open).toHaveBeenCalledTimes(1);
  });

  it("says fully verified only when the code states say so", async () => {
    await mount(ended(), {
      actions: codingActions(
        codeResult({
          states: {
            generated: true,
            testsPassed: true,
            fullyVerified: true,
            reasons: [],
          },
        }),
      ),
    });
    expect(screen.getByTestId("ended-coding")).toHaveTextContent(
      "5 of 5 generated tests passed · fully verified",
    );
    expect(screen.getByTestId("ended-coding")).not.toHaveTextContent(
      "not fully verified",
    );
  });

  it("does not claim passing tests that did not pass", async () => {
    await mount(ended(), {
      actions: codingActions(
        codeResult({
          states: {
            generated: true,
            testsPassed: false,
            fullyVerified: false,
            reasons: [],
          },
          tests: { total: 5, passed: 3, failed: 2, skipped: 0, results: [] },
        }),
      ),
    });
    expect(screen.getByTestId("ended-coding")).toHaveTextContent(
      "3 of 5 generated tests passed · not fully verified",
    );
  });

  it("says the session ended before a draft was ready, with nothing to open", async () => {
    draftLink.current = null;
    await mount(ended(), { actions: codingActions(null) });
    const row = screen.getByTestId("ended-coding");
    expect(row).toHaveTextContent("Ended before a draft was ready");
    expect(
      screen.queryByRole("button", { name: /^Open Workspace/ }),
    ).toBeNull();
  });

  it("states that nothing was promoted, even with no drafts at all", async () => {
    await mount(ended());
    expect(screen.getByTestId("ended-no-results")).toBeVisible();
    expect(screen.getByTestId("ended-no-promotion")).toHaveTextContent(
      "The session added nothing to your matrix or exercise catalogue",
    );
    expect(screen.getByTestId("ended-no-promotion")).not.toHaveTextContent(
      "promote or export",
    );
  });

  it("shows a withheld draft with the content-free count, and tolerates its absence", async () => {
    const withheld = (result: unknown) =>
      action({
        taskId: "task-w",
        actionKind: "draft-answer",
        dispatchStatus: "suppressed",
        suppressionReason: "invalid_output",
        result,
      });
    await mount(ended(), {
      actions: [withheld({ withheld: { rejectedClaimCount: 2, codes: [] } })],
    });
    expect(screen.getByTestId("ended-withheld")).toHaveTextContent(
      "1 answer draft was withheld · 2 claims failed checking",
    );
  });

  it("shows a withheld draft without a count when the server recorded none", async () => {
    await mount(ended(), {
      actions: [
        action({
          taskId: "task-w",
          dispatchStatus: "suppressed",
          suppressionReason: "invalid_output",
        }),
      ],
    });
    const notice = screen.getByTestId("ended-withheld");
    expect(notice).toHaveTextContent("1 answer draft was withheld");
    expect(notice).not.toHaveTextContent("failed checking");
  });

  it("renders a draft as inert text and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const hostile = "<img src=x onerror=alert(1)> and [a link](http://x.test)";
    await mount(ended(), {
      actions: [answerAction({ result: answerResult({ draft: hostile }) })],
    });
    const row = screen.getByTestId("ended-answer");
    expect(row.querySelector("img, a")).toBeNull();
    expect(row).toHaveTextContent(hostile);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy Experience answer 1" }),
      );
    });
    expect(writeText).toHaveBeenCalledWith(hostile);
  });

  it("names the target from the setup choices", async () => {
    const candidacyId = "11111111-1111-4111-8111-111111111111";
    const interviewId = "22222222-2222-4222-8222-222222222222";
    server.on("GET /choices", () =>
      jsonResponse({
        candidacies: [
          {
            id: candidacyId,
            title: "Senior Engineer",
            companyName: "Example Corp",
            createdAt: minutesAfter(0),
            interviews: [
              {
                id: interviewId,
                label: "Technical round",
                kind: "technical",
                scheduledAt: null,
              },
            ],
          },
        ],
        profiles: [],
      }),
    );
    await mount(ended({ candidacyId, interviewId }));
    expect(screen.getByTestId("live-ended")).toHaveTextContent(
      "Senior Engineer · Technical round",
    );
  });
});

describe("the ended view: rehearsal hints", () => {
  it("counts hints for a non-strict rehearsal", async () => {
    await mount(
      ended({ rehearsalRunId: "run-1", strict: false, shownDraftCount: 2 }),
    );
    expect(screen.getByTestId("live-ended")).toHaveTextContent("Rehearsal");
    expect(screen.getByTestId("ended-stats")).toHaveTextContent(
      "Hints counted2",
    );
  });

  it("says a strict rehearsal had assistance off and counts no hints", async () => {
    await mount(ended({ rehearsalRunId: "run-1", strict: true }));
    expect(screen.getByTestId("ended-stats")).not.toHaveTextContent(
      "Hints counted",
    );
    expect(screen.getByTestId("live-ended")).toHaveTextContent(
      "Strict rehearsal: live assistance was off",
    );
  });

  it("shows no hint stat for an interview", async () => {
    await mount(ended());
    expect(screen.getByTestId("ended-stats")).not.toHaveTextContent("Hints");
  });
});

describe("retention", () => {
  it("explains delete at end", async () => {
    await mount(ended({ retention: "delete-at-end" }));
    expect(screen.getByTestId("ended-retention")).toHaveTextContent(
      "Delete at end · Session records are deleted shortly after the session ends, when the worker’s purge runs. Some Workspace drafts may remain.",
    );
    expect(screen.getByTestId("ended-retention")).toHaveTextContent(
      "Raw audio is never stored.",
    );
  });

  it("explains thirty days with the date, thirty days after the end", async () => {
    await mount(ended({ retention: "thirty-days" }));
    expect(screen.getByTestId("ended-retention")).toHaveTextContent(
      "30 days · Session records are kept until 2 Nov 2026 (UTC), then deleted. Some Workspace drafts may remain.",
    );
  });

  it("explains until deleted", async () => {
    await mount(ended({ retention: "until-deleted" }));
    expect(screen.getByTestId("ended-retention")).toHaveTextContent(
      "Until I delete · Session records are kept until you delete them. Some Workspace drafts may remain.",
    );
  });

  it("offers only shorter options, and none for delete at end", async () => {
    await mount(ended({ retention: "until-deleted" }));
    const group = screen.getByRole("group", { name: "Shorten retention" });
    const button = (name: string) =>
      screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button("Delete at end").disabled).toBe(false);
    expect(button("30 days").disabled).toBe(false);
    expect(button("Until I delete").disabled).toBe(true);
    expect(group).toBeVisible();
  });

  it("disables the current and longer options for thirty days, and shortens", async () => {
    await mount(ended({ retention: "thirty-days" }));
    const button = (name: string) =>
      screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button("30 days").disabled).toBe(true);
    expect(button("Until I delete").disabled).toBe(true);
    server.on("POST /:id/retention", ({ body }) => {
      expect(body).toEqual({ retention: "delete-at-end" });
      session = ended({ retention: "delete-at-end" });
      return jsonResponse({ session });
    });
    fireEvent.click(button("Delete at end"));
    await flush();
    expect(server.count("POST /:id/retention")).toBe(1);
    expect(screen.getByTestId("ended-retention")).toHaveTextContent(
      "Delete at end · Session records are deleted",
    );
    expect(
      screen.queryByRole("group", { name: "Shorten retention" }),
    ).toBeNull();
  });

  it("shows a fixed message when the server refuses lengthening", async () => {
    await mount(ended({ retention: "until-deleted" }));
    server.on("POST /:id/retention", () =>
      jsonResponse({ error: { code: "retention_lengthening_refused" } }, 409),
    );
    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Retention can only be shortened.",
    );
  });
});

describe("deleting session data", () => {
  const withContent = {
    actions: [answerAction()],
    observations: [transcript(1, "Tell me about a migration.")],
  };

  it("asks first, and cancelling deletes nothing", async () => {
    await mount(ended(), withContent);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete session data" }),
    );
    const confirm = screen.getByRole("group", {
      name: "Confirm deleting session data",
    });
    expect(confirm).toHaveTextContent("can’t be undone");
    expect(confirm).toHaveTextContent(
      "Edited drafts and drafts used by an answer revision or revert can remain in Workspace",
    );
    expect(confirm).toHaveTextContent(
      "They may contain captured questions and generated answers or code",
    );
    expect(confirm).toHaveTextContent(
      "Copies in backups remain until they rotate",
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep session data" }));
    expect(server.count("DELETE /:id")).toBe(0);
    expect(screen.queryByRole("group", { name: /Confirm/ })).toBeNull();
    expect(screen.getByTestId("ended-answer")).toBeVisible();
  });

  it("shows progress, then Deleted, and keeps no content in the browser", async () => {
    await mount(ended(), withContent);
    expect(getSessionStore("local").getSnapshot().actions).toHaveLength(1);
    server.on("DELETE /:id", () => {
      session = ended({ status: "purging" });
      return jsonResponse({ session }, 202);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Delete session data" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await flush();
    expect(screen.getByText("Deleting…")).toBeVisible();
    expect(screen.getByTestId("ended-tombstone")).toHaveTextContent(
      "Deleting session data",
    );
    // No transcript, answer or stats remain in the store or on screen.
    const held = getSessionStore("local").getSnapshot();
    expect(held.observations).toHaveLength(0);
    expect(held.actions).toHaveLength(0);
    expect(screen.queryByTestId("ended-answer")).toBeNull();
    expect(screen.queryByTestId("ended-stats")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Delete session data" }),
    ).toBeNull();

    session = ended({ purged: true, purgeOutcome: "complete" });
    await advance(3_000);
    expect(screen.getByTestId("ended-tombstone")).toHaveTextContent(
      "Session data deleted",
    );
    expect(screen.getByTestId("ended-retention")).toHaveTextContent("Deleted");
  });

  it("shows purge_incomplete with a retry that deletes again", async () => {
    await mount(ended(), withContent);
    server.on("DELETE /:id", () =>
      jsonResponse({ error: { code: "purge_incomplete" } }, 500),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete session data" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Deletion did not finish",
    );
    // Nothing was deleted, so the results are still here.
    expect(screen.getByTestId("ended-answer")).toBeVisible();

    server.on("DELETE /:id", () => {
      session = ended({ status: "purging" });
      return jsonResponse({ session }, 202);
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry deletion" }));
    await flush();
    expect(server.count("DELETE /:id")).toBe(2);
    expect(screen.getByText("Deleting…")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows other failures as a fixed sentence", async () => {
    await mount(ended(), withContent);
    server.on("DELETE /:id", () => {
      throw new TypeError("offline");
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Delete session data" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Studio couldn’t delete the session data.",
    );
  });
});

describe("a deleted session", () => {
  it("shows only the tombstone's content-free facts", async () => {
    await mount(
      ended({
        purged: true,
        purgeOutcome: "complete",
        rehearsalRunId: "run-1",
        strict: false,
        shownDraftCount: 3,
      }),
    );
    const tomb = screen.getByTestId("ended-tombstone");
    expect(tomb).toHaveTextContent("Session data deleted");
    expect(tomb).toHaveTextContent(
      "Edited drafts and drafts used by an answer revision or revert can remain in Workspace",
    );
    expect(tomb).toHaveTextContent("Hints counted3");
    expect(tomb).toHaveTextContent("3 Oct 2026, 12:00 UTC");
    expect(tomb).toHaveTextContent("3 Oct 2026, 12:05 UTC");
    expect(screen.queryByTestId("ended-stats")).toBeNull();
    expect(screen.queryByTestId("ended-answer")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Delete session data" }),
    ).toBeNull();
    expect(screen.getByTestId("ended-retention")).toHaveTextContent("Deleted");
  });

  it("opens a deleted session by its address", async () => {
    server.on("GET /:id", () =>
      jsonResponse({
        session: ended({ purged: true, purgeOutcome: "complete" }),
      }),
    );
    await mount(
      ended({ purged: true, purgeOutcome: "complete" }),
      {},
      SESSION_ID,
    );
    expect(screen.getByTestId("ended-tombstone")).toHaveTextContent(
      "Session data deleted",
    );
  });
});

describe("starting another session", () => {
  it("forgets the finished session and goes to the Live view", async () => {
    await mount(ended());
    fireEvent.click(
      screen.getByRole("button", { name: "Start another session" }),
    );
    expect(studio.go).toHaveBeenCalledWith("live");
    expect(getSessionStore("local").getSnapshot().session).toBeNull();
    expect(sessionStorage.getItem(ENDED_KEY)).toBeNull();
  });
});

describe("a session that is not there", () => {
  it("says so, and offers to start a session", async () => {
    server.on("GET /:id", () =>
      jsonResponse({ error: { code: "not_found" } }, 404),
    );
    session = ended();
    window.history.replaceState({}, "", "/t/local/p/interview/live/missing");
    render(<LiveSessionView rest={["missing"]} studio={studio} />);
    await flush();
    await flush();
    expect(screen.getByTestId("live-not-found")).toHaveTextContent(
      "Session not found",
    );
    fireEvent.click(screen.getByRole("button", { name: "Start a session" }));
    expect(studio.go).toHaveBeenCalledWith("live");
  });
});

describe("session history", () => {
  const summary = (n: number, overrides: Partial<LiveSessionSummary> = {}) => ({
    id: `00000000-0000-4000-8000-00000000010${n}`,
    status: "ended" as const,
    retention: "thirty-days" as const,
    processingPolicy: "device-only" as const,
    createdAt: minutesAfter(-60 * n),
    endedAt: minutesAfter(-60 * n + 5),
    purged: false,
    interviewId: null,
    candidacyId: null,
    rehearsal: false,
    shownDraftCount: 0,
    ...overrides,
  });

  it("lists summaries, pages by cursor and opens one by id", async () => {
    await mount(ended());
    server.on("GET /", ({ url }) =>
      url.searchParams.get("cursor") === "next-1"
        ? jsonResponse({ sessions: [summary(3)], nextCursor: null })
        : jsonResponse({
            sessions: [
              summary(1, { rehearsal: true }),
              summary(2, { purged: true }),
            ],
            nextCursor: "next-1",
          }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open session history" }),
    );
    await flush();
    const list = screen.getByTestId("session-history");
    expect(list).toHaveTextContent("Rehearsal");
    expect(list).toHaveTextContent("Deleted");
    expect(list).toHaveTextContent("30 days");
    expect(list.querySelectorAll("li")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await flush();
    expect(list.querySelectorAll("li")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

    fireEvent.click(
      screen.getAllByRole("button", {
        name: /^Open .* session/,
      })[2] as HTMLElement,
    );
    expect(studio.go).toHaveBeenCalledWith("live", [summary(3).id]);
  });

  it("says when there are no past sessions, and retries a failed load", async () => {
    await mount(ended());
    server.on("GET /", () => {
      throw new TypeError("offline");
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open session history" }),
    );
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("couldn’t load");
    server.on("GET /", () => jsonResponse({ sessions: [], nextCursor: null }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    expect(screen.getByTestId("session-history")).toHaveTextContent(
      "No past sessions yet.",
    );
  });
});
