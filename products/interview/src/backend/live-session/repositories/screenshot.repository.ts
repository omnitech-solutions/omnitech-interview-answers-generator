// Reads of a session screenshot's stored artifact and payload. Raw because the
// joins span the interview and platform schemas on composite keys.
import type { TenantDatabase } from "@omnitech/database";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../../assistant-profile";
import { SESSION_SCREENSHOT_ARTIFACT_TYPE } from "../../db/live-session";
import { firstRow, type OwnerScope } from "../scope";

// The owner's own session screenshot: its bytes and artifact metadata.
export function readScreenshotArtifact(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  artifactId: string,
): Promise<{ bytes: Uint8Array; metadata: unknown } | undefined> {
  return firstRow<{ bytes: Uint8Array; metadata: unknown }>(
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
}

export type SnapshotRow = {
  status: string;
  bytes: Uint8Array;
  metadata: { media_type?: string; sha256?: string } | null;
  content: { body?: { mediaType?: string } } | null;
};

// One screen.snapshot observation joined to the owner's own session (with its
// status) and to its private screenshot artifact and payload.
export function readSnapshotRow(
  tx: TenantDatabase,
  owner: OwnerScope,
  ref: { sessionId: string; sourceId: string; eventId: string },
): Promise<SnapshotRow | undefined> {
  return firstRow<SnapshotRow>(
    tx,
    sql`SELECT s.status, p.bytes, a.metadata, o.content
            FROM interview.session_observations o
            JOIN interview.active_sessions s
              ON s.tenant_id = o.tenant_id AND s.owner_user_id = o.owner_user_id
             AND s.id = o.session_id
            JOIN platform.artifacts a
              ON a.tenant_id = o.tenant_id AND a.id = o.screenshot_artifact_id
            JOIN platform.artifact_payloads p
              ON p.tenant_id = a.tenant_id AND p.artifact_id = a.id
            WHERE o.tenant_id = ${owner.tenantId}::uuid
              AND o.owner_user_id = ${owner.actorId}::uuid
              AND o.session_id = ${ref.sessionId}::uuid
              AND o.source_id = ${ref.sourceId}
              AND o.event_id = ${ref.eventId}
              AND o.kind = 'screen.snapshot'
              AND a.owner_user_id = ${owner.actorId}::uuid
              AND a.product_id = ${INTERVIEW_PRODUCT_ID}
              AND a.artifact_type = ${SESSION_SCREENSHOT_ARTIFACT_TYPE}
              AND a.metadata->>'session_id' = ${ref.sessionId}`,
  );
}
