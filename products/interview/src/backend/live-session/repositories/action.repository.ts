// Persistence of session_actions (the dispatch ledger, the in-flight draft's
// progress, the published result) and the counters on the session row that the
// publish moves. No decisions here: callers decide, this file reads and writes.
import type { TenantDatabase } from "@omnitech/database";
import { and, desc, eq, sql } from "drizzle-orm";
import { activeSessions, sessionActions } from "../../db/live-session";
import type { OwnerScope } from "../scope";

const ownedActions = (scope: OwnerScope) =>
  and(
    eq(sessionActions.tenantId, scope.tenantId),
    eq(sessionActions.ownerUserId, scope.actorId),
  );

const ownedSession = (scope: OwnerScope, sessionId: string) =>
  and(
    eq(activeSessions.tenantId, scope.tenantId),
    eq(activeSessions.ownerUserId, scope.actorId),
    eq(activeSessions.id, sessionId),
  );

// What the dispatch ledger needs of the rows already stored for one key.
export type StoredAttempt = { attempt: number; dispatchStatus: string };

export async function listAttempts(
  tx: TenantDatabase,
  scope: OwnerScope,
  key: {
    sessionId: string;
    taskId: string;
    revision: number;
    actionKind: string;
  },
): Promise<StoredAttempt[]> {
  return tx
    .select({
      attempt: sessionActions.attempt,
      dispatchStatus: sessionActions.dispatchStatus,
    })
    .from(sessionActions)
    .where(
      and(
        ownedActions(scope),
        eq(sessionActions.sessionId, key.sessionId),
        eq(sessionActions.taskId, key.taskId),
        eq(sessionActions.taskRevision, key.revision),
        eq(sessionActions.actionKind, key.actionKind),
      ),
    );
}

// Inserts an in-flight action; the job id (when reserved) is committed with it.
export async function insertInFlightAction(
  tx: TenantDatabase,
  scope: OwnerScope,
  action: {
    sessionId: string;
    taskId: string;
    revision: number;
    actionKind: string;
    attempt: number;
    jobId: string | null;
    fence: number;
    sourceEventIds: readonly string[] | null;
  },
): Promise<string | undefined> {
  const rows = await tx
    .insert(sessionActions)
    .values({
      tenantId: scope.tenantId,
      ownerUserId: scope.actorId,
      sessionId: action.sessionId,
      taskId: action.taskId,
      taskRevision: action.revision,
      actionKind: action.actionKind,
      dispatchStatus: "in_flight",
      attempt: action.attempt,
      jobId: action.jobId,
      fenceAtDispatch: action.fence,
      sourceEventIds: action.sourceEventIds ? [...action.sourceEventIds] : null,
    })
    .returning({ id: sessionActions.id });
  return rows[0]?.id;
}

// Inserts a suppressed row (ids and a code only).
export async function insertSuppressedAction(
  tx: TenantDatabase,
  scope: OwnerScope,
  action: {
    sessionId: string;
    taskId: string;
    revision: number;
    actionKind: string;
    fence: number;
    reason: string;
    sourceEventIds: readonly string[] | null;
  },
): Promise<void> {
  await tx.insert(sessionActions).values({
    tenantId: scope.tenantId,
    ownerUserId: scope.actorId,
    sessionId: action.sessionId,
    taskId: action.taskId,
    taskRevision: action.revision,
    actionKind: action.actionKind,
    dispatchStatus: "suppressed",
    attempt: 1,
    fenceAtDispatch: action.fence,
    suppressionReason: action.reason,
    sourceEventIds: action.sourceEventIds ? [...action.sourceEventIds] : null,
  });
}

// Raises the transcript position the holder has handled, never lowers it.
export async function raiseProcessedThrough(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  through: number,
): Promise<void> {
  await tx
    .update(activeSessions)
    .set({
      processedThrough: sql`GREATEST(COALESCE(processed_through, 0), ${through})`,
    })
    .where(ownedSession(scope, sessionId));
}

// Locks one action of the session and reads what the publish decides on.
export async function lockAction(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  actionId: string,
): Promise<
  { taskId: string; taskRevision: number; dispatchStatus: string } | undefined
