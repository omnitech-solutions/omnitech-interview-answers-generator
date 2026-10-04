// One held session's in-memory state and its replay through the neutral core.
// A run exists only while this worker holds the session's lease at one fence;
// a new claim (a restart, or a successor after expiry) builds a fresh run and
// replays the stored observations from the start, so nothing but the database
// outlives a fence. Replay is deterministic for the baseline policy: task ids
// come from the policy's task key (named after the question's own segment), and
// the database's dispatch dedup (session, task,
// revision, action kind) is the safety net if it ever were not.
//
// The core decides ordering, supersession, task identity and revisions; this
// module only feeds it and never inspects utterance text. Screenshots are
// stored by ingest and never interpreted here: a screen snapshot is only
// remembered by id, and an owner's Analyze request (an `owner.input`
// observation, ADR-0016) names the exact snapshots a task revision rests on.
// That provenance travels with the revision (basedOn: spoken segment ids,
// `snap/...` snapshot ids and `input/...` owner-input ids), so replay,
// supersession, publication checks and the purge all see it; image
// interpretation is refused in device-only.
//
// Contents, in file order:
//   types      PendingOwnerInput, SessionRun, ActionSlot
//   slots      slotFor, allSlots, occupySlot, releaseSlot
//   run        createRun, keyOf, requestOf
//   restart    seedFromActions (what stored actions remember)
//   replay     replayObservations, noteSnapshot, queueOwnerInput
//   evidence   attachmentsFor, capturedFor
//   apply      processInOrder (utterances and owner inputs in observation
//              order), processOwnerInputs, processUtterances
//   progress   noteRecorded, handledThrough, nextPending, nextPendingCoding
//   cancel     cancelSupersededSlots
import {
  screenSnapshotSchema,
  transcriptFinalSchema,
} from "@omnitech/active-session-contracts";
import type { AgentAttachment } from "@omnitech/ai-contracts";
import { MAX_TASK_ATTACHMENTS } from "@omnitech/ai-contracts";
import type { CodeRunner } from "@omnitech/code-runner";
import {
  LIVE_OWNER_HINT_AUTO,
  LIVE_OWNER_SOLVE_TEXT,
  type LiveOwnerInputRequest,
  type LiveOwnerLanguage,
  type LiveOwnerLanguageHint,
  type LiveOwnerSkill,
  type LiveOwnerSkillHint,
  liveOwnerInputRequestSchema,
} from "@omnitech/interview-contracts";
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
  type ProcessingPolicy,
  processUtterance,
  type RememberedRevision,
  restoreTasks,
  TASK_ID_PREFIX,
  type Task,
  type TaskState,
  type TraceEvent,
  type TranscriptView,
  type Utterance,
} from "./core/index.js";
import type { FenceHolder } from "./fenced-writes.js";
import type { InterviewSessionPolicy } from "./interview-policy.js";
import {
  isSnapshotProvenanceId,
  OWNER_STOP_OPERATION,
  ownerInputProvenanceId,
  snapshotProvenanceId,
} from "./owner-input.js";
import type { SessionStorePort } from "./processor-ports.js";
import type { OwnerScope } from "./scope.js";
import type { SessionClaim } from "./session-claim.js";
import type { SessionContext } from "./session-context.js";
import type { StoredAction, StoredObservation } from "./session-reads.js";
import type { SessionTraceEvent } from "./trace.js";

