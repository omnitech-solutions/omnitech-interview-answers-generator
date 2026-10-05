// One task, as both the native panel and the web page describe it: identity
// (T and S numbers), what kind of task it is, the three stages and what is
// established about the code. Pure; every fact comes from the session's own
// runs and the server's code states, so the two surfaces cannot drift. Layout
// stays with each surface.
//
// Generated, tests passed and fully verified are three separate facts. "Fully
// verified" is established only when the server says fullyVerified (see
// code-states.ts); generated tests passing never stands in for it.
import type {
  LiveAction,
  LiveGeneratedBy,
  LiveMissingContext,
  LiveObservation,
} from "@omnitech/interview-contracts";
import type { IconName } from "../../icon";
import { solution } from "../overlay/overlay-model";
import { STATE_REASON } from "../session-draft-facts";
import type { ActivityRun, RunTone } from "../session-runs";
import type { ConstraintView, TaskKind, TaskView } from "../session-tasks";
import { TASK_KIND } from "./task-kind";
import { taskName } from "./task-name";
import { taskLabel, taskOrdinal } from "./task-target";

// ---- Stages -------------------------------------------------------------------

const STAGES = [
  { id: "answer", label: "Answer" },
  { id: "code", label: "Code" },
  { id: "verified", label: "Fully verified" },
] as const;
type StageId = (typeof STAGES)[number]["id"];

// waiting         not started yet
// running         work in flight
// done            finished and, for "verified", established by the server
// stopped         ended without a result (cancelled, discarded or failed)
// unavailable     cannot happen here (policy, device-only, not a coding task)
// not-established nothing says it is true; never read as "failed"
export type StageState =
  | "waiting"
  | "running"
  | "done"
  | "stopped"
  | "unavailable"
  | "not-established";

type CardStage = {
  id: StageId;
  label: string;
  state: StageState;
  // A short plain-words reason or count; null when the state says it all.
  detail: string | null;
};

export const STAGE_PRESENTATION: Record<
  StageState,
  { icon: IconName; tone: RunTone; word: string }
> = {
  waiting: { icon: "schedule", tone: "neutral", word: "Waiting" },
  running: { icon: "pending", tone: "accent", word: "Running" },
  done: { icon: "check_circle", tone: "green", word: "Done" },
  stopped: { icon: "stop_circle", tone: "amber", word: "Stopped" },
  unavailable: { icon: "lock", tone: "neutral", word: "Unavailable" },
  "not-established": {
    icon: "radio_button_unchecked",
    tone: "neutral",
    word: "Not established",
  },
};

const DEVICE_ONLY_CODE =
  "Device-only mode: the code runner does not run on this Mac.";
const NOT_CODING = "Not a coding question.";

type StageOutcome = Pick<CardStage, "state" | "detail">;

// A run's own state as a stage state. Only a published (or held, or since
// replaced) result is "done".
function outcomeOf(run: ActivityRun | null): StageOutcome {
  if (!run) return { state: "waiting", detail: null };
  switch (run.state) {
    case "published":
    case "superseded":
      return { state: "done", detail: null };
    case "held-conflict":
      return { state: "done", detail: "Held as a suggestion" };
    case "running":
      return { state: "running", detail: null };
    case "cancelling":
      return { state: "running", detail: "Cancelling" };
    case "cancelled":
    case "discarded":
      return { state: "stopped", detail: run.reasonLabel ?? run.label };
    case "failed":
      return { state: "stopped", detail: run.reasonLabel ?? run.label };
    case "refused":
      return { state: "unavailable", detail: run.reasonLabel ?? run.label };
  }
}

const testsLine = (
  tests: { total: number; passed: number } | undefined,
): string | null =>
  tests && tests.total > 0
    ? `${tests.passed}/${tests.total} generated tests`
    : null;

function answerStage(task: TaskView): StageOutcome {
  const outcome = outcomeOf(task.current.answerRun);
  // An earlier revision's answer on show: say what the stage waits for.
  return outcome.state === "waiting" && task.answer
    ? {
        state: "waiting",
        detail: `Waiting for revision ${task.currentRevision}`,
      }
    : outcome;
}

