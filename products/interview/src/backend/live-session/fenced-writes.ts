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
import { PostgresAgentJobRepository } from "@omnitech/platform-storage";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile.js";
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
} from "./core/index.js";
import { assertUuid, SessionError } from "./errors.js";
import { MAX_REASON_CHARS } from "./withheld.js";
import { firstRow, inOwnerScope, type OwnerScope, rowsOf } from "./scope.js";
import type { SessionJobs } from "./session-jobs.js";
import { lockSession, type SessionRecord } from "./session-record.js";

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
export type PublishEffectContext = {
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

type ActionRow = {
  attempt: number;
  dispatch_status: string;
};

// The dispatch ledger for one key, rebuilt from the persisted rows: succeeded
// and in-flight dedup, a failed dispatch may be retried with the next attempt.
function ledgerOf(request: DispatchRequest, rows: ActionRow[]): DispatchLedger {
  const attempts = rows.reduce((max, r) => Math.max(max, Number(r.attempt)), 0);
  const status = rows.some((r) => r.dispatch_status === "succeeded")
    ? "succeeded"
    : rows.some((r) => r.dispatch_status === "in_flight")
      ? "in-flight"
      : rows.some((r) => r.dispatch_status === "failed")
        ? "failed"
        : null;
  if (status === null) return { entries: {} };
  const key = dispatchKey(request);
  return { entries: { [key]: { key, status, attempts } } };
}

// A text[] value from ids (never text content); null stays null.
const textArray = (ids: readonly string[] | null) =>
  ids === null
    ? sql`NULL::text[]`
    : sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;

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
      const existing = await rowsOf<ActionRow>(
        tx,
        sql`SELECT attempt, dispatch_status FROM interview.session_actions
            WHERE tenant_id = ${input.scope.tenantId}::uuid
              AND owner_user_id = ${input.scope.actorId}::uuid
              AND session_id = ${input.sessionId}::uuid
              AND task_id = ${input.taskId}
              AND task_revision = ${input.revision}
              AND action_kind = ${input.actionKind}`,
      );
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
      const inserted = await firstRow<{ id: string }>(
        tx,
        sql`INSERT INTO interview.session_actions
              (tenant_id, owner_user_id, session_id, task_id, task_revision,
               action_kind, dispatch_status, attempt, job_id, fence_at_dispatch,
               source_event_ids)
            VALUES (${input.scope.tenantId}::uuid, ${input.scope.actorId}::uuid,
              ${input.sessionId}::uuid, ${input.taskId}, ${input.revision},
              ${input.actionKind}, 'in_flight', ${decision.attempt},
              ${input.jobId ?? null}::uuid, ${row.fence},
              ${textArray(sourceIdsOf(input.tasks, input.taskId, input.revision))})
            RETURNING id`,
      );
      return {
        outcome: "dispatched",
        actionId: String(inserted?.id),
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
    await tx.execute(sql`
      INSERT INTO interview.session_actions
        (tenant_id, owner_user_id, session_id, task_id, task_revision,
         action_kind, dispatch_status, attempt, fence_at_dispatch,
         suppression_reason, source_event_ids)
      VALUES (${scope.tenantId}::uuid, ${scope.actorId}::uuid, ${row.id}::uuid,
        ${request.taskId}, ${request.revision}, ${request.actionKind},
        'suppressed', 1, ${row.fence}, ${suppression.reason},
        ${textArray(sourceEventIds)})`);
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
      const action = await firstRow<{
        task_id: string;
        task_revision: number;
        dispatch_status: string;
      }>(
        tx,
        sql`SELECT task_id, task_revision, dispatch_status
            FROM interview.session_actions
            WHERE tenant_id = ${input.scope.tenantId}::uuid
              AND owner_user_id = ${input.scope.actorId}::uuid
              AND session_id = ${input.sessionId}::uuid
              AND id = ${input.actionId}::uuid
            FOR UPDATE`,
      );
      if (!action) return refused("action_not_found", false);
      if (action.dispatch_status !== "in_flight")
        return refused("action_settled", false);
      const task = input.tasks.tasks[action.task_id];
      const eligibility = task
        ? canPublish({
            sessionStatus: row.status,
            leaseFence: row.fence,
            holderFence: input.holder.fence,
            taskRevision: Number(action.task_revision),
            currentTaskRevision: task.revision,
            sourceSuperseded:
              revisionStanding(
                input.tasks,
                action.task_id,
                Number(action.task_revision),
              ) === "source_superseded",
          })
        : { eligible: false as const, reason: "revision_stale" as const };
      if (!eligibility.eligible) {
        await tx.execute(sql`
          UPDATE interview.session_actions SET
            dispatch_status = 'suppressed', suppression_reason = ${eligibility.reason}
          WHERE tenant_id = ${input.scope.tenantId}::uuid
            AND owner_user_id = ${input.scope.actorId}::uuid
            AND id = ${input.actionId}::uuid`);
        return refused(eligibility.reason, true);
      }
      const merged = input.effect
        ? await input.effect({
            tx,
            scope: input.scope,
            sessionId: input.sessionId,
            actionId: input.actionId,
            taskId: action.task_id,
            taskRevision: Number(action.task_revision),
          })
        : undefined;
      const stored = merged
        ? { ...(input.result as Record<string, unknown>), ...merged }
        : input.result;
      const show = input.show === true;
      await tx.execute(sql`
        UPDATE interview.session_actions SET
          dispatch_status = 'succeeded', result = ${JSON.stringify(stored)}::jsonb,
          shown = ${show}
        WHERE tenant_id = ${input.scope.tenantId}::uuid
          AND owner_user_id = ${input.scope.actorId}::uuid
          AND id = ${input.actionId}::uuid`);
      if (show)
        await tx.execute(sql`
          UPDATE interview.active_sessions
          SET shown_draft_count = shown_draft_count + 1
          WHERE tenant_id = ${input.scope.tenantId}::uuid
            AND owner_user_id = ${input.scope.actorId}::uuid
            AND id = ${input.sessionId}::uuid`);
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
        liveAssistance: row.sources?.liveAssistance === true,
        fence: row.fence,
      };
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
      const updated = await tx.execute(sql`
        UPDATE interview.session_actions SET
          dispatch_status = 'suppressed', suppression_reason = ${input.reason}
        WHERE tenant_id = ${input.scope.tenantId}::uuid
          AND owner_user_id = ${input.scope.actorId}::uuid
          AND session_id = ${input.sessionId}::uuid
          AND id = ${input.actionId}::uuid AND dispatch_status = 'in_flight'`);
      return (updated.rowCount ?? 0) === 1
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
      const updated = await tx.execute(sql`
        UPDATE interview.session_actions SET dispatch_status = 'failed'
        WHERE tenant_id = ${input.scope.tenantId}::uuid
          AND owner_user_id = ${input.scope.actorId}::uuid
          AND session_id = ${input.sessionId}::uuid
          AND id = ${input.actionId}::uuid AND dispatch_status = 'in_flight'`);
      return (updated.rowCount ?? 0) === 1
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
        const result = await transaction.query(
          `SELECT s.status, s.processing_policy, s.fence, s.lease_holder_id,
                  (s.lease_expires_at IS NOT NULL AND s.lease_expires_at > now()) AS lease_live,
                  EXISTS (
                    SELECT 1 FROM interview.session_actions a
                    WHERE a.tenant_id = s.tenant_id AND a.owner_user_id = s.owner_user_id
                      AND a.session_id = s.id AND a.job_id = $4::uuid
                  ) AS reserved
           FROM interview.active_sessions s
           WHERE s.tenant_id = $1::uuid AND s.owner_user_id = $2::uuid AND s.id = $3::uuid
           FOR UPDATE`,
          [scope.tenantId, scope.actorId, input.sessionId, input.jobId],
        );
        const row = result.rows[0];
        if (
          !row ||
          row["status"] !== "active" ||
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
    await tx.execute(sql`
      UPDATE interview.session_actions SET job_created = true
      WHERE tenant_id = ${scope.tenantId}::uuid
        AND owner_user_id = ${scope.actorId}::uuid
        AND session_id = ${input.sessionId}::uuid
        AND job_id = ${input.jobId}::uuid AND NOT job_created`);
  });
  return job;
}

type GuardTransaction = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
};

// [SAFETY] The resume guard: finds the session through the action that names
// the job and requires it active, under the session-row lock, so no job resumes
// after the session ended or paused (rule:no-resume-after-end) or tightened to
// device-only. A job no action names is refused.
export function sessionJobResumeGuard(
  tenantId: string,
  jobId: string,
): (transaction: GuardTransaction) => Promise<boolean> {
  return async (transaction) => {
    const result = await transaction.query(
      `SELECT s.status, s.processing_policy
       FROM interview.session_actions a
       JOIN interview.active_sessions s
         ON s.tenant_id = a.tenant_id AND s.owner_user_id = a.owner_user_id
        AND s.id = a.session_id
       WHERE a.tenant_id = $1::uuid AND a.job_id = $2::uuid
       FOR UPDATE OF s`,
      [tenantId, jobId],
    );
    // [SAFETY] A device-only session never resumes a remote agent job.
    return (
      result.rows[0]?.["status"] === "active" &&
      result.rows[0]?.["processing_policy"] === "permitted_remote"
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

export function defaultSessionJobs(database: PlatformDatabase): SessionJobs {
  return new PostgresAgentJobRepository(database);
}