// An owner input replayed and waiting to be applied to the task state after the
// spoken utterances have been (so a follow-up finds the task it targets).
export type PendingOwnerInput = {
  provenanceId: string;
  input: LiveOwnerInputRequest;
  // True for the owner's "stop work" marker (control command `stop-work`): it
  // carries no request, only a place in the observation order.
  stop?: true;
  // The observation sequence it was stored at: its place among the spoken
  // utterances, so a replay applies it where the live run did.
  sequence: number;
  // Ticks it has been held back waiting for its target task to exist.
  deferrals: number;
};

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
  // Segment ids already handed to the policy: a processed utterance is
  // closed, so a later segment (even the same speaker's) starts a new one.
  processed: Set<string>;
  // The observation sequence below which a previous holder handled every
  // transcript segment, read when the run is seeded; its segments are closed
  // as they replay, never judged again.
  restoredThrough: number;
  // The highest such sequence stored so far (this run's or a predecessor's).
  persistedThrough: number;
  // Task revisions (`${taskId}:${revision}`) with an action row: their source
  // segments are remembered by the database.
  recorded: Set<string>;
  // True once a device-only session's queued jobs were swept (cancelled).
  jobsSwept: boolean;
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
  // Screen snapshots this run has replayed, by provenance id (the media type
  // the companion declared; the loader re-detects it from the bytes).
  snapshots: Map<string, { mediaType: string }>;
  // Owner inputs (ADR-0016) by provenance id, with the typed text they carry,
  // and those replayed but not yet applied to the task state.
  ownerInputs: Map<
    string,
    {
      text: string | null;
      skill?: LiveOwnerSkillHint;
      language?: LiveOwnerLanguageHint;
    }
  >;
  pendingInputs: PendingOwnerInput[];
  // Two action slots (ADR-0016): short assistance (draft-answer) and coding
  // (solve-code) each own their action id, in-flight promise and child abort,
  // so a spoken question is never serialised behind older coding work.
  slots: { assist: ActionSlot; coding: ActionSlot };
  // The run's own abort; every slot's abort is a child of it.
  abort: AbortController;
  trace: RunTracer;
};

// One slot's state. `actionId` is the action the running dispatch recorded, so
// a dispatch that throws settles ITS OWN action as failed instead of leaving it
// stranded in flight; `taskId`/`revision` say which task revision the slot's
// work was started for.
export type ActionSlot = {
  actionId: string | null;
  inflight: Promise<void> | null;
  abort: AbortController | null;
  taskId: string | null;
  revision: number;
  // The processing policy the running dispatch read when it began; null until
  // it has read one. A tighten to device-only aborts a "permitted-remote" one.
  policy: ProcessingPolicy | null;
  // Detaches the slot's child abort from the run's once the slot settles.
  detach: (() => void) | null;
};

const emptySlot = (): ActionSlot => ({
  actionId: null,
  inflight: null,
  abort: null,
  taskId: null,
  revision: 0,
  policy: null,
  detach: null,
});

// The slot an action kind runs in: the coding solution has its own, everything
// else is short assistance.
export const slotFor = (run: SessionRun, actionKind: string): ActionSlot =>
  actionKind === CODING_ACTION_KIND ? run.slots.coding : run.slots.assist;

export const allSlots = (run: SessionRun): ActionSlot[] => [
  run.slots.assist,
  run.slots.coding,
];

// Claims a slot for a task revision with a fresh child of the run's abort, so
// aborting the run (quiesce, close, supersession) still aborts both slots.
export function occupySlot(
  run: SessionRun,
  slot: ActionSlot,
  taskId: string,
  revision: number,
): AbortController {
  const child = new AbortController();
  slot.detach?.();
  slot.detach = null;
  if (run.abort.signal.aborted) child.abort();
  else {
    const forward = () => child.abort();
    run.abort.signal.addEventListener("abort", forward, { once: true });
    // Removed when the slot settles, so a long-lived run does not accumulate
    // one listener per dispatch.
    slot.detach = () => run.abort.signal.removeEventListener("abort", forward);
  }
  slot.abort = child;
  slot.taskId = taskId;
  slot.revision = revision;
  slot.actionId = null;
  slot.policy = null;
  return child;
}