> {
  const rows = await tx
    .select({
      taskId: sessionActions.taskId,
      taskRevision: sessionActions.taskRevision,
      dispatchStatus: sessionActions.dispatchStatus,
    })
    .from(sessionActions)
    .where(
      and(
        ownedActions(scope),
        eq(sessionActions.sessionId, sessionId),
        eq(sessionActions.id, actionId),
      ),
    )
    .for("update");
  return rows[0];
}

// Settles an action as suppressed whatever its state (the publish holds the lock).
export async function suppressAction(
  tx: TenantDatabase,
  scope: OwnerScope,
  actionId: string,
  reason: string,
): Promise<void> {
  await tx
    .update(sessionActions)
    .set({ dispatchStatus: "suppressed", suppressionReason: reason })
    .where(and(ownedActions(scope), eq(sessionActions.id, actionId)));
}

// Marks the action succeeded with its stored result, clearing the progress.
export async function markSucceeded(
  tx: TenantDatabase,
  scope: OwnerScope,
  actionId: string,
  stored: unknown,
  shown: boolean,
): Promise<void> {
  await tx
    .update(sessionActions)
    .set({
      dispatchStatus: "succeeded",
      result: sql`${JSON.stringify(stored)}::jsonb`,
      progress: null,
      shown,
    })
    .where(and(ownedActions(scope), eq(sessionActions.id, actionId)));
}

export async function incrementShownDrafts(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<void> {
  await tx
    .update(activeSessions)
    .set({ shownDraftCount: sql`${activeSessions.shownDraftCount} + 1` })
    .where(ownedSession(scope, sessionId));
}

const inFlightOf = (scope: OwnerScope, sessionId: string, actionId: string) =>
  and(
    ownedActions(scope),
    eq(sessionActions.sessionId, sessionId),
    eq(sessionActions.id, actionId),
    eq(sessionActions.dispatchStatus, "in_flight"),
  );

// Each returns whether an in-flight action was changed.
export async function writeProgress(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  actionId: string,
  progress: { draft: string },
): Promise<boolean> {
  const rows = await tx
    .update(sessionActions)
    .set({ progress: sql`${JSON.stringify(progress)}::jsonb` })
    .where(inFlightOf(scope, sessionId, actionId))
    .returning({ id: sessionActions.id });
  return rows.length === 1;
}

export async function abandonInFlight(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  actionId: string,
  reason: string,
): Promise<boolean> {
  const rows = await tx
    .update(sessionActions)
    .set({ dispatchStatus: "suppressed", suppressionReason: reason })
    .where(inFlightOf(scope, sessionId, actionId))
    .returning({ id: sessionActions.id });
  return rows.length === 1;
}

export async function failInFlight(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  actionId: string,
): Promise<boolean> {
  const rows = await tx
    .update(sessionActions)
    .set({ dispatchStatus: "failed" })
    .where(inFlightOf(scope, sessionId, actionId))
    .returning({ id: sessionActions.id });
  return rows.length === 1;
}

export async function markJobCreated(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  jobId: string,
): Promise<void> {
  await tx
    .update(sessionActions)
    .set({ jobCreated: true })
    .where(
      and(
        ownedActions(scope),
        eq(sessionActions.sessionId, sessionId),
        eq(sessionActions.jobId, jobId),
        eq(sessionActions.jobCreated, false),
      ),
    );
}

// The revision of the draft the session last wrote for the task: the newest
// earlier succeeded result that actually published the draft. Undefined when
// none did; the revision text is null when the result carries none.
export async function lastPublishedDraftRevision(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  taskId: string,
  actionKind: string,
): Promise<{ revision: string | number | null } | undefined> {
  const rows = await tx
    .select({
      revision: sql<
        string | null
      >`${sessionActions.result}->'workspace'->>'artifactRevision'`,
    })
    .from(sessionActions)
    .where(
      and(
        ownedActions(scope),
        eq(sessionActions.sessionId, sessionId),
        eq(sessionActions.taskId, taskId),
        eq(sessionActions.actionKind, actionKind),
        eq(sessionActions.dispatchStatus, "succeeded"),
        sql`${sessionActions.result}->'workspace'->>'published' = 'true'`,
      ),
    )
    .orderBy(desc(sessionActions.taskRevision), desc(sessionActions.createdAt))
    .limit(1);
  return rows[0];
}
