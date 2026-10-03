// One held session's in-memory state and its replay through the neutral core.
// A run exists only while this worker holds the session's lease at one fence;
// a new claim (a restart, or a successor after expiry) builds a fresh run and
// replays the stored observations from the start, so nothing but the database
// outlives a fence. Replay is deterministic for the baseline policy: task ids
// come from a per-run counter, and the database's dispatch dedup (session, task,
// revision, action kind) is the safety net if it ever were not.
//
// The core decides ordering, supersession, task identity and revisions; this
// module only feeds it and never inspects utterance text. Screenshots are
// stored by ingest but not interpreted here: image interpretation is refused in
// device-only and belongs to loop 2.
import { transcriptFinalSchema } from "@omnitech/active-session-contracts";
import type { CodeRunner } from "@omnitech/code-runner";
import {
  ASSIST_ACTION_KIND,
  type AssistDraft,
  type CodingBrief,
  codingBriefSchema,
} from "./assist-stage.js";
import { CODING_ACTION_KIND, type PriorSolution } from "./coding-stage.js";
import {
  applyTranscriptFinal,
  applyVerdict,
  coalesceSegments,
  type DispatchRequest,
  dispatchKey,
  effectiveSegments,
  emptyTaskState,
  emptyTranscript,
  type IdGenerator,
  markSegmentsSuperseded,
  processUtterance,
  type Task,
  type TaskState,
  type TraceEvent,
  type TranscriptView,
  type Utterance,
} from "./core/index.js";
import type { FenceHolder } from "./fenced-writes.js";
import type { InterviewSessionPolicy } from "./interview-policy.js";
import type { SessionStorePort } from "./processor-ports.js";
import type { OwnerScope } from "./scope.js";
import type { SessionContext } from "./session-context.js";
import type { SessionClaim } from "./session-claim.js";
import type { StoredAction, StoredObservation } from "./session-reads.js";
import type { SessionTraceEvent } from "./trace.js";

export type RunMode = "running" | "quiescing" | "superseded";

// The host's test runner as the coding path uses it: runAll is required, the
// syntax check is optional (without it a solution cannot be fully verified).
export type SessionCodeRunner = Pick<CodeRunner, "runAll"> &
  Partial<Pick<CodeRunner, "checkSyntax">>;

// A task revision whose prose draft named it a coding challenge: the solution
// action is owed for exactly this revision.
export type CodingCandidate = {
  taskId: string;
  revision: number;
  brief: CodingBrief;
};

// Fills the ids a trace event always carries; the caller names the rest.
export type RunTracer = (
  event: Pick<SessionTraceEvent, "event" | "outcome"> &
    Partial<SessionTraceEvent>,
) => void;

export type SessionRun = {
  claim: SessionClaim;
  scope: OwnerScope;
  holder: FenceHolder;
  mode: RunMode;
  // True until the first tick has seeded dispatch memory from stored actions.
  seeded: boolean;
  justClaimed: boolean;
  // Consecutive lease renewals that threw (reset by any answered renewal).
  renewFailures: number;
  cursor: number;
  transcript: TranscriptView;
  tasks: TaskState;
  // Processor-clock time each segment was first replayed, for the settle rule.
  seenAtMs: Map<string, number>;
  processed: Set<string>;
  taskCounter: number;
  // Dispatch keys finished for good in this run (published, refused,
  // suppressed): never dispatched again here.
  settled: Set<string>;
  // Failed (retryable) dispatches per key.
  failures: Map<string, number>;
  // The pinned approved context, loaded on first use and kept for the life of
  // the run: a new fence builds a new run and reloads it, and the pinned
  // profile revision cannot change inside a session.
  context: SessionContext | null;
  // Coding candidates by `${taskId}:${revision}` (the draft-answer result with
  // category coding), and the newest published solution per task.
  coding: Map<string, CodingCandidate>;
  solutions: Map<string, PriorSolution>;
  inflight: Promise<void> | null;
  abort: AbortController;
  trace: RunTracer;
};

