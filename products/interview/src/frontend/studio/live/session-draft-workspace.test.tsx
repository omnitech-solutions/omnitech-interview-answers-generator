// A session's private draft in the existing Workspace editor, through the
// whole Studio shell: the route, the editor, saves against the revision the
// owner sees, and the session's own results beside it.
import type { AssistantConfig } from "@omnitech-assistant/react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Studio } from "../studio";
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

// The editor is a textarea here; CodeMirror needs a real layout engine.
vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    value,
    onChange,
    "aria-label": label,
  }: {
    value: string;
    onChange: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <textarea
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const assistantConfig = vi.hoisted(() => ({
  current: undefined as unknown,
}));
vi.mock("@omnitech-assistant/react", () => ({
  AssistantRoot: ({
    children,
    config,
  }: {
    config: AssistantConfig;
    children: ReactNode;
  }) => {
    assistantConfig.current = config;
    return <div className="oa-root">{children}</div>;
  },
  useAssistantHost: () => ({
    open: false,
    shortcut: "⌘J",
    toggle: () => undefined,
    preview: null,
    applied: null,
  }),
  Icon: () => <svg />,
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

const WORKSPACE = `active-session:${SESSION_ID}`;
const ARTIFACT = "coding:task-1";
const DRAFT_PATH = `/api/interview/workspaces/${encodeURIComponent(WORKSPACE)}/artifacts/${encodeURIComponent(ARTIFACT)}`;
const ROUTE = `/t/local/p/interview/work?artifact=${encodeURIComponent(ARTIFACT)}&workspace=${encodeURIComponent(WORKSPACE)}`;

const assistant = {
  client: {} as never,
  workspaceId: "interview",
  profileId: "local-interview",
};

const guide = {
  version: 1,
  understand: {
    prompt: "Implement a rate limiter for a Node service.",
    examples: [],
    constraints: ["A sliding window"],
    clarify: [],
  },
  plan: {
    steps: ["Keep a window per client."],
    complexity: { time: "n/a", space: "n/a" },
  },
  edgeCases: [],
  explain: [{ heading: "How", body: "A sliding window." }],
  talkingPoints: ["Window", "Clients", "Limits"],
};
const SESSION_CODE = "export const allow = () => true;";
const value = (code = SESSION_CODE) => ({
  question: "Implement a rate limiter for a Node service.",
  notes: "",
  answer: {
    title: "Rate limiter",
    language: "typescript",
    answerMarkdown: "## Question\n\nRendered.",
    code,
    usageCode: "",
    testCode: "it('allows', () => {});",
    guide,
  },
});

// The Workspace route for the draft, with the server's revision rules.
let draft: {
  exists: boolean;
  revision: number;
  value: ReturnType<typeof value>;
  provenance: unknown;
  patchStatus: number;
};
let patches: { origin: { artifactRevision: number }; patch: unknown }[];
const sessionProvenance = (revision: number) => ({
  proposalId: `session:${SESSION_ID}`,
  draftRevision: revision,
  acceptedDraftRevision: revision,
});

let session = sessionView({ lastHeartbeatAt: minutesAfter(1) });
let actions = [] as ReturnType<typeof action>[];
let server: ReturnType<typeof createTestServer>;

function install() {
  server = createTestServer(() => streamPage({ session, actions }));
  server.on("GET /current", () => jsonResponse({ session }));
  server.on("GET /:id", () => jsonResponse({ session }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/interview/t/local/sessions"))
        return server.fetch(url, init);
      if (url === DRAFT_PATH) {
        if (!draft.exists)
          return Response.json({ code: "not-found" }, { status: 404 });
        if (method === "PATCH") {
          const body = JSON.parse(String(init?.body));
          patches.push(body);
          if (draft.patchStatus !== 200)
            return Response.json(
              { code: "revision-conflict" },
              { status: draft.patchStatus },
            );
          draft.value = { ...draft.value, ...body.patch };
          draft.revision += 1;
          // An owner edit of the answer clears the session's mark.
          draft.provenance = null;
        }
        return Response.json({
          origin: {
            workspaceId: WORKSPACE,
            artifactId: ARTIFACT,
            artifactRevision: draft.revision,
          },
          value: draft.value,
          provenance: draft.provenance,
        });
      }
      if (url === "/api/v1/syntax-check")
        return Response.json({
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: 1,
          timedOut: false,
          diagnostics: [],
        });
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

// The session's published solution for task-1 at task revision 1.
const published = () => [
  action({
    taskId: "task-1",
    taskRevision: 1,
    actionKind: "draft-answer",
    result: codingAnswer(["A sliding window"]),
  }),
  action({
    taskId: "task-1",
    taskRevision: 1,
    actionKind: "solve-code",
    result: codeResult({
      workspace: {
        published: true,
        workspaceId: WORKSPACE,
        artifactId: ARTIFACT,
        artifactRevision: 2,
      },
    }),
  }),
];
// A newer solution the session held because the owner had edited the draft.
const HELD_CODE = "export const allow = (client: string) => client !== '';";
const held = () => [
  ...published(),
  action({
    taskId: "task-1",
    taskRevision: 2,
    actionKind: "draft-answer",
    result: codingAnswer(["A sliding window", "A burst limit"]),
  }),
  action({
    taskId: "task-1",
    taskRevision: 2,
    actionKind: "solve-code",
    result: codeResult({
      code: HELD_CODE,
      states: {
        generated: true,
        testsPassed: true,
        fullyVerified: true,
        reasons: [],
      },
      workspace: {
        published: false,
        conflict: true,
        reason: "owner_edited",
        expectedRevision: 2,
        foundRevision: 3,
      },
    }),
  }),
];

async function openDraft() {
  window.history.replaceState({}, "", ROUTE);
  render(<Studio assistant={assistant} />);
  await flush();
  await flush();
}
const editor = () => screen.getByRole("textbox", { name: /^Edit / });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  resetSessionStores();
  session = sessionView({ lastHeartbeatAt: minutesAfter(1) });
  actions = published();
  draft = {
    exists: true,
    revision: 2,
    value: value(),
    provenance: sessionProvenance(2),
    patchStatus: 200,
  };
  patches = [];
  install();
});
afterEach(() => {
  resetSessionStores();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("a session draft in the Workspace", () => {
  it("opens the draft in the existing editor with where it came from", async () => {
    await openDraft();
    expect(editor()).toHaveValue(SESSION_CODE);
    const panel = screen.getByRole("region", { name: "Session draft" });
    expect(panel).toHaveTextContent(
      "Private session draft · from task rev 1 · Rehearsal",
    );
    // The session is still open: the shell's bar stays mounted.
    expect(screen.getByTestId("session-bar")).toBeVisible();
    // An unedited draft carries no edit notice.
    expect(panel).not.toHaveTextContent("You’ve edited this draft");
  });

  it("names the session's Workspace to the assistant", async () => {
    await openDraft();
    const config = assistantConfig.current as AssistantConfig;
    expect(config.origin).toEqual({
      workspaceId: WORKSPACE,
      artifactId: ARTIFACT,
      artifactRevision: 2,
    });
  });

  it("keeps generated, tests passed and fully verified distinct", async () => {
    await openDraft();
    const states = within(
      screen.getByRole("list", { name: "Verification states" }),
    );
    const row = (key: string) =>
      document.querySelector(`[data-state="${key}"]`) as HTMLElement;
    expect(row("generated")).toHaveTextContent("Generated");
    expect(row("tests-passed")).toHaveTextContent("Tests passed");
    expect(row("tests-passed")).toHaveTextContent("5 of 5");
    // Tests passed, yet not fully verified: a constraint has no test of its own.
    expect(row("fully-verified")).toHaveTextContent("Not fully verified");
    expect(row("fully-verified")).toHaveTextContent(
      "A stated constraint has no test of its own.",
    );
    expect(row("fully-verified")).toHaveClass("off");
    expect(row("tests-passed")).toHaveClass("on");
    expect(states.getAllByRole("listitem")).toHaveLength(3);
  });

  it("lists the generated tests and states the runner only when it ran", async () => {
    await openDraft();
    const tests = screen.getByRole("list", { name: "Generated tests" });
    expect(within(tests).getByText("allows")).toBeVisible();
    expect(screen.getByText("GENERATED TESTS")).toBeVisible();
    expect(
      screen.getByText(/Tests ran in the code-runner container: no network/),
    ).toBeVisible();
  });

  it("does not claim a runner when the tests did not run", async () => {
    actions = [
      published()[0] as (typeof actions)[number],
      action({
        taskId: "task-1",
        taskRevision: 1,
        actionKind: "solve-code",
        result: codeResult({
          run: {
            available: false,
            exitCode: null,
            timedOut: false,
            durationMs: null,
          },
          tests: { total: 0, passed: 0, failed: 0, skipped: 0, results: [] },
          states: {
            generated: true,
            testsPassed: false,
            fullyVerified: false,
            reasons: ["runner_unavailable"],
          },
        }),
      }),
    ];
    await openDraft();
    expect(screen.queryByText(/Ran in the code-runner/)).toBeNull();
    expect(
      screen.getAllByText("The test runner was not available, so no tests ran.")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Tests not passed")).toBeVisible();
  });

  it("shows the session's work on the task as run chips", async () => {
    actions = [
      ...published(),
      action({
        taskId: "task-1",
        taskRevision: 1,
        actionKind: "agent-solve",
        dispatchStatus: "in_flight",
        result: null,
      }),
    ];
    await openDraft();
    const work = screen.getByRole("status", { name: "Session work" });
    expect(work).toHaveTextContent("Coding draft · Published");
    expect(work).toHaveTextContent("Agent job · Working");
  });

  it("saves an edit against the revision the owner sees and then says it was edited", async () => {
    await openDraft();
    fireEvent.change(editor(), { target: { value: "export const mine = 1;" } });
    await advance(900);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.origin).toEqual({
      workspaceId: WORKSPACE,
      artifactId: ARTIFACT,
      artifactRevision: 2,
    });
    expect(
      screen.getByText(
        "You’ve edited this draft. Any later AI result will be offered as a suggestion, not applied.",
      ),
    ).toBeVisible();
    // The results are the session's version, and the panel says so.
    expect(
      screen.getByText(/describe the session’s version, not your edits/),
    ).toBeVisible();
  });

  it("says a draft whose revision moved is edited even with its mark kept", async () => {
    // A notes or stage edit keeps the mark but moves the draft revision.
    draft.provenance = {
      ...sessionProvenance(2),
      draftRevision: 3,
    };
    draft.revision = 3;
    await openDraft();
    expect(screen.getByText(/You’ve edited this draft/)).toBeVisible();
  });

  it("shows a refused save as the Workspace's own conflict state", async () => {
    draft.patchStatus = 409;
    await openDraft();
    fireEvent.change(editor(), { target: { value: "export const mine = 1;" } });
    await advance(900);
    expect(screen.getByText("Changed elsewhere")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reload" })).toBeVisible();
  });

  it("explains an empty draft and never starts one", async () => {
    draft.exists = false;
    actions = [];
    await openDraft();
    expect(screen.getByText("No session draft yet")).toBeVisible();
    expect(
      screen.getByText(
        "When the session finds a coding task, it creates a private draft here and runs the tests. Your own edits are never overwritten.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /^Edit / })).toBeNull();
    expect(patches).toHaveLength(0);
  });

  it("does not say a purged session's draft will be created", async () => {
    draft.exists = false;
    actions = [];
    session = sessionView({
      status: "ended",
      purged: true,
      endedAt: minutesAfter(5),
    });
    await openDraft();
    expect(screen.queryByText(/it creates a private draft here/)).toBeNull();
    expect(
      screen.getByText(/deleted with the session|was deleted/i),
    ).toBeVisible();
  });

  it("shows the draft when the session writes it while this is open", async () => {
    draft.exists = false;
    actions = [];
    await openDraft();
    expect(screen.getByText("No session draft yet")).toBeVisible();
    draft.exists = true;
    actions = published();
    await advance(1500);
    expect(editor()).toHaveValue(SESSION_CODE);
  });

  it("goes back to the session", async () => {
    await openDraft();
    fireEvent.click(screen.getByRole("button", { name: "Back to session" }));
    expect(window.location.pathname).toBe(
      `/t/local/p/interview/live/${SESSION_ID}`,
    );
    expect(window.location.search).toBe("");
  });

  it("opens the product's own Workspace, not the draft's artifact, from the sidebar", async () => {
    await openDraft();
    fireEvent.click(screen.getByTitle("Workspace"));
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/t/local/p/interview/work");
    const config = assistantConfig.current as AssistantConfig;
    expect(config.origin.workspaceId).not.toBe(WORKSPACE);
  });
});

describe("a held session result", () => {
  beforeEach(() => {
    actions = held();
    // The owner edited the draft: revision 3, mark cleared.
    draft.revision = 3;
    draft.value = value("export const mine = 1;");
    draft.provenance = null;
  });

  it("is offered as a suggestion, not applied", async () => {
    await openDraft();
    const offer = screen.getByRole("region", { name: "Suggested solution" });
    expect(offer).toHaveTextContent("Suggested solution · task rev 2");
    expect(offer).toHaveTextContent("it was not applied");
    // The owner's code is untouched.
    expect(editor()).toHaveValue("export const mine = 1;");
    expect(patches).toHaveLength(0);
  });

  it("applies against the revision the owner sees", async () => {
    await openDraft();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await flush();
    await flush();
    expect(patches).toHaveLength(1);
    expect(patches[0]?.origin.artifactRevision).toBe(3);
    expect(
      (patches[0]!.patch as { answer: { code: string } }).answer.code,
    ).toBe(HELD_CODE);
    expect(editor()).toHaveValue(HELD_CODE);
    expect(screen.getByText(/Suggestion applied/)).toBeVisible();
  });

  it("shows a stale draft as a refresh message and changes nothing", async () => {
    draft.patchStatus = 409;
    await openDraft();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await flush();
    await flush();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "This draft changed since you last loaded it",
    );
    expect(alert).toHaveTextContent("review the suggestion again");
    expect(editor()).toHaveValue("export const mine = 1;");
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("can be dismissed, and stays dismissed", async () => {
    await openDraft();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(
      screen.queryByRole("region", { name: "Suggested solution" }),
    ).toBeNull();
    // The draft is untouched.
    expect(patches).toHaveLength(0);
    expect(editor()).toHaveValue("export const mine = 1;");
  });

  it("keeps the suggestion's own states apart from the draft's", async () => {
    await openDraft();
    const offer = screen.getByRole("region", { name: "Suggested solution" });
    fireEvent.click(
      within(offer).getByText("Review the changes and its results"),
    );
    // The suggestion is fully verified; the draft's own result is not.
    expect(
      within(offer).getByText("Fully verified", {
        selector: ".sd-state-label",
      }),
    ).toBeVisible();
    expect(
      within(
        screen.getByRole("region", { name: "Session draft" }),
      ).getAllByText("Not fully verified").length,
    ).toBeGreaterThan(0);
  });
});
