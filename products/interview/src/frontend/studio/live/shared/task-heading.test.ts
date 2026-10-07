// The task heading: a short title as given, a long or number-spelling
// restatement kept as detail.
import { describe, expect, it } from "vitest";
import type { TaskView } from "../session-tasks";
import { taskHeading } from "./task-heading";

const task = (title: string | null): TaskView =>
  ({
    taskId: "t1",
    kind: "programming-challenge",
    title,
    currentRevision: 1,
    revisions: [{ revision: 1 }],
    constraints: [],
  }) as unknown as TaskView;

describe("taskHeading", () => {
  it("keeps a short title as given", () => {
    expect(taskHeading(task("Two Sum"))).toEqual({
      title: "Two Sum",
      restated: null,
    });
  });
  it("moves a long restatement into the detail", () => {
    const long =
      "Given an array of integers and a target value, return the indices of the two numbers that add to it";
    const heading = taskHeading(task(long));
    expect(heading.restated).toBe(long);
    expect(heading.title).not.toBe(long);
  });
  it("never headlines a restatement that spells its numbers out", () => {
    const heading = taskHeading(task("Find one-hundred-twenty-one"));
    expect(heading.restated).toBe("Find one-hundred-twenty-one");
  });
});