export function createRun(
  claim: SessionClaim,
  workerId: string,
  trace: RunTracer,
): SessionRun {
  return {
    claim,
    scope: { tenantId: claim.tenantId, actorId: claim.ownerUserId },
    holder: { workerId, fence: claim.fence },
    mode: "running",
    seeded: false,
    justClaimed: true,
    renewFailures: 0,
    cursor: 0,
    transcript: emptyTranscript(),
    tasks: emptyTaskState(),
    seenAtMs: new Map(),
    processed: new Set(),
    taskCounter: 0,
    settled: new Set(),
    failures: new Map(),
    context: null,
    coding: new Map(),
    solutions: new Map(),
    inflight: null,
    abort: new AbortController(),
    trace,
  };
}

export const keyOf = (
  run: SessionRun,
  taskId: string,
  revision: number,
  actionKind: string,
): string => dispatchKey(requestOf(run, taskId, revision, actionKind));

export const requestOf = (
  run: SessionRun,
  taskId: string,
  revision: number,
  actionKind: string,
): DispatchRequest => ({
  sessionId: run.claim.sessionId,
  taskId,
  revision,
  actionKind,
});

const idsOf = (run: SessionRun): IdGenerator => ({
  next: (prefix) => `${prefix}-${(run.taskCounter += 1)}`,
});

// A core trace event as a processor trace event: ids, codes and counts only.
function fromCore(run: SessionRun, core: TraceEvent): void {
  const { taskId, revision, reason, ...rest } = core.ids;
  const detail: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(rest)) detail[key] = value;
  run.trace({
    event: core.event,
    outcome: typeof reason === "string" ? reason : "ok",
    ...(typeof taskId === "string" ? { taskId } : {}),
    ...(typeof revision === "number" ? { revision } : {}),
    detail,
  });
}

const codingKey = (taskId: string, revision: number) => `${taskId}:${revision}`;

// A published prose draft that classified its task as coding makes the
// solution action pending for that task revision.
export function noteCodingTask(
  run: SessionRun,
  task: Task,
  draft: Pick<AssistDraft, "category" | "codingBrief">,
): void {
  if (draft.category !== "coding" || draft.codingBrief === null) return;
  run.coding.set(codingKey(task.taskId, task.revision), {
    taskId: task.taskId,
    revision: task.revision,
    brief: draft.codingBrief,
  });
}

// The newest published solution of a task, kept as the prior solution a later
// revision's prompt may carry.
export function noteSolution(
  run: SessionRun,
  taskId: string,
  solution: PriorSolution,
): void {
  const existing = run.solutions.get(taskId);
  if (!existing || solution.revision >= existing.revision)
    run.solutions.set(taskId, solution);
}

// Restart safety: what a succeeded stored action says about coding is read
// back from its result (data this worker wrote, parsed defensively), so a fresh
// run knows which task revisions are owed a solution and which prior solution
// a later revision may carry.
function rememberCodingFacts(run: SessionRun, action: StoredAction): void {
  const result = action.result as Record<string, unknown> | null;
  if (!result || typeof result !== "object") return;
  if (action.actionKind === ASSIST_ACTION_KIND) {
    const brief = codingBriefSchema.safeParse(result["codingBrief"]);
    if (result["category"] === "coding" && brief.success)
      run.coding.set(codingKey(action.taskId, action.taskRevision), {
        taskId: action.taskId,
        revision: action.taskRevision,
        brief: brief.data,
      });
    return;
  }
  if (action.actionKind === CODING_ACTION_KIND) {
    const { language, code, testCode } = result;
    if (
      typeof language === "string" &&
      typeof code === "string" &&
      typeof testCode === "string"
    )
      noteSolution(run, action.taskId, {
        revision: action.taskRevision,
        language,
        code,
        testCode,
      });
  }
}

