// Typed browser calls to the Active Session routes
// (/api/interview/t/:tenantSlug/sessions). Every response is parsed with the
// shared contract schemas, and every failure becomes a SessionApiError whose
// code is one of the closed LIVE_SESSION_ERROR_CODES or a transport code. An
// error never carries the response body or any session content
// (rule:id-only-traces): a code is all a screen may show.
import {
  type LiveCaptureRequest,
  type LiveCaptureState,
  type LiveCompanionCapability,
  type LiveCredential,
  type LiveHeardRequest,
  type LiveOwnerInputRequest,
  type LiveOwnerLanguageHint,
  type LiveOwnerSkillHint,
  type LiveProcessingPolicy,
  type LiveRetentionMode,
  type LiveSessionChoicesResponse,
  type LiveSessionErrorCode,
  type LiveSessionListResponse,
  type LiveSessionStartRequest,
  type LiveSessionStartResponse,
  type LiveSessionView,
  type LiveStreamResponse,
  liveCaptureStateSchema,
  liveCompanionCapabilityResponseSchema,
  liveCredentialRenewResponseSchema,
  liveOwnerCaptureResponseSchema,
  liveOwnerInputResponseSchema,
  liveSessionChoicesResponseSchema,
  liveSessionErrorBodySchema,
  liveSessionListResponseSchema,
  liveSessionResponseSchema,
  liveSessionStartResponseSchema,
  liveStreamResponseSchema,
} from "@omnitech/interview-contracts";
import type { z } from "zod";
import { studioFetch } from "../studio-fetch";

export type SessionFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

// "network": the request did not complete. "invalid_response": the server
// answered with something the contract does not describe.
export type SessionErrorCode =
  | LiveSessionErrorCode
  | "network"
  | "invalid_response"
  // The owner-input route does not exist on this server (yet).
  | "unavailable";

export class SessionApiError extends Error {
  readonly code: SessionErrorCode;
  readonly status: number;
  constructor(code: SessionErrorCode, status: number) {
    super(code);
    this.name = "SessionApiError";
    this.code = code;
    this.status = status;
  }
}

export type StreamCursor = {
  afterSequence?: number;
  actionCursor?: string;
  limit?: number;
};

export type SessionClient = {
  start(request: LiveSessionStartRequest): Promise<LiveSessionStartResponse>;
  // null: no open session (the route answers 404 once the latest session is
  // ended or purging, or none exists).
  current(): Promise<LiveSessionView | null>;
  get(sessionId: string): Promise<LiveSessionView>;
  list(page?: {
    limit?: number;
    cursor?: string;
  }): Promise<LiveSessionListResponse>;
  choices(): Promise<LiveSessionChoicesResponse>;
  // The companion's latest self-reported readiness; null before its first report.
  companionCapability(): Promise<LiveCompanionCapability | null>;
  stream(sessionId: string, cursor?: StreamCursor): Promise<LiveStreamResponse>;
  control(
    sessionId: string,
    action: "pause" | "resume" | "end",
  ): Promise<LiveSessionView>;
  // Replaces the previous credential; the plaintext is in the response only.
  renewCredential(sessionId: string): Promise<LiveCredential>;
  revokeCredential(sessionId: string): Promise<void>;
  tightenPolicy(
    sessionId: string,
    processingPolicy: LiveProcessingPolicy,
  ): Promise<LiveSessionView>;
  shortenRetention(
    sessionId: string,
    retention: LiveRetentionMode,
  ): Promise<LiveSessionView>;
  // 202: the session is purging; the returned view says so.
  deleteSession(sessionId: string): Promise<LiveSessionView>;
  // The owner's own request for assistance (Analyze latest capture, a typed
  // follow-up). Stored on the server only; the answer arrives in the stream.
  sendOwnerInput(
    sessionId: string,
    input: LiveOwnerInputRequest,
  ): Promise<void>;
  // One heard phrase (hands-free Auto), to the same input route.
  sendHeard(sessionId: string, input: LiveHeardRequest): Promise<void>;
  // Capture and analyze: one multipart request carrying the frame the browser
  // just took (already cropped to the owner's region) and its hints. This is the
  // one function that knows the route's wire shape.
  sendCapture(sessionId: string, input: CaptureUpload): Promise<void>;
  // Ask the native companion to capture once; the answer is the request's state.
  sendCaptureRequest(
    sessionId: string,
    request: LiveCaptureRequest,
  ): Promise<LiveCaptureState>;
  // Where that request stands: pending, captured, expired or refused.
  getCaptureRequest(
    sessionId: string,
    requestId: string,
  ): Promise<LiveCaptureState>;
};

// What one capture request carries. `label` is plain text and never a window or
// tab title.
export type CaptureUpload = {
  requestId: string;
  image: Blob;
  label?: string;
  target?: { taskId: string; revision: number };
  skill?: LiveOwnerSkillHint | undefined;
  language?: LiveOwnerLanguageHint | undefined;
};

async function errorFrom(response: Response): Promise<SessionApiError> {
  try {
    const body = liveSessionErrorBodySchema.safeParse(await response.json());
    if (body.success)
      return new SessionApiError(body.data.error.code, response.status);
  } catch {
    // Not JSON: fall through to the status.
  }
  // No contract body: the status alone still says missing or signed out.
  if (response.status === 404) return new SessionApiError("not_found", 404);
  if (response.status === 401) return new SessionApiError("unauthorized", 401);
  return new SessionApiError("invalid_response", response.status);
}

