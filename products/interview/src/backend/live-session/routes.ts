// The Active Session routes (ADR-0011 Identity and Placement, ADR-0012 Read
// paths and Claim and credential lookup). Two route classes share one
// sub-app under /api/interview/t/:tenantSlug/sessions:
//
//   User routes (start, current, read, stream, control, credential renewal and
//   revocation, locality, retention, delete, screenshot download) run as the
//   signed-in member of the tenant the path names; the actor is the context
//   user and nothing in the request body or query supplies identity. A session
//   that is not the actor's answers exactly as one that does not exist.
//
//   The ingest route (POST .../ingest) is credential-authenticated and takes
//   no user session: the credential travels only in the Authorization header,
//   the tenant slug in the path, and every unknown, expired, revoked,
//   other-tenant or malformed credential gets one identical refusal.
//
// Every response is content-free apart from the owner's own reads: errors are
// fixed bodies keyed by a code, and nothing here logs (rule:id-only-traces,
// rule:credential-storage, rule:bounded-ingest).
import {
  ACTIVE_SESSION_LIMITS,
  type Acknowledgement,
  CREDENTIAL_TRANSPORT,
  controlMessageSchema,
  parseCompanionDeclaration,
  WIRE_VERSION,
} from "@omnitech/active-session-contracts";
import type { PlatformDatabase } from "@omnitech/database";
import {
  LIVE_OCR_LIMITS,
  LIVE_OWNER_INPUT_MAX_SNAPSHOTS,
  LIVE_SESSION_ERROR_STATUS,
  liveHeardRequestSchema,
  liveSessionListQuerySchema,
  liveSessionScreenshotSendRequestSchema,
  liveTaskIdSchema,
  maxOwnerCaptureBytes,
  SESSION_LIST_DEFAULT_PAGE,
} from "@omnitech/interview-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import { Hono } from "hono";
import { z } from "zod";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile";
import { briefingScope } from "../briefing-access";
import {
  type ContextEngine,
  PROJECTIONS,
  type ProjectionId,
  prepareContextPack,
  sessionSources,
} from "../context-pack/index";
import { SessionError, type SessionErrorCode } from "./errors";
import { type IngestOptions, ingestObservation } from "./ingest";
import { isProcessingPolicy, isRetentionMode } from "./mapping";
import { ActiveSessionRepository } from "./repository";
import type { OwnerScope } from "./scope";
import { loadSessionContext } from "./session-context";
import { MAX_PAGE } from "./session-reads";
import type { TranscriptRecordings } from "./transcript-recording";

const SESSION_ROUTES_PREFIX = "/api/interview/t/:tenantSlug/sessions";

export type SessionRoutesOptions = {
  database: PlatformDatabase;
  // The signed-in member's context for the tenant slug, or null (the same
  // resolver every other product route uses).
  resolveContext(tenantSlug: string): Promise<PlatformContext | null>;
  repository?: ActiveSessionRepository;
  // Test overrides of the frozen ingest limits.
  ingestLimits?: IngestOptions["limits"];
  // Told each transcript line a session stored (the coach, a recording).
  onHeard?: IngestOptions["onHeard"];
  // Whether voice activity from a session's audio sources is taken (the
  // owner's switch), and who is told when one starts or stops hearing a voice.
  voiceActivity?: boolean;
  onActivity?: IngestOptions["onActivity"];
  // Told the text read from a capture of the screen (the coach), with its
  // session and whether that session may be processed off this device.
  onScreen?: (screen: {
    text: string;
    session: { tenantId: string; actorId: string; sessionId: string };
    remote: boolean;
  }) => void;
  // The owner's own recordings of what a session heard. Absent: the
  // recording routes answer that there is none.
  recordings?: TranscriptRecordings;
  // Prepares and resolves the session's context pack for its owner's view.
  // Absent: the view route answers that it is not available.
  contextEngine?: ContextEngine;
};

// A start or control body is a few fields; this bounds it before parsing.
const MAX_JSON_BYTES = 16 * 1024;
// A multipart ingest carries one envelope and one screenshot payload, plus
// framing; anything larger is refused before it is parsed.
const MULTIPART_OVERHEAD_BYTES = 8 * 1024;

