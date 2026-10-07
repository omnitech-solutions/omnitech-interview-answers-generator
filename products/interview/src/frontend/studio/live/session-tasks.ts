// Tasks: one per task id, with every revision, built from the session's
// actions. The stream carries no task table, so a task is what its actions say
// it is: its current revision is the highest revision any action ran for, its
// kind comes from the answer's category (or from a coding action), and its
// constraints come from the coding briefs of its revisions.
import type {
  LiveAction,
  LiveRevisionReason,
  LiveSessionStatus,
} from "@omnitech/interview-contracts";
import {
  type AgentResult,
  type AnswerResult,
  type CodeResult,
  parseAgentResult,
  parseAnswerResult,
  parseCodeResult,
} from "./session-results";
import { type ActivityRun, activityRun, type RunContext } from "./session-runs";

// What the task is, for the panel to show.
//   experience-question     asks about the candidate's own experience, answered
//                           from the pinned matrix (background, motivation,
//                           story, leaving a role)
//   leadership-behavioural  a STAR-shaped outline from approved experience
//   logistics               notice period, compensation, work arrangement:
//                           found in approved preferences or missing
//   concept                 technical background, labelled as general knowledge
//   programming-challenge   a coding task with a Workspace draft and tests
//   other                   questions to ask, or anything uncategorised
//   unclassified            no answer has been published yet
export type TaskKind =
  | "experience-question"
  | "leadership-behavioural"
  | "logistics"
  | "concept"
  | "programming-challenge"
  | "other"
  | "unclassified";

const KIND_OF_CATEGORY: Record<string, TaskKind> = {
  background: "experience-question",
  motivation: "experience-question",
  "experience-story": "experience-question",
  "leaving-role": "experience-question",
  "leadership-behavioural": "leadership-behavioural",
  logistics: "logistics",
  "technical-concept": "concept",
  coding: "programming-challenge",
  "questions-to-ask": "other",
  other: "other",
};

export type TaskRevisionView = {
  revision: number;
  current: boolean;
  // The latest run per action kind, in the order drafts, code, agent.
  runs: ActivityRun[];
  answerRun: ActivityRun | null;
  codeRun: ActivityRun | null;
  agentRun: ActivityRun | null;
  answer: AnswerResult | null;
  code: CodeResult | null;
  agent: AgentResult | null;
  // Why the owner's own input made this revision (regenerate, added
  // screenshot), as the server recorded it; null for any other revision.
  reason: LiveRevisionReason | null;
  // The capture behind this revision showed no interview question (D36): the
  // server's flag on its draft-answer action, never inferred from the text.
  noQuestion: boolean;
  firstSeenAt: string;
};

export type ConstraintView = {
  text: string;
  status: "current" | "superseded";
  // The first revision whose brief carried it.
  sinceRevision: number;
  // The first later revision whose brief no longer carries it.
  supersededAtRevision: number | null;
};

export type TaskView = {
  taskId: string;
  kind: TaskKind;
  // The restated coding task, when the brief has one.
  title: string | null;
  currentRevision: number;
  revisions: TaskRevisionView[];
  current: TaskRevisionView;
  // What to show: the current revision's results, or, until they exist, the
  // newest earlier ones marked stale (never presented as current).
  answer: AnswerResult | null;
  answerStale: boolean;
  code: CodeResult | null;
  codeStale: boolean;
  // The newest solution that was written to the Workspace draft (or predates
  // the write). Its states and tests are what the draft holds; a held result
  // is never what the status grid describes.
  draftCode: CodeResult | null;
  // The current revision's held result: a suggestion the owner has not
  // accepted, with its own states.
  suggestion: CodeResult | null;
  constraints: ConstraintView[];
  // The Workspace draft the newest published solution wrote, if any.
  draft: {
    workspaceId: string;
    artifactId: string;
    artifactRevision: number;
  } | null;
  // The current revision's solution is held because the draft was edited.
  heldResult: boolean;
  // EVERY revision showed no interview question: never a real task, so
  // deriveTasks leaves it out (see deriveNoQuestionTasks). A real task whose
  // newest revision found none keeps this false; read the revision's own flag.
  noQuestion: boolean;
  // Where the task sits in numbering: when it first counted as a real task
  // (its first revision that is not a no-question one). Equals firstSeenAt
  // for every task that was real from the start.
  realSince: string;
  firstSeenAt: string;
};

