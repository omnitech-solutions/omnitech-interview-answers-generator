// Cursor-paged owner reads for the Studio Live view: the owner's session
// history (newest first) and the session's action changes (every action
// created or changed after a cursor). Both are keyset pages over
// (timestamp, id), read in the owner's actor scope, so another same-tenant
// user finds nothing (rule:owner-checked-read-paths). Nothing here selects
// transcript, draft or answer content except the action result the stream
// already returns to its owner.
import type { PlatformDatabase } from "@omnitech/database";
import { assertUuid, isUuid, SessionError } from "./errors";
import { policyFromDb, retentionFromDb } from "./mapping";
import { readSession } from "./repositories/session.repository";
import {
  NIL_ID,
  readActionChangeRows,
  readDatabaseClock,
  readSessionHistoryRows,
} from "./repositories/session-read.repository";
import { inOwnerScope, type OwnerScope } from "./scope";
import { MAX_PAGE, type StoredAction, toStoredAction } from "./session-reads";
import type { SessionView } from "./session-record";

// The exact-microsecond keyset text a cursor carries.
const EXACT_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

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

const SESSION_LIST_MAX = 100;

// A history row: standing, retention, policy, links and counts. It carries no
// transcript, draft, answer or credential.
type SessionSummary = Pick<
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
    const rows = await readSessionHistoryRows(tx, scope, after, limit + 1);
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
const ACTION_CURSOR_OVERLAP_SECONDS = 2;

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
    const rows = await readActionChangeRows(
      tx,
      scope,
      sessionId,
      after,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = page.at(-1);
    const clock = await readDatabaseClock(tx, ACTION_CURSOR_OVERLAP_SECONDS);
    let next: Keyset;
    if (hasMore && last) {
      // More to read: continue exactly after the last row.
      next = { at: String(last["key_at"]), id: String(last["id"]) };
    } else {
      // Caught up: always restart from just before now, even when the caller
      // holds a later cursor. After a hasMore page that cursor is the exact
      // last row, and a transaction that started earlier but commits later
      // would be skipped; repeated rows merge by id on the client.
      next = { at: String(clock?.margin_text), id: NIL_ID };
    }
    return {
      actions: page.map(toStoredAction),
      nextActionCursor: encodeKeyset(next),
      hasMoreActions: hasMore,
      serverNow: String(clock?.now_text),
    };
  });
}
