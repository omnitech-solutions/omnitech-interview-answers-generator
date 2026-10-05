import { beforeEach, describe, expect, it } from "vitest";
import { presentation } from "../focus-presentation";
import { deriveTasks } from "../session-tasks";
import { action, minutesAfter } from "../testing/session-fixtures";
import { answerResult, codeResult } from "../testing/session-result-fixtures";
import {
  followUpNote,
  pickOf,
  revisionCause,
  revisionLine,
  revisionList,
  revisionText,
  selectedRevisionOf,
  taskAtRevision,
} from "./revisions";
import { taskCardModel } from "./task-card-model";

const coding = (draft: string, constraints: string[]) =>
  answerResult({
    category: "coding",
    draft,
    claims: [],
    codingBrief: {
      language: "typescript",
      restatement: "Rate limiter",
      constraints,
    },
  });

// One task, three revisions: the first answer, a regeneration, and a follow-up
// whose draft is still running.
const actions = [
  action({
    taskId: "t",
    taskRevision: 1,
    actionKind: "draft-answer",
    result: coding("First draft.", ["O(n) time"]),
    createdAt: minutesAfter(1),
  }),
  action({
    taskId: "t",
    taskRevision: 2,
    actionKind: "draft-answer",
    revisionReason: "regenerate",
    result: coding("Second draft.", ["O(1) space"]),
    createdAt: minutesAfter(2),
  }),
  action({
    taskId: "t",
    taskRevision: 3,
    actionKind: "draft-answer",
    dispatchStatus: "in_flight",
    createdAt: minutesAfter(3),
  }),
];
const [task] = deriveTasks(actions, "active");
if (!task) throw new Error("fixture");

