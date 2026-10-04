// The screenshot loader (ADR-0016 Decision 3): resolves an attachment that
// names one stored screen snapshot to its verified bytes, for the worker's
// agent port to stage. It is the product side of the port's
// `attachmentSource`:
//   - input is observation ids only (session, source and event id), never a
//     path, URL or byte string;
//   - the snapshot observation is joined to the OWNER's own session, which
//     must still be active, in the owner's tenant-and-actor scope;
//   - the media type is re-detected from the loaded bytes and must match what
//     the observation and the artifact recorded;
//   - the stored sha256 digest is checked against the bytes;
//   - bytes and decoded dimensions are capped, the dimensions read from the
//     image header alone (no decode).
// Nothing here writes anything (the port stages the bytes in its private
// directory), logs, or puts an id or any pixel into an error: failures are a
// typed code.
import { createHash } from "node:crypto";
import {
  ACTIVE_SESSION_LIMITS,
  detectScreenshotMediaType,
  type ScreenshotMediaType,
} from "@omnitech/active-session-contracts";
import type { AgentAttachment, AiAccessContext } from "@omnitech/ai-contracts";
import type { PlatformDatabase } from "@omnitech/database";
import { sql } from "drizzle-orm";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile.js";
import { SESSION_SCREENSHOT_ARTIFACT_TYPE } from "../db/live-session.js";
import { isUuid } from "./errors.js";
import { parseSnapshotProvenanceId } from "./owner-input.js";
import { firstRow, inOwnerScope } from "./scope.js";

export const SCREENSHOT_LOAD_LIMITS = Object.freeze({
  // What ingest accepts; never more than a runtime's own image bound.
  maxBytes: ACTIVE_SESSION_LIMITS.maxScreenshotBytes,
  // A full-resolution desktop capture fits; a decompression bomb does not.
  maxSide: 8_192,
  maxPixels: 40_000_000,
});
export type ScreenshotLoadLimits = typeof SCREENSHOT_LOAD_LIMITS;

export type ScreenshotLoadCode =
  | "bad_reference"
  | "not_found"
  | "session_closed"
  // The read itself failed (a transient store error): retryable, unlike every
  // other code, which is a final refusal of this screenshot.
  | "read_failed"
  | "media_type_mismatch"
  | "digest_mismatch"
  | "too_large"
  | "bad_dimensions"
  | "aborted";

const MESSAGES: Record<ScreenshotLoadCode, string> = {
  bad_reference: "The screenshot reference is not valid.",
  not_found: "The screenshot was not found for this session.",
  session_closed: "The session no longer accepts screenshot reads.",
  read_failed: "The screenshot could not be read.",
  media_type_mismatch: "The screenshot's media type could not be verified.",
  digest_mismatch: "The screenshot does not match its stored digest.",
  too_large: "The screenshot exceeds its size bound.",
  bad_dimensions: "The screenshot's dimensions exceed their bound.",
  aborted: "The screenshot read was cancelled.",
};

export class ScreenshotLoadError extends Error {
  constructor(readonly code: ScreenshotLoadCode) {
    super(MESSAGES[code]);
    this.name = "ScreenshotLoadError";
  }
}

const be32 = (b: Uint8Array, at: number) =>
  ((b[at] ?? 0) * 0x1000000 +
    ((b[at + 1] ?? 0) << 16) +
    ((b[at + 2] ?? 0) << 8) +
    (b[at + 3] ?? 0)) >>>
  0;