function codeStage(task: TaskView, deviceOnly: boolean): StageOutcome {
  const run = task.current.codeRun;
  if (!run) {
    if (task.kind === "unclassified") return { state: "waiting", detail: null };
    if (task.kind !== "programming-challenge" && !task.code)
      return { state: "unavailable", detail: NOT_CODING };
    if (deviceOnly) return { state: "unavailable", detail: DEVICE_ONLY_CODE };
    return { state: "waiting", detail: null };
  }
  const outcome = outcomeOf(run);
  if (outcome.state !== "done") return outcome;
  const counts = testsLine((task.draftCode ?? task.code)?.tests);
  return {
    state: "done",
    detail: [outcome.detail, counts].filter(Boolean).join(" · ") || null,
  };
}

function verifiedStage(task: TaskView, code: StageOutcome): StageOutcome {
  const result = task.draftCode ?? task.code;
  if (result?.states.fullyVerified) return { state: "done", detail: null };
  if (code.state === "unavailable") return code;
  if (!result) return { state: "not-established", detail: "No solution yet" };
  const why = result.states.reasons
    .map((reason) => STATE_REASON[reason])
    .filter((text): text is string => text !== undefined);
  return {
    state: "not-established",
    detail: why.length > 0 ? why.join(" ") : "The server did not verify it.",
  };
}

// ---- Badges ---------------------------------------------------------------------

export type CardBadge = {
  id: "generated" | "tests" | "verified";
  label: string;
  ok: boolean;
};

// Only what the server reports: "n/n generated tests" only when it counted them.
export function badgesOf(task: TaskView): CardBadge[] {
  const result = task.draftCode ?? task.code;
  if (!result) return [];
  const { states, tests } = result;
  return [
    { id: "generated", label: "Generated", ok: states.generated },
    {
      id: "tests",
      label:
        testsLine(tests) ??
        (states.testsPassed
          ? "Generated tests passed"
          : "Generated tests not passed"),
      ok: states.testsPassed,
    },
    {
      id: "verified",
      label: states.fullyVerified ? "Fully verified" : "Not fully verified",
      ok: states.fullyVerified,
    },
  ];
}

// ---- Model label ------------------------------------------------------------------

const RUNTIME_LABEL: Record<string, string> = {
  "claude-code": "Claude",
  codex: "Codex",
};

const labelOfRuntime = (by: LiveGeneratedBy): string =>
  `${RUNTIME_LABEL[by.runtime] ?? by.runtime} · ${by.model}`;