// Seeds dispatch memory from the stored actions when a run is built. An action
// still in flight under an OLDER fence belongs to a holder that is gone (it
// could never publish), so it is failed and may be retried; succeeded and
// suppressed actions are final; failed ones count toward the retry bound.
export async function seedFromActions(
  run: SessionRun,
  store: SessionStorePort,
  actions: readonly StoredAction[],
): Promise<void> {
  for (const action of actions) {
    const key = keyOf(
      run,
      action.taskId,
      action.taskRevision,
      action.actionKind,
    );
    if (action.dispatchStatus === "succeeded") {
      run.settled.add(key);
      rememberCodingFacts(run, action);
    } else if (action.dispatchStatus === "suppressed") {
      // A pause or not-yet-started suppression is not final: the task is
      // retried once the session is active again, matching the dispatcher,
      // which leaves these unsettled (rule:pause-end-suppression).
      if (
        action.suppressionReason !== "session_paused" &&
        action.suppressionReason !== "session_not_active"
      )
        run.settled.add(key);
    } else if (action.dispatchStatus === "failed")
      run.failures.set(
        key,
        Math.max(run.failures.get(key) ?? 0, action.attempt),
      );
    else if (action.dispatchStatus === "in_flight") {
      if (action.fenceAtDispatch >= run.holder.fence) {
        run.settled.add(key);
        continue;
      }
      const outcome = await store.recordFailure({
        scope: run.scope,
        sessionId: run.claim.sessionId,
        holder: run.holder,
        actionId: action.id,
      });
      run.trace({
        event: "dispatch.orphan_failed",
        outcome: outcome.outcome === "recorded" ? "failed" : outcome.reason,
        taskId: action.taskId,
        revision: action.taskRevision,
      });
      run.failures.set(
        key,
        Math.max(run.failures.get(key) ?? 0, action.attempt),
      );
    }
  }
}

// Replays stored observations after the cursor through the core. Ingest has
// already deduplicated by source and event id, so a resend never reaches here
// twice; the core applies transcript supersession and marks every task
// revision built on a superseded segment stale.
export async function replayObservations(
  run: SessionRun,
  store: SessionStorePort,
  nowMs: number,
  page: number,
): Promise<number> {
  let replayed = 0;
  for (;;) {
    const batch: StoredObservation[] = await store.observationsAfter(
      run.scope,
      run.claim.sessionId,
      run.cursor,
      page,
    );
    if (batch.length === 0) return replayed;
    for (const stored of batch) {
      run.cursor = Math.max(run.cursor, stored.sequence);
      replayed += 1;
      if (stored.kind !== "transcript.final") continue;
      const body = (
        stored.content as { body?: unknown; sourceSequence?: number }
      ).body;
      const parsed = transcriptFinalSchema.safeParse({
        version: 1,
        kind: "transcript.final",
        sourceId: stored.sourceId,
        eventId: stored.eventId,
        occurredAt: (stored.content as { occurredAt?: string }).occurredAt,
        sequence: (stored.content as { sourceSequence?: number })
          .sourceSequence,
        content: body,
      });
      if (!parsed.success) {
        // A stored row that no longer parses is skipped by ids, never echoed.
        run.trace({ event: "observation.unreadable", outcome: "invalid" });
        continue;
      }
      const observation = parsed.data;
      const applied = applyTranscriptFinal(
        run.transcript,
        observation,
        stored.sequence,
      );
      run.transcript = applied.view;
      run.seenAtMs.set(observation.eventId, nowMs);
      if (applied.supersededIds.length > 0) {
        const marked = markSegmentsSuperseded(run.tasks, applied.supersededIds);
        run.tasks = marked.state;
        fromCore(run, marked.trace);
      }
    }
    if (batch.length < page) return replayed;
  }
}

// The task a corrected segment replaces the source of: some revision was built
// on the superseded segment this utterance's segment supersedes.
function correctionTarget(
  run: SessionRun,
  utterance: Utterance,
): string | null {
  for (const segment of Object.values(run.transcript.segments)) {
    if (
      segment.supersededBy === null ||
      !utterance.segmentIds.includes(segment.supersededBy)
    )
      continue;
    const task = Object.values(run.tasks.tasks)
      .reverse()
      .find((candidate) =>
        candidate.revisions.some((entry) =>
          entry.basedOn.includes(segment.eventId),
        ),
      );
    if (task) return task.taskId;
  }
  return null;
}

