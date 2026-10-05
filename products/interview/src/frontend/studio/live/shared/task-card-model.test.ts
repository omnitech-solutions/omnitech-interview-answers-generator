import type { LiveAction } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { deriveTasks, type TaskView } from "../session-tasks";
import { action, minutesAfter, snapshot } from "../testing/session-fixtures";
import {
  answerResult,
  codeResult,
  codingAnswer,
} from "../testing/session-result-fixtures";
import {
  generatedByLabel,
  missingContextFor,
  STAGE_PRESENTATION,
  snapshotLabelOf,
  snapshotOrdinals,
  type TaskCardInput,
  taskCardModel,
} from "./task-card-model";

const answer = (taskId: string, overrides: Partial<LiveAction> = {}) =>
  action({
    taskId,
    actionKind: "draft-answer",
    result: codingAnswer(["O(n) time"]),
    ...overrides,
  });
const code = (taskId: string, result = codeResult(), overrides = {}) =>
  action({ taskId, actionKind: "solve-code", result, ...overrides });

function card(
  actions: LiveAction[],
  over: Partial<TaskCardInput> = {},
  status: "active" | "paused" = "active",
) {
  return taskCardModel({
    tasks: deriveTasks(actions, status),
    actions,
    observations: [],
    selectedTaskId: null,
    deviceOnly: false,
    ...over,
  });
}
const stage = (model: ReturnType<typeof card>, id: string) =>
  model?.stages.find((each) => each.id === id);

describe("the task card", () => {
  it("has no card when there are no tasks", () => {
    expect(card([])).toBeNull();
  });

  it("numbers tasks in creation order and flags an earlier task", () => {
    const actions = [
      answer("a", { createdAt: minutesAfter(1) }),
      answer("b", { createdAt: minutesAfter(2) }),
    ];
    const current = card(actions);
    expect(current).toMatchObject({ taskId: "b", label: "T2", earlier: false });
    const earlier = card(actions, { selectedTaskId: "a" });
    expect(earlier).toMatchObject({ taskId: "a", label: "T1", earlier: true });
    // An unknown selection is the newest task, not an earlier one.
    expect(card(actions, { selectedTaskId: "gone" })).toMatchObject({
      label: "T2",
      earlier: false,
    });
  });

  it("names the task, its kind, revision and constraints from the answer", () => {
    const model = card([answer("a"), answer("a", { taskRevision: 2 })]);
    expect(model?.kind).toMatchObject({
      id: "programming-challenge",
      label: "Programming challenge",
    });
    expect(model?.revision).toBe(2);
    expect(model?.constraints.map((each) => each.text)).toEqual(["O(n) time"]);
    expect(model?.restatement).toBe(
      "Implement a rate limiter for a Node service.",
    );
    expect(model?.answerText).toBe(
      "A small rate limiter with a configurable window.",
    );
  });

  it("lists the three stages in order with the table's labels", () => {
    const model = card([answer("a")]);
    expect(model?.stages.map((each) => each.label)).toEqual([
      "Answer",
      "Code",
      "Fully verified",
    ]);
    for (const each of model?.stages ?? [])
      expect(STAGE_PRESENTATION[each.state]).toBeDefined();
  });
});