// The latest run per kind: highest attempt, then latest update.
function latestOf(actions: readonly LiveAction[]): LiveAction | null {
  return (
    [...actions].sort(
      (a, b) =>
        a.attempt - b.attempt ||
        Date.parse(a.updatedAt) - Date.parse(b.updatedAt),
    )[actions.length - 1] ?? null
  );
}

function revisionView(
  revision: number,
  actions: readonly LiveAction[],
  context: RunContext,
): TaskRevisionView {
  const of = (kind: string) =>
    latestOf(actions.filter((a) => a.actionKind === kind));
  const answer = of("draft-answer");
  const code = of("solve-code");
  const agent = of("agent-solve");
  const run = (action: LiveAction | null) =>
    action ? activityRun(action, context) : null;
  const answerRun = run(answer);
  const codeRun = run(code);
  const agentRun = run(agent);
  // Results are read only from a run that published (or was held, whose
  // solution is kept as a suggestion).
  const shows = (r: ActivityRun | null) =>
    r?.state === "published" ||
    r?.state === "superseded" ||
    r?.state === "held-conflict";
  return {
    revision,
    current: revision >= context.currentRevision,
    runs: [answerRun, codeRun, agentRun].filter(
      (r): r is ActivityRun => r !== null,
    ),
    answerRun,
    codeRun,
    agentRun,
    // A draft still being written shows as the answer so far (its claims come
    // with the publish); the run stays "running" beside it.
    answer:
      answer && shows(answerRun)
        ? parseAnswerResult(answer.result)
        : answer?.progress
          ? parseAnswerResult({
              category: "other",
              draft: answer.progress.draft,
              claims: [],
            })
          : null,
    code: code && shows(codeRun) ? parseCodeResult(code.result) : null,
    agent: agent ? parseAgentResult(agent.result) : null,
    reason: actions.find((a) => a.revisionReason)?.revisionReason ?? null,
    noQuestion: answer?.noQuestion === true,
    firstSeenAt: actions
      .map((a) => a.createdAt)
      .sort((x, y) => Date.parse(x) - Date.parse(y))[0] as string,
  };
}

// Constraints across revisions: a later brief's list is the truth; an earlier
// constraint it no longer lists is superseded, not deleted.
export function constraintHistory(
  revisions: readonly TaskRevisionView[],
): ConstraintView[] {
  const briefs = revisions
    .filter((r) => r.answer?.codingBrief)
    .map((r) => ({
      revision: r.revision,
      list: r.answer?.codingBrief?.constraints ?? [],
    }));
  if (briefs.length === 0) return [];
  const latest = briefs[briefs.length - 1] as (typeof briefs)[number];
  const seen = new Map<string, ConstraintView>();
  briefs.forEach(({ revision, list }, position) => {
    for (const text of list) {
      const known = seen.get(text);
      if (known) continue;
      const later = briefs
        .slice(position + 1)
        .find((b) => !b.list.includes(text));
      seen.set(text, {
        text,
        status: latest.list.includes(text) ? "current" : "superseded",
        sinceRevision: revision,
        supersededAtRevision: latest.list.includes(text)
          ? null
          : (later?.revision ?? null),
      });
    }
  });
  return [...seen.values()];
}

