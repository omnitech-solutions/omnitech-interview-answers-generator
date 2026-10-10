// Every read behind the owner-checked read paths: the open session's id, the
// observation and action rows, a task's screenshots, the pinned profile
// revision, the session history page, and the action-changes page. Each takes
// the open tenant transaction and the owner's scope, returns raw rows and
// decides nothing; the use cases (session-reads.ts, session-pages.ts) own the
// not-found refusal, the paging and the mapping. The statements are kept raw
// because they use PostgreSQL-specific constructs (window ranks, array_agg,
// unnest ... WITH ORDINALITY, correlated subqueries, row-value keysets,
// to_char) that the query builder would only restate.
import type { TenantDatabase } from "@omnitech/database";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../../assistant-profile";
import { OWNER_INPUT_SOURCE_ID } from "../../db/live-session";
import { firstRow, type OwnerScope, rowsOf } from "../scope";

export type Row = Record<string, unknown>;

// Microsecond-exact UTC text: a JavaScript Date would truncate to the
// millisecond, and a keyset that rounds its own key can return the same row
// forever.
const EXACT = sql`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
// A cursor for "before every row" sorts below any id.
export const NIL_ID = "00000000-0000-0000-0000-000000000000";

export const ACTION_COLUMNS = sql`id, task_id, task_revision, action_kind,
  dispatch_status, attempt, fence_at_dispatch, job_id, job_created, result,
  progress, shown, suppression_reason, created_at, updated_at`;

// Column that gives the browser's feed the snapshot provenance ids only: the
// spoken segment ids and owner input ids in source_event_ids stay server-side.
export const SNAPSHOT_EVENT_IDS = sql`ARRAY(
    SELECT source_id FROM unnest(source_event_ids) WITH ORDINALITY AS u(source_id, n)
    WHERE source_id LIKE 'snap/%' ORDER BY n) AS snapshot_event_ids`;

// Column that tells the browser WHY a task revision exists when the owner's own
// input made it: the newest owner input the revision rests on that no earlier
// revision of the task did (a regeneration, or a screenshot added to the task).
// The input's content stays server-side; only the closed word leaves.
export const REVISION_REASON = sql`(
    SELECT CASE o.content->'body'->>'operation'
             WHEN 'regenerate' THEN 'regenerate'
             WHEN 'analyze' THEN CASE WHEN o.content->'body'->'target' IS NOT NULL
                                      THEN 'added-screenshot' END
           END
    FROM interview.session_observations o
    WHERE session_actions.task_revision > 1
      AND o.tenant_id = session_actions.tenant_id
      AND o.owner_user_id = session_actions.owner_user_id
      AND o.session_id = session_actions.session_id
      AND o.source_id = ${OWNER_INPUT_SOURCE_ID}
      AND 'input/' || o.event_id = ANY(session_actions.source_event_ids)
      AND NOT EXISTS (
        SELECT 1 FROM interview.session_actions p
        WHERE p.tenant_id = session_actions.tenant_id
          AND p.owner_user_id = session_actions.owner_user_id
          AND p.session_id = session_actions.session_id
          AND p.task_id = session_actions.task_id
          AND p.task_revision < session_actions.task_revision
          AND 'input/' || o.event_id = ANY(p.source_event_ids))
    ORDER BY o.sequence DESC LIMIT 1) AS revision_reason`;

// The owner's session that is not ended or purging (at most one).
export function findOpenSessionId(
  tx: TenantDatabase,
  scope: OwnerScope,
): Promise<{ id: string } | undefined> {
  return firstRow<{ id: string }>(
    tx,
    sql`SELECT id FROM interview.active_sessions
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND status NOT IN ('ended', 'purging')
          LIMIT 1`,
  );
}

// In order, by the per-session sequence, after the cursor.
export function readObservationRows(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  page: { after: number; limit: number; excludeOwnerInput: boolean },
): Promise<Row[]> {
  return rowsOf<Row>(
    tx,
    sql`SELECT sequence, source_id, event_id, kind, received_at, content,
                 screenshot_artifact_id
          FROM interview.session_observations
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid AND sequence > ${page.after}
            ${page.excludeOwnerInput ? sql`AND kind <> 'owner.input'` : sql``}
          ORDER BY sequence LIMIT ${page.limit}`,
  );
}

// The snapshots any revision of one task was built on; the ordinal is ranked
// among ALL the session's snapshots before the join narrows to the task.
export function readTaskScreenshotRows(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  taskId: string,
): Promise<Row[]> {
  return rowsOf<Row>(
    tx,
    sql`SELECT o.ordinal, o.source_id, o.event_id, o.sequence, o.received_at,
                 o.screenshot_artifact_id, o.ocr_engine, o.display,
                 array_agg(DISTINCT a.task_revision
                           ORDER BY a.task_revision) AS revisions
          FROM (SELECT sequence, source_id, event_id, received_at,
                       screenshot_artifact_id, session_id, tenant_id,
                       owner_user_id, content->'ocr'->>'engine' AS ocr_engine,
                       content->'display' AS display,
                       row_number() OVER (ORDER BY sequence)::int AS ordinal
                FROM interview.session_observations
                WHERE tenant_id = ${scope.tenantId}::uuid
                  AND owner_user_id = ${scope.actorId}::uuid
                  AND session_id = ${sessionId}::uuid
                  AND kind = 'screen.snapshot') o
          JOIN interview.session_actions a
            ON a.tenant_id = o.tenant_id AND a.owner_user_id = o.owner_user_id
           AND a.session_id = o.session_id AND a.task_id = ${taskId}
           AND 'snap/' || a.session_id || '/' || o.source_id || '/' || o.event_id
               = ANY(a.source_event_ids)
          GROUP BY o.ordinal, o.source_id, o.event_id, o.sequence,
                   o.received_at, o.screenshot_artifact_id, o.ocr_engine,
                   o.display
          ORDER BY o.sequence`,
  );
}

// What each succeeded revision of a task recorded as sent, oldest first.
export function readScreenshotsSentRows(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  taskId: string,
): Promise<Row[]> {
  return rowsOf<Row>(
    tx,
    sql`SELECT task_revision, result->'screenshotsSent' AS sent
          FROM interview.session_actions
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid AND task_id = ${taskId}
            AND dispatch_status = 'succeeded'
            AND result->'screenshotsSent' IS NOT NULL
          ORDER BY task_revision, created_at`,
  );
}

// The oldest actions by creation, bounded.
export function readActionRowsOldest(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  limit: number,
): Promise<Row[]> {
  return rowsOf<Row>(
    tx,
    sql`SELECT ${ACTION_COLUMNS}, source_event_ids
          FROM interview.session_actions
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid
          ORDER BY created_at, id LIMIT ${limit}`,
  );
}

// The newest actions by creation, newest first (the caller reverses).
export function readActionRowsNewest(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  limit: number,
): Promise<Row[]> {
  return rowsOf<Row>(
    tx,
    sql`SELECT ${ACTION_COLUMNS}, source_event_ids
          FROM interview.session_actions
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid
          ORDER BY created_at DESC, id DESC LIMIT ${limit}`,
  );
}

// The profile revision a session pinned, in the owner's actor scope.
export function readPinnedProfileRevision(
  tx: TenantDatabase,
  scope: OwnerScope,
  pin: { profileId: string; revision: number },
): Promise<{ sha256: string; matrix: unknown } | undefined> {
  return firstRow<{ sha256: string; matrix: unknown }>(
    tx,
    sql`SELECT sha256, matrix FROM interview.candidate_profile_revisions
            WHERE tenant_id = ${scope.tenantId} AND actor_id = ${scope.actorId}
              AND product_id = ${INTERVIEW_PRODUCT_ID}
              AND id = ${pin.profileId}
              AND revision = ${pin.revision}`,
  );
}

// The job an action of the owner's own session names.
export function findActionJob(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  jobId: string,
): Promise<{ job_id: string } | undefined> {
  return firstRow<{ job_id: string }>(
    tx,
    sql`SELECT job_id FROM interview.session_actions
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid AND job_id = ${jobId}::uuid`,
  );
}

// One keyset page of the owner's session history, newest first; `limit` rows
// are asked for as given (the caller adds the look-ahead row).
export function readSessionHistoryRows(
  tx: TenantDatabase,
  scope: OwnerScope,
  after: { at: string; id: string } | null,
  limit: number,
): Promise<Row[]> {
  return rowsOf<Row>(
    tx,
    sql`SELECT id, status, retention_mode, processing_policy, created_at,
                 ended_at, purged_at, interview_id, candidacy_id,
                 rehearsal_run_id, shown_draft_count,
                 to_char(created_at AT TIME ZONE 'UTC', ${EXACT}) AS key_at
          FROM interview.active_sessions
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND (${after === null}
                 OR (created_at, id) < (${after?.at ?? null}::timestamptz,
                                        ${after?.id ?? NIL_ID}::uuid))
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit}`,
  );
}

// One keyset page of a session's actions created or changed after the cursor.
export function readActionChangeRows(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  after: { at: string; id: string } | null,
  limit: number,
): Promise<Row[]> {
  return rowsOf<Row>(
    tx,
    sql`SELECT ${ACTION_COLUMNS}, ${SNAPSHOT_EVENT_IDS}, ${REVISION_REASON},
                 to_char(updated_at AT TIME ZONE 'UTC', ${EXACT}) AS key_at
          FROM interview.session_actions
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid
            AND (${after === null}
                 OR (updated_at, id) > (${after?.at ?? null}::timestamptz,
                                        ${after?.id ?? NIL_ID}::uuid))
          ORDER BY updated_at, id
          LIMIT ${limit}`,
  );
}

// The database clock now and `overlapSeconds` ago, as exact UTC text.
export function readDatabaseClock(
  tx: TenantDatabase,
  overlapSeconds: number,
): Promise<{ now_text: string; margin_text: string } | undefined> {
  return firstRow<{ now_text: string; margin_text: string }>(
    tx,
    sql`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now_text,
                 to_char((now() - make_interval(secs => ${overlapSeconds}))
                         AT TIME ZONE 'UTC', ${EXACT}) AS margin_text`,
  );
}
