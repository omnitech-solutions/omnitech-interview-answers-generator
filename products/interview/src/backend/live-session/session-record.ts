// The session row as the repository reads it, and the public view of it. The
// view never carries the credential hash (rule:credential-storage).
import type { TenantDatabase } from "@omnitech/database";
import type { LiveScreenshotSend } from "@omnitech/interview-contracts";
import { sql } from "drizzle-orm";
import type { ProcessingPolicy, SessionStatus } from "./core/index";
import {
  decodeDraftKey,
  policyFromDb,
  type RetentionMode,
  retentionFromDb,
  screenshotSendFromDb,
  type WorkspaceDraftKey,
} from "./mapping";
import { firstRow, type OwnerScope } from "./scope";

export type SessionRecord = {
  id: string;
  tenantId: string;
  ownerUserId: string;
  status: SessionStatus;
  retention: RetentionMode;
  policy: ProcessingPolicy;
  // D35: what of a screenshot may reach a model; absent column reads "always".
  screenshotSend: LiveScreenshotSend;
  fence: number;
  leaseHolderId: string | null;
  leaseExpiresAt: Date | null;
  credentialHash: string | null;
  credentialExpiresAt: Date | null;
  credentialRevokedAt: Date | null;
  sources: { captureSources: string[]; liveAssistance: boolean } | null;
  rehearsalRunId: string | null;
  strict: boolean;
  interviewId: string | null;
  candidacyId: string | null;
  profileId: string | null;
  profileRevision: number | null;
  workspaceDraftId: string | null;
  createdAt: Date;
  expiresAt: Date;
  lastHeartbeatAt: Date | null;
  endedAt: Date | null;
  purgeStartedAt: Date | null;
  purgedAt: Date | null;
  purgeOutcome: string | null;
  shownDraftCount: number;
  // Observation sequence below which a holder handled every transcript
  // segment (see FencedSessionWrites.recordProcessedThrough).
  processedThrough: number;
  // The one pending capture request as stored (capture-request.ts decodes it).
  captureRequest: unknown;
  // The database clock when the row was read; every time decision uses it, so
  // the row-security policies, leases and these decisions share one clock.
  nowMs: number;
};

type Raw = Record<string, unknown>;
const date = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(value as string);
const text = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

export function toRecord(row: Raw): SessionRecord {
  return {
    id: String(row["id"]),
    tenantId: String(row["tenant_id"]),
    ownerUserId: String(row["owner_user_id"]),
    status: String(row["status"]) as SessionStatus,
    retention: retentionFromDb(row["retention_mode"]),
    policy: policyFromDb(row["processing_policy"]),
    screenshotSend: screenshotSendFromDb(row["screenshot_send"]),
    fence: Number(row["fence"]),
    leaseHolderId: text(row["lease_holder_id"]),
    leaseExpiresAt: date(row["lease_expires_at"]),
    credentialHash: text(row["credential_hash"]),
    credentialExpiresAt: date(row["credential_expires_at"]),
    credentialRevokedAt: date(row["credential_revoked_at"]),
    sources: (row["sources"] ?? null) as SessionRecord["sources"],
    rehearsalRunId: text(row["rehearsal_run_id"]),
    strict: Boolean(row["strict"]),
    interviewId: text(row["interview_id"]),
    candidacyId: text(row["candidacy_id"]),
    profileId: text(row["profile_id"]),
    profileRevision:
      row["profile_revision"] === null || row["profile_revision"] === undefined
        ? null
        : Number(row["profile_revision"]),
    workspaceDraftId: text(row["workspace_draft_id"]),
    createdAt: date(row["created_at"]) as Date,
    expiresAt: date(row["expires_at"]) as Date,
    lastHeartbeatAt: date(row["last_heartbeat_at"]),
    endedAt: date(row["ended_at"]),
    purgeStartedAt: date(row["purge_started_at"]),
    purgedAt: date(row["purged_at"]),
    purgeOutcome: text(row["purge_outcome"]),
    shownDraftCount: Number(row["shown_draft_count"] ?? 0),
    processedThrough: Number(row["processed_through"] ?? 0),
    captureRequest: row["capture_request"] ?? null,
    nowMs: Number(row["now_ms"] ?? Date.now()),
  };
}

// Locks the owner's session row. Every status change, ingest write and fenced
// write starts here, so they serialize per session (ADR-0012 job creation and
// purge also take this lock).
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

export type SessionView = {
  id: string;
  status: SessionStatus;
  retention: RetentionMode;
  processingPolicy: ProcessingPolicy;
  screenshotSend: LiveScreenshotSend;
  createdAt: string;
  expiresAt: string;
  credentialExpiresAt: string | null;
  credentialRevoked: boolean;
  captureSources: string[];
  liveAssistance: boolean;
  strict: boolean;
  rehearsalRunId: string | null;
  interviewId: string | null;
  candidacyId: string | null;
  profile: { id: string; revision: number } | null;
  workspaceDraft: WorkspaceDraftKey | null;
  lastHeartbeatAt: string | null;
  endedAt: string | null;
  purged: boolean;
  purgeOutcome: string | null;
  shownDraftCount: number;
};

const iso = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

export function toView(record: SessionRecord): SessionView {
  return {
    id: record.id,
    status: record.status,
    retention: record.retention,
    processingPolicy: record.policy,
    screenshotSend: record.screenshotSend,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    credentialExpiresAt: iso(record.credentialExpiresAt),
    credentialRevoked: record.credentialRevokedAt !== null,
    captureSources: record.sources?.captureSources ?? [],
    liveAssistance: record.sources?.liveAssistance ?? false,
    strict: record.strict,
    rehearsalRunId: record.rehearsalRunId,
    interviewId: record.interviewId,
    candidacyId: record.candidacyId,
    profile:
      record.profileId !== null && record.profileRevision !== null
        ? { id: record.profileId, revision: record.profileRevision }
        : null,
    workspaceDraft: decodeDraftKey(record.workspaceDraftId),
    lastHeartbeatAt: iso(record.lastHeartbeatAt),
    endedAt: iso(record.endedAt),
    purged: record.purgedAt !== null,
    purgeOutcome: record.purgeOutcome,
    shownDraftCount: record.shownDraftCount,
  };
}
