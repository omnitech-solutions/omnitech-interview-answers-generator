// The capture companion as the server sees it: requests to the ingest route
// carrying the pairing credential (`Authorization: Bearer`), exactly the wire
// the Mac companion speaks (active-session-contracts). Specs use it to make a
// source healthy, lost, revoked or dropped, to say something "heard" and to
// hand over a stored screenshot, and to check what a credential is allowed to
// do. Nothing here reads or writes the database; the server decides.
import { stackConfig } from "../stack/config";

export type Ack = { status: number; body: Record<string, unknown> };

let counter = 0;
const next = (label: string) =>
  `${label}-${Date.now().toString(36)}-${++counter}`;
const sequences = new Map<string, number>();
const sequenceOf = (credential: string, sourceId: string): number => {
  const key = `${credential}|${sourceId}`;
  const value = sequences.get(key) ?? 0;
  sequences.set(key, value + 1);
  return value;
};

// A 1x1 PNG: a real, decodable image (the server checks the leading bytes and
// the header dimensions).
const PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (char) => char.charCodeAt(0),
);

export class Companion {
  constructor(
    readonly credential: string,
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  private url(): string {
    const { webUrl, tenantSlug } = stackConfig();
    return `${webUrl}/api/interview/t/${tenantSlug}/sessions/ingest`;
  }

  private async send(body: BodyInit, contentType?: string): Promise<Ack> {
    const response = await fetch(this.url(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.credential}`,
        ...(contentType ? { "content-type": contentType } : {}),
        ...this.extraHeaders,
      },
      body,
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    };
  }

  private json(message: Record<string, unknown>): Promise<Ack> {
    return this.send(JSON.stringify(message), "application/json");
  }

  private envelope(sourceId: string, kind: string, content: unknown) {
    return {
      version: 1,
      kind,
      sourceId,
      eventId: next("evt"),
      occurredAt: new Date().toISOString(),
      sequence: sequenceOf(this.credential, sourceId),
      content,
    };
  }

  // The content-free "I am alive" message; the server stamps last contact.
  heartbeat(capturing = true): Promise<Ack> {
    return this.json({
      version: 1,
      kind: "heartbeat",
      sourceId: "companion",
      sentAt: new Date().toISOString(),
      capturing,
    });
  }

  // Said by the other side of the call (application audio) or by the owner's
  // microphone as the companion hears it.
  transcript(
    text: string,
    source: "microphone" | "application-audio" = "application-audio",
  ): Promise<Ack> {
    return this.json(
      this.envelope(
        source === "microphone" ? "mic" : "app",
        "transcript.final",
        {
          speaker: source === "microphone" ? "you" : "speaker-1",
          source,
          text,
          startMs: 0,
          endMs: 1000,
        },
      ),
    );
  }

  disconnected(
    source: "microphone" | "application-audio" | "screen",
    reason: "user-stopped" | "permission-revoked" | "device-lost" | "error",
  ): Promise<Ack> {
    return this.json(
      this.envelope(
        source === "screen" ? "scr" : source === "microphone" ? "mic" : "app",
        "source.disconnected",
        {
          source,
          reason,
        },
      ),
    );
  }

  gap(
    source: "microphone" | "application-audio" | "screen",
    reason:
      | "buffer-overflow"
      | "source-interrupted"
      | "paused"
      | "error" = "source-interrupted",
  ): Promise<Ack> {
    return this.json(
      this.envelope(
        source === "screen" ? "scr" : source === "microphone" ? "mic" : "app",
        "capture.gap",
        {
          source,
          durationMs: 4000,
          reason,
        },
      ),
    );
  }

  // A stored screen capture the companion hands over (multipart: envelope plus
  // the image's bytes).
  screenshot(windowLabel = "Shared window", requestId?: string): Promise<Ack> {
    const eventId = next("shot");
    const form = new FormData();
    form.set(
      "envelope",
      JSON.stringify({
        version: 1,
        kind: "screen.snapshot",
        sourceId: "scr",
        eventId,
        occurredAt: new Date().toISOString(),
        sequence: sequenceOf(this.credential, "scr"),
        content: {
          payloadRef: `payload-${eventId}`,
          mediaType: "image/png",
          byteLength: PNG_1X1.byteLength,
          windowLabel,
          ...(requestId ? { requestId } : {}),
        },
      }),
    );
    form.set("payload", new Blob([PNG_1X1], { type: "image/png" }), "shot.png");
    return this.send(form);
  }

  // The companion's capture loop (ADR-0020), as a Companion built with
  // `captureRequestHeaders(token)` plays it: every heartbeat answer carries the
  // ONE pending request (control.capture) for a companion that declared
  // support; the companion then captures once and answers with a snapshot naming
  // the request, or reports a closed failure code.
  async pendingCapture(): Promise<CaptureRequestWire | null> {
    const ack = await this.heartbeat();
    const control = ack.body["control"] as
      | { capture?: CaptureRequestWire }
      | undefined;
    return control?.capture ?? null;
  }

  // Captured and handed over: the snapshot names the request it fulfils.
  fulfil(request: CaptureRequestWire, windowLabel = "Focused window") {
    return this.screenshot(windowLabel, request.requestId);
  }

  // Could not capture: the closed code, correlated by request id.
  captureFailure(
    request: CaptureRequestWire,
    code:
      | "no-focused-window"
      | "permission-denied"
      | "source-gone"
      | "source-changed"
      | "capture-failed",
  ): Promise<Ack> {
    return this.json({
      version: 1,
      kind: "capture.failure",
      sourceId: "companion",
      sentAt: new Date().toISOString(),
      requestId: request.requestId,
      code,
    });
  }

  capabilityReport(
    report: {
      onDeviceAvailable?: boolean;
      recognizerAvailable?: boolean;
      authorizationStatus?:
        | "authorized"
        | "denied"
        | "restricted"
        | "not-determined";
      microphone?: "granted" | "denied" | "not-determined";
      screen?: "granted" | "denied" | "not-determined";
    } = {},
  ): Promise<Ack> {
    return this.json({
      version: 1,
      kind: "capability.report",
      sourceId: "companion",
      sentAt: new Date().toISOString(),
      speech: {
        locale: "en-US",
        onDeviceAvailable: report.onDeviceAvailable ?? true,
        recognizerAvailable: report.recognizerAvailable ?? true,
        authorizationStatus: report.authorizationStatus ?? "authorized",
      },
      permissions: {
        microphone: report.microphone ?? "granted",
        screen: report.screen ?? "granted",
      },
    });
  }
}

// A pending capture request as the companion reads it from an answer.
export type CaptureRequestWire = {
  requestId: string;
  mode: "focused-window" | "region" | "display";
  region?: { x: number; y: number; width: number; height: number };
  selection?: string;
  expiresAt: string;
};

// The headers that make a companion one that can be handed capture requests:
// its feature token and the opaque token of the screen source it selected.
export const captureRequestHeaders = (
  screenToken = "display-1.gen-1",
): Record<string, string> => ({
  "x-companion-features": "capture-request.v1",
  "x-companion-screen": screenToken,
});