// Called when a slot's dispatch has settled.
export function releaseSlot(slot: ActionSlot): void {
  slot.detach?.();
  slot.detach = null;
  slot.inflight = null;
  slot.abort = null;
}

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
    restoredThrough: 0,
    persistedThrough: 0,
    recorded: new Set(),
    jobsSwept: false,
    taskCounter: 0,
    settled: new Set(),
    failures: new Map(),
    context: null,
    coding: new Map(),
    solutions: new Map(),
    snapshots: new Map(),
    ownerInputs: new Map(),
    pendingInputs: [],
    slots: { assist: emptySlot(), coding: emptySlot() },
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
  // A task is named after its source (the policy's task key), never a
  // per-run counter, so a rebuilt run names every question as the last did.
  next: (prefix, stableKey) =>
    stableKey === undefined
      ? `${prefix}-${(run.taskCounter += 1)}`
      : `${prefix}-${stableKey}`,
});

// What the stored actions remember of the tasks a previous holder opened: the
// source segments of every task revision it recorded an action for. An action
// stores the segments its revision RESTS ON (its own and every earlier
// revision's), so a revision whose predecessors were never dispatched still
// carries the whole question; a revision's own segments are what it adds to
// the previous remembered revision's.
function rememberedRevisions(
  actions: readonly StoredAction[],
): RememberedRevision[] {
  const byTask = new Map<string, Map<number, StoredAction>>();
  for (const action of actions) {
    if (!action.sourceEventIds || action.sourceEventIds.length === 0) continue;
    if (!action.taskId.startsWith(`${TASK_ID_PREFIX}-`)) continue;
    const revisions = byTask.get(action.taskId) ?? new Map();
    if (!revisions.has(action.taskRevision))
      revisions.set(action.taskRevision, action);
    byTask.set(action.taskId, revisions);
  }
  const remembered: RememberedRevision[] = [];
  for (const [taskId, revisions] of byTask) {
    let previous = new Set<string>();
    for (const revision of [...revisions.keys()].sort((a, b) => a - b)) {
      const resting = (revisions.get(revision) as StoredAction)
        .sourceEventIds as readonly string[];
      remembered.push({
        taskId,
        taskKey: taskId.slice(TASK_ID_PREFIX.length + 1),
        revision,
        basedOn: resting.filter((id) => !previous.has(id)),
      });
      previous = new Set(resting);
    }
  }
  return remembered;
}

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
  // [STATE] Rebuild what the previous holder had already decided: its tasks
  // at their stored revisions (so a follow-up to a corrected question is the
  // next revision, never a repeat of one that already has an answer) and the
  // segments they rest on as closed utterances (so a question one second after
  // an answered one is its own utterance, as it was live, and never merges
  // into the answered task). Segments no action names stay open; replay
  // evaluates them again.
  const remembered = rememberedRevisions(actions);
  run.tasks = restoreTasks(run.tasks, remembered);
  for (const entry of remembered)
    for (const id of entry.basedOn) run.processed.add(id);
  // Segments the previous holder handled and ignored are closed too: judging
  // them again against the restored task state could revise a task the live
  // run never revised.
  run.restoredThrough = await store.processedThrough(
    run.scope,
    run.claim.sessionId,
  );
  run.persistedThrough = run.restoredThrough;
  for (const action of actions)
    run.recorded.add(`${action.taskId}:${action.taskRevision}`);
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
        action.suppressionReason !== "session_not_active" &&
        action.suppressionReason !== "policy_changed"
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
  // A run that has seen nothing yet is rebuilding from the stored stream.
  const initialReplay = run.cursor === 0;
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
      if (stored.kind === "screen.snapshot") {
        noteSnapshot(run, stored);
        continue;
      }
      if (stored.kind === "owner.input") {
        queueOwnerInput(run, stored, initialReplay);
        continue;
      }
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
      if (stored.sequence <= run.restoredThrough)
        run.processed.add(observation.eventId);
      if (applied.supersededIds.length > 0) {
        const marked = markSegmentsSuperseded(run.tasks, applied.supersededIds);
        run.tasks = marked.state;
        fromCore(run, marked.trace);
      }
    }
    if (batch.length < page) return replayed;
  }
}