describe("the stages follow the runs", () => {
  it.each([
    ["in flight", { dispatchStatus: "in_flight" as const }, "running"],
    ["published", {}, "done"],
    [
      "stopped by a pause",
      {
        dispatchStatus: "suppressed" as const,
        suppressionReason: "session_paused",
      },
      "stopped",
    ],
    [
      "refused by policy",
      {
        dispatchStatus: "suppressed" as const,
        suppressionReason: "policy_refused",
      },
      "unavailable",
    ],
    ["failed", { dispatchStatus: "failed" as const }, "stopped"],
  ])("answer %s is %s", (_name, over, expected) => {
    expect(stage(card([answer("a", over)]), "answer")?.state).toBe(expected);
  });

  it("a coding task waits for its code before any run exists", () => {
    const model = card([answer("a")]);
    expect(stage(model, "code")?.state).toBe("waiting");
    expect(stage(model, "verified")?.state).toBe("not-established");
  });

  it("code is unavailable for a question that is not a coding task", () => {
    const model = card([
      answer("a", { result: answerResult({ category: "background" }) }),
    ]);
    expect(stage(model, "code")).toMatchObject({
      state: "unavailable",
      detail: "Not a coding question.",
    });
  });

  it("code is unavailable, with the reason, for a device-only session", () => {
    const model = card([answer("a")], { deviceOnly: true });
    expect(stage(model, "code")).toMatchObject({
      state: "unavailable",
      detail: expect.stringContaining("Device-only"),
    });
    expect(stage(model, "verified")?.state).toBe("unavailable");
  });

  it("code is unavailable when the run was refused for device-only", () => {
    const model = card([
      answer("a"),
      code("a", undefined, {
        dispatchStatus: "suppressed",
        suppressionReason: "runner_not_device_local",
        result: null,
      }),
    ]);
    expect(stage(model, "code")?.state).toBe("unavailable");
    expect(stage(model, "code")?.detail).toMatch(/does not run on this Mac/);
  });
});

describe("generated, tests passed and fully verified stay distinct", () => {
  it("shows passing generated tests without claiming verification", () => {
    const model = card([answer("a"), code("a")]);
    expect(stage(model, "code")).toMatchObject({
      state: "done",
      detail: "5/5 generated tests",
    });
    expect(stage(model, "verified")).toMatchObject({
      state: "not-established",
      detail: "A stated constraint has no test of its own.",
    });
    expect(model?.badges).toEqual([
      { id: "generated", label: "Generated", ok: true },
      { id: "tests", label: "5/5 generated tests", ok: true },
      { id: "verified", label: "Not fully verified", ok: false },
    ]);
  });

  it("is verified only when the server says fullyVerified", () => {
    const verified = codeResult({
      states: {
        generated: true,
        testsPassed: true,
        fullyVerified: true,
        reasons: [],
      },
    });
    const model = card([answer("a"), code("a", verified)]);
    expect(stage(model, "verified")?.state).toBe("done");
    expect(model?.badges.at(-1)).toEqual({
      id: "verified",
      label: "Fully verified",
      ok: true,
    });
  });

  it("states a count only when the server reports tests", () => {
    const uncounted = codeResult({
      tests: { total: 0, passed: 0, failed: 0, skipped: 0, results: [] },
    });
    const model = card([answer("a"), code("a", uncounted)]);
    expect(model?.badges[1]?.label).toBe("Generated tests passed");
    expect(stage(model, "code")?.detail).toBeNull();
  });

  it("does not call failing tests a pass", () => {
    const failing = codeResult({
      states: {
        generated: true,
        testsPassed: false,
        fullyVerified: false,
        reasons: ["test_failed"],
      },
      tests: { total: 5, passed: 3, failed: 2, skipped: 0, results: [] },
    });
    const model = card([answer("a"), code("a", failing)]);
    expect(model?.badges[1]).toEqual({
      id: "tests",
      label: "3/5 generated tests",
      ok: false,
    });
    expect(stage(model, "verified")?.detail).toBe("A test failed.");
  });
});

