// Task state behind the injected TaskPolicy port. The policy decides what an
// utterance means; this module enforces the mechanics: one logical task per
// question, revisions rise only when the policy says revise, older revisions
// become stale, deferred topics are kept, and non-substantive segments never
// open or revise. It never inspects text (rule:id-only-traces).
import {
  type IdGenerator,
  isOpaqueHandle,
  type OpenTaskSummary,
  type RevisionReason,
  type SegmentClass,
  type TaskDecision,
  type TaskPolicy,
  type TraceEvent,
  type Utterance,
} from "./ports.js";

export type TaskRevision = {
  revision: number;
  // Segment ids this revision was built on.
  basedOn: readonly string[];
  reason: RevisionReason | "opened";
  // Set when a segment the revision was built on was later superseded.
  sourceSuperseded: boolean;
};

export type Task = {
  taskId: string;
  taskKey: string;
  revision: number;
  revisions: readonly TaskRevision[];
};

export type DeferredTopic = {
  topic: string;
  status: "deferred" | "resumed";
  deferredAtUtterance: string;
};

export type TaskState = {
  tasks: Readonly<Record<string, Task>>;
  byKey: Readonly<Record<string, string>>;
  deferred: Readonly<Record<string, DeferredTopic>>;
};

export const emptyTaskState = (): TaskState => ({
  tasks: {},
  byKey: {},
  deferred: {},
});

export type TaskRefusal =
  | "non_substantive_segment"
  | "invalid_handle"
  | "task_exists"
  | "unknown_task"
  | "topic_not_deferred";

export type TaskOutcome =
  | { kind: "ignored" }
  | { kind: "opened"; taskId: string; revision: 1 }
  | { kind: "revised"; taskId: string; revision: number }
  | { kind: "deferred"; topic: string }
  | { kind: "resumed"; topic: string }
  | {
      kind: "refused";
      reason: TaskRefusal;
      utteranceId: string;
      taskId?: string;
    };

export type TaskStep = {
  state: TaskState;
  outcome: TaskOutcome;
  trace: TraceEvent;
};

const NON_SUBSTANTIVE: readonly SegmentClass[] = [
  "backchannel",
  "filler",
  "monologue",
];

export const openTaskSummaries = (
  state: TaskState,
): readonly OpenTaskSummary[] =>
  Object.values(state.tasks).map((task) => ({
    taskId: task.taskId,
    taskKey: task.taskKey,
    revision: task.revision,
  }));

export const deferredTopics = (state: TaskState): readonly string[] =>
  Object.values(state.deferred)
    .filter((entry) => entry.status === "deferred")
    .map((entry) => entry.topic);

