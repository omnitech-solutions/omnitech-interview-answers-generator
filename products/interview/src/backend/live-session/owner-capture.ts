// Owner capture and analyze: the owner's own browser capture (a window, tab or
// screen they picked, optionally cropped) analysed on press. One transaction
// under the session row lock stores the image exactly as ingest stores a
// companion screenshot (private artifact, sha256 and media metadata), writes a
// `screen.snapshot` observation under the reserved owner-capture source id, and
// then the `owner.input` analyze observation that names it. A request may carry
// several images (a task's added context): every image gets its own snapshot,
// one `owner.input` names them all, so the whole request is ONE revision and
// is all-or-nothing (one bad image refuses it with nothing stored).
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
  LIVE_OWNER_CAPTURE_MIN_SIDE,
  LIVE_OWNER_INPUT_MAX_SNAPSHOTS,
  type LiveOwnerCaptureResponse,
  liveOwnerCaptureRequestSchema,
  liveOwnerInputRequestSchema,
} from "@omnitech/interview-contracts";
import { OWNER_CAPTURE_SOURCE_ID } from "../db/live-session";
import { assertUuid, type InvalidReason, SessionError } from "./errors";
import {
  assertAcceptsOwnerInput,
  assertTargetNotStale,
  findStoredOwnerInput,
  insertOwnerInput,
  nextOwnerSequence,
  type OwnerInputBody,
  sameBody,
} from "./owner-input";
import { storeScreenshot } from "./repositories/capture.repository";
import {
  countOwnerCaptures,
  insertOwnerObservation,
  readSnapshotForResend,
} from "./repositories/owner-input.repository";
import { lockSession } from "./repositories/session.repository";
import { inOwnerScope, type OwnerScope } from "./scope";
import { readImageSize, SCREENSHOT_LOAD_LIMITS } from "./screenshot-loader";
import { normalizeOcrText } from "./screenshot-text";

// Owner captures (images) one session accepts: each may hold up to 2 MiB, so
// this bounds stored bytes (400 x 2 MiB is the companion's own bound).
const OWNER_CAPTURE_MAX_PER_SESSION = 200;

const invalid = (reason: InvalidReason = "fields") =>
  new SessionError("invalid_input", [], reason);

// The snapshot event id of the nth image (0-based): the first is the request
// id (so a single-image request is named as it always was), the rest add `.n`.
const eventIdOf = (requestId: string, index: number): string =>
  index === 0 ? requestId : `${requestId}.${index + 1}`;

// [SAFETY] An image is judged by its own bytes: size, magic-byte media type,
// and decoded dimensions read from the header (nothing is decoded).
function checkedImage(image: Uint8Array): {
  mediaType: NonNullable<ReturnType<typeof detectScreenshotMediaType>>;
  digest: string;
} {
  if (image.byteLength === 0) throw invalid("image_empty");
  if (image.byteLength > ACTIVE_SESSION_LIMITS.maxScreenshotBytes)
    throw invalid("image_too_large");
  const mediaType = detectScreenshotMediaType(image);
  if (mediaType === null) throw invalid("image_type");
  const size = readImageSize(image, mediaType);
  if (size === null) throw invalid("image_unreadable");
  if (
    size.width < LIVE_OWNER_CAPTURE_MIN_SIDE ||
    size.height < LIVE_OWNER_CAPTURE_MIN_SIDE ||
    size.width > SCREENSHOT_LOAD_LIMITS.maxSide ||
    size.height > SCREENSHOT_LOAD_LIMITS.maxSide ||
    size.width * size.height > SCREENSHOT_LOAD_LIMITS.maxPixels
  )
    throw invalid("image_dimensions");
  return {
    mediaType,
    digest: createHash("sha256").update(image).digest("hex"),
  };
}

