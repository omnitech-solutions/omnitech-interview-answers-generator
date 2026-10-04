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
  WIRE_VERSION,
} from "@omnitech/active-session-contracts";
import type { PlatformDatabase } from "@omnitech/database";
import {
  LIVE_SESSION_ERROR_STATUS,
  liveSessionListQuerySchema,
  SESSION_LIST_DEFAULT_PAGE,
} from "@omnitech/interview-contracts";
import type { PlatformContext } from "@omnitech/platform-contracts";
import { Hono } from "hono";
import { z } from "zod";
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile.js";
import { briefingScope } from "../briefing-access.js";
import { SessionError, type SessionErrorCode } from "./errors.js";
import { type IngestOptions, ingestObservation } from "./ingest.js";
import { isProcessingPolicy, isRetentionMode } from "./mapping.js";
import { ActiveSessionRepository } from "./repository.js";
import type { OwnerScope } from "./scope.js";
import { MAX_PAGE } from "./session-reads.js";

export const SESSION_ROUTES_PREFIX = "/api/interview/t/:tenantSlug/sessions";

export type SessionRoutesOptions = {
  database: PlatformDatabase;
  // The signed-in member's context for the tenant slug, or null (the same
  // resolver every other product route uses).
  resolveContext(tenantSlug: string): Promise<PlatformContext | null>;
  repository?: ActiveSessionRepository;
  // Test overrides of the frozen ingest limits.
  ingestLimits?: IngestOptions["limits"];
};

// A start or control body is a few fields; this bounds it before parsing.
const MAX_JSON_BYTES = 16 * 1024;
// A multipart ingest carries one envelope and one screenshot payload, plus
// framing; anything larger is refused before it is parsed.
const MULTIPART_OVERHEAD_BYTES = 8 * 1024;

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

  app.onError((error, c) => {
    c.header("Cache-Control", "no-store");
    if (error instanceof SessionError)
      return c.json(errorBody(error.code), ERROR_STATUS[error.code]);
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
    const type = (c.req.header("content-type") ?? "").toLowerCase();
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
          headers: { "content-type": type },
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
        limits: options.ingestLimits ?? {},
        onRetryAfter: (seconds) => {
          retryAfter = seconds;
        },
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
    const session = await repository.controlSession(
      c.get("scope"),
      c.req.param("sessionId"),
      parsed.data.action,
    );
    return c.json({ session });
  });

  // The owner's own request for assistance: Analyze latest capture or a typed
  // follow-up (ADR-0016). Owner-authenticated like every user route (tenant
  // membership and interview.write are resolved before any domain work); the
  // body names exact snapshot observation ids, never bytes, and carries no
  // identity.
  app.post(`${base}/:sessionId/input`, async (c) => {
    const input = await repository.submitOwnerInput(
      c.get("scope"),
      c.req.param("sessionId"),
      await jsonBody(c.req.raw),
    );
    return c.json({ input }, 202);
  });

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
