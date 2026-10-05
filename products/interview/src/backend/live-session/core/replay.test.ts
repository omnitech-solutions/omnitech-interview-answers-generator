// A synthetic, anonymised recruiter-screen-shaped replay through the core, with
// a fake TaskPolicy standing in for interview policy. No real names, employers
// or compensation figures appear in any utterance.
import type {
  ControlStatus,
  Observation,
} from "@omnitech/active-session-contracts";
import { describe, expect, it } from "vitest";
import {
  applyTranscriptFinal,
  applyVerdict,
  coalesceSegments,
  decideDispatch,
  decideObservation,
  deferredTopics,
  effectiveSegments,
  emptyDispatchLedger,
  emptyLedger,
  emptyTaskState,
  emptyTranscript,
  type IdGenerator,
  isSuperseded,
  markSegmentsSuperseded,
  openTaskSummaries,
  type PolicyInput,
  type PolicyVerdict,
  processUtterance,
  recordDispatchOutcome,
  revisionStanding,
  type Segment,
  type TaskPolicy,
  type TraceEvent,
} from "./index";

const control: ControlStatus = {
  state: "active",
  credentialExpiresAt: "2026-10-03T12:00:00Z",
};

type Line = {
  id: string;
  speaker: "interviewer" | "candidate";
  startMs: number;
  endMs: number;
  text: string;
  supersedes?: string;
};

const BACKCHANNELS = new Set(["mm-hm", "yeah", "right", "okay"]);
const LONG_MONOLOGUE =
  "um so basically we sort of went through the whole estate ".repeat(12).trim();

const script: Line[] = [
  {
    id: "s1",
    speaker: "interviewer",
    startMs: 0,
    endMs: 2000,
    text: "Could you walk me through a migration you led",
  },
  { id: "s2", speaker: "candidate", startMs: 2000, endMs: 2300, text: "mm-hm" },
  {
    id: "s3",
    speaker: "interviewer",
    startMs: 2300,
    endMs: 4000,
    text: "and what the main risk was",
  },
  {
    id: "s4",
    speaker: "candidate",
    startMs: 5000,
    endMs: 65000,
    text: LONG_MONOLOGUE,
  },
  {
    id: "s5",
    speaker: "interviewer",
    startMs: 66000,
    endMs: 69000,
    text: "part two how did you handle rollback",
  },
  {
    id: "s5b",
    speaker: "candidate",
    startMs: 69500,
    endMs: 70500,
    text: "here is how we handled it",
  },
  {
    id: "s6",
    speaker: "interviewer",
    startMs: 71000,
    endMs: 72000,
    text: "we can circle back to the salary topic later",
  },
  {
    id: "s7",
    speaker: "candidate",
    startMs: 72100,
    endMs: 72400,
    text: "yeah",
  },
  {
    id: "s7b",
    speaker: "candidate",
    startMs: 73000,
    endMs: 74000,
    text: "sure happy to",
  },
  {
    id: "s8",
    speaker: "interviewer",
    startMs: 80000,
    endMs: 82000,
    text: "what is your notice perid",
  },
  {
    id: "s9",
    speaker: "interviewer",
    startMs: 80000,
    endMs: 82000,
    text: "what is your notice period",
    supersedes: "s8",
  },
  {
    id: "s9b",
    speaker: "candidate",
    startMs: 83000,
    endMs: 84000,
    text: "about a month",
  },
  {
    id: "s10",
    speaker: "interviewer",
    startMs: 90000,
    endMs: 92000,
    text: "now resuming the salary topic",
  },
];

const lineById = (id: string): Line => {
  const line = script.find((entry) => entry.id === id);
  if (!line) throw new Error(`missing fixture line ${id}`);
  return line;
};

