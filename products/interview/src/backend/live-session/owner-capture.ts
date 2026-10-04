// Owner capture and analyze: the owner's own browser capture (a window, tab or
// screen they picked, optionally cropped) analysed on press. One transaction
// under the session row lock stores the image exactly as ingest stores a
// companion screenshot (private artifact, sha256 and media metadata), writes a
// `screen.snapshot` observation under the reserved owner-capture source id, and
// then the `owner.input` analyze observation that names it.
//   - the wire cannot produce the owner-capture source (ingest refuses it, and
//     a CHECK pairs it with stored screen snapshots);
//   - both rows are exempt from the capture caps and rate counters, and the
//     capture count is bounded by its own per-session cap;
//   - the image is accepted by magic bytes and header-parsed dimensions only;
//     every bad image or field is one undifferentiated invalid_input;
//   - the purge deletes the artifact like any session screenshot.
// Nothing here logs; bytes, labels and hints never appear in an error.
import { createHash } from "node:crypto";
import {
  ACTIVE_SESSION_LIMITS,
  detectScreenshotMediaType,
} from "@omnitech/active-session-contracts";
import type { PlatformDatabase } from "@omnitech/database";
import {
  type LiveOwnerCaptureResponse,
  liveOwnerCaptureRequestSchema,
  liveOwnerInputRequestSchema,
} from "@omnitech/interview-contracts";
import { sql } from "drizzle-orm";
import { OWNER_CAPTURE_SOURCE_ID } from "../db/live-session.js";
import { assertUuid, SessionError } from "./errors.js";
import { storeScreenshot } from "./ingest.js";
import {
  assertAcceptsOwnerInput,
  findStoredOwnerInput,
  insertOwnerInput,
  nextOwnerSequence,
  type OwnerInputBody,
  sameBody,
} from "./owner-input.js";
import { firstRow, inOwnerScope, type OwnerScope } from "./scope.js";
import { readImageSize, SCREENSHOT_LOAD_LIMITS } from "./screenshot-loader.js";
import { lockSession } from "./session-record.js";

// Owner captures one session accepts: each may hold up to 2 MiB, so this
// bounds stored bytes (400 x 2 MiB is the companion's own bound).
export const OWNER_CAPTURE_MAX_PER_SESSION = 200;

const invalid = () => new SessionError("invalid_input");

