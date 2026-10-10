// Persistence of what a capture leaves behind: the screenshot as an
// owner-private platform artifact, and the session's one capture request.
import { createHash, randomUUID } from "node:crypto";
import type { TenantDatabase } from "@omnitech/database";
import { artifactPayloads, artifacts } from "@omnitech/platform-storage/schema";
import { and, eq, sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../../assistant-profile";
import {
  activeSessions,
  SESSION_SCREENSHOT_ARTIFACT_TYPE,
} from "../../db/live-session";
import type { OwnerScope } from "../scope";

const ownedSession = (scope: OwnerScope, sessionId: string) =>
  and(
    eq(activeSessions.tenantId, scope.tenantId),
    eq(activeSessions.ownerUserId, scope.actorId),
    eq(activeSessions.id, sessionId),
  );

// The session's screenshot artifact holding exactly these bytes, if any.
async function findScreenshotArtifact(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  sha256: string,
): Promise<string | undefined> {
  const rows = await tx
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.tenantId, scope.tenantId),
        eq(artifacts.ownerUserId, scope.actorId),
        eq(artifacts.productId, INTERVIEW_PRODUCT_ID),
        eq(artifacts.artifactType, SESSION_SCREENSHOT_ARTIFACT_TYPE),
        sql`${artifacts.metadata}->>'session_id' = ${sessionId}`,
        sql`${artifacts.metadata}->>'sha256' = ${sha256}`,
      ),
    );
  return rows[0]?.id;
}

// An owner-private platform artifact of the session type, bound to its session
// by metadata.session_id, and its bytes.
async function insertScreenshotArtifact(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  screenshot: { bytes: Uint8Array; mediaType: string; sha256: string },
): Promise<string> {
  const artifactId = randomUUID();
  await tx.insert(artifacts).values({
    id: artifactId,
    tenantId: scope.tenantId,
    ownerUserId: scope.actorId,
    productId: INTERVIEW_PRODUCT_ID,
    artifactType: SESSION_SCREENSHOT_ARTIFACT_TYPE,
    title: "Session screenshot",
    metadata: {
      session_id: sessionId,
      media_type: screenshot.mediaType,
      sha256: screenshot.sha256,
    },
    payloadReference: `platform.artifact_payloads/${artifactId}`,
  });
  await tx.insert(artifactPayloads).values({
    tenantId: scope.tenantId,
    artifactId,
    bytes: Buffer.from(screenshot.bytes),
    byteLength: screenshot.bytes.byteLength,
  });
  return artifactId;
}

// Stores a screenshot as the session's artifact and answers its id. Identical
// bytes within a session share one artifact (a digest dedupes stored bytes
// only; observations stay keyed by source and event id).
export async function storeScreenshot(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  screenshot: { bytes: Uint8Array; mediaType: string },
): Promise<string> {
  const sha256 = createHash("sha256").update(screenshot.bytes).digest("hex");
  return (
    (await findScreenshotArtifact(tx, scope, sessionId, sha256)) ??
    insertScreenshotArtifact(tx, scope, sessionId, { ...screenshot, sha256 })
  );
}

// Replaces the session's one capture request with this stored value.
export async function writeCaptureRequest(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
  stored: unknown,
): Promise<void> {
  await tx
    .update(activeSessions)
    .set({ captureRequest: stored })
    .where(ownedSession(scope, sessionId));
}

// The session's capture request as stored, with the database clock.
export async function readStoredCaptureRequest(
  tx: TenantDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<
  { captureRequest: unknown; purgedAt: Date | null; nowMs: number } | undefined
> {
  const rows = await tx
    .select({
      captureRequest: activeSessions.captureRequest,
      purgedAt: activeSessions.purgedAt,
      nowMs: sql<number>`(extract(epoch from now()) * 1000)::float8`,
    })
    .from(activeSessions)
    .where(ownedSession(scope, sessionId));
  const row = rows[0];
  return row ? { ...row, nowMs: Number(row.nowMs) } : undefined;
}
