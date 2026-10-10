// Owner-checked read paths (rule:owner-checked-read-paths): streams, downloads,
// context assembly and job results each open an actor-scoped transaction for the
// session owner and read only owner-scoped data, so another same-tenant user
// finds nothing. A session that is not the actor's reads as "not found", the
// same as one that does not exist.
import type { PlatformDatabase } from "@omnitech/database";
import {
  type LiveCaptureDisplay,
  type LiveMissingContext,
  type LiveRevisionReason,
  type LiveScreenshotSent,
  liveCaptureDisplaySchema,
  liveGeneratedBySchema,
  liveRevisionReasonSchema,
  liveScreenshotSentSchema,
} from "@omnitech/interview-contracts";
import { z } from "zod";
import { assertUuid, SessionError } from "./errors";
import { sanitizeMissingContext } from "./missing-context";
import { parseSnapshotProvenanceId } from "./owner-input";
import { readScreenshotArtifact } from "./repositories/screenshot.repository";
import { readSession } from "./repositories/session.repository";
import {
  ACTION_COLUMNS,
  findActionJob,
  findOpenSessionId,
  REVISION_REASON,
  readActionRowsNewest,
  readActionRowsOldest,
  readObservationRows,
  readPinnedProfileRevision,
  readScreenshotsSentRows,
  readTaskScreenshotRows,
  SNAPSHOT_EVENT_IDS,
} from "./repositories/session-read.repository";
import { inOwnerScope, type OwnerScope } from "./scope";
import type { SessionJobs } from "./session-jobs";
import { type SessionView, toView } from "./session-record";
import { decodeWithheldReason } from "./withheld";

// The column fragments live with the queries; the paging reads import them here.
export { ACTION_COLUMNS, REVISION_REASON, SNAPSHOT_EVENT_IDS };

export const MAX_PAGE = 500;
// A page is at most MAX_PAGE; one more row may be asked for (MAX_PAGE + 1) so
// a reader can tell whether a further page exists.
const pageSize = (limit: number | undefined, fallback: number): number =>
  Math.max(1, Math.min(limit ?? fallback, MAX_PAGE + 1));

export async function getSession(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<SessionView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  return inOwnerScope(database, scope, async (tx) => {
    const record = await readSession(tx, scope, sessionId);
    return record ? toView(record) : null;
  });
}

// The owner's session that is not ended or purging (at most one).
export async function getOpenSession(
  database: PlatformDatabase,
  scope: OwnerScope,
): Promise<SessionView | null> {
  return inOwnerScope(database, scope, async (tx) => {
    const row = await findOpenSessionId(tx, scope);
    if (!row) return null;
    const record = await readSession(tx, scope, row.id);
    return record ? toView(record) : null;
  });
}

export type StoredObservation = {
  sequence: number;
  sourceId: string;
  eventId: string;
  kind: string;
  receivedAt: string;
  content: unknown;
  screenshotArtifactId: string | null;
};

// In order, by the per-session sequence; the cursor is the last sequence seen.
export async function listObservations(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  options: {
    afterSequence?: number;
    limit?: number;
    // The browser's stream never carries the owner's own inputs back to it
    // (they are DB-side only) and never the text read from a screenshot (only
    // the engine that read it); the worker reads every kind, with the text.
    excludeOwnerInput?: boolean;
  } = {},
): Promise<StoredObservation[]> {
  assertUuid(sessionId);
  const after = options.afterSequence ?? 0;
  const limit = pageSize(options.limit, 200);
  return inOwnerScope(database, scope, async (tx) => {
    if (!(await readSession(tx, scope, sessionId)))
      throw new SessionError("not_found");
    const rows = await readObservationRows(tx, scope, sessionId, {
      after,
      limit,
      excludeOwnerInput: options.excludeOwnerInput === true,
    });
    return rows.map((row) => ({
      sequence: Number(row["sequence"]),
      sourceId: String(row["source_id"]),
      eventId: String(row["event_id"]),
      kind: String(row["kind"]),
      receivedAt: new Date(row["received_at"] as string).toISOString(),
      content: options.excludeOwnerInput
        ? withoutOcrText(row["content"])
        : row["content"],
      screenshotArtifactId: row["screenshot_artifact_id"]
        ? String(row["screenshot_artifact_id"])
        : null,
    }));
  });
}

