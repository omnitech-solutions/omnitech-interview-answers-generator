// Persistence of the session row and of what hangs directly on it: the
// credential lookup, the row lock every write serializes on, the membership
// re-check's read, the contact stamp and the status change. No decisions here:
// callers decide, this file reads and writes.
import type { DatabaseClient, TenantDatabase } from "@omnitech/database";
import { tenantMemberships } from "@omnitech/platform-storage/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { activeSessions, sessionActions } from "../../db/live-session";
import type { SessionStatus, StatusCommand } from "../core/index";
import { firstRow, type OwnerScope } from "../scope";
import { type SessionRecord, toRecord } from "../session-record";

const ownedSession = (scope: OwnerScope, sessionId: string) =>
  and(
    eq(activeSessions.tenantId, scope.tenantId),
    eq(activeSessions.ownerUserId, scope.actorId),
    eq(activeSessions.id, sessionId),
  );

// The one row the credential-lookup policy admits for the presented hash (see
// credential-lookup.ts). Raw: it runs on the lookup transaction's own client,
// which carries the credential setting and is not a tenant-scoped handle.
export async function findSessionByCredential(
  client: DatabaseClient,
  credentialHash: string,
): Promise<{ id: string; ownerUserId: string } | undefined> {
  const row = (
    await client.query<{ id: string; owner_user_id: string }>(
      "SELECT id, owner_user_id FROM interview.active_sessions WHERE credential_hash = $1",
      [credentialHash],
    )
  ).rows[0];
  return row ? { id: row.id, ownerUserId: row.owner_user_id } : undefined;
}

type Raw = Record<string, unknown>;

// Locks the owner's session row. Every status change, ingest write and fenced
// write starts here, so they serialize per session (ADR-0012 job creation and
// purge also take this lock). Raw: every column plus the database clock, read
// FOR UPDATE.
export async function lockSession(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<SessionRecord | undefined> {
  const row = await firstRow<Raw>(
    tx,
    sql`SELECT *, (extract(epoch from now()) * 1000)::float8 AS now_ms
        FROM interview.active_sessions
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND owner_user_id = ${scope.actorId}::uuid
          AND id = ${sessionId}::uuid
        FOR UPDATE`,
  );
  return row ? toRecord(row) : undefined;
}

export async function readSession(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<SessionRecord | undefined> {
  const row = await firstRow<Raw>(
    tx,
    sql`SELECT *, (extract(epoch from now()) * 1000)::float8 AS now_ms
        FROM interview.active_sessions
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND owner_user_id = ${scope.actorId}::uuid
          AND id = ${sessionId}::uuid`,
  );
  return row ? toRecord(row) : undefined;
}

// The owner's role in the tenant now, or undefined once the membership is gone.
export async function findMemberRole(
  tx: TenantDatabase,
  scope: OwnerScope,
): Promise<string | undefined> {
  const rows = await tx
    .select({ role: tenantMemberships.role })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, scope.tenantId),
        eq(tenantMemberships.userId, scope.actorId),
      ),
    );
  return rows[0]?.role;
}

// Revokes the session's credential, keeping the first revocation's time.
export async function revokeCredential(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<void> {
  await tx
    .update(activeSessions)
    .set({
      credentialRevokedAt: sql`COALESCE(${activeSessions.credentialRevokedAt}, now())`,
    })
    .where(ownedSession(scope, sessionId));
}

// Stamps the companion's contact with the database clock.
export async function touchContact(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<void> {
  await tx
    .update(activeSessions)
    .set({ lastHeartbeatAt: sql`now()` })
    .where(ownedSession(scope, sessionId));
}

// Writes a status change of the locked row. Ending or starting a purge also
// revokes the credential and stamps the end (rule:credential-revocation); a
// purge also stamps its start. Raw: every stamp is a CASE over the old row and
// the database clock, in one statement.
export async function writeStatus(
  tx: TenantDatabase,
  row: SessionRecord,
  to: SessionStatus,
  command: StatusCommand,
): Promise<void> {
  await tx.execute(sql`
    UPDATE interview.active_sessions SET
      status = ${to}::text,
      ended_at = CASE WHEN ${to}::text IN ('ended', 'purging')
        THEN COALESCE(ended_at, now()) ELSE ended_at END,
      purge_started_at = CASE WHEN ${to}::text = 'purging'
        THEN COALESCE(purge_started_at, now()) ELSE purge_started_at END,
      credential_revoked_at = CASE WHEN ${to}::text IN ('ended', 'purging')
        THEN COALESCE(credential_revoked_at, now()) ELSE credential_revoked_at END,
      last_heartbeat_at = CASE WHEN ${command}::text = 'resume'
        THEN NULL ELSE last_heartbeat_at END,
      -- The session clock leaves paused time out: a pause stamps its start, and
      -- leaving the pause (resume or end) adds its length to the total.
      paused_ms = paused_ms + CASE WHEN ${row.status}::text = 'paused' AND ${to}::text <> 'paused'
        THEN GREATEST(0, (EXTRACT(EPOCH FROM (now() - COALESCE(paused_at, now()))) * 1000)::bigint)
        ELSE 0 END,
      paused_at = CASE
        WHEN ${to}::text = 'paused' THEN COALESCE(paused_at, now())
        WHEN ${row.status}::text = 'paused' THEN NULL
        ELSE paused_at END
    WHERE tenant_id = ${row.tenantId}::uuid
      AND owner_user_id = ${row.ownerUserId}::uuid
      AND id = ${row.id}::uuid`);
}

// Suppresses the session's in-flight processor actions that no job backs.
export async function suppressInFlightActions(
  tx: TenantDatabase,
  row: SessionRecord,
  reason: string,
): Promise<void> {
  await tx
    .update(sessionActions)
    .set({ dispatchStatus: "suppressed", suppressionReason: reason })
    .where(
      and(
        eq(sessionActions.tenantId, row.tenantId),
        eq(sessionActions.ownerUserId, row.ownerUserId),
        eq(sessionActions.sessionId, row.id),
        eq(sessionActions.dispatchStatus, "in_flight"),
        isNull(sessionActions.jobId),
      ),
    );
}