export function createSessionClient(
  tenant: string,
  fetcher: SessionFetch = studioFetch,
): SessionClient {
  const base = `/api/interview/t/${encodeURIComponent(tenant)}/sessions`;
  const at = (sessionId: string, suffix = "") =>
    `${base}/${encodeURIComponent(sessionId)}${suffix}`;

  async function send(url: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetcher(url, init);
    } catch {
      throw new SessionApiError("network", 0);
    }
    if (!response.ok) throw await errorFrom(response);
    return response;
  }
  async function read<S extends z.ZodType>(
    response: Response,
    schema: S,
  ): Promise<z.infer<S>> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SessionApiError("invalid_response", response.status);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new SessionApiError("invalid_response", response.status);
    return parsed.data;
  }
  const post = (url: string, body?: unknown): Promise<Response> =>
    send(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  return {
    async start(request) {
      return read(await post(base, request), liveSessionStartResponseSchema);
    },
    async current() {
      try {
        const { session } = await read(
          await send(`${base}/current`),
          liveSessionResponseSchema,
        );
        return session;
      } catch (error) {
        if (error instanceof SessionApiError && error.code === "not_found")
          return null;
        throw error;
      }
    },
    async get(sessionId) {
      const { session } = await read(
        await send(at(sessionId)),
        liveSessionResponseSchema,
      );
      return session;
    },
    async list(page = {}) {
      const query = new URLSearchParams();
      if (page.limit !== undefined) query.set("limit", String(page.limit));
      if (page.cursor) query.set("cursor", page.cursor);
      const suffix = query.size ? `?${query}` : "";
      return read(
        await send(`${base}${suffix}`),
        liveSessionListResponseSchema,
      );
    },
    async choices() {
      return read(
        await send(`${base}/choices`),
        liveSessionChoicesResponseSchema,
      );
    },
    async companionCapability() {
      const { capability } = await read(
        await send(`${base}/companion-capability`),
        liveCompanionCapabilityResponseSchema,
      );
      return capability;
    },
    async stream(sessionId, cursor = {}) {
      const query = new URLSearchParams();
      if (cursor.afterSequence !== undefined)
        query.set("afterSequence", String(cursor.afterSequence));
      if (cursor.actionCursor) query.set("actionCursor", cursor.actionCursor);
      if (cursor.limit !== undefined) query.set("limit", String(cursor.limit));
      const suffix = query.size ? `?${query}` : "";
      return read(
        await send(at(sessionId, `/stream${suffix}`)),
        liveStreamResponseSchema,
      );
    },
    async control(sessionId, action) {
      const { session } = await read(
        await post(at(sessionId, "/control"), {
          version: 1,
          kind: "session.control",
          action,
        }),
        liveSessionResponseSchema,
      );
      return session;
    },
    async renewCredential(sessionId) {
      const { credential } = await read(
        await post(at(sessionId, "/credential")),
        liveCredentialRenewResponseSchema,
      );
      return credential;
    },
    async revokeCredential(sessionId) {
      await send(at(sessionId, "/credential"), { method: "DELETE" });
    },
    async tightenPolicy(sessionId, processingPolicy) {
      const { session } = await read(
        await post(at(sessionId, "/policy"), { processingPolicy }),
        liveSessionResponseSchema,
      );
      return session;
    },
    async shortenRetention(sessionId, retention) {
      const { session } = await read(
        await post(at(sessionId, "/retention"), { retention }),
        liveSessionResponseSchema,
      );
      return session;
    },
    async sendOwnerInput(sessionId, input) {
      await read(
        await post(at(sessionId, "/input"), input),
        liveOwnerInputResponseSchema,
      );
    },
    async sendHeard(sessionId, input) {
      await read(
        await post(at(sessionId, "/input"), input),
        liveOwnerInputResponseSchema,
      );
    },
    async sendCapture(sessionId, input) {
      const form = new FormData();
      form.set("requestId", input.requestId);
      form.set("operation", "analyze");
      if (input.target) {
        form.set("targetTaskId", input.target.taskId);
        form.set("targetRevision", String(input.target.revision));
      }
      if (input.skill) form.set("skill", input.skill);
      if (input.language) form.set("language", input.language);
      if (input.label) form.set("label", input.label);
      form.set("image", input.image, "capture.jpg");
      // No content-type header: the browser adds the multipart boundary.
      await read(
        await send(at(sessionId, "/capture"), { method: "POST", body: form }),
        liveOwnerCaptureResponseSchema,
      );
    },
    async sendCaptureRequest(sessionId, request) {
      return read(
        await post(at(sessionId, "/capture-request"), request),
        liveCaptureStateSchema,
      );
    },
    async getCaptureRequest(sessionId, requestId) {
      return read(
        await send(
          at(sessionId, `/capture-request/${encodeURIComponent(requestId)}`),
        ),
        liveCaptureStateSchema,
      );
    },
    async deleteSession(sessionId) {
      const { session } = await read(
        await send(at(sessionId), { method: "DELETE" }),
        liveSessionResponseSchema,
      );
      return session;
    },
  };
}