describe("revisionList", () => {
  it("lists every revision newest first with the current one marked", () => {
    const list = revisionList(task);
    expect(list.map((entry) => entry.revision)).toEqual([3, 2, 1]);
    expect(list.map((entry) => entry.isCurrent)).toEqual([true, false, false]);
    expect(list.map((entry) => entry.outdated)).toEqual([false, true, true]);
    expect(list.map((entry) => entry.at)).toEqual([
      minutesAfter(3),
      minutesAfter(2),
      minutesAfter(1),
    ]);
  });

  it("marks the selected revision, the current one by default", () => {
    expect(revisionList(task).map((entry) => entry.isSelected)).toEqual([
      true,
      false,
      false,
    ]);
    expect(
      revisionList(task, 1).map((entry) => [entry.revision, entry.isSelected]),
    ).toEqual([
      [3, false],
      [2, false],
      [1, true],
    ]);
  });

  it("says whether a revision has an answer yet", () => {
    expect(revisionList(task).map((entry) => entry.hasAnswer)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("names what produced each revision from the recorded data only", () => {
    expect(revisionList(task).map((entry) => entry.cause)).toEqual([
      "Follow-up",
      "Regenerated",
      "First answer",
    ]);
    const [added] = deriveTasks(
      [
        action({ taskId: "u", taskRevision: 1 }),
        action({
          taskId: "u",
          taskRevision: 2,
          revisionReason: "added-screenshot",
        }),
      ],
      "active",
    );
    expect(added && revisionCause(added, added.revisions[1] as never)).toBe(
      "Screenshot added",
    );
  });
});

describe("the revision on show", () => {
  it("is the current one unless an older one was picked", () => {
    expect(selectedRevisionOf(task, {})).toBe(3);
    expect(selectedRevisionOf(task, { t: 1 })).toBe(1);
    // A pick for a revision the task does not have is ignored.
    expect(selectedRevisionOf(task, { t: 9 })).toBe(3);
    expect(selectedRevisionOf(task, { other: 1 })).toBe(3);
  });

  it("remembers nothing for the current revision (it follows the newest)", () => {
    expect(pickOf(task, 3)).toBeNull();
    expect(pickOf(task, 1)).toBe(1);
  });

  it("says 'rev n of m' and, only for an older one, what that means", () => {
    expect(revisionLine(task, 3)).toEqual({
      label: "rev 3 of 3",
      viewingEarlier: false,
      note: null,
    });
    expect(revisionLine(task, 1)).toEqual({
      label: "rev 1 of 3",
      viewingEarlier: true,
      note: "Viewing rev 1, current is rev 3",
    });
  });

  it("keeps the composer pointed at the current revision", () => {
    expect(followUpNote(task, 3)).toBeNull();
    expect(followUpNote(task, 1)).toBe("Follow-up goes to rev 3");
  });
});

describe("following the newest versus keeping an old pick", () => {
  beforeEach(() => presentation.reset());

  const withRevisions = (count: number) =>
    deriveTasks(
      Array.from({ length: count }, (_, index) =>
        action({
          taskId: "t",
          taskRevision: index + 1,
          result: answerResult({ draft: `Draft ${index + 1}.` }),
          createdAt: minutesAfter(index + 1),
        }),
      ),
      "active",
    )[0];

  it("follows a newer revision when the current one was on show", () => {
    const before = withRevisions(2);
    if (!before) throw new Error("fixture");
    // Choosing the current revision stores nothing.
    presentation.pickRevision("t", pickOf(before, 2));
    const after = withRevisions(3);
    if (!after) throw new Error("fixture");
    expect(selectedRevisionOf(after, presentation.get().revisionPicks)).toBe(3);
  });

  it("keeps an older revision the person chose when a newer one arrives", () => {
    const before = withRevisions(2);
    if (!before) throw new Error("fixture");
    presentation.pickRevision("t", pickOf(before, 1));
    const after = withRevisions(3);
    if (!after) throw new Error("fixture");
    const picks = presentation.get().revisionPicks;
    expect(selectedRevisionOf(after, picks)).toBe(1);
    expect(revisionLine(after, 1).note).toBe("Viewing rev 1, current is rev 3");
    // Picking the newest again goes back to following.
    presentation.pickRevision("t", pickOf(after, 3));
    expect(selectedRevisionOf(after, presentation.get().revisionPicks)).toBe(3);
  });

  it("is forgotten with the rest of the layout on reset", () => {
    presentation.pickRevision("t", 1);
    presentation.reset();
    expect(presentation.get().revisionPicks).toEqual({});
  });
});

describe("the task at a revision", () => {
  it("is the task itself for the current revision", () => {
    expect(taskAtRevision(task, 3)).toBe(task);
    expect(taskAtRevision(task, 99)).toBe(task);
  });

  it("carries that revision's answer and constraints, and nothing newer", () => {
    const first = taskAtRevision(task, 1);
    expect(first.answer?.draft).toBe("First draft.");
    expect(first.answerStale).toBe(false);
    expect(first.constraints.map((each) => each.text)).toEqual(["O(n) time"]);
    const second = taskAtRevision(task, 2);
    expect(second.answer?.draft).toBe("Second draft.");
    // The list and the follow-up target stay the task's own.
    expect(second.currentRevision).toBe(3);
    expect(second.revisions).toBe(task.revisions);
  });

  it("never shows another revision's answer for one that has none", () => {
    // Revision 3 is still drafting; the task falls back to rev 2's answer for
    // its card, but the revision's own view has none.
    expect(task.answer?.draft).toBe("Second draft.");
    expect(task.current.answer).toBeNull();
  });
});

describe("the task card follows the revision", () => {
  const input = (picks: Record<string, number>) => ({
    tasks: [task],
    actions,
    observations: [],
    selectedTaskId: null,
    revisionPicks: picks,
    deviceOnly: false,
  });

  it("describes the current revision by default", () => {
    expect(taskCardModel(input({}))).toMatchObject({
      revision: 3,
      currentRevision: 3,
      revisionCount: 3,
    });
  });

  it("swaps the answer, constraints and revision for an older pick", () => {
    const card = taskCardModel(input({ t: 1 }));
    expect(card).toMatchObject({
      revision: 1,
      currentRevision: 3,
      answerText: "First draft.",
      answerStale: false,
    });
    expect(card?.constraints.map((each) => each.text)).toEqual(["O(n) time"]);
    expect(taskCardModel(input({ t: 2 }))?.answerText).toBe("Second draft.");
  });

  it("takes the missing-context note from the revision on show", () => {
    const noted = [
      action({
        taskId: "m",
        taskRevision: 1,
        actionKind: "draft-answer",
        result: answerResult(),
        missingContext: [{ kind: "examples" }],
        createdAt: minutesAfter(1),
      }),
      action({
        taskId: "m",
        taskRevision: 2,
        actionKind: "draft-answer",
        result: answerResult(),
        createdAt: minutesAfter(2),
      }),
    ];
    const tasks = deriveTasks(noted, "active");
    const base = {
      tasks,
      actions: noted,
      observations: [],
      selectedTaskId: null,
      deviceOnly: false,
    };
    expect(taskCardModel(base)?.missingContext).toBeNull();
    expect(
      taskCardModel({ ...base, revisionPicks: { m: 1 } })?.missingContext,
    ).toEqual([{ kind: "examples" }]);
  });
});

describe("what a revision says in a chat row", () => {
  it("is its own draft", () => {
    expect(revisionText(task.revisions[0] as never)).toEqual({
      text: "First draft.",
      note: null,
    });
  });

  it("is its honest state until it has a draft", () => {
    expect(revisionText(task.revisions[2] as never)).toEqual({
      text: null,
      note: "Drafting…",
    });
  });

  it("says what the run says for a draft the guard withheld", () => {
    const [withheld] = deriveTasks(
      [
        action({
          taskId: "w",
          actionKind: "draft-answer",
          dispatchStatus: "suppressed",
          suppressionReason: "invalid_output",
          result: { withheld: { rejectedClaimCount: 2, codes: [] } },
        }),
      ],
      "active",
    );
    const text = revisionText(withheld?.revisions[0] as never);
    expect(text.text).toBeNull();
    expect(text.note).toBe(withheld?.revisions[0]?.answerRun?.reasonLabel);
    expect(text.note).toMatch(/\S/);
  });
});

// F6: the code as it stood at a revision, for every reader of a task.
describe("the code at a revision", () => {
  const solved = (revision: number, code: string, minute: number) =>
    action({
      taskId: "c",
      taskRevision: revision,
      actionKind: "solve-code",
      result: codeResult({ code }),
      createdAt: minutesAfter(minute),
    });
  const asked = (revision: number, minute: number) =>
    action({
      taskId: "c",
      taskRevision: revision,
      actionKind: "draft-answer",
      result: coding(`Draft ${revision}.`, ["O(n) time"]),
      createdAt: minutesAfter(minute),
    });
  // Revision 2 has an answer but no solution.
  const [coded] = deriveTasks(
    [
      asked(1, 1),
      solved(1, "// rev 1", 1),
      asked(2, 2),
      asked(3, 3),
      solved(3, "// rev 3", 3),
    ],
    "active",
  );
  if (!coded) throw new Error("fixture");
  const cardAt = (revision: number) =>
    taskCardModel({
      tasks: [coded],
      actions: [],
      observations: [],
      selectedTaskId: null,
      revisionPicks: { c: revision },
      deviceOnly: false,
    });

  it("keeps an older revision's own code, tests and draft", () => {
    const first = taskAtRevision(coded, 1);
    expect(first.code?.code).toBe("// rev 1");
    expect(first.draftCode).toBe(first.code);
    expect(first.draftCode).not.toBeNull();
  });

  it("leaves the current revision as the task itself", () => {
    expect(taskAtRevision(coded, 3)).toBe(coded);
    expect(coded.draftCode?.code).toBe("// rev 3");
  });

  it("gives a revision without code no code, never another revision's", () => {
    const second = taskAtRevision(coded, 2);
    expect(second.code).toBeNull();
    expect(second.draftCode).toBeNull();
    expect(second.draft).toBeNull();
  });

  it("is what the native card shows at each revision", () => {
    expect(cardAt(1)?.code?.text).toBe("// rev 1");
    expect(cardAt(1)?.code?.revision).toBe(1);
    expect(cardAt(2)?.code).toBeNull();
    expect(cardAt(2)?.badges).toEqual([]);
    expect(cardAt(3)?.code?.text).toBe("// rev 3");
  });
});
