import { describe, expect, it } from "vitest";
import { action, minutesAfter } from "./session-fixtures";
import {
  answerResult,
  codeResult,
  codingAnswer,
  logisticsResult,
  starResult,
} from "./session-result-fixtures";
import { deriveTasks } from "./session-tasks";

const answer = (
  result: Record<string, unknown>,
  overrides: Parameters<typeof action>[0] = {},
) => action({ actionKind: "draft-answer", result, ...overrides });

const kindOf = (result: Record<string, unknown>) =>
  deriveTasks([answer(result)], "active")[0]?.kind;

describe("task classification", () => {
  it("classifies by the answer's category", () => {
    expect(kindOf(answerResult({ category: "experience-story" }))).toBe(
      "experience-question",
    );
    expect(kindOf(answerResult({ category: "background" }))).toBe(
      "experience-question",
    );
    expect(kindOf(answerResult({ category: "motivation" }))).toBe(
      "experience-question",
    );
    expect(kindOf(answerResult({ category: "leaving-role" }))).toBe(
      "experience-question",
    );
    expect(kindOf(starResult())).toBe("leadership-behavioural");
    expect(kindOf(logisticsResult())).toBe("logistics");
    expect(kindOf(answerResult({ category: "technical-concept" }))).toBe(
      "concept",
    );
    expect(kindOf(answerResult({ category: "questions-to-ask" }))).toBe(
      "other",
    );
    expect(kindOf(answerResult({ category: "something-new" }))).toBe("other");
    expect(kindOf(codingAnswer([]))).toBe("programming-challenge");
  });

  it("is unclassified until an answer is published", () => {
    const [task] = deriveTasks(
      [action({ actionKind: "draft-answer", dispatchStatus: "in_flight" })],
      "active",
    );
    expect(task?.kind).toBe("unclassified");
    expect(task?.answer).toBeNull();
  });

  it("treats a task with a coding action as a programming challenge", () => {
    const [task] = deriveTasks(
      [
        action({
          actionKind: "solve-code",
          dispatchStatus: "in_flight",
          taskId: "t",
        }),
      ],
      "active",
    );
    expect(task?.kind).toBe("programming-challenge");
  });

  it("shows nothing for a malformed result rather than a guess", () => {
    const [task] = deriveTasks([answer({ category: "coding" })], "active");
    expect(task?.answer).toBeNull();
    expect(task?.kind).toBe("unclassified");
  });
});

describe("task revisions", () => {
  it("keeps one task per id with its revisions, and the highest is current", () => {
    const tasks = deriveTasks(
      [
        answer(answerResult(), { taskId: "a", taskRevision: 1 }),
        answer(answerResult(), { taskId: "a", taskRevision: 2 }),
        answer(answerResult(), { taskId: "b", taskRevision: 1 }),
      ],
      "active",
    );
    expect(
      tasks.map((t) => [t.taskId, t.currentRevision, t.revisions.length]),
    ).toEqual([
      ["a", 2, 2],
      ["b", 1, 1],
    ]);
    expect(tasks[0]?.revisions.map((r) => r.current)).toEqual([false, true]);
  });

  it("takes the latest run per kind: the highest attempt wins", () => {
    const [task] = deriveTasks(
      [
        answer(null as never, {
          attempt: 1,
          dispatchStatus: "failed",
          result: null,
        }),
        answer(answerResult(), { attempt: 2 }),
      ],
      "active",
    );
    expect(task?.current.answerRun?.attempt).toBe(2);
    expect(task?.answer).not.toBeNull();
  });

  it("orders tasks by when work on them first began", () => {
    const tasks = deriveTasks(
      [
        answer(answerResult(), { taskId: "late", createdAt: minutesAfter(5) }),
        answer(answerResult(), { taskId: "early", createdAt: minutesAfter(1) }),
      ],
      "active",
    );
    expect(tasks.map((t) => t.taskId)).toEqual(["early", "late"]);
  });

  it("shows an earlier revision's answer as stale, never as current", () => {
    const [task] = deriveTasks(
      [
        answer(answerResult({ draft: "first answer" }), { taskRevision: 1 }),
        answer(null as never, {
          taskRevision: 2,
          dispatchStatus: "in_flight",
          result: null,
        }),
      ],
      "active",
    );
    expect(task?.answer?.draft).toBe("first answer");
    expect(task?.answerStale).toBe(true);
    expect(task?.current.answerRun?.state).toBe("running");
  });
});

describe("coding constraints", () => {
  const coding = (revision: number, constraints: string[]) =>
    answer(codingAnswer(constraints), { taskId: "c", taskRevision: revision });

  it("has none stated yet before any brief", () => {
    const [task] = deriveTasks([coding(1, [])], "active");
    expect(task?.constraints).toEqual([]);
    expect(task?.title).toBe("Implement a rate limiter for a Node service.");
  });

  it("strikes a constraint a later revision no longer lists", () => {
    const [task] = deriveTasks(
      [
        coding(1, ["Sliding window", "Per client"]),
        coding(2, ["Per client", "Token bucket"]),
      ],
      "active",
    );
    expect(task?.constraints).toEqual([
      {
        text: "Sliding window",
        status: "superseded",
        sinceRevision: 1,
        supersededAtRevision: 2,
      },
      {
        text: "Per client",
        status: "current",
        sinceRevision: 1,
        supersededAtRevision: null,
      },
      {
        text: "Token bucket",
        status: "current",
        sinceRevision: 2,
        supersededAtRevision: null,
      },
    ]);
  });
});