// Remembers a replayed screen snapshot by its provenance id, so a task that
// rests on it can name it as an attachment. Only the declared media type is
// kept; the pixels are loaded, verified and staged later, by the loader.
function noteSnapshot(run: SessionRun, stored: StoredObservation): void {
  const body = (stored.content as { body?: unknown }).body;
  const parsed = screenSnapshotSchema.shape.content.safeParse(body);
  if (!parsed.success || stored.screenshotArtifactId === null) return;
  run.snapshots.set(
    snapshotProvenanceId(run.claim.sessionId, stored.sourceId, stored.eventId),
    { mediaType: parsed.data.mediaType },
  );
}

// Queues a replayed owner input. One already part of a remembered task
// revision (its provenance id is in the restored, processed set) was applied by
// a previous holder and is never applied again.
function queueOwnerInput(
  run: SessionRun,
  stored: StoredObservation,
  initialReplay: boolean,
): void {
  const provenanceId = ownerInputProvenanceId(stored.eventId);
  const body = (stored.content as { body?: unknown }).body;
  if (
    typeof body === "object" &&
    body !== null &&
    (body as { operation?: unknown }).operation === OWNER_STOP_OPERATION
  ) {
    // [SAFETY] A stop met while a run replays its session from the start is
    // history: what it abandoned is remembered as settled actions, and applying
    // it again would abandon work that came after it. Only a stop that arrives
    // while this run is live is applied.
    if (initialReplay || run.processed.has(provenanceId)) {
      run.processed.add(provenanceId);
      return;
    }
    run.pendingInputs.push({
      provenanceId,
      input: undefined as unknown as LiveOwnerInputRequest,
      stop: true,
      sequence: stored.sequence,
      deferrals: 0,
    });
    return;
  }
  const parsed = liveOwnerInputRequestSchema.safeParse({
    ...(typeof body === "object" && body !== null ? body : {}),
    requestId: stored.eventId,
  });
  if (!parsed.success) {
    run.trace({ event: "observation.unreadable", outcome: "invalid" });
    return;
  }
  run.ownerInputs.set(provenanceId, {
    text:
      parsed.data.operation === "solve"
        ? LIVE_OWNER_SOLVE_TEXT
        : (parsed.data.text ?? null),
    ...(parsed.data.skill ? { skill: parsed.data.skill } : {}),
    ...(parsed.data.language ? { language: parsed.data.language } : {}),
  });
  if (run.processed.has(provenanceId)) return;
  run.pendingInputs.push({
    provenanceId,
    input: parsed.data,
    sequence: stored.sequence,
    deferrals: 0,
  });
}

// A task's provenance ids: everything any of its revisions rests on.
const provenanceOf = (task: Task): string[] => [
  ...new Set(task.revisions.flatMap((entry) => entry.basedOn)),
];

// The images a task revision's answer rests on, newest last and bounded, as
// attachments that name only provenance ids (the loader resolves them).
export function attachmentsFor(run: SessionRun, task: Task): AgentAttachment[] {
  return provenanceOf(task)
    .filter(isSnapshotProvenanceId)
    .slice(-MAX_TASK_ATTACHMENTS)
    .map((id, index) => ({
      id,
      kind: "image" as const,
      name: `screenshot-${index + 1}`,
      reference: id,
      ...(run.snapshots.get(id)
        ? {
            mimeType: (run.snapshots.get(id) as { mediaType: string })
              .mediaType,
          }
        : {}),
    }));
}