export async function storeOwnerCapture(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  fields: unknown,
  image: Uint8Array,
): Promise<LiveOwnerCaptureResponse> {
  assertUuid(sessionId);
  const parsed = liveOwnerCaptureRequestSchema.safeParse(fields);
  if (!parsed.success) throw invalid();
  const { requestId, targetTaskId, targetRevision, label, skill, language } =
    parsed.data;
  if ((targetTaskId === undefined) !== (targetRevision === undefined))
    throw invalid();

  // [SAFETY] The image is judged by its own bytes: size, magic-byte media type,
  // and decoded dimensions read from the header (nothing is decoded).
  if (
    image.byteLength === 0 ||
    image.byteLength > ACTIVE_SESSION_LIMITS.maxScreenshotBytes
  )
    throw invalid();
  const mediaType = detectScreenshotMediaType(image);
  if (mediaType === null) throw invalid();
  const size = readImageSize(image, mediaType);
  if (
    size === null ||
    size.width < 1 ||
    size.height < 1 ||
    size.width > SCREENSHOT_LOAD_LIMITS.maxSide ||
    size.height > SCREENSHOT_LOAD_LIMITS.maxSide ||
    size.width * size.height > SCREENSHOT_LOAD_LIMITS.maxPixels
  )
    throw invalid();
  const digest = createHash("sha256").update(image).digest("hex");

  const snapshotRef = { sourceId: OWNER_CAPTURE_SOURCE_ID, eventId: requestId };
  const body: OwnerInputBody = {
    operation: "analyze",
    ...(targetTaskId !== undefined && targetRevision !== undefined
      ? { target: { taskId: targetTaskId, revision: targetRevision } }
      : {}),
    ...(skill ? { skill } : {}),
    ...(language ? { language } : {}),
    snapshots: [snapshotRef],
  };
  if (!liveOwnerInputRequestSchema.safeParse({ requestId, ...body }).success)
    throw invalid();
  const windowLabel = label ?? "";
  const response = (sequence: number): LiveOwnerCaptureResponse => ({
    input: { requestId, sequence },
    snapshot: snapshotRef,
  });

  return inOwnerScope(database, scope, async (tx) => {
    const row = await lockSession(tx, scope, sessionId);
    assertAcceptsOwnerInput(row);

    // [SAFETY] Dedup on the request id: an identical resend (same fields, same
    // image bytes) returns the original acknowledgement; anything else under
    // the same id is refused and the original stays.
    const stored = await findStoredOwnerInput(tx, scope, sessionId, requestId);
    if (stored) {
      const storedBody = (stored.content as { body?: unknown }).body;
      const snapshot = await firstRow<{
        sha256: string | null;
        content: unknown;
      }>(
        tx,
        sql`SELECT a.metadata->>'sha256' AS sha256, o.content
            FROM interview.session_observations o
            LEFT JOIN platform.artifacts a
              ON a.tenant_id = o.tenant_id AND a.id = o.screenshot_artifact_id
            WHERE o.tenant_id = ${scope.tenantId}::uuid
              AND o.owner_user_id = ${scope.actorId}::uuid
              AND o.session_id = ${sessionId}::uuid
              AND o.source_id = ${snapshotRef.sourceId}
              AND o.event_id = ${snapshotRef.eventId}`,
      );
      const snapshotBody = (snapshot?.content as { body?: unknown } | undefined)
        ?.body;
      if (
        !snapshot ||
        snapshot.sha256 !== digest ||
        !sameBody(storedBody, body) ||
        !sameBody(snapshotBody, {
          payloadRef: requestId,
          mediaType,
          byteLength: image.byteLength,
          windowLabel,
        })
      )
        throw invalid();
      return response(Number(stored.sequence));
    }

    const captures = await firstRow<{ n: number }>(
      tx,
      sql`SELECT count(*)::int AS n FROM interview.session_observations
          WHERE tenant_id = ${scope.tenantId}::uuid
            AND owner_user_id = ${scope.actorId}::uuid
            AND session_id = ${sessionId}::uuid
            AND source_id = ${OWNER_CAPTURE_SOURCE_ID}`,
    );
    if (Number(captures?.n ?? 0) >= OWNER_CAPTURE_MAX_PER_SESSION)
      throw new SessionError("status_refused");

    // [STRATEGY] The snapshot takes the next sequence and the input the one
    // after, so a reader that replays in order always sees the image first.
    const snapshotSequence = await nextOwnerSequence(tx, scope, sessionId);
    const artifactId = await storeScreenshot(tx, scope, sessionId, {
      bytes: image,
      mediaType,
    });
    const occurredAt = new Date(row.nowMs).toISOString();
    await tx.execute(sql`
      INSERT INTO interview.session_observations
        (tenant_id, owner_user_id, session_id, source_id, event_id, sequence,
         kind, content, ack, screenshot_artifact_id)
      VALUES (${scope.tenantId}::uuid, ${scope.actorId}::uuid, ${sessionId}::uuid,
        ${snapshotRef.sourceId}, ${snapshotRef.eventId}, ${snapshotSequence},
        'screen.snapshot',
        ${JSON.stringify({
          occurredAt,
          sourceSequence: 0,
          body: {
            payloadRef: requestId,
            mediaType,
            byteLength: image.byteLength,
            windowLabel,
          },
        })}::jsonb,
        ${JSON.stringify({ ...snapshotRef, sequence: snapshotSequence })}::jsonb,
        ${artifactId}::uuid)`);
    const ack = await insertOwnerInput(
      tx,
      scope,
      sessionId,
      row,
      requestId,
      snapshotSequence + 1,
      body,
    );
    return response(ack.sequence);
  });
}