// [SAFETY] The text read from a screenshot stays server-side: the browser's copy
// of the observation keeps only which engine read it.
function withoutOcrText(content: unknown): unknown {
  const ocr = (content as { ocr?: { engine?: unknown } } | null)?.ocr;
  if (!ocr) return content;
  return { ...(content as object), ocr: { engine: ocr.engine } };
}

// The stored display label, re-checked on the way out (a row is never trusted
// to hold the shape); anything else is no display.
export function storedDisplay(value: unknown): LiveCaptureDisplay | null {
  // A malformed stored string is no display, never a throw.
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = liveCaptureDisplaySchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

// A screenshot a task rests on: ids, ordinal and time only, never image bytes.
export type TaskScreenshot = {
  ordinal: number;
  sourceId: string;
  eventId: string;
  sequence: number;
  capturedAt: string;
  artifactId: string | null;
  // The engine that read the screenshot's text on the device; null when none.
  // The text itself is never returned.
  ocrEngine: "vision" | "tesseract" | null;
  // The display it was captured on (a label); null: not recorded.
  display: LiveCaptureDisplay | null;
  revisions: number[];
  // D35: what left the device for this screenshot, per revision whose call
  // finished; a revision with no entry has no record. Ascending by revision.
  sentByRevision?: { revision: number; sent: LiveScreenshotSent }[];
};

// The screenshots any revision of one task was built on, oldest first. The link
// is session_actions.source_event_ids (the snap/ provenance ids) joined to the
// session's screen.snapshot observations; the ordinal is the rank among ALL the
// session's snapshots by sequence (the S{n} the browser shows), so it is
// computed before the join narrows to the task.
export async function listTaskScreenshots(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  taskId: string,
): Promise<TaskScreenshot[]> {
  assertUuid(sessionId);
  return inOwnerScope(database, scope, async (tx) => {
    if (!(await readSession(tx, scope, sessionId)))
      throw new SessionError("not_found");
    const rows = await readTaskScreenshotRows(tx, scope, sessionId, taskId);
    const recorded = await readScreenshotsSentRows(
      tx,
      scope,
      sessionId,
      taskId,
    );
    // ordinal -> revision -> outcome (the later action of a revision wins).
    const sentOf = new Map<number, Map<number, LiveScreenshotSent>>();
    for (const entry of recorded) {
      const list = screenshotsSentOf({ screenshotsSent: entry["sent"] });
      for (const { ordinal, sent } of list ?? []) {
        const byRevision = sentOf.get(ordinal) ?? new Map();
        byRevision.set(Number(entry["task_revision"]), sent);
        sentOf.set(ordinal, byRevision);
      }
    }
    return rows.map((row) => ({
      ...sentByRevisionOf(sentOf.get(Number(row["ordinal"]))),
      ordinal: Number(row["ordinal"]),
      sourceId: String(row["source_id"]),
      eventId: String(row["event_id"]),
      sequence: Number(row["sequence"]),
      capturedAt: new Date(row["received_at"] as string).toISOString(),
      artifactId: row["screenshot_artifact_id"]
        ? String(row["screenshot_artifact_id"])
        : null,
      ocrEngine:
        row["ocr_engine"] === "vision" || row["ocr_engine"] === "tesseract"
          ? row["ocr_engine"]
          : null,
      display: storedDisplay(row["display"]),
      revisions: (row["revisions"] as unknown[]).map(Number),
    }));
  });
}

function sentByRevisionOf(
  byRevision: Map<number, LiveScreenshotSent> | undefined,
): Pick<TaskScreenshot, "sentByRevision"> {
  if (!byRevision || byRevision.size === 0) return {};
  return {
    sentByRevision: [...byRevision]
      .sort(([a], [b]) => a - b)
      .map(([revision, sent]) => ({ revision, sent })),
  };
}

export type StoredAction = {
  id: string;
  taskId: string;
  taskRevision: number;
  actionKind: string;
  dispatchStatus: string;
  attempt: number;
  // The fence the dispatching holder held; an in-flight action under an older
  // fence than the current holder's belongs to a holder that is gone.
  fenceAtDispatch: number;
  jobId: string | null;
  jobCreated: boolean;
  // The transcript segment ids the task revision was built on. Read only for
  // the worker (listActions), never for the browser's changes feed; null for
  // a row written before the column existed.
  sourceEventIds?: readonly string[] | null;
  result: unknown;
  // The draft's text so far while in flight (browser feed; absent otherwise).
  progress?: { draft: string };
  // The screenshots the revision rests on, as (sourceId, eventId) pairs lifted
  // from the snapshot provenance ids. Ids only; the browser's feed carries this
  // and never the raw sourceEventIds.
  sourceSnapshots?: { sourceId: string; eventId: string }[];
  // Display metadata lifted from result.generatedBy when it is well formed.
  generatedBy?: { runtime: string; model: string };
  // Display metadata lifted from result.missingContext, sanitised.
  missingContext?: LiveMissingContext;
  // D35: what of each screenshot the revision's call carried (by S{n}),
  // lifted from the stored result; absent when none was recorded.
  screenshotsSent?: { ordinal: number; sent: LiveScreenshotSent }[];
  // D36: the result is the closed category no-question (a capture showing
  // nothing to answer). Derived at read time from the stored result; absent
  // otherwise, so a later revision that finds a question clears it.
  noQuestion?: true;
  // Why the revision exists when the owner's input made it (browser feed only).
  revisionReason?: LiveRevisionReason;
  shown: boolean;
  suppressionReason: string | null;
  createdAt: string;
  // Set by the database on every status change (the action cursor's key).
  updatedAt: string;
};

// The draft's text so far on an in-flight action (recordProgress), when well
// formed; a settled action carries none.
function progressOf(
  row: Record<string, unknown>,
): { draft: string } | undefined {
  if (row["dispatch_status"] !== "in_flight") return undefined;
  const draft = (row["progress"] as { draft?: unknown } | null)?.draft;
  return typeof draft === "string" && draft !== "" ? { draft } : undefined;
}

function generatedByOf(
  result: unknown,
): { runtime: string; model: string } | undefined {
  const found = (result as { generatedBy?: unknown } | null)?.generatedBy;
  const parsed = liveGeneratedBySchema.safeParse(found);
  return parsed.success ? parsed.data : undefined;
}

function missingContextOf(result: unknown): LiveMissingContext | undefined {
  return sanitizeMissingContext(
    (result as { missingContext?: unknown } | null)?.missingContext,
  );
}

// The per-screenshot outcome the dispatch recorded with its result, when well
// formed (a malformed or absent value is simply no record).
export function screenshotsSentOf(
  result: unknown,
): { ordinal: number; sent: LiveScreenshotSent }[] | undefined {
  const parsed = z
    .array(
      z.strictObject({
        ordinal: z.number().int().min(1),
        sent: liveScreenshotSentSchema,
      }),
    )
    .max(100)
    .safeParse(
      (result as { screenshotsSent?: unknown } | null)?.screenshotsSent,
    );
  return parsed.success && parsed.data.length > 0 ? parsed.data : undefined;
}

function noQuestionOf(result: unknown): true | undefined {
  return (result as { category?: unknown } | null)?.category === "no-question"
    ? true
    : undefined;
}

function sourceSnapshotsOf(
  row: Record<string, unknown>,
): { sourceId: string; eventId: string }[] | undefined {
  const ids = row["snapshot_event_ids"];
  if (!Array.isArray(ids)) return undefined;
  const found = (ids as string[]).flatMap((id) => {
    const parsed = parseSnapshotProvenanceId(id);
    return parsed
      ? [{ sourceId: parsed.sourceId, eventId: parsed.eventId }]
      : [];
  });
  return found.length > 0 ? found : undefined;
}

export function toStoredAction(row: Record<string, unknown>): StoredAction {
  // A withheld draft's summary rides on its suppression reason (withheld.ts):
  // the browser reads it as result.withheld, content-free.
  const stored = row["suppression_reason"]
    ? decodeWithheldReason(String(row["suppression_reason"]))
    : null;
  const result = stored?.withheld
    ? { withheld: stored.withheld }
    : (row["result"] ?? null);
  const generatedBy = generatedByOf(result);
  const missingContext = missingContextOf(result);
  const noQuestion = noQuestionOf(result);
  const screenshotsSent = screenshotsSentOf(result);
  const sourceSnapshots = sourceSnapshotsOf(row);
  const progress = progressOf(row);
  const reason = liveRevisionReasonSchema.safeParse(row["revision_reason"]);
  return {
    id: String(row["id"]),
    taskId: String(row["task_id"]),
    taskRevision: Number(row["task_revision"]),
    actionKind: String(row["action_kind"]),
    dispatchStatus: String(row["dispatch_status"]),
    attempt: Number(row["attempt"]),
    fenceAtDispatch: Number(row["fence_at_dispatch"]),
    jobId: row["job_id"] ? String(row["job_id"]) : null,
    jobCreated: Boolean(row["job_created"]),
    result,
    ...(progress === undefined ? {} : { progress }),
    ...(generatedBy === undefined ? {} : { generatedBy }),
    ...(missingContext === undefined ? {} : { missingContext }),
    ...(noQuestion === undefined ? {} : { noQuestion }),
    ...(screenshotsSent === undefined ? {} : { screenshotsSent }),
    ...(sourceSnapshots === undefined ? {} : { sourceSnapshots }),
    ...(reason.success ? { revisionReason: reason.data } : {}),
    shown: Boolean(row["shown"]),
    suppressionReason: stored ? stored.reason : null,
    createdAt: new Date(row["created_at"] as string).toISOString(),
    updatedAt: new Date(row["updated_at"] as string).toISOString(),
    ...("source_event_ids" in row
      ? {
          sourceEventIds: Array.isArray(row["source_event_ids"])
            ? (row["source_event_ids"] as string[])
            : null,
        }
      : {}),
  };
}

// The oldest actions by creation, bounded: for workers and tests that read a
// session's actions whole. The browser reads changes through
// listActionChanges (session-pages.ts), which a changed row cannot hide from.
export async function listActions(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  options: { limit?: number } = {},
): Promise<StoredAction[]> {
  assertUuid(sessionId);
  const limit = pageSize(options.limit, 200);
  return inOwnerScope(database, scope, async (tx) => {
    if (!(await readSession(tx, scope, sessionId)))
      throw new SessionError("not_found");
    const rows = await readActionRowsOldest(tx, scope, sessionId, limit);
    return rows.map(toStoredAction);
  });
}

// The worker's read of a session's actions: the NEWEST `limit` rows, oldest
// first. A long session whose actions pass a page would otherwise seed a
// rebuilt run from its oldest rows only and lose every later task.
export async function listActionsNewest(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  limit: number,
): Promise<StoredAction[]> {
  assertUuid(sessionId);
  return inOwnerScope(database, scope, async (tx) => {
    if (!(await readSession(tx, scope, sessionId)))
      throw new SessionError("not_found");
    const rows = await readActionRowsNewest(
      tx,
      scope,
      sessionId,
      Math.max(1, limit),
    );
    return rows.map(toStoredAction).reverse();
  });
}

export type ScreenshotDownload = { bytes: Uint8Array; mediaType: string };

// The download read: the owner's own session screenshot only, served with its
// stored type (never sniffed). Anyone else gets null.
export async function readScreenshot(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
  artifactId: string,
): Promise<ScreenshotDownload | null> {
  assertUuid(sessionId);
  assertUuid(artifactId);
  return inOwnerScope(database, scope, async (tx) => {
    const row = await readScreenshotArtifact(tx, scope, sessionId, artifactId);
    if (!row) return null;
    const mediaType = (row.metadata as { media_type?: string } | null)
      ?.media_type;
    return {
      bytes: row.bytes,
      mediaType: mediaType ?? "application/octet-stream",
    };
  });
}

export type SessionContext = {
  session: SessionView;
  // The approved candidate-profile revision pinned at session start.
  profile: {
    id: string;
    revision: number;
    sha256: string;
    matrix: unknown;
  } | null;
};

// Context assembly: the pinned profile revision, read in the owner's actor
// scope, so a link never widens access.
export async function getSessionContext(
  database: PlatformDatabase,
  scope: OwnerScope,
  sessionId: string,
): Promise<SessionContext | null> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  return inOwnerScope(database, scope, async (tx) => {
    const record = await readSession(tx, scope, sessionId);
    if (!record) return null;
    let profile: SessionContext["profile"] = null;
    if (record.profileId !== null && record.profileRevision !== null) {
      const row = await readPinnedProfileRevision(tx, scope, {
        profileId: record.profileId,
        revision: record.profileRevision,
      });
      if (row)
        profile = {
          id: record.profileId,
          revision: record.profileRevision,
          sha256: row.sha256,
          matrix: row.matrix,
        };
    }
    return { session: toView(record), profile };
  });
}

// A session job's result, read with the actor-carrying get. The job is named
// only through an action of the owner's own session.
export async function getSessionJob(
  database: PlatformDatabase,
  jobs: SessionJobs,
  scope: OwnerScope,
  sessionId: string,
  jobId: string,
) {
  assertUuid(sessionId);
  assertUuid(jobId);
  const named = await inOwnerScope(database, scope, (tx) =>
    findActionJob(tx, scope, sessionId, jobId),
  );
  if (!named) return undefined;
  return jobs.get(scope.tenantId, scope.actorId, jobId);
}