describe("code and workspace draft", () => {
  it("reads the solution, its states and the draft it wrote", () => {
    const [task] = deriveTasks(
      [
        answer(codingAnswer(["A"]), { taskId: "c" }),
        action({ taskId: "c", actionKind: "solve-code", result: codeResult() }),
      ],
      "active",
    );
    expect(task?.code?.states).toMatchObject({
      generated: true,
      testsPassed: true,
      fullyVerified: false,
    });
    expect(task?.draft).toEqual({
      workspaceId: "active-session:0b1f6a52-7c7e-4f0e-9e1b-2c3d4e5f6a7b",
      artifactId: "coding:task-1",
      artifactRevision: 2,
    });
    expect(task?.heldResult).toBe(false);
  });

  it("marks a result held when the owner edited the draft, and keeps the code", () => {
    const [task] = deriveTasks(
      [
        action({
          taskId: "c",
          actionKind: "solve-code",
          result: codeResult({
            workspace: {
              published: false,
              conflict: true,
              reason: "owner_edited",
              expectedRevision: 2,
              foundRevision: 4,
            },
          }),
        }),
      ],
      "active",
    );
    expect(task?.heldResult).toBe(true);
    expect(task?.current.codeRun?.state).toBe("held-conflict");
    expect(task?.code?.code).toContain("allow");
    expect(task?.draft).toBeNull();
  });

  it("marks last revision's code stale while the new revision has none", () => {
    const [task] = deriveTasks(
      [
        action({
          taskId: "c",
          taskRevision: 1,
          actionKind: "solve-code",
          result: codeResult(),
        }),
        action({
          taskId: "c",
          taskRevision: 2,
          actionKind: "solve-code",
          dispatchStatus: "in_flight",
        }),
      ],
      "active",
    );
    expect(task?.codeStale).toBe(true);
    expect(task?.current.codeRun?.state).toBe("running");
  });
});

describe("activity runs", () => {
  const stateOf = (
    overrides: Parameters<typeof action>[0],
    status: Parameters<typeof deriveTasks>[1] = "active",
    extra: Parameters<typeof action>[0][] = [],
  ) => {
    const target = action({ taskId: "t", ...overrides });
    const tasks = deriveTasks(
      [target, ...extra.map((e) => action({ taskId: "t", ...e }))],
      status,
    );
    return tasks[0]?.revisions
      .flatMap((r) => r.runs)
      .find((run) => run.id === target.id);
  };

  it("labels each lifecycle", () => {
    expect(
      stateOf({ dispatchStatus: "succeeded", result: answerResult() }),
    ).toMatchObject({
      state: "published",
      label: "Published",
    });
    expect(stateOf({ dispatchStatus: "in_flight" })).toMatchObject({
      state: "running",
      label: "Drafting",
    });
    expect(
      stateOf({ dispatchStatus: "in_flight", actionKind: "solve-code" }),
    ).toMatchObject({
      state: "running",
      label: "Testing",
    });
    expect(stateOf({ dispatchStatus: "failed" })).toMatchObject({
      state: "failed",
    });
  });

  it("shows work that pause or end will cancel as cancelling", () => {
    expect(stateOf({ dispatchStatus: "in_flight" }, "paused")?.state).toBe(
      "cancelling",
    );
    expect(stateOf({ dispatchStatus: "in_flight" }, "ended")?.state).toBe(
      "cancelling",
    );
  });

  it("shows work for an older revision or an older fence as cancelling, not running", () => {
    expect(
      stateOf({ dispatchStatus: "in_flight", taskRevision: 1 }, "active", [
        { taskRevision: 2, dispatchStatus: "succeeded" },
      ])?.state,
    ).toBe("cancelling");
    expect(
      stateOf({ dispatchStatus: "in_flight", fenceAtDispatch: 1 }, "active", [
        // Another kind of run, under the newer holder.
        {
          fenceAtDispatch: 2,
          dispatchStatus: "succeeded",
          actionKind: "solve-code",
        },
      ])?.state,
    ).toBe("cancelling");
  });

  it("separates cancelled, discarded, refused and failed suppressions", () => {
    const suppressed = (reason: string) =>
      stateOf({ dispatchStatus: "suppressed", suppressionReason: reason });
    expect(suppressed("session_paused")).toMatchObject({
      state: "cancelled",
      label: "Cancelled",
    });
    expect(suppressed("session_ended")?.state).toBe("cancelled");
    expect(suppressed("revision_stale")).toMatchObject({
      state: "discarded",
      label: "Discarded",
      reasonLabel: "The task changed before this finished.",
    });
    expect(suppressed("fence_superseded")?.state).toBe("discarded");
    expect(suppressed("policy_refused")?.state).toBe("refused");
    expect(suppressed("stage_unlisted")?.state).toBe("refused");
    expect(suppressed("invalid_output")?.state).toBe("failed");
    expect(suppressed("something_new")).toMatchObject({
      state: "discarded",
      reasonLabel: null,
    });
  });

  it("calls an older published result superseded", () => {
    expect(
      stateOf(
        {
          dispatchStatus: "succeeded",
          result: answerResult(),
          taskRevision: 1,
        },
        "active",
        [{ taskRevision: 2, dispatchStatus: "in_flight" }],
      ),
    ).toMatchObject({ state: "superseded", current: false });
  });
});