// Apply one policy verdict to the state. Pure; ids come from the injected source.
export function applyVerdict(
  state: TaskState,
  utterance: Utterance,
  segmentClass: SegmentClass,
  decision: TaskDecision,
  ids: IdGenerator,
): TaskStep {
  const refuse = (reason: TaskRefusal, taskId?: string): TaskStep => ({
    state,
    outcome: {
      kind: "refused",
      reason,
      utteranceId: utterance.id,
      ...(taskId ? { taskId } : {}),
    },
    trace: {
      event: "task.refused",
      ids: {
        utteranceId: utterance.id,
        reason,
        ...(taskId ? { taskId } : {}),
      },
    },
  });
  const step = (
    next: TaskState,
    outcome: TaskOutcome,
    traceIds: Record<string, string | number>,
  ): TaskStep => ({
    state: next,
    outcome,
    trace: {
      event: `task.${outcome.kind}`,
      ids: { utteranceId: utterance.id, ...traceIds },
    },
  });

  switch (decision.kind) {
    case "ignore":
      return step(state, { kind: "ignored" }, {});

    case "open": {
      // [GUARD] Backchannel, filler and monologue never open a task.
      if (NON_SUBSTANTIVE.includes(segmentClass))
        return refuse("non_substantive_segment");
      if (!isOpaqueHandle(decision.taskKey)) return refuse("invalid_handle");
      // One logical task per question: a repeated key is not a second task.
      const existing = state.byKey[decision.taskKey];
      if (existing) return refuse("task_exists", existing);
      const taskId = ids.next("task");
      const task: Task = {
        taskId,
        taskKey: decision.taskKey,
        revision: 1,
        revisions: [
          {
            revision: 1,
            basedOn: utterance.segmentIds,
            reason: "opened",
            sourceSuperseded: false,
          },
        ],
      };
      return step(
        {
          ...state,
          tasks: { ...state.tasks, [taskId]: task },
          byKey: { ...state.byKey, [decision.taskKey]: taskId },
        },
        { kind: "opened", taskId, revision: 1 },
        { taskId, revision: 1 },
      );
    }

    case "revise": {
      if (NON_SUBSTANTIVE.includes(segmentClass))
        return refuse("non_substantive_segment", decision.taskId);
      const task = state.tasks[decision.taskId];
      if (!task) return refuse("unknown_task", decision.taskId);
      // The revision rises only here, and only because the policy said so.
      const revision = task.revision + 1;
      const next: Task = {
        ...task,
        revision,
        revisions: [
          ...task.revisions,
          {
            revision,
            basedOn: utterance.segmentIds,
            reason: decision.reason,
            sourceSuperseded: false,
          },
        ],
      };
      return step(
        { ...state, tasks: { ...state.tasks, [task.taskId]: next } },
        { kind: "revised", taskId: task.taskId, revision },
        { taskId: task.taskId, revision },
      );
    }

    case "defer": {
      if (!isOpaqueHandle(decision.topic)) return refuse("invalid_handle");
      // Deferring again keeps the original record (idempotent).
      if (state.deferred[decision.topic]?.status === "deferred")
        return step(state, { kind: "deferred", topic: decision.topic }, {});
      return step(
        {
          ...state,
          deferred: {
            ...state.deferred,
            [decision.topic]: {
              topic: decision.topic,
              status: "deferred",
              deferredAtUtterance: utterance.id,
            },
          },
        },
        { kind: "deferred", topic: decision.topic },
        { topic: decision.topic },
      );
    }

    case "resume-deferred": {
      if (!isOpaqueHandle(decision.topic)) return refuse("invalid_handle");
      const entry = state.deferred[decision.topic];
      if (!entry || entry.status !== "deferred")
        return refuse("topic_not_deferred");
      return step(
        {
          ...state,
          deferred: {
            ...state.deferred,
            [decision.topic]: { ...entry, status: "resumed" },
          },
        },
        { kind: "resumed", topic: decision.topic },
        { topic: decision.topic },
      );
    }
  }
}

// Ask the policy about one utterance and apply its verdict.
export async function processUtterance(
  state: TaskState,
  policy: TaskPolicy,
  utterance: Utterance,
  ids: IdGenerator,
): Promise<TaskStep> {
  const verdict = await policy.decide({
    utterance,
    openTasks: openTaskSummaries(state),
    deferredTopics: deferredTopics(state),
  });
  return applyVerdict(
    state,
    utterance,
    verdict.segmentClass,
    verdict.decision,
    ids,
  );
}

export type StaleRevision = { taskId: string; revision: number };

// Mark every revision built on a superseded segment stale. The revision is
// flagged, never edited, so the history of what it was built on is kept.
export function markSegmentsSuperseded(
  state: TaskState,
  supersededIds: readonly string[],
): { state: TaskState; stale: readonly StaleRevision[]; trace: TraceEvent } {
  const stale: StaleRevision[] = [];
  const tasks: Record<string, Task> = { ...state.tasks };
  for (const task of Object.values(state.tasks)) {
    let touched = false;
    const revisions = task.revisions.map((entry) => {
      if (
        !entry.sourceSuperseded &&
        entry.basedOn.some((id) => supersededIds.includes(id))
      ) {
        touched = true;
        stale.push({ taskId: task.taskId, revision: entry.revision });
        return { ...entry, sourceSuperseded: true };
      }
      return entry;
    });
    if (touched) tasks[task.taskId] = { ...task, revisions };
  }
  return {
    state: { ...state, tasks },
    stale,
    trace: {
      event: "task.sources_superseded",
      ids: { supersededCount: supersededIds.length, staleCount: stale.length },
    },
  };
}

export type RevisionStanding =
  | "current"
  | "outdated"
  | "source_superseded"
  | "unknown";

// An earlier answer is stale once a newer revision exists; a revision whose
// source segment was superseded is stale even when it is the newest.
export function revisionStanding(
  state: TaskState,
  taskId: string,
  revision: number,
): RevisionStanding {
  const task = state.tasks[taskId];
  const entry = task?.revisions.find((r) => r.revision === revision);
  if (!task || !entry) return "unknown";
  if (revision !== task.revision) return "outdated";
  return entry.sourceSuperseded ? "source_superseded" : "current";
}