// Processes every effective utterance not yet processed, in time order, once
// it has settled. The policy decides what an utterance means; a corrected
// segment that replaces the source of a task is the correction of THAT task
// (a mechanical fact of the transcript, not an interpretation), so it revises
// it with the reason "correction" and the earlier answer stays marked stale.
export async function processUtterances(
  run: SessionRun,
  policy: InterviewSessionPolicy,
  nowMs: number,
  settleMs: number,
): Promise<number> {
  const utterances = coalesceSegments(
    effectiveSegments(run.transcript),
    (segment) => policy.isBackchannel(segment.text),
  );
  let handled = 0;
  for (const utterance of utterances) {
    if (run.processed.has(utterance.id)) continue;
    const lastSeen = Math.max(
      0,
      ...utterance.segmentIds.map((id) => run.seenAtMs.get(id) ?? 0),
    );
    // Order matters for revisions, so an unsettled utterance holds the rest.
    if (nowMs - lastSeen < settleMs) break;
    run.processed.add(utterance.id);
    const target = policy.isBackchannel(utterance.text)
      ? null
      : correctionTarget(run, utterance);
    const step = target
      ? applyVerdict(
          run.tasks,
          utterance,
          "substantive",
          { kind: "revise", taskId: target, reason: "correction" },
          idsOf(run),
        )
      : await processUtterance(run.tasks, policy, utterance, idsOf(run));
    run.tasks = step.state;
    fromCore(run, step.trace);
    handled += 1;
  }
  return handled;
}

// The next task revision that needs assistance: the current revision of a task
// whose source still stands and that this run has not finished or retried out.
export function nextPending(
  run: SessionRun,
  actionKind: string,
  maxAttempts: number,
): { task: Task; key: string } | null {
  for (const task of Object.values(run.tasks.tasks)) {
    const current = task.revisions.find(
      (entry) => entry.revision === task.revision,
    );
    if (!current || current.sourceSuperseded) continue;
    const key = keyOf(run, task.taskId, task.revision, actionKind);
    if (run.settled.has(key)) continue;
    if ((run.failures.get(key) ?? 0) >= maxAttempts) continue;
    return { task, key };
  }
  return null;
}

// The next coding task revision owed a solution: its prose draft named it a
// coding challenge, it is still the task's CURRENT revision with a standing
// source, and this run has not finished or retried it out. A revision a newer
// one replaced is never solved (its solution would be stale).
export function nextPendingCoding(
  run: SessionRun,
  maxAttempts: number,
): { task: Task; candidate: CodingCandidate; key: string } | null {
  for (const candidate of run.coding.values()) {
    const task = run.tasks.tasks[candidate.taskId];
    if (!task || task.revision !== candidate.revision) continue;
    const current = task.revisions.find(
      (entry) => entry.revision === task.revision,
    );
    if (!current || current.sourceSuperseded) continue;
    const key = keyOf(run, task.taskId, task.revision, CODING_ACTION_KIND);
    if (run.settled.has(key)) continue;
    if ((run.failures.get(key) ?? 0) >= maxAttempts) continue;
    return { task, candidate, key };
  }
  return null;
}

// The captured text a task revision rests on, oldest first: every revision's
// effective segments, so a "part two" carries the question it follows.
export function capturedFor(run: SessionRun, task: Task) {
  const ids = new Set(task.revisions.flatMap((entry) => entry.basedOn));
  return Object.values(run.transcript.segments)
    .filter(
      (segment) => ids.has(segment.eventId) && segment.supersededBy === null,
    )
    .sort((a, b) => a.startMs - b.startMs || a.seq - b.seq)
    .map((segment) => ({ speaker: segment.speaker, text: segment.text }));
}

// What a test or an operator may read about a run: ids, revisions, counts.
export type RunSnapshot = {
  fence: number;
  mode: RunMode;
  cursor: number;
  tasks: {
    taskId: string;
    revision: number;
    standing: Record<number, string>;
  }[];
  deferred: string[];
};
