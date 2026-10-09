// A scripted stand-in for Studio's ingest route: it records every request and
// answers with well-formed acknowledgements, so a companion can be exercised
// with no server. It mirrors the route's behaviour only as far as the
// companion depends on it (acknowledge, refuse, control state, outage).
import {
  type Acknowledgement,
  CAPABILITY_ACK_EVENT_ID,
  CAPTURE_FAILURE_ACK_EVENT_ID,
  type CaptureFailureCode,
  type CaptureRequest,
  COMPANION_FEATURE_CAPTURE_REQUEST,
  COMPANION_FEATURES_HEADER,
  HEARTBEAT_ACK_EVENT_ID,
  type RefusalCode,
  type SessionControlState,
  VOICE_ACTIVITY_ACK_EVENT_ID,
  WIRE_VERSION,
} from "@omnitech/active-session-contracts";
import type { FetchLike, FetchResponse } from "../wire-client";

export const FAKE_CREDENTIAL_EXPIRY = "2026-10-03T12:00:00.000Z";
// Well-formed (asc_ plus 43 base64url characters) and obviously not real.
export const FAKE_CREDENTIAL = `asc_${"Z".repeat(43)}`;

export type RecordedRequest = {
  url: string;
  headers: Record<string, string> & { Authorization?: string };
  // The parsed envelope (a JSON body, or the multipart `envelope` part).
  message: {
    kind: string;
    sourceId: string;
    eventId?: string;
    sequence?: number;
    capturing?: boolean;
    content?: { reason?: string; source?: string; requestId?: string };
  } & Record<string, unknown>;
  // Present for a multipart screenshot: the payload part's byte length.
  payloadBytes?: number;
};

export type Reply =
  | Acknowledgement
  | { ack: Acknowledgement; retryAfter: string }
  | "network-error"
  | "not-an-ack";

const control = (state: SessionControlState, capture?: CaptureRequest) => ({
  state,
  credentialExpiresAt: FAKE_CREDENTIAL_EXPIRY,
  ...(capture ? { capture } : {}),
});

export const acceptedAck = (
  request: Pick<RecordedRequest["message"], "kind" | "sourceId" | "eventId">,
  state: SessionControlState = "active",
  capture?: CaptureRequest,
): Acknowledgement => ({
  version: WIRE_VERSION,
  status: "accepted",
  sourceId: request.sourceId,
  eventId:
    request.eventId ??
    (request.kind === "heartbeat"
      ? HEARTBEAT_ACK_EVENT_ID
      : CAPABILITY_ACK_EVENT_ID),
  control: control(state, capture),
});

export const refusedAck = (
  code: RefusalCode,
  state?: SessionControlState,
  capture?: CaptureRequest,
): Acknowledgement => ({
  version: WIRE_VERSION,
  status: "refused",
  code,
  ...(state ? { control: control(state, capture) } : {}),
});

const declaresCaptureRequests = (headers: Record<string, string>) =>
  Object.entries(headers).some(
    ([name, value]) =>
      name.toLowerCase() === COMPANION_FEATURES_HEADER &&
      value.split(/[\s,]+/).includes(COMPANION_FEATURE_CAPTURE_REQUEST),
  );

export type FakeStudio = {
  fetch: FetchLike;
  requests: RecordedRequest[];
  // The control state every acknowledgement reports.
  state: SessionControlState;
  // While true, every request fails at the network.
  down: boolean;
  // The pending capture request every acknowledgement hands over (as Studio
  // does) until a snapshot names its id; that clears it.
  capture?: CaptureRequest | undefined;
  // Ids of requests fulfilled by a snapshot, in order.
  readonly fulfilled: string[];
  // Capture failures reported for the pending request, in order.
  readonly failures: { requestId: string; code: CaptureFailureCode }[];
  // An older Studio: it never hands over a request and (strict) refuses the
  // capture.failure and voice.activity kinds it does not know. Otherwise Studio negotiates: a
  // request is handed over only on a request that declared support for it.
  legacy: boolean;
  // Decides a reply before the default; return undefined to fall through.
  script?:
    | ((request: RecordedRequest, index: number) => Reply | undefined)
    | undefined;
};

export function fakeStudio(): FakeStudio {
  const studio: FakeStudio = {
    requests: [],
    fulfilled: [],
    failures: [],
    legacy: false,
    state: "active",
    down: false,
    fetch: async (url, init) => {
      const body = init.body;
      let envelope: string;
      let payloadBytes: number | undefined;
      if (typeof body === "string") envelope = body;
      else {
        envelope = String(body.get("envelope"));
        const file = body.get("payload");
        if (file instanceof Blob) payloadBytes = file.size;
      }
      const request: RecordedRequest = {
        url,
        headers: init.headers,
        message: JSON.parse(envelope),
        ...(payloadBytes === undefined ? {} : { payloadBytes }),
      };
      const index = studio.requests.push(request) - 1;
      if (studio.down) throw new Error("studio-down");
      // A snapshot naming the pending request's id fulfils it, so its own
      // answer no longer carries the request.
      const requestId = request.message.content?.requestId;
      if (
        request.message.kind === "screen.snapshot" &&
        requestId !== undefined &&
        requestId === studio.capture?.requestId
      ) {
        studio.fulfilled.push(requestId);
        studio.capture = undefined;
      }
      const failure = request.message as unknown as {
        kind: string;
        requestId?: string;
        code?: CaptureFailureCode;
      };
      if (failure.kind === "capture.failure" && !studio.legacy) {
        if (
          failure.requestId !== undefined &&
          failure.requestId === studio.capture?.requestId
        ) {
          studio.failures.push({
            requestId: failure.requestId,
            code: failure.code as CaptureFailureCode,
          });
          studio.capture = undefined;
        }
      }
      const handOver =
        !studio.legacy && declaresCaptureRequests(request.headers)
          ? studio.capture
          : undefined;
      const reply =
        studio.script?.(request, index) ??
        (failure.kind === "capture.failure" && studio.legacy
          ? refusedAck("invalid_observation", studio.state)
          : failure.kind === "capture.failure"
            ? {
                ...acceptedAck(request.message, studio.state),
                eventId: CAPTURE_FAILURE_ACK_EVENT_ID,
              }
            : request.message.kind === "voice.activity"
              ? studio.legacy
                ? refusedAck("invalid_observation", studio.state)
                : {
                    ...acceptedAck(request.message, studio.state),
                    eventId: VOICE_ACTIVITY_ACK_EVENT_ID,
                  }
              : acceptedAck(request.message, studio.state, handOver));
      if (reply === "network-error") throw new Error("network");
      const respond = (json: unknown, retryAfter?: string): FetchResponse => ({
        headers: {
          get: (name) =>
            name.toLowerCase() === "retry-after" ? (retryAfter ?? null) : null,
        },
        json: async () => json,
      });
      if (reply === "not-an-ack") return respond({ error: { code: "x" } });
      return "ack" in reply
        ? respond(reply.ack, reply.retryAfter)
        : respond(reply);
    },
  };
  return studio;
}