// Applies one queued owner input to the task state. An owner input is never a
// transcript segment: an analyze or typed question opens its own task (named
// after its request id, so a rebuilt run names it the same), and an input aimed
// at an existing task revises it. The revision rests on the input's and
// snapshots' provenance ids, which the action row remembers, so replay,
// supersession and the purge all see them.
function applyOwnerInput(run: SessionRun, pending: PendingOwnerInput): void {
  const { input, provenanceId } = pending;
  const target = input.target
    ? run.tasks.tasks[input.target.taskId]
    : undefined;
  // [SAFETY] "Solve" is bound to the revision the owner saw: a task that has
  // moved on since is left alone (the owner asks again for the new one).
  if (input.operation === "solve") {
    const latest = target?.revisions[target.revisions.length - 1]?.revision;
    if (!target || latest !== input.target?.revision) {
      run.processed.add(provenanceId);
      run.trace({ event: "owner-input.stale-solve", outcome: "skipped" });
      return;
    }
  }
  const provenance = [
    provenanceId,
    ...input.snapshots.map((snapshot) =>
      snapshotProvenanceId(
        run.claim.sessionId,
        snapshot.sourceId,
        snapshot.eventId,
      ),
    ),
  ];
  const utterance: Utterance = {
    id: provenanceId,
    speaker: "owner",
    segmentIds: provenance,
    startMs: 0,
    endMs: 0,
    text: "",
  };
  const step = applyVerdict(
    run.tasks,
    utterance,
    "substantive",
    target
      ? { kind: "revise", taskId: target.taskId, reason: "follow_up" }
      : { kind: "open", taskKey: `i.${input.requestId}` },
    idsOf(run),
  );
  run.tasks = step.state;
  fromCore(run, step.trace);
  for (const id of provenance) run.processed.add(id);
}

// The owner's stop (control command `stop-work`): every dispatch in flight is
// abandoned and aborted, and every task revision that exists now and has no
// answer is settled, so no later tick dispatches it again. A revision or task
// created after the stop is not touched and dispatches normally. The
// abandonment is durable: each pending revision gets an action row settled as
// suppressed `owner_stopped` (a final reason that a rebuilt run reads back as
// settled). Store calls are best effort: the in-memory settlement holds anyway,
// and nothing here carries content.
export const OWNER_STOPPED_REASON = "owner_stopped";

async function applyStop(
  run: SessionRun,
  pending: PendingOwnerInput,
  policy: InterviewSessionPolicy,
  store: SessionStorePort | undefined,
): Promise<void> {
  const sessionId = run.claim.sessionId;
  // [STATE] Abandon what is in the air first, so a late failure of the aborted
  // dispatch finds its action already settled and cannot reopen it.
  for (const slot of allSlots(run)) {
    if (slot.inflight === null) continue;
    const actionId = slot.actionId;
    if (store && actionId !== null)
      await store
        .abandonAction({
          scope: run.scope,
          sessionId,
          holder: run.holder,
          actionId,
          reason: OWNER_STOPPED_REASON,
        })
        .catch(() => undefined);
    if (slot.taskId !== null) {
      const kind =
        slot === run.slots.coding
          ? CODING_ACTION_KIND
          : policy.assist.actionKind;
      run.settled.add(keyOf(run, slot.taskId, slot.revision, kind));
    }
    slot.abort?.abort();
  }
  // [STATE] Settle every current revision still owed an answer (the coding
  // solution only where its prose draft named the revision a coding challenge).
  for (const task of Object.values(run.tasks.tasks)) {
    const current = task.revisions.find(
      (entry) => entry.revision === task.revision,
    );
    if (!current || current.sourceSuperseded) continue;
    const kinds = [policy.assist.actionKind];
    if (run.coding.get(codingKey(task.taskId, task.revision)))
      kinds.push(CODING_ACTION_KIND);
    for (const kind of kinds) {
      const key = keyOf(run, task.taskId, task.revision, kind);
      if (run.settled.has(key)) continue;
      run.settled.add(key);
      if (!store) continue;
      const recorded = await store
        .recordAction({
          scope: run.scope,
          sessionId,
          holder: run.holder,
          tasks: run.tasks,
          taskId: task.taskId,
          revision: task.revision,
          actionKind: kind,
        })
        .catch(() => null);
      if (recorded?.outcome !== "dispatched") continue;
      noteRecorded(run, task.taskId, task.revision);
      await store
        .abandonAction({
          scope: run.scope,
          sessionId,
          holder: run.holder,
          actionId: recorded.actionId,
          reason: OWNER_STOPPED_REASON,
        })
        .catch(() => undefined);
    }
  }
  run.processed.add(pending.provenanceId);
  run.trace({ event: "session.work_stopped", outcome: "stopped" });
}