export async function storeOwnerCapture(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  fields: unknown,
  images: readonly Uint8Array[],
): Promise<LiveOwnerCaptureResponse> {
  assertUuid(sessionId);
  const parsed = liveOwnerCaptureRequestSchema.safeParse(fields);
  if (!parsed.success) throw invalid("fields");
  const {
    requestId,
    targetTaskId,
    targetRevision,
    label,
    skill,
    language,
    ocr: blocks,
    display: displayList,
  } = parsed.data;
  if ((targetTaskId === undefined) !== (targetRevision === undefined))
    throw invalid("target");

  if (images.length === 0) throw invalid("no_image");
  if (images.length > LIVE_OWNER_INPUT_MAX_SNAPSHOTS)
    throw invalid("image_count");
  const checked = images.map(checkedImage);
  // [SAFETY] On-device text, one entry per image in the order sent: a list of
  // another length is refused whole. The text is normalised, never cut, and a
  // text with nothing left is no text at all.
  if (blocks !== undefined && blocks.length !== images.length)
    throw invalid("ocr");
  const ocrs = images.map((_, index) => {
    const block = blocks?.[index];
    if (!block) return null;
    const text = normalizeOcrText(block.text);
    return text === ""
      ? null
      : {
          engine: block.engine,
          text,
          ...(block.confidence === undefined
            ? {}
            : { confidence: block.confidence }),
          // D35: validated, bounded numbers the image gate weighs; stored with
          // the text and never returned to the browser.
          ...(block.metrics === undefined ? {} : { metrics: block.metrics }),
        };
  });

  // [SAFETY] The display each image came from, one entry per image in order:
  // a list of another length is refused whole. A label only (never the
  // hardware id), kept in the observation and never logged or sent to a model.
  if (displayList !== undefined && displayList.length !== images.length)
    throw invalid("display");
  const displays = images.map((_, index) => displayList?.[index] ?? null);

  const snapshotRefs = images.map((_, index) => ({
    sourceId: OWNER_CAPTURE_SOURCE_ID,
    eventId: eventIdOf(requestId, index),
  }));
  const body: OwnerInputBody = {
    operation: "analyze",
    ...(targetTaskId !== undefined && targetRevision !== undefined
      ? { target: { taskId: targetTaskId, revision: targetRevision } }
      : {}),
    ...(skill ? { skill } : {}),
    ...(language ? { language } : {}),
    snapshots: snapshotRefs,
  };
  if (!liveOwnerInputRequestSchema.safeParse({ requestId, ...body }).success)
    throw invalid();
  const windowLabel = label ?? "";
  const snapshotBodyOf = (index: number) => ({
    payloadRef: eventIdOf(requestId, index),
    mediaType: (checked[index] as (typeof checked)[number]).mediaType,
    byteLength: (images[index] as Uint8Array).byteLength,
    windowLabel,
  });
  const response = (sequence: number): LiveOwnerCaptureResponse => ({
    input: { requestId, sequence },
    snapshots: snapshotRefs,
  });

  return inOwnerScope(database, scope, async (tx) => {
    const row = await lockSession(tx, scope, sessionId);
    assertAcceptsOwnerInput(row);

    // [SAFETY] Dedup on the request id: an identical resend (same fields, same
    // image bytes, in the same order) returns the original acknowledgement;
    // anything else under the same id is refused and the original stays.
    const stored = await findStoredOwnerInput(tx, scope, sessionId, requestId);
    if (stored) {
      const storedBody = (stored.content as { body?: unknown }).body;
      if (!sameBody(storedBody, body)) throw invalid();
      for (const [index, ref] of snapshotRefs.entries()) {
        const snapshot = await readSnapshotForResend(tx, scope, sessionId, ref);
        const snapshotBody = (
          snapshot?.content as { body?: unknown } | undefined
        )?.body;
        if (
          !snapshot ||
          snapshot.sha256 !==
            (checked[index] as (typeof checked)[number]).digest ||
          !sameBody(snapshotBody, snapshotBodyOf(index)) ||
          !sameBody(
            (snapshot.content as { ocr?: unknown }).ocr ?? null,
            ocrs[index] ?? null,
          ) ||
          !sameBody(
            (snapshot.content as { display?: unknown }).display ?? null,
            displays[index] ?? null,
          )
        )
          throw invalid();
      }
      return response(Number(stored.sequence));
    }

    // [SAFETY] Added context for a task the owner saw is refused when the task
    // has since moved on (nothing is stored); the owner reviews the newer
    // revision first.
    if (targetTaskId !== undefined && targetRevision !== undefined)
      await assertTargetNotStale(tx, scope, sessionId, {
        taskId: targetTaskId,
        revision: targetRevision,
      });

    const captures = await countOwnerCaptures(tx, scope, sessionId);
    if (captures + images.length > OWNER_CAPTURE_MAX_PER_SESSION)
      throw new SessionError("status_refused");

    // [STRATEGY] The snapshots take the next sequences in order and the input
    // the one after, so a reader that replays in order always sees every image
    // before the input that names them.
    const firstSequence = await nextOwnerSequence(tx, scope, sessionId);
    const occurredAt = new Date(row.nowMs).toISOString();
    for (const [index, ref] of snapshotRefs.entries()) {
      const sequence = firstSequence + index;
      const artifactId = await storeScreenshot(tx, scope, sessionId, {
        bytes: images[index] as Uint8Array,
        mediaType: (checked[index] as (typeof checked)[number]).mediaType,
      });
      await insertOwnerObservation(tx, scope, sessionId, {
        sourceId: ref.sourceId,
        eventId: ref.eventId,
        sequence,
        kind: "screen.snapshot",
        content: {
          occurredAt,
          sourceSequence: 0,
          body: snapshotBodyOf(index),
          ...(ocrs[index] ? { ocr: ocrs[index] } : {}),
          ...(displays[index] ? { display: displays[index] } : {}),
        },
        ack: { ...ref, sequence },
        screenshotArtifactId: artifactId,
      });
    }
    const ack = await insertOwnerInput(
      tx,
      scope,
      sessionId,
      row,
      requestId,
      firstSequence + images.length,
      body,
    );
    return response(ack.sequence);
  });
}