describe("the code block of the card", () => {
  const failed = {
    name: "blocks",
    status: "failed",
    message: "expected false, got true",
    location: { editor: "tests", line: 7 },
  };

  it("lists the files that have text, with the main app's file names", () => {
    const model = card([
      answer("a"),
      code("a", codeResult({ usageCode: "allow()" })),
    ]);
    expect(model?.code?.files).toEqual([
      {
        id: "solution",
        name: "solution.ts",
        text: "export const allow = () => true;",
      },
      { id: "usage", name: "usage.ts", text: "allow()" },
      {
        id: "tests",
        name: "solution.test.ts",
        text: "it('allows', () => {});",
      },
    ]);
    expect(model?.code?.text).toBe("export const allow = () => true;");
  });

  it("omits empty files and falls back to plain names for an unknown language", () => {
    const model = card([
      answer("a"),
      code(
        "a",
        codeResult({ usageCode: "  ", testCode: "", language: "cobol" }),
      ),
    ]);
    expect(model?.code?.files).toEqual([
      {
        id: "solution",
        name: "solution",
        text: "export const allow = () => true;",
      },
    ]);
  });

  it("maps constraints to tests and carries failure message and location", () => {
    const model = card([
      answer("a"),
      code(
        "a",
        codeResult({
          coverage: [
            { constraintIndex: 2, testName: "allows" },
            { constraintIndex: 0, testName: "allows" },
            { constraintIndex: 1, testName: "blocks" },
          ],
          tests: {
            total: 2,
            passed: 1,
            failed: 1,
            skipped: 0,
            results: [failed, { name: "allows", status: "passed" }],
          },
        }),
      ),
    ]);
    expect(model?.code?.tests?.results).toEqual([
      { ...failed, covers: [1] },
      { name: "allows", status: "passed", covers: [0, 2] },
    ]);
  });

  it("takes the counts from the server, not from a capped list", () => {
    const model = card([
      answer("a"),
      code(
        "a",
        codeResult({
          tests: {
            total: 80,
            passed: 70,
            failed: 7,
            skipped: 3,
            results: Array.from({ length: 50 }, (_, index) => ({
              name: `t${index}`,
              status: "passed",
            })),
          },
        }),
      ),
    ]);
    expect(model?.code?.tests).toMatchObject({
      generated: true,
      total: 80,
      passed: 70,
      failed: 7,
      skipped: 3,
    });
    expect(model?.code?.tests?.results).toHaveLength(50);
  });

  it("claims no test result when no runner answered", () => {
    const model = card([
      answer("a"),
      code(
        "a",
        codeResult({
          states: {
            generated: true,
            testsPassed: false,
            fullyVerified: false,
            reasons: ["runner_unavailable"],
          },
          tests: undefined,
          run: {
            available: false,
            exitCode: null,
            timedOut: false,
            durationMs: null,
          },
        }),
      ),
    ]);
    expect(model?.code?.tests).toBeNull();
    expect(model?.code?.reasons).toEqual([
      "The test runner was not available, so no tests ran.",
    ]);
  });

  it("gives the reasons from the one table, and none once fully verified", () => {
    expect(card([answer("a"), code("a")])?.code?.reasons).toEqual([
      "A stated constraint has no test of its own.",
    ]);
    const verified = codeResult({
      states: {
        generated: true,
        testsPassed: true,
        fullyVerified: true,
        reasons: [],
      },
    });
    expect(card([answer("a"), code("a", verified)])?.code?.reasons).toEqual([]);
  });

  it("exposes diagnostics, repair and notes", () => {
    const model = card([
      answer("a"),
      code(
        "a",
        codeResult({
          syntax: {
            checked: true,
            clean: false,
            diagnostics: [{ line: 3, message: "Unexpected token" }],
          },
          repair: { attempted: true, succeeded: false },
        }),
      ),
    ]);
    expect(model?.code).toMatchObject({
      syntax: { checked: true, clean: false },
      diagnostics: [{ line: 3, message: "Unexpected token" }],
      repair: { attempted: true, succeeded: false },
      notes: "A sliding window per client.",
    });
  });

  it("has no code block before a solution exists", () => {
    expect(card([answer("a")])?.code).toBeNull();
  });
});