// Room for the capture route's text fields and multipart framing, and for the
// `ocr` field: JSON-escaped text takes at most six bytes a character.
const CAPTURE_FIELDS_BYTES = 16 * 1024 + LIVE_OCR_LIMITS.maxTextPerRequest * 6;

type Status = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 503;

// SessionError codes to HTTP statuses. Bodies are fixed by the code alone, so
// no id, credential or content rides along in an error.
// The table itself lives in the browser contract, so the Studio view and these
// routes cannot disagree about a code's status.
const ERROR_STATUS: Record<SessionErrorCode, Status> =
  LIVE_SESSION_ERROR_STATUS;

const errorBody = (code: string) => ({ error: { code } });

// The one refusal for every bad ingest credential (rule:credential-strength).
const CREDENTIAL_REFUSED: Acknowledgement = {
  version: WIRE_VERSION,
  status: "refused",
  code: "credential_refused",
};

const REFUSAL_STATUS: Record<string, Status> = {
  credential_refused: 401,
  session_paused: 409,
  session_ended: 409,
  session_purging: 409,
  invalid_observation: 422,
  unsupported_version: 422,
  envelope_too_large: 413,
  payload_too_large: 413,
  rate_limited: 429,
  limit_reached: 409,
  // Same source and event id, different content: the original is kept.
  event_conflict: 409,
  // The named capture request is not the pending one: nothing was stored.
  capture_request_stale: 409,
  // Voice activity is not taken (the owner's switch, or a device-only session).
  voice_activity_off: 409,
};

class BodyTooLarge extends Error {}

// Reads at most `limit` bytes, counting as it streams so an oversize body is
// refused before it is buffered or parsed.
async function boundedBytes(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw new BodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(request: Request): Promise<unknown> {
  const bytes = await boundedBytes(request, MAX_JSON_BYTES);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SessionError("invalid_input");
  }
}

// The bearer credential from the Authorization header, or null. It is never
// read from a URL.
function presentedCredential(request: Request): string | null {
  const header = request.headers.get(CREDENTIAL_TRANSPORT.header);
  const prefix = `${CREDENTIAL_TRANSPORT.scheme} `;
  return header?.startsWith(prefix) ? header.slice(prefix.length).trim() : null;
}

const refusedResponse = (ack: Acknowledgement = CREDENTIAL_REFUSED) =>
  ack.status === "refused"
    ? ({ ack, status: REFUSAL_STATUS[ack.code] ?? 422 } as const)
    : ({ ack, status: 200 } as const);

const pageNumber = (value: string | undefined, fallback: number) => {
  const parsed = z.coerce
    .number()
    .int()
    .min(0)
    .safeParse(value ?? fallback);
  return parsed.success ? parsed.data : fallback;
};

// Pause, end, credential revocation and delete: the stop class that the
// session's owner may always perform (rule:owner-or-cap-ends).
async function isOwnerStop(request: Request, path: string): Promise<boolean> {
  if (request.method === "DELETE") return true;
  if (request.method !== "POST" || !path.endsWith("/control")) return false;
  try {
    const bytes = await boundedBytes(request.clone(), MAX_JSON_BYTES);
    const body = JSON.parse(new TextDecoder().decode(bytes)) as {
      action?: unknown;
    };
    return body.action === "pause" || body.action === "end";
  } catch {
    return false;
  }
}

