import { describe, expect, it } from "vitest";
import type { LiveAction } from "@omnitech/interview-contracts";
import type { TaskView } from "../../session-tasks";
import { missingContextFor, problemNameIn, taskStage } from "./panel-model";

describe("a problem name the answer gives", () => {
  it("takes a quoted name", () => {
    expect(
      problemNameIn('This is LeetCode 2, "Add Two Numbers": two lists'),
    ).toBe("Add Two Numbers");
    expect(problemNameIn("This is “Two Sum” again")).toBe("Two Sum");
  });

  it("takes the name after a LeetCode number", () => {
    expect(
      problemNameIn("This is LeetCode 37, Sudoku Solver: fill a 9x9 board"),
    ).toBe("Sudoku Solver");
    expect(
      problemNameIn(
        "This is LeetCode 32, Longest Valid Parentheses: given a string",
      ),
    ).toBe("Longest Valid Parentheses");
  });

  it("ignores text that is not a name", () => {
    expect(problemNameIn("no name here")).toBeNull();
    expect(problemNameIn('He said "do it now." and left')).toBeNull();
    expect(problemNameIn('a "x" b')).toBeNull();
  });
});

describe("a task's stage", () => {
  const run = (actionKind: string, state: string) => ({
    actionKind,
    state,
    createdAt: "2026-10-04T10:00:00Z",
  });
  const task = (
    runs: ReturnType<typeof run>[],
    kind = "programming-challenge",
  ) => ({ kind, current: { runs } }) as unknown as TaskView;

  it("reads the problem while the answer is drafted for a coding task", () => {
    expect(taskStage(task([run("draft-answer", "running")]))?.label).toBe(
      "Reading the problem",
    );
  });

  it("drafts an answer for any other kind of question", () => {
    expect(
      taskStage(task([run("draft-answer", "running")], "experience-question"))
        ?.label,
    ).toBe("Drafting an answer");
  });

  it("solutions once the code is being written, even if the draft still runs", () => {
    expect(
      taskStage(
        task([run("draft-answer", "running"), run("solve-code", "running")]),
      )?.label,
    ).toBe("Solutioning");
  });

  it("has no stage when nothing is running", () => {
    expect(taskStage(task([run("draft-answer", "published")]))).toBeNull();
    expect(taskStage(task([]))).toBeNull();
  });
});

describe("what the model says is missing", () => {
  const task = { taskId: "t1", currentRevision: 2 } as unknown as TaskView;
  const action = (over: Record<string, unknown>) =>
    ({
      taskId: "t1",
      taskRevision: 2,
      actionKind: "draft-answer",
      dispatchStatus: "succeeded",
      updatedAt: "2026-10-04T10:00:00Z",
      missingContext: [{ kind: "constraints" }],
      ...over,
    }) as unknown as LiveAction;

  it("comes from the newest succeeded draft for the task's current revision", () => {
    const found = missingContextFor(
      [
        action({ missingContext: [{ kind: "examples" }] }),
        action({
          updatedAt: "2026-10-04T10:05:00Z",
          missingContext: [{ kind: "signature", note: "return type unclear" }],
        }),
      ],
      task,
    );
    expect(found).toEqual([{ kind: "signature", note: "return type unclear" }]);
  });

  it("ignores other revisions, other tasks, failed drafts and empty lists", () => {
    expect(missingContextFor([action({ taskRevision: 1 })], task)).toBeNull();
    expect(missingContextFor([action({ taskId: "t2" })], task)).toBeNull();
    expect(
      missingContextFor([action({ dispatchStatus: "failed" })], task),
    ).toBeNull();
    expect(
      missingContextFor([action({ missingContext: [] })], task),
    ).toBeNull();
    expect(missingContextFor([action({})], undefined)).toBeNull();
  });
});