describe("screenshot numbers", () => {
  const shots = (sequences: number[]) => sequences.map((n) => snapshot(n));
  const ref = (n: number) => ({ sourceId: "screen", eventId: `evt-${n}` });

  it("number screenshots by arrival, across gaps and pages read out of order", () => {
    // Sequences 4, 9 and 31 (gaps), the later page read first, 9 repeated.
    const ordinals = snapshotOrdinals([...shots([31, 9]), ...shots([4, 9])]);
    expect(snapshotLabelOf(ref(4), ordinals)).toBe("S1");
    expect(snapshotLabelOf(ref(9), ordinals)).toBe("S2");
    expect(snapshotLabelOf(ref(31), ordinals)).toBe("S3");
  });

  it("ignores observations that are not screenshots", () => {
    const other = { ...snapshot(2), kind: "transcript.final" };
    const ordinals = snapshotOrdinals([other, snapshot(5)]);
    expect(snapshotLabelOf(ref(5), ordinals)).toBe("S1");
  });

  it("is null when the link is unknown or the screenshot is not held", () => {
    const ordinals = snapshotOrdinals(shots([1, 2]));
    expect(snapshotLabelOf(null, ordinals)).toBeNull();
    expect(snapshotLabelOf(undefined, ordinals)).toBeNull();
    expect(snapshotLabelOf(ref(99), ordinals)).toBeNull();
  });

  it("is on the card only when an action names the screenshot", () => {
    const observations = shots([3, 8]);
    expect(card([answer("a")], { observations })?.snapshotLabel).toBeNull();
    const linked = answer("a", { sourceSnapshots: [ref(8)] });
    expect(card([linked], { observations })?.snapshotLabel).toBe("S2");
  });

  it("is null when the named screenshot is not in the stream held", () => {
    const linked = answer("a", { sourceSnapshots: [ref(99)] });
    expect(card([linked], { observations: shots([3]) })?.snapshotLabel).toBe(
      null,
    );
  });

  it("keeps the original screenshot across follow-up revisions", () => {
    const observations = shots([3, 8]);
    const first = answer("a", {
      taskRevision: 1,
      createdAt: minutesAfter(1),
      sourceSnapshots: [ref(3)],
    });
    const followUp = answer("a", {
      taskRevision: 2,
      createdAt: minutesAfter(2),
      sourceSnapshots: [ref(3), ref(8)],
    });
    expect(card([followUp, first], { observations })?.snapshotLabel).toBe("S1");
  });

  it("is null for a device-only task that has no screenshot link", () => {
    const spoken = answer("a");
    expect(
      card([spoken], { observations: shots([3]), deviceOnly: true })
        ?.snapshotLabel,
    ).toBeNull();
  });
});

describe("the model chip", () => {
  const generated = (
    updatedAt: string,
    generatedBy?: { runtime: string; model: string },
    dispatchStatus = "succeeded",
  ) => ({ updatedAt, generatedBy, dispatchStatus }) as unknown as LiveAction;

  it("names the runtime and model of the latest succeeded answer", () => {
    expect(
      generatedByLabel([
        generated("2026-10-04T10:00:00Z", { runtime: "codex", model: "gpt-x" }),
        generated("2026-10-04T10:05:00Z", {
          runtime: "claude-code",
          model: "claude-sonnet-5-5",
        }),
      ]),
    ).toBe("Claude · claude-sonnet-5-5");
  });

  it("shows nothing before any answer, and ignores failed or unlabelled ones", () => {
    expect(generatedByLabel([])).toBeNull();
    expect(
      generatedByLabel([
        generated("2026-10-04T10:00:00Z", undefined),
        generated(
          "2026-10-04T10:01:00Z",
          { runtime: "codex", model: "m" },
          "failed",
        ),
      ]),
    ).toBeNull();
  });

  it("is per task on the card", () => {
    const actions = [
      answer("a", {
        generatedBy: { runtime: "claude-code", model: "sonnet" },
        createdAt: minutesAfter(1),
      }),
      answer("b", { createdAt: minutesAfter(2) }),
    ];
    expect(card(actions, { selectedTaskId: "a" })?.modelLabel).toBe(
      "Claude · sonnet",
    );
    expect(card(actions, { selectedTaskId: "b" })?.modelLabel).toBeNull();
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

  it("is cleared by a newer draft for the same revision that reports nothing", () => {
    expect(
      missingContextFor(
        [
          action({}),
          action({ updatedAt: "2026-10-04T10:05:00Z", missingContext: [] }),
        ],
        task,
      ),
    ).toBeNull();
  });

  it("never shows a late result for a revision the task has moved past", () => {
    const moved = { taskId: "t1", currentRevision: 3 } as unknown as TaskView;
    expect(
      missingContextFor(
        [
          action({ taskRevision: 3, missingContext: [] }),
          action({ taskRevision: 2, updatedAt: "2026-10-04T10:09:00Z" }),
        ],
        moved,
      ),
    ).toBeNull();
  });
});
