// Persistence of the owner-facing session lifecycle: the link checks of a
// start, the one-open-session lookup, the insert, and the credential, policy,
// screenshot-send and retention writes. No decisions here: the use-case module
// (repository.ts) decides, this file reads and writes. Every statement is raw
// and moved verbatim from there, so the SQL semantics are unchanged.
import type { TenantDatabase } from "@omnitech/database";
import { and, eq, sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../../assistant-profile";
import { activeSessions } from "../../db/live-session";
import { firstRow, type OwnerScope } from "../scope";
import { type SessionRecord, toRecord } from "../session-record";

// True when the candidacy belongs to the owner's person.
export async function candidacyIsOwned(
  tx: TenantDatabase,
  scope: OwnerScope,
  candidacyId: string,
): Promise<boolean> {
  const own = await firstRow(
    tx,
    sql`SELECT 1 AS ok FROM interview.candidacies c
        JOIN interview.member_people mp
          ON mp.tenant_id = c.tenant_id AND mp.person_id = c.candidate_person_id
        WHERE c.tenant_id = ${scope.tenantId}::uuid
          AND c.id = ${candidacyId}::uuid
          AND mp.user_id = ${scope.actorId}::uuid`,
  );
  return own !== undefined;
}

// True when the interview belongs to the candidacy.
export async function interviewBelongsToCandidacy(
  tx: TenantDatabase,
  scope: OwnerScope,
  interviewId: string,
  candidacyId: string,
): Promise<boolean> {
  const own = await firstRow(
    tx,
    sql`SELECT 1 AS ok FROM interview.interviews
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND id = ${interviewId}::uuid
          AND candidacy_id = ${candidacyId}::uuid`,
  );
  return own !== undefined;
}

// The current revision of the owner's unrevoked profile, if it exists.
export async function findProfileCurrentRevision(
  tx: TenantDatabase,
  scope: OwnerScope,
  profileId: string,
): Promise<number | undefined> {
  const row = await firstRow<{ revision: string | number }>(
    tx,
    sql`SELECT p.revision FROM interview.candidate_profiles p
        WHERE p.tenant_id = ${scope.tenantId} AND p.actor_id = ${scope.actorId}
        AND p.product_id = ${INTERVIEW_PRODUCT_ID}
        AND p.id = ${profileId} AND p.revoked_at IS NULL`,
  );
  return row ? Number(row.revision) : undefined;
}

// True when the owner's profile has that revision.
export async function profileRevisionExists(
  tx: TenantDatabase,
  scope: OwnerScope,
  profileId: string,
  revision: number,
): Promise<boolean> {
  const pinned = await firstRow(
    tx,
    sql`SELECT 1 AS ok FROM interview.candidate_profile_revisions r
        WHERE r.tenant_id = ${scope.tenantId} AND r.actor_id = ${scope.actorId}
        AND r.product_id = ${INTERVIEW_PRODUCT_ID}
        AND r.id = ${profileId} AND r.revision = ${revision}`,
  );
  return pinned !== undefined;
}

// True when the owner has that workspace draft.
export async function workspaceDraftExists(
  tx: TenantDatabase,
  scope: OwnerScope,
  workspaceId: string,
  artifactId: string,
): Promise<boolean> {
  const draft = await firstRow(
    tx,
    sql`SELECT 1 AS ok FROM interview.assistant_drafts
        WHERE tenant_id = ${scope.tenantId} AND actor_id = ${scope.actorId}
        AND product_id = ${INTERVIEW_PRODUCT_ID}
        AND workspace_id = ${workspaceId}
        AND artifact_id = ${artifactId}`,
  );
  return draft !== undefined;
}

// True when the owner has a session that is neither ended nor purging.
export async function hasOpenSession(
  tx: TenantDatabase,
  scope: OwnerScope,
): Promise<boolean> {
  const open = await firstRow(
    tx,
    sql`SELECT 1 AS ok FROM interview.active_sessions
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND owner_user_id = ${scope.actorId}::uuid
          AND status NOT IN ('ended', 'purging')`,
  );
  return open !== undefined;
}

// The database clock in epoch milliseconds.
export async function readClockMs(tx: TenantDatabase): Promise<number> {
  const clock = await firstRow<{ now_ms: number }>(
    tx,
    sql`SELECT (extract(epoch from now()) * 1000)::float8 AS now_ms`,
  );
  return Number(clock?.now_ms);
}

export type NewSession = {
  status: string;
  retentionMode: string;
  processingPolicy: string;
  screenshotSend: string;
  credentialHash: string;
  credentialExpiresAt: string;
  sources: { captureSources: readonly string[]; liveAssistance: boolean };
  rehearsalRunId: string | null;
  strict: boolean;
  interviewId: string | null;
  candidacyId: string | null;
  profileId: string | null;
  profileRevision: number | null;
  workspaceDraftId: string | null;
  expiresAt: string;
  nowMs: number;
};

// Inserts the session row and returns it as the database wrote it.
export async function insertSession(
  tx: TenantDatabase,
  scope: OwnerScope,
  session: NewSession,
): Promise<SessionRecord | undefined> {
  const row = await firstRow<Record<string, unknown>>(
    tx,
    sql`INSERT INTO interview.active_sessions (
          tenant_id, owner_user_id, status, retention_mode,
          processing_policy, screenshot_send, credential_hash,
          credential_expires_at, sources, rehearsal_run_id, strict, interview_id, candidacy_id,
          profile_id, profile_revision, workspace_draft_id, expires_at)
        VALUES (
          ${scope.tenantId}::uuid, ${scope.actorId}::uuid,
          ${session.status}, ${session.retentionMode},
          ${session.processingPolicy}, ${session.screenshotSend},
          ${session.credentialHash}, ${session.credentialExpiresAt}::timestamptz,
          ${JSON.stringify(session.sources)}::jsonb,
          ${session.rehearsalRunId}, ${session.strict},
          ${session.interviewId}::uuid, ${session.candidacyId}::uuid,
          ${session.profileId}, ${session.profileRevision},
          ${session.workspaceDraftId},
          ${session.expiresAt}::timestamptz)
        RETURNING *, ${session.nowMs}::float8 AS now_ms`,
  );
  return row ? toRecord(row) : undefined;
}

// Replaces the credential and clears any revocation.
export async function replaceCredential(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  hash: string,
  expiresAtIso: string,
): Promise<void> {
  await tx.execute(sql`
        UPDATE interview.active_sessions SET
          credential_hash = ${hash},
          credential_expires_at = ${expiresAtIso}::timestamptz,
          credential_revoked_at = NULL
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND owner_user_id = ${scope.actorId}::uuid AND id = ${sessionId}::uuid`);
}

// Stamps the credential revoked, keeping the first revocation's time.
export async function stampCredentialRevoked(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<void> {
  await tx.execute(sql`
        UPDATE interview.active_sessions
        SET credential_revoked_at = COALESCE(credential_revoked_at, now())
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND owner_user_id = ${scope.actorId}::uuid AND id = ${sessionId}::uuid`);
}

export async function writeProcessingPolicy(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  policy: string,
): Promise<void> {
  await tx.execute(sql`
          UPDATE interview.active_sessions
          SET processing_policy = ${policy}
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid AND id = ${sessionId}::uuid`);
}

export async function writeScreenshotSend(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  screenshotSend: string,
): Promise<void> {
  await tx
    .update(activeSessions)
    .set({ screenshotSend })
    .where(
      and(
        eq(activeSessions.tenantId, scope.tenantId),
        eq(activeSessions.ownerUserId, scope.actorId),
        eq(activeSessions.id, sessionId),
      ),
    );
}

export async function writeRetentionMode(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  retentionMode: string,
): Promise<void> {
  await tx.execute(sql`
          UPDATE interview.active_sessions
          SET retention_mode = ${retentionMode}
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid AND id = ${sessionId}::uuid`);
}
