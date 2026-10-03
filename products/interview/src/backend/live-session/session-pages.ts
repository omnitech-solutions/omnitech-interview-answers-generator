// Cursor-paged owner reads for the Studio Live view: the owner's session
// history (newest first) and the session's action changes (every action
// created or changed after a cursor). Both are keyset pages over
// (timestamp, id), read in the owner's actor scope, so another same-tenant
// user finds nothing (rule:owner-checked-read-paths). Nothing here selects
// transcript, draft or answer content except the action result the stream
// already returns to its owner.
import type { PlatformDatabase } from "@omnitech/database";
import { sql } from "drizzle-orm";
import { assertUuid, isUuid, SessionError } from "./errors.js";
import { policyFromDb, retentionFromDb } from "./mapping.js";
import { firstRow, inOwnerScope, type OwnerScope, rowsOf } from "./scope.js";
import {
  ACTION_COLUMNS,
  MAX_PAGE,
  type StoredAction,
  toStoredAction,
} from "./session-reads.js";
import { readSession, type SessionView } from "./session-record.js";

// Microsecond-exact UTC text: a JavaScript Date would truncate to the
// millisecond, and a keyset that rounds its own key can return the same row
// forever.
const EXACT = sql`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const EXACT_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
// A cursor for "before every row" sorts below any id.
const NIL_ID = "00000000-0000-0000-0000-000000000000";

type Keyset = { at: string; id: string };

// Opaque to clients: base64url of [timestamp, id]. A malformed one is an
// invalid input, never a database error that could echo it.
const encodeKeyset = (key: Keyset): string =>
  Buffer.from(JSON.stringify([key.at, key.id])).toString("base64url");

function decodeKeyset(value: string): Keyset {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      EXACT_TS.test(parsed[0]) &&
      isUuid(parsed[1])
    )
      return { at: parsed[0], id: parsed[1] };
  } catch {
    // Falls through to the one refusal.
  }
  throw new SessionError("invalid_input");
}

const pageSize = (limit: number | undefined, fallback: number): number =>
  Math.max(1, Math.min(limit ?? fallback, MAX_PAGE));

// ---- Session history --------------------------------------------------------

export const SESSION_LIST_MAX = 100;

// A history row: standing, retention, policy, links and counts. It carries no
// transcript, draft, answer or credential.
export type SessionSummary = Pick<
  SessionView,
  | "id"
  | "status"
  | "retention"
  | "processingPolicy"
  | "createdAt"
  | "endedAt"
  | "purged"
  | "interviewId"
  | "candidacyId"
  | "shownDraftCount"
> & { rehearsal: boolean };

export type SessionListPage = {
  sessions: SessionSummary[];
  nextCursor: string | null;
};

export async function listSessions(
  database: PlatformDatabase,
  scope: OwnerScope,
  options: { limit?: number; cursor?: string } = {},
): Promise<SessionListPage> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, SESSION_LIST_MAX));
  // [GUARD] A bad cursor is refused before any database work.
  const after = options.cursor ? decodeKeyset(options.cursor) : null;
  return inOwnerScope(database, scope, async (tx) => {
    const rows = await rowsOf<Record<string, unknown>>(
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
          LIMIT ${limit + 1}`,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      sessions: page.map((row) => ({
        id: String(row["id"]),
        status: String(row["status"]) as SessionSummary["status"],
        retention: retentionFromDb(row["retention_mode"]),
        processingPolicy: policyFromDb(row["processing_policy"]),
        createdAt: new Date(row["created_at"] as string).toISOString(),
        endedAt: row["ended_at"]
          ? new Date(row["ended_at"] as string).toISOString()
          : null,
        purged: row["purged_at"] !== null && row["purged_at"] !== undefined,
        interviewId: row["interview_id"] ? String(row["interview_id"]) : null,
        candidacyId: row["candidacy_id"] ? String(row["candidacy_id"]) : null,
        rehearsal:
          row["rehearsal_run_id"] !== null &&
          row["rehearsal_run_id"] !== undefined,
        shownDraftCount: Number(row["shown_draft_count"] ?? 0),
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeKeyset({ at: String(last["key_at"]), id: String(last["id"]) })
          : null,
    };
  });
}

// ---- Action changes ---------------------------------------------------------

// A reader that is caught up asks again from a little before "now", so a row
// whose transaction began before the read but committed after it (its
// updated_at is the transaction's start) is still found. Rows can therefore
// repeat; clients merge by id (the contract says so).
export const ACTION_CURSOR_OVERLAP_SECONDS = 2;

export type ActionChangesPage = {
  actions: StoredAction[];
  nextActionCursor: string;
  hasMoreActions: boolean;
  // The database clock when the page was read.
  serverNow: string;
};

// Every action of the owner's session created or changed after the cursor,
// oldest change first. updated_at is set on creation and by the database on
// every change, so an early row that settles late is read again instead of
// hiding behind the first page (the cap that left orphaned in-flight rows).
export async function listActionChanges(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<ActionChangesPage> {
  assertUuid(sessionId);
  const limit = pageSize(options.limit, 200);
  return inOwnerScope(database, scope, async (tx) => {
    if (!(await readSession(tx, scope, sessionId)))
      throw new SessionError("not_found");
    const after = options.cursor ? decodeKeyset(options.cursor) : null;
    const rows = await rowsOf<Record<string, unknown>>(
      tx,
      sql`SELECT ${ACTION_COLUMNS},
                 to_char(updated_at AT TIME ZONE 'UTC', ${EXACT}) AS key_at
          FROM interview.session_actions
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid
            AND (${after === null}
                 OR (updated_at, id) > (${after?.at ?? null}::timestamptz,
                                        ${after?.id ?? NIL_ID}::uuid))
          ORDER BY updated_at, id
          LIMIT ${limit + 1}`,
    );
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = page.at(-1);
    const clock = await firstRow<{ now_text: string; margin_text: string }>(
      tx,
      sql`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now_text,
                 to_char((now() - make_interval(secs => ${ACTION_CURSOR_OVERLAP_SECONDS}))
                         AT TIME ZONE 'UTC', ${EXACT}) AS margin_text`,
    );
    let next: Keyset;
    if (hasMore && last) {
      // More to read: continue exactly after the last row.
      next = { at: String(last["key_at"]), id: String(last["id"]) };
    } else {
      // Caught up: start the next read just before now, never earlier than
      // the cursor the caller already holds.
      const margin = String(clock?.margin_text);
      next = after && after.at > margin ? after : { at: margin, id: NIL_ID };
    }
    return {
      actions: page.map(toStoredAction),
      nextActionCursor: encodeKeyset(next),
      hasMoreActions: hasMore,
      serverNow: String(clock?.now_text),
    };
  });
}
