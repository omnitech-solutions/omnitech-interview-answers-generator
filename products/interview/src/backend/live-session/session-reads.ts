// Owner-checked read paths (rule:owner-checked-read-paths): streams, downloads,
// context assembly and job results each open an actor-scoped transaction for the
// session owner and read only owner-scoped data, so another same-tenant user
// finds nothing. A session that is not the actor's reads as "not found", the
// same as one that does not exist.
import type { PlatformDatabase } from "@omnitech/database";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile.js";
import { SESSION_SCREENSHOT_ARTIFACT_TYPE } from "../db/live-session.js";
import { assertUuid, SessionError } from "./errors.js";
import { firstRow, inOwnerScope, type OwnerScope, rowsOf } from "./scope.js";
import type { SessionJobs } from "./session-jobs.js";
import { readSession, type SessionView, toView } from "./session-record.js";
import { decodeWithheldReason } from "./withheld.js";

export const MAX_PAGE = 500;
// A page is at most MAX_PAGE; one more row may be asked for (MAX_PAGE + 1) so
// a reader can tell whether a further page exists.
export const pageSize = (limit: number | undefined, fallback: number): number =>
  Math.max(1, Math.min(limit ?? fallback, MAX_PAGE + 1));

export async function getSession(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<SessionView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  return inOwnerScope(database, scope, async (tx) => {
    const record = await readSession(tx, scope, sessionId);
    return record ? toView(record) : null;
  });
}

// The owner's session that is not ended or purging (at most one).
export async function getOpenSession(
  database: PlatformDatabase,
  scope: OwnerScope,
): Promise<SessionView | null> {
  return inOwnerScope(database, scope, async (tx) => {
    const row = await firstRow<{ id: string }>(
      tx,
      sql`SELECT id FROM interview.active_sessions
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND status NOT IN ('ended', 'purging')
          LIMIT 1`,
    );
    if (!row) return null;
    const record = await readSession(tx, scope, row.id);
    return record ? toView(record) : null;
  });
}

export type StoredObservation = {
  sequence: number;
  sourceId: string;
  eventId: string;
  kind: string;
  receivedAt: string;
  content: unknown;
  screenshotArtifactId: string | null;
};

// In order, by the per-session sequence; the cursor is the last sequence seen.
export async function listObservations(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  options: { afterSequence?: number; limit?: number } = {},
): Promise<StoredObservation[]> {
  assertUuid(sessionId);
  const after = options.afterSequence ?? 0;
  const limit = pageSize(options.limit, 200);
  return inOwnerScope(database, scope, async (tx) => {
    if (!(await readSession(tx, scope, sessionId)))
      throw new SessionError("not_found");
    const rows = await rowsOf<Record<string, unknown>>(
      tx,
      sql`SELECT sequence, source_id, event_id, kind, received_at, content,
                 screenshot_artifact_id
          FROM interview.session_observations
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid AND sequence > ${after}
          ORDER BY sequence LIMIT ${limit}`,
    );
    return rows.map((row) => ({
      sequence: Number(row["sequence"]),
      sourceId: String(row["source_id"]),
      eventId: String(row["event_id"]),
      kind: String(row["kind"]),
      receivedAt: new Date(row["received_at"] as string).toISOString(),
      content: row["content"],
      screenshotArtifactId: row["screenshot_artifact_id"]
        ? String(row["screenshot_artifact_id"])
        : null,
    }));
  });
}

export type StoredAction = {
  id: string;
  taskId: string;
  taskRevision: number;
  actionKind: string;
  dispatchStatus: string;
  attempt: number;
  // The fence the dispatching holder held; an in-flight action under an older
  // fence than the current holder's belongs to a holder that is gone.
  fenceAtDispatch: number;
  jobId: string | null;
  jobCreated: boolean;
  // The transcript segment ids the task revision was built on. Read only for
  // the worker (listActions), never for the browser's changes feed; null for
  // a row written before the column existed.
  sourceEventIds?: readonly string[] | null;
  result: unknown;
  shown: boolean;
  suppressionReason: string | null;
  createdAt: string;
  // Set by the database on every status change (the action cursor's key).
  updatedAt: string;
};

export const ACTION_COLUMNS = sql`id, task_id, task_revision, action_kind,
  dispatch_status, attempt, fence_at_dispatch, job_id, job_created, result,
  shown, suppression_reason, created_at, updated_at`;

export function toStoredAction(row: Record<string, unknown>): StoredAction {
  // A withheld draft's summary rides on its suppression reason (withheld.ts):
  // the browser reads it as result.withheld, content-free.
  const stored = row["suppression_reason"]
    ? decodeWithheldReason(String(row["suppression_reason"]))
    : null;
  return {
    id: String(row["id"]),
    taskId: String(row["task_id"]),
    taskRevision: Number(row["task_revision"]),
    actionKind: String(row["action_kind"]),
    dispatchStatus: String(row["dispatch_status"]),
    attempt: Number(row["attempt"]),
    fenceAtDispatch: Number(row["fence_at_dispatch"]),
    jobId: row["job_id"] ? String(row["job_id"]) : null,
    jobCreated: Boolean(row["job_created"]),
    result: stored?.withheld
      ? { withheld: stored.withheld }
      : (row["result"] ?? null),
    shown: Boolean(row["shown"]),
    suppressionReason: stored ? stored.reason : null,
    createdAt: new Date(row["created_at"] as string).toISOString(),
    updatedAt: new Date(row["updated_at"] as string).toISOString(),
    ...("source_event_ids" in row
      ? {
          sourceEventIds: Array.isArray(row["source_event_ids"])
            ? (row["source_event_ids"] as string[])
            : null,
        }
      : {}),
  };
}

