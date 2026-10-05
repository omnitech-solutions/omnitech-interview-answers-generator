// The Revisions control on the web page: one task with several revisions is ONE
// transcript row; the task panel and that row follow the revision on show; the
// earlier-TASK banner stays separate.
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { presentation } from "./focus-presentation";
import { answerAction, show } from "./testing/live-view-kit";
import { action, minutesAfter } from "./testing/session-fixtures";
import {
  answerResult,
  codeResult,
  codingAnswer,
} from "./testing/session-result-fixtures";

beforeEach(() => presentation.reset());
afterEach(cleanup);

const draft = (revision: number, text: string, minute: number) =>
  answerAction(answerResult({ draft: text }), {
    taskId: "t",
    taskRevision: revision,
    createdAt: minutesAfter(1, minute),
    updatedAt: minutesAfter(1, minute),
  });
const two = () => [draft(1, "First words.", 10), draft(2, "Second words.", 20)];
const panel = () => within(screen.getByTestId("task-panel"));
const rows = () => screen.getAllByTestId("transcript-row");
const taskRows = () =>
  rows().filter((row) => row.hasAttribute("data-task-row"));
const choose = (revision: number) => {
  fireEvent.click(screen.getByTestId("revisions-button"));
  fireEvent.click(screen.getByTestId(`revision-${revision}`));
};

describe("a task with revisions", () => {
  it("is one transcript row whose text is the revision on show", () => {
    show({ actions: two() });
    expect(taskRows()).toHaveLength(1);
    expect(
      within(taskRows()[0] as HTMLElement).getByTestId("task-row-text"),
    ).toHaveTextContent("Second words.");
    expect(screen.getByTestId("task-row-rev")).toHaveTextContent(
      "rev 2 of 2 · Follow-up",
    );
    choose(1);
    expect(taskRows()).toHaveLength(1);
    expect(screen.getByTestId("task-row-text")).toHaveTextContent(
      "First words.",
    );
    expect(screen.getByTestId("task-row-rev")).toHaveTextContent(
      "rev 1 of 2 · First answer",
    );
  });

  it("swaps the task panel with it and marks the current and outdated revisions", () => {
    show({ actions: two() });
    expect(panel().getByText("Second words.")).toBeVisible();
    fireEvent.click(screen.getByTestId("revisions-button"));
    const items = screen.getAllByRole("menuitemradio");
    expect(items[0]).toHaveTextContent("rev 2 · Current");
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    expect(items[1]).toHaveTextContent("rev 1 · Outdated");
    fireEvent.click(items[1] as HTMLElement);
    expect(panel().getByText("First words.")).toBeVisible();
    expect(panel().queryByText("Second words.")).toBeNull();
    expect(screen.getByTestId("earlier-revision")).toHaveTextContent(
      "Viewing an earlier revision. The current one is rev 2.",
    );
    expect(panel().getByText("T1 · rev 1 of 2")).toBeVisible();
    // Not the earlier-task banner.
    expect(screen.queryByText(/Viewing an earlier task/)).toBeNull();
  });

  it("is operable from the keyboard", () => {
    show({ actions: two() });
    fireEvent.click(screen.getByTestId("revisions-button"));
    const menu = screen.getByRole("menu", { name: "Revisions" });
    expect(screen.getByTestId("revision-2")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByTestId("revision-1")).toHaveFocus();
    fireEvent.click(document.activeElement as HTMLElement);
    expect(panel().getByText("First words.")).toBeVisible();
    expect(screen.getByTestId("revisions-button")).toHaveFocus();
  });

  it("keeps an old pick when a newer revision arrives and follows when it was current", () => {
    const view = show({ actions: two() });
    choose(1);
    view.again({ actions: [...two(), draft(3, "Third words.", 30)] });
    expect(panel().getByText("First words.")).toBeVisible();
    expect(screen.getByTestId("earlier-revision")).toHaveTextContent("rev 3");
    expect(taskRows()).toHaveLength(1);
    // Back on the newest, the view follows the next one too.
    choose(3);
    view.again({
      actions: [
        ...two(),
        draft(3, "Third words.", 30),
        draft(4, "Fourth words.", 40),
      ],
    });
    expect(panel().getByText("Fourth words.")).toBeVisible();
    expect(screen.queryByTestId("earlier-revision")).toBeNull();
  });

  it("says what a revision with no draft yet is doing, never the other revision's text", () => {
    show({
      actions: [
        draft(1, "First words.", 10),
        action({
          taskId: "t",
          taskRevision: 2,
          actionKind: "draft-answer",
          dispatchStatus: "in_flight",
          createdAt: minutesAfter(1, 20),
          updatedAt: minutesAfter(1, 20),
        }),
      ],
    });
    const text = screen.getByTestId("task-row-text");
    expect(text).toHaveTextContent("Drafting…");
    expect(text).not.toHaveTextContent("First words.");
    choose(1);
    expect(screen.getByTestId("task-row-text")).toHaveTextContent(
      "First words.",
    );
  });

  it("has no control for a task with one revision", () => {
    show({ actions: [draft(1, "Only words.", 10)] });
    expect(screen.queryByTestId("revisions-button")).toBeNull();
    expect(taskRows()).toHaveLength(1);
    expect(screen.queryByTestId("task-row-rev")).toBeNull();
  });

  it("keeps the earlier-task control and the revision control distinct", () => {
    show({
      actions: [
        ...two(),
        answerAction(answerResult({ draft: "Other task." }), {
          taskId: "u",
          createdAt: minutesAfter(1, 50),
          updatedAt: minutesAfter(1, 50),
        }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /T1 ·/ }));
    expect(screen.getByText(/Viewing an earlier task/)).toBeVisible();
    choose(1);
    expect(screen.getByText(/Viewing an earlier task/)).toBeVisible();
    expect(screen.getByTestId("earlier-revision")).toBeVisible();
    // Two tasks, two rows.
    expect(taskRows()).toHaveLength(2);
  });
});

describe("a coding task with revisions (F6)", () => {
  const withCode = (revision: number, minute: number) => [
    answerAction(codingAnswer(["O(n) time"]), {
      taskId: "c",
      taskRevision: revision,
      createdAt: minutesAfter(1, minute),
      updatedAt: minutesAfter(1, minute),
    }),
    action({
      taskId: "c",
      taskRevision: revision,
      actionKind: "solve-code",
      result: codeResult({ code: `// rev ${revision}` }),
      createdAt: minutesAfter(1, minute + 1),
      updatedAt: minutesAfter(1, minute + 1),
    }),
  ];
  const canvas = () =>
    within(screen.getByRole("tabpanel", { name: "Code" })).getByTestId(
      "canvas-editor",
    );

  it("draws each revision's own code in the Code view", () => {
    show({ actions: [...withCode(1, 10), ...withCode(2, 20)] });
    fireEvent.click(screen.getByRole("tab", { name: "Code" }));
    expect(canvas()).toHaveTextContent("// rev 2");
    choose(1);
    fireEvent.click(screen.getByRole("tab", { name: "Code" }));
    expect(canvas()).toHaveTextContent("// rev 1");
    expect(canvas()).not.toHaveTextContent("// rev 2");
    choose(2);
    fireEvent.click(screen.getByRole("tab", { name: "Code" }));
    expect(canvas()).toHaveTextContent("// rev 2");
  });
});
