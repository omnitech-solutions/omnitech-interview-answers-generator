// Captures that showed no interview question (D36): they are notes, never
// tasks. The table covers numbering, "newest", targeting, the transcript note
// and its collapse, the native chat row and the status line.
import { describe, expect, it } from "vitest";
import {
  type PanelRow,
  panelRows,
  taskChips,
  taskMarkers,
} from "../overlay/panels/panel-model";
import { deriveNoQuestionTasks, deriveTasks } from "../session-tasks";
import { transcriptRows } from "../session-transcript";
import { action, minutesAfter, snapshot } from "../testing/session-fixtures";
import { answerResult } from "../testing/session-result-fixtures";
import {
  NO_QUESTION_NOTES,
  NO_QUESTION_STATUS,
  noQuestionLines,
  noQuestionNotes,
  noQuestionStatus,
} from "./no-question";
import { revisionCause, revisionText } from "./revisions";
import {
  resolveTarget,
  selectedTask,
  taskLabel,
  taskOrdinal,
} from "./task-target";

const real = (taskId: string, at: number, revision = 1) =>
  action({
    taskId,
    taskRevision: revision,
    result: answerResult(),
    createdAt: minutesAfter(at),
    updatedAt: minutesAfter(at, 5),
  });
const junk = (taskId: string, at: number, revision = 1) =>
  action({
    taskId,
    taskRevision: revision,
    noQuestion: true,
    result: answerResult({ category: "no-question", draft: "No question." }),
    createdAt: minutesAfter(at),
    updatedAt: minutesAfter(at, 5),
  });
const ids = (list: readonly { taskId: string }[]) => list.map((t) => t.taskId);

describe("tasks, ordinals and newest", () => {
  it.each([
    [
      "no-question tasks are skipped",
      [real("a", 1), junk("x", 2), real("b", 3)],
      ["a", "b"],
      "b",
    ],
    [
      "all no-question: no tasks, no newest",
      [junk("x", 1), junk("y", 2)],
      [],
      undefined,
    ],
    ["a lone real task", [real("a", 1)], ["a"], "a"],
    [
      "a trailing no-question never becomes newest",
      [real("a", 1), real("b", 2), junk("x", 3)],
      ["a", "b"],
      "b",
    ],
  ])("%s", (_name, actions, expected, newest) => {
    const tasks = deriveTasks(actions, "active");
    expect(ids(tasks)).toEqual(expected);
    expect(selectedTask(tasks, null)?.taskId).toBe(newest);
  });

  it("numbers real tasks only, so T numbers have no gaps", () => {
    const tasks = deriveTasks(
      [real("a", 1), junk("x", 2), real("b", 3), junk("y", 4), real("c", 5)],
      "active",
    );
    expect(
      tasks.map((t) => taskLabel(taskOrdinal(tasks, t.taskId) ?? 0)),
    ).toEqual(["T1", "T2", "T3"]);
    expect(taskOrdinal(tasks, "x")).toBeNull();
  });

  it("a no-question task that a follow-up turns real takes the NEXT number; no existing number moves", () => {
    const before = [real("a", 1), junk("x", 2), real("b", 3)];
    const after = [...before, real("x", 9, 2)];
    const tasks = deriveTasks(after, "active");
    expect(ids(tasks)).toEqual(["a", "b", "x"]);
    expect(taskOrdinal(tasks, "b")).toBe(2);
    expect(taskOrdinal(tasks, "x")).toBe(3);
    expect(selectedTask(tasks, null)?.taskId).toBe("x");
    expect(deriveNoQuestionTasks(after, "active")).toEqual([]);
  });

  it("a real task whose newest revision shows no question STAYS a task: numbers stable, earlier answer kept and Outdated, revision labelled", () => {
    const actions = [real("a", 1), real("b", 2), real("c", 3), junk("b", 5, 2)];
    const tasks = deriveTasks(actions, "active");
    expect(ids(tasks)).toEqual(["a", "b", "c"]);
    expect(taskOrdinal(tasks, "c")).toBe(3);
    expect(deriveNoQuestionTasks(actions, "active")).toEqual([]);
    const b = tasks[1] as (typeof tasks)[number];
    expect(b.answer?.draft).not.toBe("No question.");
    expect(b.answerStale).toBe(true);
    expect(b.current.noQuestion).toBe(true);
    expect(revisionCause(b, b.current)).toBe("No question found");
    expect(revisionText(b.current)).toEqual({
      text: null,
      note: "No question found",
    });
    expect(resolveTarget(tasks, "b")?.task.taskId).toBe("b");
  });

  it("genuine 'other' answers stay tasks", () => {
    const tasks = deriveTasks(
      [action({ taskId: "o", result: answerResult({ category: "other" }) })],
      "active",
    );
    expect(tasks[0]?.kind).toBe("other");
  });
});

describe("targeting", () => {
  const actions = [real("a", 1), real("b", 2), junk("x", 3)];
  const tasks = deriveTasks(actions, "active");

  it("never targets a no-question capture as the implicit latest", () => {
    expect(resolveTarget(tasks, null)?.target).toEqual({
      taskId: "b",
      revision: 1,
    });
    expect(resolveTarget(tasks, null)?.targetLabel).toBe("T2");
  });

  it("falls back to the newest real task when a pin points at one", () => {
    expect(resolveTarget(tasks, "x")?.task.taskId).toBe("b");
  });

  it("has no target when every capture was no-question", () => {
    expect(
      resolveTarget(deriveTasks([junk("x", 1)], "active"), null),
    ).toBeNull();
  });
});

