// The live session body: programming challenges, earlier tasks and announcements.
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftLink } from "./testing/live-draft-link";
import { answerAction, show } from "./testing/live-view-kit";
import { action, minutesAfter } from "./testing/session-fixtures";
import {
  answerResult,
  codeResult,
  codingAnswer,
} from "./testing/session-result-fixtures";

const openCode = () =>
  fireEvent.click(screen.getByRole("tab", { name: "Code" }));
const stage = (id: string) =>
  screen
    .getByLabelText("Stages")
    .querySelector(`[data-stage="${id}"]`) as HTMLElement;

vi.mock("./workspace-handoff", async () => {
  const kit = await import("./testing/live-draft-link");
  return { useSessionDraftLink: () => kit.draftLink.current };
});

beforeEach(() => {
  draftLink.current = null;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("programming challenge", () => {
  const coding = (constraints: string[], revision = 1, overrides = {}) =>
    answerAction(codingAnswer(constraints), {
      taskRevision: revision,
      ...overrides,
    });
  const solve = (result: unknown, revision = 1, overrides = {}) =>
    action({
      actionKind: "solve-code",
      taskRevision: revision,
      result,
      ...overrides,
    });

  it("words a withheld solution as a failed structure check, not an experience check", () => {
    show({
      actions: [
        coding(["Single thread"], 1),
        solve(null, 1, {
          dispatchStatus: "suppressed",
          suppressionReason: "invalid_output",
          createdAt: minutesAfter(1, 20),
          updatedAt: minutesAfter(1, 21),
        }),
      ],
    });
    const notice = screen.getByTestId("run-notice");
    expect(notice).toHaveTextContent("Solution withheld");
    expect(notice).toHaveTextContent(
      "did not pass its checks (language, tests and constraint coverage)",
    );
    expect(notice).not.toHaveTextContent(/approved experience/);
  });

  it("shows the title, constraints across revisions and the revision", () => {
    show({
      actions: [
        coding(["Single thread"], 1),
        coding(["Single thread", "O(1) per call"], 2, {
          createdAt: minutesAfter(1, 20),
          updatedAt: minutesAfter(1, 21),
        }),
        coding(["O(1) per call"], 3, {
          createdAt: minutesAfter(1, 40),
          updatedAt: minutesAfter(1, 41),
        }),
      ],
    });
    expect(screen.getByTestId("task-panel")).toHaveAttribute(
      "data-kind",
      "programming-challenge",
    );
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: /Implement a rate limiter/,
      }),
    ).toBeVisible();
    expect(screen.getByText("T1 · rev 3 of 3")).toBeVisible();
    const old = screen.getByText("Single thread").closest("li");
    expect(old).toHaveClass("old");
    expect(old).toHaveTextContent("replaced at rev 3");
    expect(screen.getByText("O(1) per call").closest("li")).not.toHaveClass(
      "old",
    );
  });

  it("says no constraint has been stated yet", () => {
    show({ actions: [coding([], 1)] });
    expect(screen.getByText("None stated yet")).toBeVisible();
  });

  it("keeps generated, tests passed and fully verified distinct", () => {
    show({
      actions: [coding(["a"]), solve(codeResult())],
    });
    // The Fully verified tile says nothing is established, with the server's reason.
    expect(stage("verified")).toHaveAttribute("data-state", "not-established");
    expect(stage("verified")).toHaveTextContent("Not established");
    expect(stage("verified")).toHaveTextContent(
      "A stated constraint has no test of its own.",
    );
    expect(stage("code")).toHaveAttribute("data-state", "done");
    openCode();
    const badge = (id: string) =>
      screen
        .getByLabelText("What is established")
        .querySelector(`[data-badge="${id}"]`);
    expect(badge("generated")).toHaveAttribute("data-ok", "true");
    expect(badge("tests")).toHaveAttribute("data-ok", "true");
    expect(badge("tests")).toHaveTextContent("5/5 generated tests");
    expect(badge("verified")).toHaveAttribute("data-ok", "false");
    expect(badge("verified")).toHaveTextContent("Not fully verified");
  });

  it("claims verified only when the server says so", () => {
    show({
      actions: [
        coding(["a"]),
        solve(
          codeResult({
            states: {
              generated: true,
              testsPassed: true,
              fullyVerified: true,
              reasons: [],
            },
          }),
        ),
      ],
    });
    expect(stage("verified")).toHaveAttribute("data-state", "done");
    openCode();
    expect(
      screen
        .getByLabelText("What is established")
        .querySelector('[data-badge="verified"]'),
    ).toHaveTextContent("Fully verified");
  });

  it("shows a running solution as running and nothing as established", () => {
    show({
      actions: [coding(["a"]), solve(null, 1, { dispatchStatus: "in_flight" })],
    });
    expect(stage("code")).toHaveAttribute("data-state", "running");
    expect(stage("verified")).toHaveAttribute("data-state", "not-established");
    openCode();
    expect(screen.queryByLabelText("What is established")).toBeNull();
  });

  it("shows a finished answer as done", () => {
    show({
      session: { processingPolicy: "permitted-remote" },
      actions: [coding(["a"])],
    });
    expect(stage("answer")).toHaveAttribute("data-state", "done");
    expect(stage("code")).toHaveAttribute("data-state", "waiting");
  });

  it("says the code stage is unavailable in a device-only session, with the reason", () => {
    show({
      session: { processingPolicy: "device-only" },
      actions: [coding(["a"])],
    });
    expect(stage("code")).toHaveAttribute("data-state", "unavailable");
    expect(stage("code")).toHaveTextContent("Device-only mode");
    expect(stage("verified")).toHaveAttribute("data-state", "unavailable");
  });

  it("switches between the Answer and Code tabs", () => {
    show({ actions: [coding(["a"]), solve(codeResult())] });
    expect(screen.getByRole("tab", { name: "Answer" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // The answer tab holds the model's restatement and suggested answer.
    expect(
      screen.getByText("Implement a rate limiter for a Node service.", {
        selector: "p",
      }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Code canvas")).toBeNull();
    openCode();
    expect(screen.getByLabelText("Code canvas")).toBeVisible();
    expect(screen.queryByText("Suggested answer")).toBeNull();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Code" }), {
      key: "ArrowLeft",
    });
    expect(screen.getByRole("tab", { name: "Answer" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("names the model, and says general knowledge when no claim is grounded", () => {
    show({
      actions: [
        coding(["a"], 1, {
          generatedBy: { runtime: "claude-code", model: "sonnet" },
        }),
      ],
    });
    expect(screen.getByTestId("model-line")).toHaveTextContent(
      "Claude · sonnet",
    );
    expect(screen.getByTestId("model-line")).toHaveTextContent(
      "General knowledge, not a claim about you.",
    );
  });

  it("offers the Workspace draft with the test count only when it was written", () => {
    draftLink.current = { target: {}, open: vi.fn() };
    show({ actions: [coding(["a"]), solve(codeResult())] });
    openCode();
    expect(screen.getByText("Draft ready · 5/5 tests")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Open in Workspace" }));
    expect(draftLink.current?.open).toHaveBeenCalled();
  });

  it("does not say a draft is ready when none was written", () => {
    show({
      actions: [
        coding(["a"]),
        solve(
          codeResult({
            workspace: {
              published: false,
              conflict: true,
              reason: "edited",
              expectedRevision: 1,
              foundRevision: 2,
            },
          }),
        ),
      ],
    });
    openCode();
    expect(screen.queryByText(/Draft ready/)).toBeNull();
  });

  it("keeps the owner's edits when a result is held", () => {
    show({
      actions: [
        coding(["a"]),
        solve(
          codeResult({
            workspace: {
              published: false,
              conflict: true,
              reason: "edited",
              expectedRevision: 1,
              foundRevision: 2,
            },
          }),
        ),
      ],
    });
    openCode();
    expect(screen.getByTestId("held-result")).toHaveTextContent(
      "Your edits are kept; the new result is offered as a suggestion in Workspace.",
    );
  });

  it("keeps the written draft's states and chip when a later result is held, and labels the held one as a suggestion", () => {
    const held = {
      published: false,
      conflict: true,
      reason: "edited",
      expectedRevision: 1,
      foundRevision: 2,
    };
    const written = codeResult({
      states: {
        generated: true,
        testsPassed: false,
        fullyVerified: false,
        reasons: [],
      },
      tests: { total: 5, passed: 2, failed: 3, skipped: 0, results: [] },
      workspace: {
        published: true,
        workspaceId: "w1",
        artifactId: "coding:task-1",
        artifactRevision: 1,
      },
    });
    show({
      actions: [
        coding(["a"], 1),
        solve(written, 1, {
          createdAt: minutesAfter(1, 5),
          updatedAt: minutesAfter(1, 6),
        }),
        coding(["a"], 2, {
          createdAt: minutesAfter(1, 20),
          updatedAt: minutesAfter(1, 21),
        }),
        solve(codeResult({ workspace: held }), 2, {
          createdAt: minutesAfter(1, 22),
          updatedAt: minutesAfter(1, 23),
        }),
      ],
    });
    openCode();
    // The badges and the chip describe what the draft holds (rev 1: 2/5).
    const status = screen.getAllByLabelText(
      "What is established",
    )[0] as HTMLElement;
    expect(status.querySelector('[data-badge="tests"]')).toHaveAttribute(
      "data-ok",
      "false",
    );
    expect(status).toHaveTextContent("2/5 generated tests");
    expect(screen.getByText("3 failed")).toBeVisible();
    expect(screen.getByText("Draft ready · 2/5 tests")).toBeVisible();
    // The held result is the suggestion's, labelled as such.
    const suggestion = screen.getByRole("region", {
      name: "Suggestion not written to your draft",
    });
    expect(within(suggestion).getByText("5/5 generated tests")).toBeVisible();
  });

  it("shows a late result for an outdated revision as discarded", () => {
    show({
      actions: [
        coding(["a"], 1),
        solve(null, 1, {
          dispatchStatus: "suppressed",
          suppressionReason: "revision_stale",
        }),
        coding(["a", "b"], 2, {
          createdAt: minutesAfter(1, 30),
          updatedAt: minutesAfter(1, 31),
        }),
      ],
    });
    const notice = screen
      .getByText(/Discarded · task rev 1/)
      .closest("[data-testid]") as HTMLElement;
    expect(notice).toHaveTextContent(
      "Results for an outdated task revision are never published.",
    );
  });

  it("marks a solution for an earlier revision as outdated", () => {
    show({
      actions: [
        coding(["a"], 1),
        solve(codeResult(), 1),
        coding(["a", "b"], 2, {
          createdAt: minutesAfter(1, 30),
          updatedAt: minutesAfter(1, 31),
        }),
      ],
    });
    openCode();
    expect(screen.getByTestId("stale-code")).toHaveTextContent(
      "This solution is for task rev 1. The task is now at rev 2",
    );
  });

  it("states the device-only refusal only when the reason supports it", () => {
    show({
      session: { processingPolicy: "device-only" },
      actions: [
        coding(["a"]),
        solve(null, 1, {
          dispatchStatus: "suppressed",
          suppressionReason: "policy_refused",
        }),
      ],
    });
    expect(screen.getByText(/Not run\./)).toBeVisible();
    expect(
      screen.getByText(
        "Coding needs a remote model, and this session runs AI models on this Mac only.",
      ),
    ).toBeVisible();
  });

  it("does not say this Mac only for a refusal in a session that allows remote", () => {
    show({
      session: { processingPolicy: "permitted-remote" },
      actions: [
        coding(["a"]),
        solve(null, 1, {
          dispatchStatus: "suppressed",
          suppressionReason: "policy_refused",
        }),
      ],
    });
    expect(screen.getByText("The processing policy refused it.")).toBeVisible();
    expect(screen.queryByText(/on this Mac only/)).toBeNull();
  });

  it("does not blame the policy when the session allows remote", () => {
    show({
      session: { processingPolicy: "permitted-remote" },
      actions: [
        coding(["a"]),
        solve(null, 1, {
          dispatchStatus: "suppressed",
          suppressionReason: "assistance_disabled",
        }),
      ],
    });
    expect(
      screen.getByText("Assistance is off for this session."),
    ).toBeVisible();
    expect(screen.queryByText(/on this Mac only/)).toBeNull();
  });

  it("states only the real sandbox limits, and only when the runner ran", () => {
    show({ actions: [coding(["a"]), solve(codeResult())] });
    openCode();
    expect(screen.getByTestId("runner-note")).toHaveTextContent(
      "no network, a read-only filesystem, 256 MB memory, 1 CPU and a 20 s limit",
    );
    cleanup();
    show({
      actions: [
        coding(["a"]),
        solve(
          codeResult({
            run: {
              available: false,
              exitCode: null,
              timedOut: false,
              durationMs: null,
            },
          }),
        ),
      ],
    });
    openCode();
    expect(screen.getByTestId("runner-note")).toHaveTextContent(
      "code runner was not available",
    );
    expect(screen.getByTestId("runner-note")).not.toHaveTextContent(/256/);
  });
});

// The answer on the task panel (the transcript row repeats it).
const onPanel = (text: string) =>
  within(screen.getByTestId("task-panel")).getByText(text);

describe("earlier tasks", () => {
  const two = () => [
    answerAction(answerResult({ draft: "First answer." }), {
      taskId: "task-1",
    }),
    answerAction(answerResult({ draft: "Second answer." }), {
      taskId: "task-2",
      createdAt: minutesAfter(1, 30),
      updatedAt: minutesAfter(1, 31),
    }),
  ];

  it("shows the newest task and lets the owner view an earlier one without losing their place", () => {
    show({ actions: two() });
    expect(onPanel("Second answer.")).toBeVisible();
    expect(screen.queryByText(/Viewing an earlier task/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /T1 ·/ }));
    expect(onPanel("First answer.")).toBeVisible();
    expect(
      screen.getByText(
        "Viewing an earlier task. Studio still tracks the newest one.",
      ),
    ).toBeVisible();
    expect(screen.getByText("T1 · rev 1")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to T2" }));
    expect(onPanel("Second answer.")).toBeVisible();
    expect(screen.queryByText(/Viewing an earlier task/)).toBeNull();
  });

  it("lists tasks newest first and stays on the pinned task when a new one arrives", () => {
    const view = show({ actions: [two()[0] as never] });
    expect(screen.queryByRole("group", { name: "Detected tasks" })).toBeNull();
    view.again({ actions: two() });
    const names = within(screen.getByRole("group", { name: "Detected tasks" }))
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names[0]).toMatch(/^T2/);
    fireEvent.click(screen.getByRole("button", { name: /T1 ·/ }));
    view.again({
      actions: [
        ...two(),
        answerAction(answerResult({ draft: "Third answer." }), {
          taskId: "task-3",
          createdAt: minutesAfter(1, 50),
          updatedAt: minutesAfter(1, 51),
        }),
      ],
    });
    expect(onPanel("First answer.")).toBeVisible();
    expect(screen.getByText(/Viewing an earlier task/)).toBeVisible();
  });
});

describe("announcements", () => {
  it("announces a new result politely and leaves focus alone", () => {
    const view = show({ actions: [] });
    const tab = screen.getByRole("tab", { name: "Activity" });
    tab.focus();
    view.again({ actions: [answerAction(answerResult())] });
    expect(document.activeElement).toBe(tab);
    const live = document.querySelector(".live-sr[aria-live='polite']");
    expect(live).toHaveTextContent("An answer draft is ready.");
  });
  it("does not announce results that were already there", () => {
    show({ actions: [answerAction(answerResult())] });
    expect(
      document.querySelector(".live-sr[aria-live='polite']"),
    ).toHaveTextContent("");
  });
});