function buildTasks(
  actions: readonly LiveAction[],
  sessionStatus: LiveSessionStatus,
): TaskView[] {
  const currentFence = Math.max(0, ...actions.map((a) => a.fenceAtDispatch));
  const byTask = new Map<string, LiveAction[]>();
  for (const action of actions)
    byTask.set(action.taskId, [...(byTask.get(action.taskId) ?? []), action]);

  const tasks: TaskView[] = [];
  for (const [taskId, taskActions] of byTask) {
    const currentRevision = Math.max(...taskActions.map((a) => a.taskRevision));
    const context: RunContext = {
      currentRevision,
      currentFence,
      sessionStatus,
    };
    const revisions = [...new Set(taskActions.map((a) => a.taskRevision))]
      .sort((a, b) => a - b)
      .map((revision) =>
        revisionView(
          revision,
          taskActions.filter((a) => a.taskRevision === revision),
          context,
        ),
      );
    const current = revisions[revisions.length - 1] as TaskRevisionView;
    const newest = <T>(pick: (r: TaskRevisionView) => T | null): T | null =>
      [...revisions]
        .reverse()
        .map(pick)
        .find((value) => value !== null) ?? null;
    // A no-question revision never replaces what an earlier real revision
    // answered: that answer stays (Outdated), the new revision just says so.
    const answer = newest((r) => (r.noQuestion ? null : r.answer));
    const code = newest((r) => r.code);
    const coding =
      code !== null ||
      revisions.some((r) => r.codeRun || r.agentRun) ||
      answer?.category === "coding";
    const written = [...revisions]
      .reverse()
      .find((r) => r.code && r.code.workspace?.published !== false);
    tasks.push({
      taskId,
      kind: coding
        ? "programming-challenge"
        : answer
          ? (KIND_OF_CATEGORY[answer.category] ?? "other")
          : "unclassified",
      title: newest((r) => r.answer?.codingBrief?.restatement ?? null),
      currentRevision,
      revisions,
      current,
      answer,
      answerStale:
        answer !== null && (current.answer === null || current.noQuestion),
      code,
      codeStale: code !== null && current.code === null,
      constraints: constraintHistory(revisions),
      draftCode: written?.code ?? null,
      suggestion:
        current.codeRun?.state === "held-conflict" ? current.code : null,
      draft:
        written?.code?.workspace?.published === true
          ? {
              workspaceId: written.code.workspace.workspaceId,
              artifactId: written.code.workspace.artifactId,
              artifactRevision: written.code.workspace.artifactRevision,
            }
          : null,
      heldResult: current.codeRun?.state === "held-conflict",
      // Never real: every revision showed no interview question. A real task
      // whose NEWEST revision found none stays a task (D34/D36); that
      // revision alone is labelled "No question found".
      noQuestion: revisions.every((r) => r.noQuestion),
      realSince: (revisions.find((r) => !r.noQuestion) ?? current).firstSeenAt,
      firstSeenAt: revisions[0]?.firstSeenAt as string,
    });
  }
  return tasks;
}

// The tasks, oldest first, REAL ones only (D36): a task whose current revision
// showed no interview question is not one. This is the one place that rule
// lives; ordinals, "newest", chips, targets and every other surface read this
// list. Order is by when a task started counting, so a no-question task that
// a follow-up later turns real takes the next number at that moment and no
// existing number moves.
export function deriveTasks(
  actions: readonly LiveAction[],
  sessionStatus: LiveSessionStatus,
): TaskView[] {
  return partitionTasks(buildTasks(actions, sessionStatus)).real;
}

// One build, split in two (the stream derive needs both lists).
export function partitionTasks(built: readonly TaskView[]): {
  real: TaskView[];
  noQuestion: TaskView[];
} {
  // Accepted limit (T36 finding 8): an in-flight first capture counts as a
  // real task until it is classified, so its progress steps can show.
  return {
    real: built
      .filter((task) => !task.noQuestion)
      .sort((a, b) => Date.parse(a.realSince) - Date.parse(b.realSince)),
    noQuestion: built
      .filter((task) => task.noQuestion)
      .sort((a, b) => Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt)),
  };
}

export const buildTaskViews = buildTasks;

// The captures that showed no interview question, oldest first.
export function deriveNoQuestionTasks(
  actions: readonly LiveAction[],
  sessionStatus: LiveSessionStatus,
): TaskView[] {
  return partitionTasks(buildTasks(actions, sessionStatus)).noQuestion;
}
