// The persistence port that enforces the core's publish eligibility ATOMICALLY
// with the write (rule:fenced-current-publish). Every write runs in the owner's
// tenant-and-actor transaction after locking the session row, and checks, under
// that lock, that the session status, the holder's fence, the holder's
// unexpired lease and the task revision are all current. A stale holder writes
// nothing and receives a refusal outcome; a failed status or revision check
// records a suppression row carrying ids and a code only
// (rule:id-only-traces). Job creation and resume are locked to the session the
// same way (rule:job-creation-locked-to-session, rule:no-resume-after-end),
// and the action naming a pre-generated job id is committed before the job
// exists (rule:action-before-job).
import { randomUUID } from "node:crypto";
import type { PlatformDatabase, TenantDatabase } from "@omnitech/database";
import type { LiveScreenshotSend } from "@omnitech/interview-contracts";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import {
  canPublish,
  type DispatchLedger,
  type DispatchRequest,
  type DispatchStatus,
  type DispatchSuppressionReason,
  decideDispatch,
  dispatchKey,
  holderStanding,
  type ProcessingPolicy,
  type PublishSuppression,
  revisionStanding,
  type SessionStatus,
  sourceIdsOf,
  type TaskState,
} from "./core/index";
import { assertUuid, SessionError } from "./errors";
import * as actions from "./repositories/action.repository";
import {
  type GuardTransaction,
  lockSessionForJob,
  lockSessionOfJob,
} from "./repositories/lease.repository";
import { lockSession } from "./repositories/session.repository";
import { inOwnerScope, type OwnerScope } from "./scope";
import type { SessionJobs } from "./session-jobs";
import type { SessionRecord } from "./session-record";
import { MAX_REASON_CHARS } from "./withheld";

// The lease token a worker holds: the id it claimed under and the fence its
// acquire produced.
export type FenceHolder = { workerId: string; fence: number };

export type WriteRefusalReason =
  | PublishSuppression
  | DispatchSuppressionReason
  | "lease_expired"
  | "session_not_found"
  | "action_not_found"
  | "action_settled";

export type Refused = {
  outcome: "refused";
  reason: WriteRefusalReason;
  // True when a suppression row (ids and a code only) was written. A stale
  // holder never writes one.
  suppressionRecorded: boolean;
};

export type RecordActionOutcome =
  | {
      outcome: "dispatched";
      actionId: string;
      attempt: number;
      jobId: string | null;
    }
  | { outcome: "duplicate"; existing: DispatchStatus }
  | { outcome: "suppressed"; reason: DispatchSuppressionReason }
  | Refused;

export type DispatchStandingOutcome =
  | {
      outcome: "standing";
      status: SessionStatus;
      processingPolicy: ProcessingPolicy;
      // D35: read with the policy, per dispatch, never from the page. Absent
      // (an older store or fake) reads as "always".
      screenshotSend?: LiveScreenshotSend;
      liveAssistance: boolean;
      fence: number;
    }
  | Refused;

export type PublishOutcome = { outcome: "published" } | Refused;

// Work that must commit or roll back WITH the publish (a session-owned
// Workspace draft write). It runs inside the publish transaction, after the
// holder, status and revision checks passed, with the session row still locked.
// The object it returns is merged into the stored action result. A throw rolls
// the whole publish back, leaving the action in flight; an outcome the caller
// should keep (a revision conflict) is returned, never thrown.
type PublishEffectContext = {
  tx: TenantDatabase;
  scope: OwnerScope;
  sessionId: string;
  actionId: string;
  taskId: string;
  taskRevision: number;
};
export type PublishEffect = (
  context: PublishEffectContext,
) => Promise<Record<string, unknown> | undefined>;
export type SettleOutcome = { outcome: "recorded" } | Refused;

// Up to 200: a withheld draft's reason also carries its violation codes
// (withheld.ts); the charset stays closed.
const REASON_CODE = new RegExp(`^[a-z0-9_.-]{1,${MAX_REASON_CHARS}}$`);

type Guarded =
  | { ok: true; row: SessionRecord }
  | { ok: false; refused: Refused };