const le16 = (b: Uint8Array, at: number) =>
  (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const le24 = (b: Uint8Array, at: number) =>
  le16(b, at) | ((b[at + 2] ?? 0) << 16);
const ascii = (b: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...b.subarray(at, at + length));

export type ImageSize = { width: number; height: number };

// Reads the decoded size from the image header only; null when the header is
// malformed or truncated. Nothing is decoded and no loop reads past the bytes.
export function readImageSize(
  bytes: Uint8Array,
  mediaType: ScreenshotMediaType,
): ImageSize | null {
  if (mediaType === "image/png") {
    // 8-byte signature, then the IHDR chunk: length, "IHDR", width, height.
    if (bytes.length < 24 || ascii(bytes, 12, 4) !== "IHDR") return null;
    return { width: be32(bytes, 16), height: be32(bytes, 20) };
  }
  if (mediaType === "image/jpeg") {
    // Walk the marker segments to the first start-of-frame.
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1] as number;
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        at += 2;
        continue;
      }
      const length =
        ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number);
      const isFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isFrame) {
        if (at + 9 > bytes.length) return null;
        return {
          height: ((bytes[at + 5] as number) << 8) | (bytes[at + 6] as number),
          width: ((bytes[at + 7] as number) << 8) | (bytes[at + 8] as number),
        };
      }
      // Entropy-coded data starts at the scan; no frame header came first.
      if (marker === 0xda || length < 2) return null;
      at += 2 + length;
    }
    return null;
  }
  // WebP: RIFF <size> WEBP, then the first chunk names the encoding.
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a)
      return null;
    return {
      width: le16(bytes, 26) & 0x3fff,
      height: le16(bytes, 28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits =
      ((bytes[21] as number) |
        ((bytes[22] as number) << 8) |
        ((bytes[23] as number) << 16) |
        ((bytes[24] as number) << 24)) >>>
      0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X")
    return { width: le24(bytes, 24) + 1, height: le24(bytes, 27) + 1 };
  return null;
}

// What the store returns for one snapshot of the owner's open session.
export type StoredSnapshot = {
  bytes: Uint8Array;
  // The media type and digest the artifact recorded at ingest.
  artifactMediaType: string | null;
  artifactSha256: string | null;
  // The media type the observation declared.
  observationMediaType: string | null;
};

export type SnapshotRead = (
  owner: { tenantId: string; actorId: string },
  ref: { sessionId: string; sourceId: string; eventId: string },
) => Promise<StoredSnapshot | "session_closed" | null>;

// The verification, apart from storage so it is testable without a database.
export async function loadVerifiedScreenshot(
  read: SnapshotRead,
  context: Pick<AiAccessContext, "tenantId" | "userId">,
  attachment: Pick<AgentAttachment, "kind" | "id" | "reference">,
  signal: AbortSignal | undefined,
  limits: ScreenshotLoadLimits = SCREENSHOT_LOAD_LIMITS,
): Promise<Uint8Array> {
  if (signal?.aborted) throw new ScreenshotLoadError("aborted");
  const ref = parseSnapshotProvenanceId(attachment.reference);
  if (
    attachment.kind !== "image" ||
    attachment.id !== attachment.reference ||
    !ref ||
    !isUuid(ref.sessionId)
  )
    throw new ScreenshotLoadError("bad_reference");

  // [SAFETY] A thrown read is a typed, retryable failure; the store's error
  // (which may name rows or SQL) is never carried.
  const found = await Promise.resolve()
    .then(() =>
      read({ tenantId: context.tenantId, actorId: context.userId }, ref),
    )
    .catch(() => {
      throw new ScreenshotLoadError(
        signal?.aborted ? "aborted" : "read_failed",
      );
    });
  if (signal?.aborted) throw new ScreenshotLoadError("aborted");
  if (found === "session_closed")
    throw new ScreenshotLoadError("session_closed");
  if (found === null) throw new ScreenshotLoadError("not_found");

  const { bytes } = found;
  if (bytes.byteLength === 0 || bytes.byteLength > limits.maxBytes)
    throw new ScreenshotLoadError("too_large");
  // [SAFETY] The media type is detected from the bytes themselves, never
  // taken from a stored label, and every recorded label must agree.
  const detected = detectScreenshotMediaType(bytes);
  if (
    detected === null ||
    found.artifactMediaType !== detected ||
    found.observationMediaType !== detected
  )
    throw new ScreenshotLoadError("media_type_mismatch");
  // [SAFETY] The bytes are the bytes ingest stored.
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (found.artifactSha256 === null || found.artifactSha256 !== digest)
    throw new ScreenshotLoadError("digest_mismatch");
  // [SAFETY] Dimensions come from the header alone; a malformed header, or a
  // size beyond the side or pixel cap, is refused.
  const size = readImageSize(bytes, detected);
  if (
    size === null ||
    size.width < 1 ||
    size.height < 1 ||
    size.width > limits.maxSide ||
    size.height > limits.maxSide ||
    size.width * size.height > limits.maxPixels
  )
    throw new ScreenshotLoadError("bad_dimensions");
  return bytes;
}

// The database read: the snapshot observation joined to the owner's own ACTIVE
// session and to its private screenshot artifact, in the owner's scope.
export function createSnapshotRead(database: PlatformDatabase): SnapshotRead {
  return (owner, ref) =>
    inOwnerScope(database, owner, async (tx) => {
      const row = await firstRow<{
        status: string;
        bytes: Uint8Array;
        metadata: { media_type?: string; sha256?: string } | null;
        content: { body?: { mediaType?: string } } | null;
      }>(
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
      if (!row) return null;
      if (row.status !== "active") return "session_closed";
      return {
        bytes: row.bytes,
        artifactMediaType: row.metadata?.media_type ?? null,
        artifactSha256: row.metadata?.sha256 ?? null,
        observationMediaType: row.content?.body?.mediaType ?? null,
      };
    });
}

// The `attachmentSource` of the worker's session agent port.
export function createSessionScreenshotLoader(
  database: PlatformDatabase,
  limits: ScreenshotLoadLimits = SCREENSHOT_LOAD_LIMITS,
) {
  const read = createSnapshotRead(database);
  return (
    context: AiAccessContext,
    attachment: AgentAttachment,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array> =>
    loadVerifiedScreenshot(read, context, attachment, signal, limits);
}