// "Claude · claude-sonnet-5-5": what produced the latest answer, or null before
// the first one. Display only; nothing depends on it.
export function generatedByLabel(
  actions: readonly LiveAction[],
): string | null {
  const latest = actions
    .filter(
      (action) => action.generatedBy && action.dispatchStatus === "succeeded",
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  return latest?.generatedBy ? labelOfRuntime(latest.generatedBy) : null;
}

// ---- Missing context ----------------------------------------------------------------

// What the model said it could not see for a task: from its newest succeeded
// answer draft for the task's current revision, or none. A newer draft that
// reports nothing missing clears an older one's list.
export function missingContextFor(
  actions: readonly LiveAction[],
  task: TaskView | undefined,
): LiveMissingContext | null {
  if (!task) return null;
  const draft = actions
    .filter(
      (action) =>
        action.taskId === task.taskId &&
        action.taskRevision === task.currentRevision &&
        action.actionKind === "draft-answer" &&
        action.dispatchStatus === "succeeded",
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  return draft?.missingContext?.length ? draft.missingContext : null;
}

// ---- Screenshot numbers -------------------------------------------------------------

const SCREEN_SNAPSHOT = "screen.snapshot";
export type SnapshotRef = { sourceId: string; eventId: string };
const snapshotKey = (ref: SnapshotRef): string =>
  `${ref.sourceId}\u0000${ref.eventId}`;

// S1, S2, ... in the order the screenshots arrived (stream sequence), however
// the pages were read and whatever gaps the sequence has. A repeat of the same
// observation is one screenshot.
export function snapshotOrdinals(
  observations: readonly LiveObservation[],
): Map<string, number> {
  const ordinals = new Map<string, number>();
  const shots = observations
    .filter((observation) => observation.kind === SCREEN_SNAPSHOT)
    .sort((a, b) => a.sequence - b.sequence);
  for (const shot of shots) {
    const key = snapshotKey(shot);
    if (!ordinals.has(key)) ordinals.set(key, ordinals.size + 1);
  }
  return ordinals;
}

// null when the screenshot the task came from is not known or no longer held.
// Nothing is guessed from timing.
export function snapshotLabelOf(
  ref: SnapshotRef | null | undefined,
  ordinals: ReadonlyMap<string, number>,
): string | null {
  const ordinal = ref ? ordinals.get(snapshotKey(ref)) : undefined;
  return ordinal === undefined ? null : `S${ordinal}`;
}

// The screenshot a task was started from: the first one its earliest action
// (by revision, then creation) rests on. null when no action names one, as for
// a task built on speech alone or a device-only session; never guessed.
export function sourceSnapshotOf(
  actions: readonly LiveAction[],
  taskId: string,
): SnapshotRef | null {
  const own = actions
    .filter((action) => action.taskId === taskId && action.sourceSnapshots?.[0])
    .sort(
      (a, b) =>
        a.taskRevision - b.taskRevision ||
        Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
  return own[0]?.sourceSnapshots?.[0] ?? null;
}

// ---- The card -----------------------------------------------------------------------

export type TaskCardInput = {
  tasks: readonly TaskView[];
  actions: readonly LiveAction[];
  observations: readonly LiveObservation[];
  // The task the person chose; null or unknown means the newest.
  selectedTaskId: string | null;
  // The session's processing policy is device-only.
  deviceOnly: boolean;
};

export type TaskCard = {
  taskId: string;
  ordinal: number;
  // "T2"
  label: string;
  // "S3", or null when the screenshot is not known.
  snapshotLabel: string | null;
  // The task on show is not the newest one.
  earlier: boolean;
  name: string;
  kind: { id: TaskKind; label: string; icon: IconName };
  revision: number;
  // The answer on show belongs to an older revision.
  answerStale: boolean;
  constraints: readonly ConstraintView[];
  stages: readonly [CardStage, CardStage, CardStage];
  badges: readonly CardBadge[];
  // "Claude · claude-sonnet-5-5" for this task's latest answer, or null.
  modelLabel: string | null;
  missingContext: LiveMissingContext | null;
  // The published answer's own words; no structured sections are invented.
  answerText: string | null;
  restatement: string | null;
  code: { language: string; text: string; revision: number | null } | null;
};

export function taskCardModel(input: TaskCardInput): TaskCard | null {
  const { tasks } = input;
  const task =
    tasks.find((each) => each.taskId === input.selectedTaskId) ??
    tasks[tasks.length - 1];
  if (!task) return null;
  const ordinal = taskOrdinal(tasks, task.taskId) ?? tasks.length;
  const code = codeStage(task, input.deviceOnly);
  const outcomes: Record<StageId, StageOutcome> = {
    answer: answerStage(task),
    code,
    verified: verifiedStage(task, code),
  };
  const shown = solution(task);
  const own = input.actions.filter((action) => action.taskId === task.taskId);
  return {
    taskId: task.taskId,
    ordinal,
    label: taskLabel(ordinal),
    snapshotLabel: snapshotLabelOf(
      sourceSnapshotOf(input.actions, task.taskId),
      snapshotOrdinals(input.observations),
    ),
    earlier: task !== tasks[tasks.length - 1],
    name: taskName(task),
    kind: { id: task.kind, ...TASK_KIND[task.kind] },
    revision: task.currentRevision,
    answerStale: task.answerStale,
    constraints: task.constraints,
    stages: [
      { ...STAGES[0], ...outcomes.answer },
      { ...STAGES[1], ...outcomes.code },
      { ...STAGES[2], ...outcomes.verified },
    ],
    badges: badgesOf(task),
    modelLabel: generatedByLabel(own),
    missingContext: missingContextFor(input.actions, task),
    answerText: task.answer?.draft ?? null,
    restatement: task.answer?.codingBrief?.restatement ?? null,
    code: shown
      ? { language: shown.language, text: shown.code, revision: shown.revision }
      : null,
  };
}