const stale = (reason: WriteRefusalReason): Guarded => ({
  ok: false,
  refused: { outcome: "refused", reason, suppressionRecorded: false },
});

// [SAFETY] Locks the session row, then admits only the current holder: the
// worker id and fence must be the stored ones and the lease unexpired. A
// purging session takes no further write at all.
async function guardHolder(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  holder: FenceHolder,
): Promise<Guarded> {
  const row = await lockSession(tx, scope, sessionId);
  if (!row || row.purgedAt !== null) return stale("session_not_found");
  const standing = holderStanding(
    {
      fence: row.fence,
      holderId: row.leaseHolderId,
      expiresAtMs: row.leaseExpiresAt?.getTime() ?? null,
    },
    holder.workerId,
    holder.fence,
    row.nowMs,
  );
  if (standing === "stop-superseded") return stale("fence_superseded");
  if (standing === "stop-expired") return stale("lease_expired");
  if (row.status === "purging") return stale("session_purging");
  return { ok: true, row };
}

const refused = (reason: WriteRefusalReason, recorded: boolean): Refused => ({
  outcome: "refused",
  reason,
  suppressionRecorded: recorded,
});

// The dispatch ledger for one key, rebuilt from the persisted rows: succeeded
// and in-flight dedup, a failed dispatch may be retried with the next attempt.
function ledgerOf(
  request: DispatchRequest,
  rows: actions.StoredAttempt[],
): DispatchLedger {
  const attempts = rows.reduce((max, r) => Math.max(max, Number(r.attempt)), 0);
  const status = rows.some((r) => r.dispatchStatus === "succeeded")
    ? "succeeded"
    : rows.some((r) => r.dispatchStatus === "in_flight")
      ? "in-flight"
      : rows.some((r) => r.dispatchStatus === "failed")
        ? "failed"
        : null;
  if (status === null) return { entries: {} };
  const key = dispatchKey(request);
  return { entries: { [key]: { key, status, attempts } } };
}

export class FencedSessionWrites {
  constructor(private readonly database: PlatformDatabase) {}

  // Decides a dispatch with the core (session status, task revision, dedup by
  // session, task, revision and action kind) and persists the decision. A
  // pre-generated `jobId` is committed with the action BEFORE any job exists.
  async recordAction(input: {
    scope: OwnerScope;
    sessionId: string;
    holder: FenceHolder;
    // The processor's task state, which the core's decision reads.
    tasks: TaskState;
    taskId: string;
    revision: number;
    actionKind: string;
    jobId?: string;
  }): Promise<RecordActionOutcome> {
    assertUuid(input.sessionId);
    if (input.jobId !== undefined) assertUuid(input.jobId);
    return inOwnerScope(this.database, input.scope, async (tx) => {
      const guard = await guardHolder(
        tx,
        input.scope,
        input.sessionId,
        input.holder,
      );
      if (!guard.ok) return guard.refused;
      const { row } = guard;
      const request: DispatchRequest = {
        sessionId: input.sessionId,
        taskId: input.taskId,
        revision: input.revision,
        actionKind: input.actionKind,
      };
      const existing = await actions.listAttempts(tx, input.scope, request);
      const decision = decideDispatch(
        ledgerOf(request, existing),
        input.tasks,
        row.status,
        request,
      );
      if (decision.decision === "duplicate")
        return { outcome: "duplicate", existing: decision.existing };
      if (decision.decision === "suppressed") {
        await this.insertSuppression(
          tx,
          input.scope,
          row,
          request,
          { reason: decision.suppression.reason },
          sourceIdsOf(input.tasks, input.taskId, input.revision),
        );
        return { outcome: "suppressed", reason: decision.suppression.reason };
      }
      const insertedId = await actions.insertInFlightAction(tx, input.scope, {
        sessionId: input.sessionId,
        taskId: input.taskId,
        revision: input.revision,
        actionKind: input.actionKind,
        attempt: decision.attempt,
        jobId: input.jobId ?? null,
        fence: row.fence,
        sourceEventIds: sourceIdsOf(input.tasks, input.taskId, input.revision),
      });
      return {
        outcome: "dispatched",
        actionId: String(insertedId),
        attempt: decision.attempt,
        jobId: input.jobId ?? null,
      };
    });
  }

