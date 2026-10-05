// Session control over HTTP with the signed-in cookie: the same routes the page
// calls (routes.ts), used by specs to set up state quickly or to cross-check
// what the UI claims against what the server answers.
import { readFileSync } from "node:fs";
import type {
  LiveSessionStartRequest,
  LiveSessionStartResponse,
} from "@omnitech/interview-contracts";
import { stackConfig } from "../stack/config";

type Cookie = { name: string; value: string };

function cookieHeader(): string {
  const { storageStatePath } = stackConfig();
  const state = JSON.parse(readFileSync(storageStatePath, "utf8")) as {
    cookies: Cookie[];
  };
  return state.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

export const DEFAULT_START: LiveSessionStartRequest = {
  processingPolicy: "permitted-remote",
  captureSources: ["microphone", "screen"],
  liveAssistance: true,
  retention: "delete-at-end",
};

export async function sessionApi(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const { webUrl, tenantSlug } = stackConfig();
  const response = await fetch(
    `${webUrl}/api/interview/t/${tenantSlug}/sessions${path}`,
    {
      method: init.method ?? "GET",
      headers: {
        cookie: cookieHeader(),
        origin: webUrl,
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    },
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

// Starts a session the way the setup page does and returns its id.
export async function startSessionViaApi(
  request: Partial<LiveSessionStartRequest> = {},
): Promise<{ id: string; response: LiveSessionStartResponse }> {
  const { status, body } = await sessionApi("", {
    method: "POST",
    body: { ...DEFAULT_START, ...request },
  });
  if (status !== 201) throw new Error(`start session failed: ${status}`);
  const response = body as LiveSessionStartResponse;
  return { id: response.session.id, response };
}

export const controlSession = (
  id: string,
  action: "pause" | "resume" | "end" | "stop-work",
) =>
  sessionApi(`/${id}/control`, {
    method: "POST",
    body: { version: 1, kind: "session.control", action },
  });

// The capture companion's ingest route: no cookie, the session credential is
// the only principal (the same call the companion makes).
let eventCounter = 0;
export async function ingest(
  credential: string,
  envelope: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const { webUrl, tenantSlug } = stackConfig();
  const response = await fetch(
    `${webUrl}/api/interview/t/${tenantSlug}/sessions/ingest`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credential}`,
      },
      body: JSON.stringify(envelope),
    },
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

// Wire envelopes the companion sends (content-free here: fixed placeholder
// words, never anything a person said).
export const envelopes = {
  transcript(sourceId: string, sequence: number, text: string) {
    eventCounter += 1;
    return {
      version: 1,
      kind: "transcript.final",
      sourceId,
      eventId: `e2e-${Date.now()}-${eventCounter}`,
      occurredAt: new Date().toISOString(),
      sequence,
      content: { speaker: "speaker-1", text, startMs: 0, endMs: 1000 },
    };
  },
  disconnected(
    source: "microphone" | "application-audio" | "screen",
    sequence: number,
    reason: "user-stopped" | "device-lost" | "permission-revoked" | "error",
  ) {
    eventCounter += 1;
    return {
      version: 1,
      kind: "source.disconnected",
      sourceId: source,
      eventId: `e2e-${Date.now()}-${eventCounter}`,
      occurredAt: new Date().toISOString(),
      sequence,
      content: { source, reason },
    };
  },
  gap(
    source: "microphone" | "application-audio" | "screen",
    sequence: number,
    durationMs: number,
  ) {
    eventCounter += 1;
    return {
      version: 1,
      kind: "capture.gap",
      sourceId: source,
      eventId: `e2e-${Date.now()}-${eventCounter}`,
      occurredAt: new Date().toISOString(),
      sequence,
      content: { source, durationMs, reason: "source-interrupted" },
    };
  },
};

// A fresh credential for a session the page started (the start response is the
// only other place the plaintext appears, and the page keeps it). Renewing
// replaces the old one, as the Sources tab's Renew does.
export async function renewCredential(sessionId: string): Promise<string> {
  const { status, body } = await sessionApi(`/${sessionId}/credential`, {
    method: "POST",
  });
  if (status !== 200 && status !== 201)
    throw new Error(`renew credential failed: ${status}`);
  return (body as { credential: { value: string } }).credential.value;
}

// GET .../sessions (the history list route).
export type SessionApiList = {
  sessions: Array<{ id: string; status: string; retention: string }>;
  nextCursor: string | null;
};

// The owner's own screenshot, uploaded the way the page's Capture & analyze
// does (multipart: the image plus its fields). Resolves with the HTTP status and
// body so a spec can assert both the acceptance and the refusal.
export async function ownerCapture(
  sessionId: string,
  image: Uint8Array,
  fields: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const { webUrl, tenantSlug } = stackConfig();
  const form = new FormData();
  form.set(
    "requestId",
    fields["requestId"] ?? `cap-${Date.now().toString(36)}`,
  );
  form.set("operation", "analyze");
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  form.append(
    "image",
    new Blob([new Uint8Array(image)], { type: "image/png" }),
    "capture.png",
  );
  const response = await fetch(
    `${webUrl}/api/interview/t/${tenantSlug}/sessions/${sessionId}/capture`,
    {
      method: "POST",
      headers: { cookie: cookieHeader(), origin: webUrl },
      body: form,
    },
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
