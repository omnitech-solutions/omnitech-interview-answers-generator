// The live session body: programming challenges, earlier tasks and announcements.
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftLink } from "./live-draft-link";
import { answerAction, show, spies } from "./live-view-kit";
import { action, minutesAfter } from "./session-fixtures";
import {
  answerResult,
  codeResult,
  codingAnswer,
} from "./session-result-fixtures";

vi.mock("./workspace-handoff", async () => {
  const kit = await import("./live-draft-link");
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
    expect(screen.getByText("Programming challenge")).toBeVisible();
    expect(
      screen.getByText("Implement a rate limiter for a Node service."),
    ).toBeVisible();
    expect(screen.getByText("Task rev 3")).toBeVisible();
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
    const state = (name: string) =>
      screen.getByText(name, { selector: "dt" }).closest(".live-state");
    expect(state("Generated")).toHaveAttribute("data-state", "yes");
    expect(state("Tests passed")).toHaveAttribute("data-state", "yes");
    expect(state("Fully verified")).toHaveAttribute("data-state", "no");
    expect(screen.getByText("5/5 tests passed")).toBeVisible();
    expect(screen.getByLabelText("Why not fully verified")).toHaveTextContent(
      "A stated constraint has no test of its own.",
    );
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
    expect(
      screen
        .getByText("Fully verified", { selector: "dt" })
        .closest(".live-state"),
    ).toHaveAttribute("data-state", "yes");
  });

  it("shows nothing as passed before a result exists", () => {
    show({
      actions: [coding(["a"]), solve(null, 1, { dispatchStatus: "in_flight" })],
    });
    for (const name of ["Generated", "Tests passed", "Fully verified"])
      expect(
        screen.getByText(name, { selector: "dt" }).closest(".live-state"),
      ).toHaveAttribute("data-state", "unknown");
  });

  it("offers the Workspace draft with the test count only when it was written", () => {
    draftLink.current = { target: {}, open: vi.fn() };
    show({ actions: [coding(["a"]), solve(codeResult())] });
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
    expect(screen.getByTestId("held-result")).toHaveTextContent(
      "Your edits are kept; the new result is offered as a suggestion in Workspace.",
    );
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
        "Coding needs a remote model, and this session processes content on this Mac only.",
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
    expect(screen.getByTestId("runner-note")).toHaveTextContent(
      "code runner was not available",
    );
    expect(screen.getByTestId("runner-note")).not.toHaveTextContent(/256/);
  });
});

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
    expect(screen.getByText("Second answer.")).toBeVisible();
    expect(screen.queryByText(/Viewing an earlier task/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Task 1 ·/ }));
    expect(screen.getByText("First answer.")).toBeVisible();
    expect(
      screen.getByText(
        "Viewing an earlier task. The session is still listening.",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to now" }));
    expect(screen.getByText("Second answer.")).toBeVisible();
    expect(screen.queryByText(/Viewing an earlier task/)).toBeNull();
  });

  it("lists tasks newest first and stays on the pinned task when a new one arrives", () => {
    const view = show({ actions: [two()[0] as never] });
    expect(screen.queryByRole("group", { name: "Detected tasks" })).toBeNull();
    view.again({ actions: two() });
    const names = within(screen.getByRole("group", { name: "Detected tasks" }))
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names[0]).toMatch(/^Task 2/);
    fireEvent.click(screen.getByRole("button", { name: /Task 1 ·/ }));
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
    expect(screen.getByText("First answer.")).toBeVisible();
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