  private async insertSuppression(
    tx: TenantDatabase,
    scope: OwnerScope,
    row: SessionRecord,
    request: DispatchRequest,
    suppression: { reason: string },
    sourceEventIds: readonly string[] | null,
  ): Promise<void> {
    // The purging mark refuses every new action at the database; the purge is
    // about to delete them all, so nothing is recorded.
    if (row.status === "purging") return;
    await actions.insertSuppressedAction(tx, scope, {
      sessionId: row.id,
      taskId: request.taskId,
      revision: request.revision,
      actionKind: request.actionKind,
      fence: row.fence,
      reason: suppression.reason,
      sourceEventIds,
    });
  }

  // A suppression the processor's own policy decided (for example a locality
  // refusal): ids and a code only, from the current holder.
  async recordSuppression(input: {
    scope: OwnerScope;
    sessionId: string;
    holder: FenceHolder;
    // The processor's task state, when it has one: the suppressed revision's
    // source segments are remembered for a rebuilt run.
    tasks?: TaskState;
    taskId: string;
    revision: number;
    actionKind: string;
    reason: string;
  }): Promise<SettleOutcome> {
    assertUuid(input.sessionId);
    if (!REASON_CODE.test(input.reason))
      throw new SessionError("invalid_input");
    return inOwnerScope(this.database, input.scope, async (tx) => {
      const guard = await guardHolder(
        tx,
        input.scope,
        input.sessionId,
        input.holder,
      );
      if (!guard.ok) return guard.refused;
      await this.insertSuppression(
        tx,
        input.scope,
        guard.row,
        {
          sessionId: input.sessionId,
          taskId: input.taskId,
          revision: input.revision,
          actionKind: input.actionKind,
        },
        { reason: input.reason },
        input.tasks
          ? sourceIdsOf(input.tasks, input.taskId, input.revision)
          : null,
      );
      return { outcome: "recorded" };
    });
  }

  // Records how far the holder has handled the transcript (an observation
  // sequence, never content), so a rebuilt run closes the same segments the
  // live run closed. Only raised; written only by the current holder.
  async recordProcessedThrough(input: {
    scope: OwnerScope;
    sessionId: string;
    holder: FenceHolder;
    through: number;
  }): Promise<SettleOutcome> {
    assertUuid(input.sessionId);
    if (!Number.isSafeInteger(input.through) || input.through < 0)
      throw new SessionError("invalid_input");
    return inOwnerScope(this.database, input.scope, async (tx) => {
      const guard = await guardHolder(
        tx,
        input.scope,
        input.sessionId,
        input.holder,
      );
      if (!guard.ok) return guard.refused;
      await actions.raiseProcessedThrough(
        tx,
        input.scope,
        input.sessionId,
        input.through,
      );
      return { outcome: "recorded" };
    });
  }