export function createSessionRoutes(options: SessionRoutesOptions) {
  const repository =
    options.repository ?? new ActiveSessionRepository(options.database);
  const limits = { ...ACTIVE_SESSION_LIMITS, ...options.ingestLimits };
  const app = new Hono<{ Variables: { scope: OwnerScope } }>();
  // Heard phrases already told to a listener, by request id: a resend of the
  // same phrase is stored once and told once.
  const told = new Set<string>();

  app.onError((error, c) => {
    c.header("Cache-Control", "no-store");
    if (error instanceof SessionError) {
      // The body stays uniform per code; the refusal reason (a fixed word, never
      // content) rides in a header so a client or log can say which check failed.
      if (error.reason) c.header("X-Refusal-Reason", error.reason);
      return c.json(errorBody(error.code), ERROR_STATUS[error.code]);
    }
    if (error instanceof BodyTooLarge)
      return c.json(errorBody("body_too_large"), 413);
    // [SAFETY] Never logged and never echoed: an unexpected failure is a
    // fixed body, because its message could carry session content.
    return c.json(errorBody("session_unavailable"), 500);
  });
  // Scoped to the session routes: a route mounted after this sub-app keeps
  // its own headers.
  app.use(`${SESSION_ROUTES_PREFIX}/*`, async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
  });

  // ---- Ingest: the credential is the principal; no user session. ----------
  async function installed(tenantSlug: string): Promise<string | null> {
    // The slug resolves to a tenant id (the tenants table is not tenant-owned),
    // then the product's installation is checked inside that tenant before any
    // domain work (ADR-0012 Claim and credential lookup).
    const found = await options.database.transaction((client) =>
      client.query<{ id: string }>(
        "SELECT id FROM platform.tenants WHERE slug = $1",
        [tenantSlug],
      ),
    );
    const tenantId = found.rows[0]?.id;
    if (!tenantId) return null;
    const installation = await options.database.tenantTransaction(
      tenantId,
      (client) =>
        client.query(
          "SELECT 1 FROM platform.product_installations WHERE tenant_id = $1 AND product_id = $2 AND enabled",
          [tenantId, INTERVIEW_PRODUCT_ID],
        ),
    );
    return installation.rows.length > 0 ? tenantId : null;
  }

  app.post(`${SESSION_ROUTES_PREFIX}/ingest`, async (c) => {
    const refuse = (ack?: Acknowledgement) => {
      const { ack: body, status } = refusedResponse(ack);
      return c.json(body, status);
    };
    // [GUARD] A credential in the URL is never honoured: any query string is
    // refused, without looking at its content.
    if (new URL(c.req.url).search !== "")
      return c.json(errorBody("query_not_allowed"), 400);
    const credential = presentedCredential(c.req.raw);
    if (credential === null) return refuse();

    // [SAFETY] Size before parsing: the byte bound depends only on the
    // declared kind of body, so it discloses nothing about any session.
    // [GUARD] Lowercase only to recognise the media type: the multipart
    // boundary is case-sensitive and must reach the parser as sent (a browser's
    // boundary is mixed case).
    const rawType = c.req.header("content-type") ?? "";
    const type = rawType.toLowerCase();
    const multipart = type.startsWith("multipart/form-data");
    if (!multipart && !type.startsWith("application/json"))
      return c.json(errorBody("unsupported_media_type"), 415);
    const bound = multipart
      ? limits.maxScreenshotBytes +
        limits.maxEnvelopeBytes +
        MULTIPART_OVERHEAD_BYTES
      : limits.maxEnvelopeBytes;
    let bytes: Uint8Array;
    try {
      bytes = await boundedBytes(c.req.raw, bound);
    } catch (error) {
      if (!(error instanceof BodyTooLarge)) throw error;
      return refuse({
        version: WIRE_VERSION,
        status: "refused",
        code: multipart ? "payload_too_large" : "envelope_too_large",
      });
    }

    let envelope: unknown;
    let payload: Uint8Array | undefined;
    if (multipart) {
      try {
        const form = await new Request("http://ingest.invalid/", {
          method: "POST",
          headers: { "content-type": rawType },
          body: bytes as BodyInit,
        }).formData();
        const part = form.get("envelope");
        const file = form.get("payload");
        if (typeof part !== "string") throw new Error("envelope");
        envelope = part;
        if (file instanceof File)
          payload = new Uint8Array(await file.arrayBuffer());
      } catch {
        return refuse({
          version: WIRE_VERSION,
          status: "refused",
          code: "invalid_observation",
        });
      }
    } else envelope = new TextDecoder().decode(bytes);

    const tenantId = await installed(c.req.param("tenantSlug"));
    if (tenantId === null) return refuse();
    let retryAfter = 60;
    const ack = await ingestObservation(
      options.database,
      credential,
      tenantId,
      envelope,
      {
        ...(payload ? { payload } : {}),
        jobs: repository.jobs,
        declaration: parseCompanionDeclaration((name) => c.req.header(name)),
        limits: options.ingestLimits ?? {},
        onRetryAfter: (seconds) => {
          retryAfter = seconds;
        },
        ...(options.onHeard ? { onHeard: options.onHeard } : {}),
        voiceActivity: options.voiceActivity === true,
        ...(options.onActivity ? { onActivity: options.onActivity } : {}),
      },
    );
    if (ack.status === "refused") {
      const response = refusedResponse(ack);
      if (ack.code === "rate_limited")
        c.header("Retry-After", String(retryAfter));
      return c.json(response.ack, response.status);
    }
    return c.json(ack, 200);
  });

  // ---- User routes: the signed-in member of the tenant the path names. ----
  app.use(`${SESSION_ROUTES_PREFIX}/*`, async (c, next) => {
    if (c.req.path.endsWith("/ingest") && c.req.method === "POST")
      return next();
    const slug = c.req.param("tenantSlug") ?? "";
    // [SAFETY] Starting, resuming and renewing need interview.write; the
    // owner's own stop actions (pause, end, revoke, delete) need only
    // membership with read, so a demoted member can still stop their session.
    const scope = briefingScope(
      await options.resolveContext(slug),
      slug,
      (await isOwnerStop(c.req.raw, c.req.path)) ? "GET" : c.req.method,
    );
    if (!scope) return c.json(errorBody("unauthorized"), 401);
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const origin = c.req.header("origin");
      const host = c.req.header("host");
      const own = host
        ? new URL(`${new URL(c.req.url).protocol}//${host}`).origin
        : new URL(c.req.url).origin;
      if (
        c.req.header("sec-fetch-site") === "cross-site" ||
        (origin && origin !== own)
      )
        return c.json(errorBody("origin_forbidden"), 403);
    }
    c.set("scope", { tenantId: scope.tenantId, actorId: scope.actorId });
    await next();
  });

  const base = SESSION_ROUTES_PREFIX;

  app.post(base, async (c) => {
    // [SAFETY] The owner is the context user; the strict start schema (in the
    // repository) rejects any identity field in the body.
    const started = await repository.startSession(
      c.get("scope"),
      (await jsonBody(c.req.raw)) as never,
    );
    // The plaintext credential leaves the repository here, once.
    return c.json(started, 201);
  });

  // The owner's session history, newest first. Registered with /choices and
  // /current ahead of /:sessionId so none of them is read as a session id.
  app.get(base, async (c) => {
    const query = liveSessionListQuerySchema.safeParse(c.req.query());
    if (!query.success) throw new SessionError("invalid_input");
    return c.json(
      await repository.listSessions(c.get("scope"), {
        limit: query.data.limit ?? SESSION_LIST_DEFAULT_PAGE,
        ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      }),
    );
  });

  // What the setup screen offers to start a session with.
  app.get(`${base}/choices`, async (c) =>
    c.json(await repository.getSessionChoices(c.get("scope"))),
  );

  // The signed-in member's own latest companion capability report (null before
  // the first one). Registered ahead of /:sessionId so it is never read as an id.
  app.get(`${base}/companion-capability`, async (c) =>
    c.json({
      capability: await repository.getCompanionCapability(c.get("scope")),
    }),
  );

  app.get(`${base}/current`, async (c) => {
    const session = await repository.getOpenSession(c.get("scope"));
    if (!session) throw new SessionError("not_found");
    return c.json({ session });
  });

  app.get(`${base}/:sessionId`, async (c) => {
    const session = await repository.getSession(
      c.get("scope"),
      c.req.param("sessionId"),
    );
    if (!session) throw new SessionError("not_found");
    return c.json({ session });
  });

  // [DOMAIN] The projection view (ADR-0038): for a question, what of the
  // owner's approved material a model would be given under a projection, what
  // was left out and why. Read in the owner's scope like the session itself;
  // nothing is written and no model is called.
  app.get(`${base}/:sessionId/context`, async (c) => {
    if (!options.contextEngine) throw new SessionError("not_found");
    const projection = c.req.query("projection") ?? PROJECTIONS.inspect;
    const spoken = (c.req.query("q") ?? "").slice(0, 2_000);
    if (!Object.values(PROJECTIONS).includes(projection as ProjectionId))
      throw new SessionError("invalid_input");
    const scope = c.get("scope");
    const sessionId = c.req.param("sessionId");
    const engine = options.contextEngine;
    // [SAFETY] A pinned record that no longer verifies, or material the
    // recipe refuses, is answered by a code alone: what it says never rides
    // along in an error.
    const pack = await loadSessionContext(options.database, scope, sessionId)
      .then((context) =>
        prepareContextPack(engine, sessionSources(context), {
          scope,
          signal: c.req.raw.signal,
          for: { kind: "session", id: sessionId },
        }),
      )
      .catch((error: unknown) => {
        throw error instanceof SessionError
          ? error
          : new SessionError("invalid_input");
      });
    return c.json({ view: pack.view(projection as ProjectionId, spoken) });
  });

  // The stream is a cursor-paged read of the owner's session: observations
  // after a sequence, and every action created or changed after an action
  // cursor (live-session.ts in interview-contracts documents both cursors).
  app.get(`${base}/:sessionId/stream`, async (c) => {
    const scope = c.get("scope");
    const sessionId = c.req.param("sessionId");
    const after = pageNumber(c.req.query("afterSequence"), 0);
    const limit = Math.max(
      1,
      Math.min(pageNumber(c.req.query("limit"), 200), MAX_PAGE),
    );
    const session = await repository.getSession(scope, sessionId);
    // [SAFETY] Ownership is settled before the cursor is looked at, so a
    // foreign session answers as an unknown one whatever the query says.
    if (!session) throw new SessionError("not_found");
    const actionCursor = c.req.query("actionCursor");
    const found = await repository.listObservations(scope, sessionId, {
      afterSequence: after,
      limit: limit + 1,
      // The owner's own inputs are DB-side only and never echoed back.
      excludeOwnerInput: true,
    });
    const observations = found.slice(0, limit);
    const changes = await repository.listActionChanges(scope, sessionId, {
      limit,
      ...(actionCursor ? { cursor: actionCursor } : {}),
    });
    return c.json({
      session,
      observations,
      actions: changes.actions,
      nextAfterSequence: observations.at(-1)?.sequence ?? after,
      nextActionCursor: changes.nextActionCursor,
      hasMoreObservations: found.length > limit,
      hasMoreActions: changes.hasMoreActions,
      serverNow: changes.serverNow,
    });
  });

  // The screenshots a task's revisions rest on: ids, ordinals and times only;
  // an image is fetched through the screenshot route below. The task id is
  // checked before the database, and a foreign session is an unknown one.
  app.get(`${base}/:sessionId/tasks/:taskId/screenshots`, async (c) => {
    const taskId = liveTaskIdSchema.safeParse(c.req.param("taskId"));
    if (!taskId.success) throw new SessionError("invalid_input");
    const screenshots = await repository.listTaskScreenshots(
      c.get("scope"),
      c.req.param("sessionId"),
      taskId.data,
    );
    return c.json({ taskId: taskId.data, screenshots });
  });

  app.get(`${base}/:sessionId/screenshots/:artifactId`, async (c) => {
    const download = await repository.readScreenshot(
      c.get("scope"),
      c.req.param("sessionId"),
      c.req.param("artifactId"),
    );
    if (!download) throw new SessionError("not_found");
    return c.body(download.bytes as never, 200, {
      "Content-Type": download.mediaType,
      "Content-Disposition": "attachment",
      "Content-Security-Policy": "sandbox",
    });
  });

  app.post(`${base}/:sessionId/control`, async (c) => {
    const parsed = controlMessageSchema.safeParse(await jsonBody(c.req.raw));
    if (!parsed.success) throw new SessionError("invalid_input");
    // Stop work keeps the session active: it abandons what is in flight and
    // pending now, and never changes the status.
    const session =
      parsed.data.action === "stop-work"
        ? await repository.stopWork(c.get("scope"), c.req.param("sessionId"))
        : await repository.controlSession(
            c.get("scope"),
            c.req.param("sessionId"),
            parsed.data.action,
          );
    // A session that has ended is no longer recorded.
    if (parsed.data.action === "end")
      options.recordings?.stop(c.req.param("sessionId"));
    return c.json({ session });
  });

  // The owner's own request for assistance: Analyze latest capture or a typed
  // follow-up (ADR-0016). Owner-authenticated like every user route (tenant
  // membership and interview.write are resolved before any domain work); the
  // body names exact snapshot observation ids, never bytes, and carries no
  // identity.
  app.post(`${base}/:sessionId/input`, async (c) => {
    const scope = c.get("scope");
    const sessionId = c.req.param("sessionId");
    const body = await jsonBody(c.req.raw);
    const input = await repository.submitOwnerInput(scope, sessionId, body);
    // [DOMAIN] A phrase the window's own microphone heard is conversation
    // too: whoever listens (the coach, a recording) is told it once. That
    // microphone hears the room, so the line names no speaker.
    const heard = liveHeardRequestSchema.safeParse(body);
    if (options.onHeard && heard.success && !told.has(input.requestId)) {
      told.add(input.requestId);
      if (told.size > 2_000) told.delete(told.values().next().value as string);
      const session = await repository.getSession(scope, sessionId);
      try {
        options.onHeard({
          text: heard.data.text,
          occurredAt: new Date().toISOString(),
          session: { ...scope, sessionId },
          remote: session?.processingPolicy === "permitted-remote",
        });
      } catch {
        // The acknowledgement stands whatever a listener does.
      }
    }
    return c.json({ input }, 202);
  });

  // [DOMAIN] The owner's own recording of what this session hears, kept as a
  // transcript file on this machine. Off until asked for, every time: it is
  // never on because it was on before, and it ends with the session.
  app.get(`${base}/:sessionId/recording`, async (c) => {
    const session = await repository.getSession(
      c.get("scope"),
      c.req.param("sessionId"),
    );
    if (!session || !options.recordings) throw new SessionError("not_found");
    return c.json({ recording: options.recordings.state(session.id) });
  });
  app.post(`${base}/:sessionId/recording`, async (c) => {
    const body = (await jsonBody(c.req.raw)) as { on?: unknown } | null;
    if (typeof body?.on !== "boolean") throw new SessionError("invalid_input");
    const session = await repository.getSession(
      c.get("scope"),
      c.req.param("sessionId"),
    );
    if (!session || !options.recordings) throw new SessionError("not_found");
    // Nothing is heard, so nothing is recorded, once a session has ended.
    if (body.on && (session.status === "ended" || session.purged))
      throw new SessionError("invalid_input");
    return c.json({
      recording: body.on
        ? options.recordings.start(session.id)
        : options.recordings.stop(session.id),
    });
  });

  // Capture and analyze (multipart/form-data): the owner's own image plus
  // fields. Every malformed, oversize or unsupported body is one
  // invalid_input; the owner-only checks run in the middleware above.
  app.post(`${base}/:sessionId/capture`, async (c) => {
    // The boundary is case-sensitive: parse with the header as sent.
    const rawType = c.req.header("content-type") ?? "";
    if (!rawType.toLowerCase().startsWith("multipart/form-data"))
      throw new SessionError("invalid_input");
    let bytes: Uint8Array;
    try {
      bytes = await boundedBytes(
        c.req.raw,
        maxOwnerCaptureBytes * LIVE_OWNER_INPUT_MAX_SNAPSHOTS +
          CAPTURE_FIELDS_BYTES,
      );
    } catch (error) {
      if (error instanceof BodyTooLarge)
        throw new SessionError("invalid_input");
      throw error;
    }
    const fields: Record<string, unknown> = {};
    const images: Uint8Array[] = [];
    try {
      const form = await new Request("http://capture.invalid/", {
        method: "POST",
        headers: { "content-type": rawType },
        body: bytes as BodyInit,
      }).formData();
      for (const [name, value] of form.entries()) {
        if (name === "image") {
          if (!(value instanceof File)) throw new Error("image");
          // More than the limit is refused whole before any image is read.
          if (images.length >= LIVE_OWNER_INPUT_MAX_SNAPSHOTS)
            throw new SessionError("invalid_input", [], "image_count");
          images.push(new Uint8Array(await value.arrayBuffer()));
          continue;
        }
        // Text fields only, each once; an empty one is an absent one.
        if (typeof value !== "string" || name in fields)
          throw new Error("field");
        if (value === "") continue;
        // The on-device text of the images, one JSON list; its shape and
        // bounds are the contract's to judge.
        if (name === "ocr" || name === "display") {
          try {
            fields[name] = JSON.parse(value);
          } catch {
            throw new SessionError("invalid_input", [], name);
          }
          continue;
        }
        fields[name] =
          name === "targetRevision" && /^[0-9]{1,7}$/.test(value)
            ? Number(value)
            : value;
      }
    } catch (error) {
      if (error instanceof SessionError) throw error;
      throw new SessionError("invalid_input", [], "body");
    }
    if (images.length === 0)
      throw new SessionError("invalid_input", [], "no_image");
    const scope = c.get("scope");
    const sessionId = c.req.param("sessionId");
    const capture = await repository.submitOwnerCapture(
      scope,
      sessionId,
      fields,
      images,
    );
    // [DOMAIN] What the capture shows, as the text read from it on the
    // device, is what the conversation is about: whoever coaches is told.
    const read = Array.isArray(fields["ocr"])
      ? (fields["ocr"] as { text?: unknown }[])
          .map((block) => (typeof block?.text === "string" ? block.text : ""))
          .filter(Boolean)
          .join("\n\n")
      : "";
    if (options.onScreen && read) {
      const session = await repository.getSession(scope, sessionId);
      try {
        options.onScreen({
          text: read,
          session: { ...scope, sessionId },
          remote: session?.processingPolicy === "permitted-remote",
        });
      } catch {
        // The capture stands whatever a listener does.
      }
    }
    return c.json(capture, 202);
  });

  // Capture now: ask the native companion to capture ONCE (focused window,
  // masked region or display) and analyse the result. Owner-authenticated like
  // /input; the body carries no identity. 202 with the request's state; the
  // GET reports pending, captured, expired or refused (with a reason code).
  app.post(`${base}/:sessionId/capture-request`, async (c) => {
    const state = await repository.submitCaptureRequest(
      c.get("scope"),
      c.req.param("sessionId"),
      await jsonBody(c.req.raw),
    );
    return c.json(state, 202);
  });

  app.get(`${base}/:sessionId/capture-request/:requestId`, async (c) =>
    c.json(
      await repository.getCaptureRequest(
        c.get("scope"),
        c.req.param("sessionId"),
        c.req.param("requestId"),
      ),
    ),
  );

  app.post(`${base}/:sessionId/credential`, async (c) => {
    const credential = await repository.renewCredential(
      c.get("scope"),
      c.req.param("sessionId"),
    );
    return c.json({ credential });
  });

  app.delete(`${base}/:sessionId/credential`, async (c) => {
    await repository.revokeCredential(c.get("scope"), c.req.param("sessionId"));
    return c.body(null, 204);
  });

  app.post(`${base}/:sessionId/policy`, async (c) => {
    const body = z
      .strictObject({ processingPolicy: z.string().refine(isProcessingPolicy) })
      .safeParse(await jsonBody(c.req.raw));
    if (!body.success) throw new SessionError("invalid_input");
    const session = await repository.tightenProcessingPolicy(
      c.get("scope"),
      c.req.param("sessionId"),
      body.data.processingPolicy as never,
    );
    return c.json({ session });
  });

  app.post(`${base}/:sessionId/screenshot-send`, async (c) => {
    const body = liveSessionScreenshotSendRequestSchema.safeParse(
      await jsonBody(c.req.raw),
    );
    if (!body.success) throw new SessionError("invalid_input");
    const session = await repository.setScreenshotSend(
      c.get("scope"),
      c.req.param("sessionId"),
      body.data.screenshotSend,
    );
    return c.json({ session });
  });

  app.post(`${base}/:sessionId/retention`, async (c) => {
    const body = z
      .strictObject({ retention: z.string().refine(isRetentionMode) })
      .safeParse(await jsonBody(c.req.raw));
    if (!body.success) throw new SessionError("invalid_input");
    const session = await repository.shortenRetention(
      c.get("scope"),
      c.req.param("sessionId"),
      body.data.retention as never,
    );
    return c.json({ session });
  });

  app.delete(`${base}/:sessionId`, async (c) => {
    const session = await repository.deleteSession(
      c.get("scope"),
      c.req.param("sessionId"),
    );
    return c.json({ session }, 202);
  });

  return app;
}