describe("chips and Back target", () => {
  it("makes no chip for a no-question capture and marks the newest REAL task", () => {
    const tasks = deriveTasks(
      [real("a", 1), real("b", 2), junk("x", 3)],
      "active",
    );
    const chips = taskChips(tasks, "a");
    expect(chips.map((c) => c.label)).toEqual(["T1", "T2"]);
    expect(chips.find((c) => c.newest)?.taskId).toBe("b");
  });
});

describe("the note", () => {
  it("is one note per capture, labelled by its screenshot", () => {
    const actions = [
      {
        ...junk("x", 2),
        sourceSnapshots: [{ sourceId: "screen", eventId: "e1" }],
      },
    ];
    const notes = noQuestionNotes(
      deriveNoQuestionTasks(actions, "active"),
      actions,
    );
    expect(notes).toEqual([
      {
        taskId: "x",
        at: minutesAfter(2),
        snapshot: { sourceId: "screen", eventId: "e1" },
      },
    ]);
  });

  it.each([
    [["S15"], ["S15 captured: no question found"]],
    [[null], ["No question found"]],
    [
      ["S1", "S2"],
      ["S1 captured: no question found", "S2 captured: no question found"],
    ],
    [
      Array(NO_QUESTION_NOTES.collapseAt).fill("S1"),
      [`${NO_QUESTION_NOTES.collapseAt} captures with no question`],
    ],
  ])("words %j as %j", (labels, lines) => {
    expect(noQuestionLines(labels)).toEqual(lines);
  });
});

describe("transcript", () => {
  const rowsFor = (actions: ReturnType<typeof action>[], shots = 0) => {
    const tasks = deriveTasks(actions, "active");
    const notes = noQuestionNotes(
      deriveNoQuestionTasks(actions, "active"),
      actions,
    );
    return transcriptRows(
      Array.from({ length: shots }, (_v, i) => snapshot(i + 1, "Window")),
      tasks,
      notes,
    );
  };

  it("shows a no-question capture as a note and never as a task row or its draft", () => {
    const rows = rowsFor([real("a", 1), junk("x", 2)]);
    expect(rows.map((r) => r.type)).toEqual(["task", "no-question"]);
    expect(JSON.stringify(rows)).not.toContain("No question.");
  });

  it("joins consecutive notes with a screenshot between them; a real task starts a new group", () => {
    const actions = [junk("x", 2), junk("y", 4), real("a", 6), junk("z", 8)];
    const shot = { ...snapshot(1, "Window"), receivedAt: minutesAfter(3) };
    const rows = transcriptRows(
      [shot],
      deriveTasks(actions, "active"),
      noQuestionNotes(deriveNoQuestionTasks(actions, "active"), actions),
    );
    expect(rows.map((r) => r.type)).toEqual([
      "no-question",
      "screenshot",
      "task",
      "no-question",
    ]);
    const counts = rows.map((r) =>
      r.type === "no-question" ? r.notes.length : 0,
    );
    expect(counts).toEqual([2, 0, 0, 1]);
  });
});

describe("native chat", () => {
  const model = (actions: ReturnType<typeof action>[]) => {
    const tasks = deriveTasks(actions, "active");
    const noQuestion = noQuestionNotes(
      deriveNoQuestionTasks(actions, "active"),
      actions,
    );
    return { tasks, noQuestion, transcript: [] } as never;
  };
  const markersFor = (actions: ReturnType<typeof action>[]) => {
    const m = model(actions) as { tasks: never; noQuestion: never };
    return taskMarkers({
      tasks: m.tasks,
      actions,
      observations: [],
      deviceOnly: false,
      noQuestion: m.noQuestion,
    });
  };
  const rows = (actions: ReturnType<typeof action>[]): PanelRow[] =>
    panelRows(model(actions), [], [], 0, markersFor(actions));

  it("adds a muted note row and no Studio bubble for a no-question capture", () => {
    const list = rows([real("a", 1), junk("x", 2)]);
    expect(list.filter((r) => r.kind === "assistant")).toHaveLength(1);
    const note = list.find((r) => r.text === "No question found");
    expect(note?.kind).toBe("marker");
    expect(list.some((r) => r.text.includes("No question."))).toBe(false);
  });

  it("collapses a run of notes", () => {
    const n = NO_QUESTION_NOTES.collapseAt;
    const list = rows(
      Array.from({ length: n }, (_v, i) => junk(`x${i}`, i + 1)),
    );
    expect(list.map((r) => r.text)).toEqual([`${n} captures with no question`]);
  });
});

describe("status line", () => {
  it.each([
    [true, true, NO_QUESTION_STATUS.auto],
    [true, false, NO_QUESTION_STATUS.manual],
    [false, true, null],
    [false, false, null],
  ])("newest no-question=%s auto=%s -> %s", (newest, auto, text) => {
    expect(noQuestionStatus(newest, auto)).toBe(text);
  });

  it("uses the agreed wording", () => {
    expect(NO_QUESTION_STATUS.auto).toBe(
      "No question on screen. Auto is holding until the screen changes.",
    );
    expect(NO_QUESTION_STATUS.manual).toBe(
      "No question found in the last capture.",
    );
  });
});