  // Publishes a result only while the session is active, the holder's fence
  // and lease are current and the task revision is current; otherwise the
  // action is suppressed with a code and nothing is published.
  async publishResult(input: {
    scope: OwnerScope;
    sessionId: string;
    holder: FenceHolder;
    actionId: string;
    tasks: TaskState;
    result: unknown;
    // The draft was shown to the owner: it counts as a hint on the tombstone.
    show?: boolean;
    effect?: PublishEffect;
  }): Promise<PublishOutcome> {
    assertUuid(input.sessionId);
    assertUuid(input.actionId);
    return inOwnerScope(this.database, input.scope, async (tx) => {
      const guard = await guardHolder(
        tx,
        input.scope,
        input.sessionId,
        input.holder,
      );
      if (!guard.ok) return guard.refused;
      const { row } = guard;
      const action = await actions.lockAction(
        tx,
        input.scope,
        input.sessionId,
        input.actionId,
      );
      if (!action) return refused("action_not_found", false);
      if (action.dispatchStatus !== "in_flight")
        return refused("action_settled", false);
      const task = input.tasks.tasks[action.taskId];
      const eligibility = task
        ? canPublish({
            sessionStatus: row.status,
            leaseFence: row.fence,
            holderFence: input.holder.fence,
            taskRevision: Number(action.taskRevision),
            currentTaskRevision: task.revision,
            sourceSuperseded:
              revisionStanding(
                input.tasks,
                action.taskId,
                Number(action.taskRevision),
              ) === "source_superseded",
          })
        : { eligible: false as const, reason: "revision_stale" as const };
      if (!eligibility.eligible) {
        await actions.suppressAction(
          tx,
          input.scope,
          input.actionId,
          eligibility.reason,
        );
        return refused(eligibility.reason, true);
      }
      const merged = input.effect
        ? await input.effect({
            tx,
            scope: input.scope,
            sessionId: input.sessionId,
            actionId: input.actionId,
            taskId: action.taskId,
            taskRevision: Number(action.taskRevision),
          })
        : undefined;
      const stored = merged
        ? { ...(input.result as Record<string, unknown>), ...merged }
        : input.result;
      const show = input.show === true;
      await actions.markSucceeded(
        tx,
        input.scope,
        input.actionId,
        stored,
        show,
      );
      if (show)
        await actions.incrementShownDrafts(tx, input.scope, input.sessionId);
      return { outcome: "published" };
    });
  }

  // The session's standing right before a model call, read under the same
  // fenced-write check as every write: the row is locked, the holder's fence and
  // lease are verified, and the status, processing policy and assistance flag
  // returned are the stored ones, so the processor derives each request's
  // policy from the session row alone (rule:session-processing-policy) and
  // re-checks locality immediately before dispatch (rule:device-only-enforced-
  // twice). A stale holder learns nothing but the refusal.
  async readDispatchStanding(input: {
    scope: OwnerScope;
    sessionId: string;
    holder: FenceHolder;
  }): Promise<DispatchStandingOutcome> {
    assertUuid(input.sessionId);
    return inOwnerScope(this.database, input.scope, async (tx) => {
      const guard = await guardHolder(
        tx,
        input.scope,
        input.sessionId,
        input.holder,
      );
      if (!guard.ok) return guard.refused;
      const { row } = guard;
      return {
        outcome: "standing",
        status: row.status,
        processingPolicy: row.policy,
        screenshotSend: row.screenshotSend,
        liveAssistance: row.sources?.liveAssistance === true,
        fence: row.fence,
      };
    });
  }

  // The draft's text so far, while the action is in flight: rewritten as the
  // model writes (the browser shows it), under the same holder check as every
  // write. A settled action is left alone (the publish or failure owns it).
  async recordProgress(input: {
    scope: OwnerScope;
    sessionId: string;
    holder: FenceHolder;
    actionId: string;
    progress: { draft: string };
  }): Promise<SettleOutcome> {
    assertUuid(input.sessionId);
    return inOwnerScope(this.database, input.scope, async (tx) => {
      const guard = await guardHolder(
        tx,
        input.scope,
        input.sessionId,
        input.holder,
      );
      if (!guard.ok) return guard.refused;
      const updated = await actions.writeProgress(
        tx,
        input.scope,
        input.sessionId,
        input.actionId,
        input.progress,
      );
      return updated
        ? { outcome: "recorded" }
        : refused("action_settled", false);
    });
  }

  // Settles an in-flight action as suppressed with a code (ids and codes only)
  // when the processor itself decides not to dispatch it, for example a
  // locality refusal or an output that failed its closed schema.
  async abandonAction(input: {
    scope: OwnerScope;
    sessionId: string;
    holder: FenceHolder;
    actionId: string;
    reason: string;
  }): Promise<SettleOutcome> {
    assertUuid(input.sessionId);
    assertUuid(input.actionId);
    if (!REASON_CODE.test(input.reason))
      throw new SessionError("invalid_input");
    return inOwnerScope(this.database, input.scope, async (tx) => {
      const guard = await guardHolder(
        tx,
        input.scope,
        input.sessionId,
        input.holder,
      );
      if (!guard.ok) return guard.refused;
      const updated = await actions.abandonInFlight(
        tx,
        input.scope,
        input.sessionId,
        input.actionId,
        input.reason,
      );
      return updated
        ? { outcome: "recorded" }
        : refused("action_settled", false);
    });
  }