const toObservation = (line: Line, index: number): Observation => ({
  version: 1,
  kind: "transcript.final",
  sourceId: line.speaker === "candidate" ? "mic-1" : "app-1",
  eventId: line.id,
  occurredAt: "2026-10-03T10:00:00Z",
  sequence: index,
  content: {
    speaker: line.speaker,
    text: line.text,
    startMs: line.startMs,
    endMs: line.endMs,
    ...(line.supersedes ? { supersedes: line.supersedes } : {}),
  },
});

// Test-only policy: keyword rules over synthetic text. Interview policy is
// the product's business; the core only sees the verdict.
const fakePolicy = (state: {
  taskIds: Record<string, string>;
}): TaskPolicy => ({
  async decide({ utterance, openTasks }: PolicyInput): Promise<PolicyVerdict> {
    const text = utterance.text;
    if (BACKCHANNELS.has(text))
      return { segmentClass: "backchannel", decision: { kind: "ignore" } };
    if (text.length > 400)
      return {
        segmentClass: "monologue",
        decision: { kind: "open", taskKey: "q-monologue" },
      };
    if (text.includes("part two")) {
      const task = openTasks.find((t) => t.taskKey === "q-migration");
      return task
        ? {
            segmentClass: "substantive",
            decision: {
              kind: "revise",
              taskId: task.taskId,
              reason: "follow_up",
            },
          }
        : { segmentClass: "substantive", decision: { kind: "ignore" } };
    }
    if (text.includes("circle back"))
      return {
        segmentClass: "substantive",
        decision: { kind: "defer", topic: "topic-salary" },
      };
    if (text.includes("resuming"))
      return {
        segmentClass: "substantive",
        decision: { kind: "resume-deferred", topic: "topic-salary" },
      };
    if (text.includes("notice"))
      return {
        segmentClass: "substantive",
        decision: { kind: "open", taskKey: "q-notice" },
      };
    if (text.includes("migration"))
      return {
        segmentClass: "substantive",
        decision: { kind: "open", taskKey: "q-migration" },
      };
    void state;
    return { segmentClass: "substantive", decision: { kind: "ignore" } };
  },
});

const ids = (): IdGenerator => {
  let n = 0;
  return { next: (prefix) => `${prefix}-${++n}` };
};

async function runReplay() {
  let ledger = emptyLedger();
  let view = emptyTranscript();
  let tasks = emptyTaskState();
  const traces: TraceEvent[] = [];
  const outcomes: unknown[] = [];
  const policy = fakePolicy({ taskIds: {} });
  const generator = ids();
  const staleLog: Array<{ taskId: string; revision: number }> = [];
  for (const [index, line] of script.entries()) {
    const observation = toObservation(line, index);
    const decided = decideObservation(ledger, {
      observation,
      sessionStatus: "active",
      control,
    });
    if (decided.decision !== "accepted") throw new Error("expected accepted");
    ledger = decided.ledger;
    if (observation.kind !== "transcript.final") continue;
    const applied = applyTranscriptFinal(view, observation, decided.seq);
    view = applied.view;
    if (applied.supersededIds.length > 0) {
      const marked = markSegmentsSuperseded(tasks, applied.supersededIds);
      tasks = marked.state;
      staleLog.push(...marked.stale);
      traces.push(marked.trace);
    }
    // Decide only once the line is complete: skip utterances that a later
    // coalesced line will cover by processing from the effective view below.
  }
  const utterances = coalesceSegments(
    effectiveSegments(view),
    (segment: Segment) => BACKCHANNELS.has(segment.text),
  );
  return {
    ledger,
    view,
    tasks,
    utterances,
    policy,
    generator,
    traces,
    outcomes,
    staleLog,
  };
}