// Applies queued owner inputs to the task state, in arrival order, after the
// spoken utterances. Returns how many inputs were applied.
export function processOwnerInputs(run: SessionRun): number {
  let handled = 0;
  const waiting: PendingOwnerInput[] = [];
  const spokenPending = effectiveSegments(run.transcript).some(
    (segment) => !run.processed.has(segment.eventId),
  );
  for (const pending of run.pendingInputs) {
    // A stop needs the store and is applied by processInOrder only.
    if (pending.stop) {
      waiting.push(pending);
      continue;
    }
    const { input } = pending;
    // A target that is not a task yet may be one of the utterances still
    // settling: wait one pass for it, then treat the input as a new question.
    if (
      input.target &&
      !run.tasks.tasks[input.target.taskId] &&
      spokenPending &&
      pending.deferrals < 1
    ) {
      pending.deferrals += 1;
      waiting.push(pending);
      continue;
    }
    applyOwnerInput(run, pending);
    handled += 1;
  }
  run.pendingInputs = waiting;
  return handled;
}

// Spoken utterances and owner inputs in OBSERVATION order, so a rebuilt run
// numbers every task revision as the live run did: each input is applied only
// after every utterance stored before it has been processed, and an utterance
// stored after it is never coalesced into one before it. An earlier utterance
// still settling holds the input (and any later one) for the next pass.
export async function processInOrder(
  run: SessionRun,
  policy: InterviewSessionPolicy,
  nowMs: number,
  settleMs: number,
  store?: SessionStorePort,
): Promise<{ utterances: number; inputs: number }> {
  let utterances = 0;
  let inputs = 0;
  const ordered = [...run.pendingInputs].sort(
    (a, b) => a.sequence - b.sequence,
  );
  for (const pending of ordered) {
    utterances += await processUtterances(
      run,
      policy,
      nowMs,
      settleMs,
      pending.sequence,
    );
    const earlierOpen = effectiveSegments(run.transcript).some(
      (segment) =>
        segment.seq < pending.sequence && !run.processed.has(segment.eventId),
    );
    if (earlierOpen) break;
    if (pending.stop) await applyStop(run, pending, policy, store);
    else applyOwnerInput(run, pending);
    run.pendingInputs = run.pendingInputs.filter((entry) => entry !== pending);
    inputs += 1;
  }
  utterances += await processUtterances(run, policy, nowMs, settleMs);
  return { utterances, inputs };
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
  // Only segments stored before this observation sequence are considered
  // (an owner input's place among the utterances).
  beforeSequence = Number.POSITIVE_INFINITY,
): Promise<number> {
  // [STATE] Closed utterances are out of the picture: what is left coalesces
  // into new utterances, so a question that follows an already-handled
  // statement of the same speaker is still evaluated.
  const utterances = coalesceSegments(
    effectiveSegments(run.transcript).filter(
      (segment) =>
        !run.processed.has(segment.eventId) && segment.seq < beforeSequence,
    ),
    (segment) => policy.isBackchannel(segment.text),
  );
  let handled = 0;
  for (const utterance of utterances) {
    const lastSeen = Math.max(
      0,
      ...utterance.segmentIds.map((id) => run.seenAtMs.get(id) ?? 0),
    );
    // Order matters for revisions, so an unsettled utterance holds the rest.
    if (nowMs - lastSeen < settleMs) break;
    for (const id of utterance.segmentIds) run.processed.add(id);
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

// Notes that a task revision now has an action row (dispatched, duplicate or
// suppressed): the database remembers the segments it rests on.
export function noteRecorded(
  run: SessionRun,
  taskId: string,
  revision: number,
): void {
  run.recorded.add(`${taskId}:${revision}`);
}

// The observation sequence below which every transcript segment is handled AND
// remembered: ignored by the policy, or part of a revision the database holds
// an action for (or an earlier one of a task with a later recorded revision,
// whose stored segment ids include it). A segment whose handling only lives in
// memory (a revision not yet dispatched) stops the marker, so a rebuilt run
// evaluates it again instead of losing it. A deferred topic does NOT stop it:
// it opens no task, and holding the marker there made a rebuilt run re-judge
// the later statements the live run ignored (they coalesced into the next
// question and could revise it). The deferral itself is memory-only.
export function handledThrough(run: SessionRun): number {
  const unremembered = new Set<string>();
  for (const task of Object.values(run.tasks.tasks)) {
    const newestRecorded = Math.max(
      0,
      ...task.revisions
        .filter((entry) => run.recorded.has(`${task.taskId}:${entry.revision}`))
        .map((entry) => entry.revision),
    );
    for (const entry of task.revisions)
      if (entry.revision > newestRecorded)
        for (const id of entry.basedOn) unremembered.add(id);
  }
  let through = run.persistedThrough;
  const segments = Object.values(run.transcript.segments).sort(
    (a, b) => a.seq - b.seq,
  );
  for (const segment of segments) {
    if (segment.seq <= through) continue;
    const handled =
      segment.supersededBy !== null ||
      (run.processed.has(segment.eventId) &&
        !unremembered.has(segment.eventId));
    if (!handled) break;
    through = segment.seq;
  }
  return through;
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
  const spoken = Object.values(run.transcript.segments)
    .filter(
      (segment) => ids.has(segment.eventId) && segment.supersededBy === null,
    )
    .sort((a, b) => a.startMs - b.startMs || a.seq - b.seq)
    .map((segment) => ({ speaker: segment.speaker, text: segment.text }));
  // The owner's typed text follows the spoken lines it was written after. It
  // is the owner's own words, but it still travels as captured data.
  const typed = [...ids].flatMap((id) => {
    const text = run.ownerInputs.get(id)?.text;
    return text ? [{ speaker: "owner", text }] : [];
  });
  return [...spoken, ...typed];
}

// The owner's hints a task rests on: the newest skill and language any of its
// owner inputs carried (closed enums; never text). An input that omits a hint
// keeps the earlier one; an input that says "auto" RESETS it to none, so the
// owner choosing automatic detection again is honoured.
export function hintsFor(
  run: SessionRun,
  task: Task,
): { skill?: LiveOwnerSkill; language?: LiveOwnerLanguage } {
  let skill: LiveOwnerSkill | undefined;
  let language: LiveOwnerLanguage | undefined;
  for (const id of provenanceOf(task)) {
    const input = run.ownerInputs.get(id);
    if (input?.skill)
      skill = input.skill === LIVE_OWNER_HINT_AUTO ? undefined : input.skill;
    if (input?.language)
      language =
        input.language === LIVE_OWNER_HINT_AUTO ? undefined : input.language;
  }
  return {
    ...(skill ? { skill } : {}),
    ...(language ? { language } : {}),
  };
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

// Aborts the work of any slot whose task revision the task has moved past (a
// correction replaced it, or the task is gone). The slot stays occupied until
// its dispatch settles; fenced publication refuses its result either way.
export function cancelSupersededSlots(run: SessionRun): void {
  for (const slot of allSlots(run)) {
    if (slot.inflight === null || slot.taskId === null) continue;
    const task = run.tasks.tasks[slot.taskId];
    if (!task || task.revision > slot.revision) slot.abort?.abort();
  }
}