  // Records a failed dispatch (a later retry is deduplicated only against a
  // succeeded or in-flight dispatch, so a failed one may be retried).
  async recordFailure(input: {
    scope: OwnerScope;
    sessionId: string;
    holder: FenceHolder;
    actionId: string;
  }): Promise<SettleOutcome> {
    assertUuid(input.sessionId);
    assertUuid(input.actionId);
    return inOwnerScope(this.database, input.scope, async (tx) => {
      const guard = await guardHolder(
        tx,
        input.scope,
        input.sessionId,
        input.holder,
      );
      if (!guard.ok) return guard.refused;
      const updated = await actions.failInFlight(
        tx,
        input.scope,
        input.sessionId,
        input.actionId,
      );
      return updated
        ? { outcome: "recorded" }
        : refused("action_settled", false);
    });
  }
}

export type SessionJobRequest = {
  scope: OwnerScope;
  sessionId: string;
  holder: FenceHolder;
  // The id reserved on the action by recordAction.
  jobId: string;
  profile: Parameters<SessionJobs["create"]>[0]["profile"];
  promptReference: string;
};

// Creates the session's private job under a lock on the session row that
// verifies it is active, the holder's fence and lease are current and an action
// of this session names the reserved id (rule:job-creation-locked-to-session).
// Creation is idempotent on the id; once the job row exists the action's
// job_created flag is set, and the database re-verifies the job is the owner's
// private Interview job.
export async function createSessionJob(
  database: PlatformDatabase,
  jobs: SessionJobs,
  input: SessionJobRequest,
) {
  assertUuid(input.sessionId);
  assertUuid(input.jobId);
  const { scope } = input;
  const job = await jobs.create(
    {
      id: input.jobId,
      private: true,
      tenantId: scope.tenantId,
      userId: scope.actorId,
      productId: INTERVIEW_PRODUCT_ID,
      profile: input.profile,
      promptReference: input.promptReference,
    },
    {
      beforeInsert: async (transaction) => {
        const row = await lockSessionForJob(
          transaction,
          scope,
          input.sessionId,
          input.jobId,
        );
        if (
          row?.["status"] !== "active" ||
          // [SAFETY] A remote agent job is never created for a session that
          // has tightened to device-only, however late the tighten came.
          row["processing_policy"] !== "permitted_remote" ||
          Number(row["fence"]) !== input.holder.fence ||
          row["lease_holder_id"] !== input.holder.workerId ||
          row["lease_live"] !== true ||
          row["reserved"] !== true
        )
          throw new SessionError("job_creation_refused");
      },
    },
  );
  await inOwnerScope(database, scope, async (tx) => {
    await actions.markJobCreated(tx, scope, input.sessionId, input.jobId);
  });
  return job;
}

// [SAFETY] The resume guard: finds the session through the action that names
// the job and requires it active, under the session-row lock, so no job resumes
// after the session ended or paused (rule:no-resume-after-end) or tightened to
// device-only. A job no action names is refused.
export function sessionJobResumeGuard(
  tenantId: string,
  jobId: string,
): (transaction: GuardTransaction) => Promise<boolean> {
  return async (transaction) => {
    const row = await lockSessionOfJob(transaction, tenantId, jobId);
    // [SAFETY] A device-only session never resumes a remote agent job.
    return (
      row?.["status"] === "active" &&
      row?.["processing_policy"] === "permitted_remote"
    );
  };
}

export async function resumeSessionJob(
  jobs: SessionJobs,
  scope: OwnerScope,
  jobId: string,
  promptReference: string,
): Promise<boolean> {
  assertUuid(jobId);
  return jobs.requestResume(
    scope.tenantId,
    scope.actorId,
    jobId,
    promptReference,
    {
      guard: sessionJobResumeGuard(scope.tenantId, jobId),
    },
  );
}

// The job id the dispatch reserves on its action before the job exists.
export const reserveJobId = (): string => randomUUID();