describe("recruiter-screen replay through the neutral core", () => {
  it("coalesces split segments across a backchannel and keeps the backchannel apart", async () => {
    const { utterances } = await runReplay();
    const question = utterances.find((u) => u.segmentIds.includes("s1"));
    expect(question?.segmentIds).toEqual(["s1", "s3"]);
    expect(question?.startMs).toBe(0);
    expect(question?.endMs).toBe(4000);
    const backchannel = utterances.find((u) => u.segmentIds.includes("s2"));
    expect(backchannel?.segmentIds).toEqual(["s2"]);
  });

  it("does not coalesce across a substantive interjection or another speaker's turn", () => {
    const seg = (
      id: string,
      speaker: string,
      startMs: number,
      text: string,
    ): Segment => ({
      eventId: id,
      sourceId: "x",
      speaker,
      startMs,
      endMs: startMs + 10,
      text,
      seq: startMs,
      supersededBy: null,
      originId: id,
    });
    const out = coalesceSegments(
      [
        seg("a", "interviewer", 0, "one"),
        seg("b", "candidate", 20, "a real answer"),
        seg("c", "interviewer", 40, "two"),
      ],
      (s) => s.eventId === "never",
    );
    expect(out.map((u) => u.segmentIds)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("opens no task from backchannel or monologue, one task per question, and revises on part two", async () => {
    const run = await runReplay();
    let { tasks } = run;
    const { utterances, policy, generator } = run;
    const outcomes: string[] = [];
    for (const utterance of utterances) {
      const step = await processUtterance(tasks, policy, utterance, generator);
      tasks = step.state;
      outcomes.push(`${utterance.id}:${step.outcome.kind}`);
    }
    expect(outcomes).toEqual([
      "s1:opened",
      "s2:ignored",
      "s4:refused", // monologue open refused
      "s5:revised",
      "s5b:ignored",
      "s6:deferred",
      "s7:ignored",
      "s7b:ignored",
      "s9:opened",
      "s9b:ignored",
      "s10:resumed",
    ]);
    const summaries = openTaskSummaries(tasks);
    expect(summaries.map((s) => [s.taskKey, s.revision])).toEqual([
      ["q-migration", 2],
      ["q-notice", 1],
    ]);
    expect(Object.keys(tasks.byKey)).not.toContain("q-monologue");
  });

  it("supersedes the ASR error in the effective view and marks the answer built on it stale", async () => {
    // Build the task on the uncorrected segment, then deliver the correction.
    let view = emptyTranscript();
    let tasks = emptyTaskState();
    const generator = ids();
    const early = applyTranscriptFinal(
      view,
      toObservation(lineById("s8"), 7) as never,
      8,
    );
    view = early.view;
    const [utterance] = coalesceSegments(effectiveSegments(view), () => false);
    if (!utterance) throw new Error("expected utterance");
    const step = await processUtterance(
      tasks,
      fakePolicy({ taskIds: {} }),
      utterance,
      generator,
    );
    tasks = step.state;
    if (step.outcome.kind !== "opened") throw new Error("expected opened");
    const { taskId } = step.outcome;
    expect(revisionStanding(tasks, taskId, 1)).toBe("current");

    const correction = applyTranscriptFinal(
      view,
      toObservation(lineById("s9"), 8) as never,
      9,
    );
    expect(correction.supersededIds).toEqual(["s8"]);
    expect(isSuperseded(correction.view, "s8")).toBe(true);
    expect(effectiveSegments(correction.view).map((s) => s.eventId)).toEqual([
      "s9",
    ]);
    const marked = markSegmentsSuperseded(tasks, correction.supersededIds);
    expect(marked.stale).toEqual([{ taskId, revision: 1 }]);
    expect(revisionStanding(marked.state, taskId, 1)).toBe("source_superseded");
    // Marked, not edited: the revision keeps what it was built on.
    expect(marked.state.tasks[taskId]?.revisions[0]?.basedOn).toEqual(["s8"]);
    expect(tasks.tasks[taskId]?.revisions[0]?.sourceSuperseded).toBe(false);
    // A dispatch for the stale-source revision is suppressed.
    const dispatch = decideDispatch(
      emptyDispatchLedger(),
      marked.state,
      "active",
      {
        sessionId: "sess-1",
        taskId,
        revision: 1,
        actionKind: "draft",
      },
    );
    expect(dispatch).toMatchObject({
      decision: "suppressed",
      suppression: { reason: "source_superseded" },
    });
  });

  it("holds a correction that arrives before its target and supersedes on arrival", () => {
    const correction = applyTranscriptFinal(
      emptyTranscript(),
      toObservation(lineById("s9"), 8) as never,
      1,
    );
    expect(correction.supersededIds).toEqual([]);
    const target = applyTranscriptFinal(
      correction.view,
      toObservation(lineById("s8"), 7) as never,
      2,
    );
    expect(target.supersededIds).toEqual(["s8"]);
    expect(effectiveSegments(target.view).map((s) => s.eventId)).toEqual([
      "s9",
    ]);
  });

  it("keeps the deferred topic in task state until resumed", async () => {
    const { utterances, policy, generator } = await runReplay();
    let tasks = emptyTaskState();
    for (const utterance of utterances) {
      tasks = (await processUtterance(tasks, policy, utterance, generator))
        .state;
      if (utterance.id === "s6")
        expect(deferredTopics(tasks)).toEqual(["topic-salary"]);
    }
    expect(deferredTopics(tasks)).toEqual([]);
    expect(tasks.deferred["topic-salary"]?.status).toBe("resumed");
  });

  it("carries ids and counts only in traces, outcomes and suppression records", async () => {
    const run = await runReplay();
    let { tasks } = run;
    const records: unknown[] = [...run.traces];
    for (const utterance of run.utterances) {
      const step = await processUtterance(
        tasks,
        run.policy,
        utterance,
        run.generator,
      );
      tasks = step.state;
      records.push(step.trace, step.outcome);
    }
    const aTask = Object.keys(tasks.tasks)[0] ?? "none";
    records.push(
      decideDispatch(emptyDispatchLedger(), tasks, "paused", {
        sessionId: "sess-1",
        taskId: aTask,
        revision: 1,
        actionKind: "draft",
      }),
    );
    const serialised = JSON.stringify(records);
    for (const line of script) expect(serialised).not.toContain(line.text);
    expect(serialised).not.toContain("migration you led");
    expect(serialised).not.toContain("rollback");
    expect(serialised).not.toContain("salary topic later");
  });

  it("never lets the policy open or revise on a non-substantive segment", () => {
    const utterance = {
      id: "u",
      speaker: "candidate",
      segmentIds: ["x"],
      startMs: 0,
      endMs: 1,
      text: "synthetic",
    };
    const state = emptyTaskState();
    for (const segmentClass of [
      "backchannel",
      "filler",
      "monologue",
    ] as const) {
      const open = applyVerdict(
        state,
        utterance,
        segmentClass,
        { kind: "open", taskKey: "k" },
        ids(),
      );
      expect(open.outcome).toMatchObject({
        kind: "refused",
        reason: "non_substantive_segment",
      });
      expect(open.state).toBe(state);
    }
    const opened = applyVerdict(
      state,
      utterance,
      "substantive",
      { kind: "open", taskKey: "k" },
      ids(),
    );
    if (opened.outcome.kind !== "opened") throw new Error("expected opened");
    const revise = applyVerdict(
      opened.state,
      utterance,
      "filler",
      {
        kind: "revise",
        taskId: opened.outcome.taskId,
        reason: "correction",
      },
      ids(),
    );
    expect(revise.outcome).toMatchObject({
      kind: "refused",
      reason: "non_substantive_segment",
    });
    expect(revise.state.tasks[opened.outcome.taskId]?.revision).toBe(1);
  });

  it("enforces one logical task per question and id-shaped handles", () => {
    const utterance = {
      id: "u",
      speaker: "interviewer",
      segmentIds: ["x"],
      startMs: 0,
      endMs: 1,
      text: "synthetic",
    };
    const generator = ids();
    const first = applyVerdict(
      emptyTaskState(),
      utterance,
      "substantive",
      { kind: "open", taskKey: "q1" },
      generator,
    );
    const second = applyVerdict(
      first.state,
      utterance,
      "substantive",
      { kind: "open", taskKey: "q1" },
      generator,
    );
    expect(second.outcome).toMatchObject({
      kind: "refused",
      reason: "task_exists",
    });
    expect(Object.keys(second.state.tasks)).toHaveLength(1);
    const freeText = applyVerdict(
      emptyTaskState(),
      utterance,
      "substantive",
      { kind: "open", taskKey: "what is your notice period" },
      generator,
    );
    expect(freeText.outcome).toMatchObject({ reason: "invalid_handle" });
    expect(
      applyVerdict(
        emptyTaskState(),
        utterance,
        "substantive",
        { kind: "defer", topic: "has spaces" },
        generator,
      ).outcome,
    ).toMatchObject({ reason: "invalid_handle" });
    expect(
      applyVerdict(
        emptyTaskState(),
        utterance,
        "substantive",
        { kind: "resume-deferred", topic: "never-deferred" },
        generator,
      ).outcome,
    ).toMatchObject({ reason: "topic_not_deferred" });
    expect(
      applyVerdict(
        emptyTaskState(),
        utterance,
        "substantive",
        { kind: "revise", taskId: "ghost", reason: "constraint_changed" },
        generator,
      ).outcome,
    ).toMatchObject({ reason: "unknown_task" });
  });

  it("increments the revision only on revise and makes the earlier revision stale", () => {
    const utterance = {
      id: "u",
      speaker: "interviewer",
      segmentIds: ["x"],
      startMs: 0,
      endMs: 1,
      text: "synthetic",
    };
    const generator = ids();
    let step = applyVerdict(
      emptyTaskState(),
      utterance,
      "substantive",
      { kind: "open", taskKey: "q1" },
      generator,
    );
    if (step.outcome.kind !== "opened") throw new Error("expected opened");
    const { taskId } = step.outcome;
    // An ignore (an unrelated sentence) leaves the revision alone.
    step = applyVerdict(
      step.state,
      utterance,
      "substantive",
      { kind: "ignore" },
      generator,
    );
    expect(step.state.tasks[taskId]?.revision).toBe(1);
    step = applyVerdict(
      step.state,
      utterance,
      "substantive",
      { kind: "revise", taskId, reason: "constraint_changed" },
      generator,
    );
    expect(step.outcome).toEqual({ kind: "revised", taskId, revision: 2 });
    expect(revisionStanding(step.state, taskId, 1)).toBe("outdated");
    expect(revisionStanding(step.state, taskId, 2)).toBe("current");
    expect(revisionStanding(step.state, taskId, 9)).toBe("unknown");
  });
});

describe("dispatch decisions (rule:idempotent-dispatch, rule:pause-end-suppression)", () => {
  const request = {
    sessionId: "sess-1",
    taskId: "task-1",
    revision: 1,
    actionKind: "draft",
  };
  const tasksWithOne = () => {
    const utterance = {
      id: "u",
      speaker: "interviewer",
      segmentIds: ["x"],
      startMs: 0,
      endMs: 1,
      text: "synthetic",
    };
    const step = applyVerdict(
      emptyTaskState(),
      utterance,
      "substantive",
      { kind: "open", taskKey: "q1" },
      { next: () => "task-1" },
    );
    return step.state;
  };

  it("dispatches once per session, task, revision and action kind", () => {
    const tasks = tasksWithOne();
    const first = decideDispatch(
      emptyDispatchLedger(),
      tasks,
      "active",
      request,
    );
    expect(first).toMatchObject({ decision: "dispatch", attempt: 1 });
    if (first.decision !== "dispatch") return;
    // In-flight resend is a duplicate.
    expect(
      decideDispatch(first.ledger, tasks, "active", request),
    ).toMatchObject({
      decision: "duplicate",
      existing: "in-flight",
    });
    // A different action kind is a different key.
    expect(
      decideDispatch(first.ledger, tasks, "active", {
        ...request,
        actionKind: "retrieve",
      }).decision,
    ).toBe("dispatch");
    // A different session is a different key.
    expect(
      decideDispatch(first.ledger, tasks, "active", {
        ...request,
        sessionId: "sess-2",
      }).decision,
    ).toBe("dispatch");
    const done = recordDispatchOutcome(first.ledger, first.key, "succeeded");
    expect(decideDispatch(done, tasks, "active", request)).toMatchObject({
      decision: "duplicate",
      existing: "succeeded",
    });
  });

  it("records a failure and allows a retry that is then deduplicated", () => {
    const tasks = tasksWithOne();
    const first = decideDispatch(
      emptyDispatchLedger(),
      tasks,
      "active",
      request,
    );
    if (first.decision !== "dispatch") throw new Error("expected dispatch");
    const failed = recordDispatchOutcome(first.ledger, first.key, "failed");
    expect(failed.entries[first.key]?.status).toBe("failed");
    const retry = decideDispatch(failed, tasks, "active", request);
    expect(retry).toMatchObject({ decision: "dispatch", attempt: 2 });
    if (retry.decision !== "dispatch") return;
    expect(
      decideDispatch(retry.ledger, tasks, "active", request).decision,
    ).toBe("duplicate");
  });

  it("does not let a late report rewrite a settled outcome", () => {
    const tasks = tasksWithOne();
    const first = decideDispatch(
      emptyDispatchLedger(),
      tasks,
      "active",
      request,
    );
    if (first.decision !== "dispatch") throw new Error("expected dispatch");
    const done = recordDispatchOutcome(first.ledger, first.key, "succeeded");
    expect(recordDispatchOutcome(done, first.key, "failed")).toBe(done);
    expect(recordDispatchOutcome(done, "unknown-key", "failed")).toBe(done);
  });

  it("suppresses by session status with an ids-only record", () => {
    const tasks = tasksWithOne();
    for (const [status, reason] of [
      ["paused", "session_paused"],
      ["ended", "session_ended"],
      ["purging", "session_purging"],
      ["created", "session_not_active"],
    ] as const) {
      const result = decideDispatch(
        emptyDispatchLedger(),
        tasks,
        status,
        request,
      );
      expect(result).toMatchObject({
        decision: "suppressed",
        suppression: { ...request, reason },
      });
      expect(
        Object.keys(
          result.decision === "suppressed" ? result.suppression : {},
        ).sort(),
      ).toEqual(["actionKind", "reason", "revision", "sessionId", "taskId"]);
    }
  });

  it("suppresses a stale revision and an unknown task", () => {
    let tasks = tasksWithOne();
    const utterance = {
      id: "u",
      speaker: "interviewer",
      segmentIds: ["y"],
      startMs: 0,
      endMs: 1,
      text: "synthetic",
    };
    tasks = applyVerdict(
      tasks,
      utterance,
      "substantive",
      { kind: "revise", taskId: "task-1", reason: "constraint_changed" },
      { next: () => "n" },
    ).state;
    expect(
      decideDispatch(emptyDispatchLedger(), tasks, "active", request),
    ).toMatchObject({
      decision: "suppressed",
      suppression: { reason: "revision_stale" },
    });
    expect(
      decideDispatch(emptyDispatchLedger(), tasks, "active", {
        ...request,
        taskId: "ghost",
      }),
    ).toMatchObject({
      decision: "suppressed",
      suppression: { reason: "task_unknown" },
    });
    expect(
      decideDispatch(emptyDispatchLedger(), tasks, "active", {
        ...request,
        revision: 2,
      }).decision,
    ).toBe("dispatch");
  });
});