// The oldest actions by creation, bounded: for workers and tests that read a
// session's actions whole. The browser reads changes through
// listActionChanges (session-pages.ts), which a changed row cannot hide from.
export async function listActions(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  options: { limit?: number } = {},
): Promise<StoredAction[]> {
  assertUuid(sessionId);
  const limit = pageSize(options.limit, 200);
  return inOwnerScope(database, scope, async (tx) => {
    if (!(await readSession(tx, scope, sessionId)))
      throw new SessionError("not_found");
    const rows = await rowsOf<Record<string, unknown>>(
      tx,
      sql`SELECT ${ACTION_COLUMNS}, source_event_ids
          FROM interview.session_actions
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid
          ORDER BY created_at, id LIMIT ${limit}`,
    );
    return rows.map(toStoredAction);
  });
}

// The worker's read of a session's actions: the NEWEST `limit` rows, oldest
// first. A long session whose actions pass a page would otherwise seed a
// rebuilt run from its oldest rows only and lose every later task.
export async function listActionsNewest(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  limit: number,
): Promise<StoredAction[]> {
  assertUuid(sessionId);
  return inOwnerScope(database, scope, async (tx) => {
    if (!(await readSession(tx, scope, sessionId)))
      throw new SessionError("not_found");
    const rows = await rowsOf<Record<string, unknown>>(
      tx,
      sql`SELECT ${ACTION_COLUMNS}, source_event_ids
          FROM interview.session_actions
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid
          ORDER BY created_at DESC, id DESC LIMIT ${Math.max(1, limit)}`,
    );
    return rows.map(toStoredAction).reverse();
  });
}

export type ScreenshotDownload = { bytes: Uint8Array; mediaType: string };

// The download read: the owner's own session screenshot only, served with its
// stored type (never sniffed). Anyone else gets null.
export async function readScreenshot(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  artifactId: string,
): Promise<ScreenshotDownload | null> {
  assertUuid(sessionId);
  assertUuid(artifactId);
  return inOwnerScope(database, scope, async (tx) => {
    const row = await firstRow<{ bytes: Uint8Array; metadata: unknown }>(
      tx,
      sql`SELECT p.bytes, a.metadata
          FROM platform.artifacts a
          JOIN platform.artifact_payloads p
            ON p.tenant_id = a.tenant_id AND p.artifact_id = a.id
          WHERE a.tenant_id = ${scope.tenantId}::uuid
            AND a.id = ${artifactId}::uuid
            AND a.product_id = ${INTERVIEW_PRODUCT_ID}
            AND a.artifact_type = ${SESSION_SCREENSHOT_ARTIFACT_TYPE}
            AND a.owner_user_id = ${scope.actorId}::uuid
            AND a.metadata->>'session_id' = ${sessionId}`,
    );
    if (!row) return null;
    const mediaType = (row.metadata as { media_type?: string } | null)
      ?.media_type;
    return {
      bytes: row.bytes,
      mediaType: mediaType ?? "application/octet-stream",
    };
  });
}

export type SessionContext = {
  session: SessionView;
  // The approved candidate-profile revision pinned at session start.
  profile: {
    id: string;
    revision: number;
    sha256: string;
    matrix: unknown;
  } | null;
};

// Context assembly: the pinned profile revision, read in the owner's actor
// scope, so a link never widens access.
export async function getSessionContext(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<SessionContext | null> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  return inOwnerScope(database, scope, async (tx) => {
    const record = await readSession(tx, scope, sessionId);
    if (!record) return null;
    let profile: SessionContext["profile"] = null;
    if (record.profileId !== null && record.profileRevision !== null) {
      const row = await firstRow<{ sha256: string; matrix: unknown }>(
        tx,
        sql`SELECT sha256, matrix FROM interview.candidate_profile_revisions
            WHERE tenant_id = ${scope.tenantId} AND actor_id = ${scope.actorId}
              AND product_id = ${INTERVIEW_PRODUCT_ID}
              AND id = ${record.profileId}
              AND revision = ${record.profileRevision}`,
      );
      if (row)
        profile = {
          id: record.profileId,
          revision: record.profileRevision,
          sha256: row.sha256,
          matrix: row.matrix,
        };
    }
    return { session: toView(record), profile };
  });
}

// A session job's result, read with the actor-carrying get. The job is named
// only through an action of the owner's own session.
export async function getSessionJob(
  database: PlatformDatabase,
  jobs: SessionJobs,
  scope: OwnerScope,
  sessionId: string,
  jobId: string,
) {
  assertUuid(sessionId);
  assertUuid(jobId);
  const named = await inOwnerScope(database, scope, (tx) =>
    firstRow<{ job_id: string }>(
      tx,
      sql`SELECT job_id FROM interview.session_actions
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid AND job_id = ${jobId}::uuid`,
    ),
  );
  if (!named) return undefined;
  return jobs.get(scope.tenantId, scope.actorId, jobId);
}
