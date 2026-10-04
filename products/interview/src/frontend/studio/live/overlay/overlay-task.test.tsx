// The task head: a short title, constraints as chips, and a long or
// number-spelling restatement kept as a collapsed detail.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskView } from "../session-tasks";
import { TaskHead, taskHeading } from "./overlay-task";

afterEach(cleanup);

const task = (title: string | null): TaskView =>
  ({
    taskId: "t1",
    kind: "programming-challenge",
    title,
    currentRevision: 2,
    constraints: [
      { text: "No sorting allowed", status: "current", sinceRevision: 1 },
      { text: "Old rule", status: "superseded", sinceRevision: 1 },
    ],
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

describe("TaskHead", () => {
  it("shows one title line, current constraints as chips and a collapsed restatement", () => {
    render(
      <TaskHead
        task={task("Find the one-hundred-twenty-first prime")}
        number={1}
        chips={[]}
      />,
    );
    const head = within(screen.getByTestId("task-head"));
    expect(head.getByTestId("task-title")).not.toHaveTextContent(/hundred/);
    expect(head.getByText("No sorting allowed")).toBeVisible();
    expect(head.queryByText("Old rule")).toBeNull();
    const details = head.getByText("Restated task").closest("details");
    expect(details).not.toHaveAttribute("open");
  });
});
