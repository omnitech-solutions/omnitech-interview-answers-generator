import { describe, expect, it } from "vitest";
import { deriveTasks } from "../session-tasks";
import { action, minutesAfter } from "../testing/session-fixtures";
import { answerResult } from "../testing/session-result-fixtures";
import {
  resolveTarget,
  selectedTask,
  targetOf,
  taskLabel,
  taskOrdinal,
} from "./task-target";

// Three tasks, created in order; t2 is the one worked on most recently.
const tasks = deriveTasks(
  [
    action({
      taskId: "t1",
      result: answerResult(),
      createdAt: minutesAfter(1),
    }),
    action({
      taskId: "t2",
      taskRevision: 3,
      result: answerResult(),
      createdAt: minutesAfter(2),
    }),
    action({
      taskId: "t3",
      result: answerResult(),
      createdAt: minutesAfter(3),
    }),
    action({
      taskId: "t2",
      taskRevision: 4,
      result: answerResult(),
      createdAt: minutesAfter(9),
      updatedAt: minutesAfter(9, 30),
    }),
  ],
  "active",
);

describe("the selected task", () => {
  it.each([
    ["the pinned task", "t1", "t1"],
    ["the newest when nothing is pinned", null, "t3"],
    ["the newest when the pinned task is unknown", "gone", "t3"],
  ])("is %s", (_name, pinned, expected) => {
    expect(selectedTask(tasks, pinned)?.taskId).toBe(expected);
  });

  it("is none when there are no tasks", () => {
    expect(selectedTask([], null)).toBeUndefined();
  });
});

describe("the target of a follow-up or an added screenshot", () => {
  it("is the selected task at its own revision, not the newest action", () => {
    // t2 had the newest action (revision 4) but the person is on t1.
    const resolved = resolveTarget(tasks, "t1");
    expect(resolved?.target).toEqual({ taskId: "t1", revision: 1 });
    expect(resolved?.targetLabel).toBe("T1");
  });

  it("uses the current revision of a task revised more than once", () => {
    expect(resolveTarget(tasks, "t2")?.target).toEqual({
      taskId: "t2",
      revision: 4,
    });
    expect(resolveTarget(tasks, "t2")?.targetLabel).toBe("T2");
  });

  it("falls to the newest task when none is pinned", () => {
    expect(resolveTarget(tasks, null)?.targetLabel).toBe("T3");
  });

  it("is null when no task exists: an explicit general question", () => {
    expect(resolveTarget([], null)).toBeNull();
    expect(resolveTarget([], "t1")).toBeNull();
    expect(targetOf(undefined)).toBeNull();
  });
});

describe("task numbers", () => {
  it("follow creation order and are null for an unknown task", () => {
    expect(tasks.map((task) => taskOrdinal(tasks, task.taskId))).toEqual([
      1, 2, 3,
    ]);
    expect(taskOrdinal(tasks, "nope")).toBeNull();
    expect(taskLabel(2)).toBe("T2");
  });
});
