// A scripted stand-in for Studio's ingest route: it records every request and
// answers with well-formed acknowledgements, so a companion can be exercised
// with no server. It mirrors the route's behaviour only as far as the
// companion depends on it (acknowledge, refuse, control state, outage).
import {
  type Acknowledgement,
  CAPABILITY_ACK_EVENT_ID,
  HEARTBEAT_ACK_EVENT_ID,
  type RefusalCode,
  type SessionControlState,
  WIRE_VERSION,
} from "@omnitech/active-session-contracts";
import type { FetchLike, FetchResponse } from "../wire-client.js";

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
    content?: { reason?: string; source?: string };
  } & Record<string, unknown>;
  // Present for a multipart screenshot: the payload part's byte length.
  payloadBytes?: number;
};

export type Reply =
  | Acknowledgement
  | { ack: Acknowledgement; retryAfter: string }
  | "network-error"
  | "not-an-ack";

const control = (state: SessionControlState) => ({
  state,
  credentialExpiresAt: FAKE_CREDENTIAL_EXPIRY,
});

export const acceptedAck = (
  request: Pick<RecordedRequest["message"], "kind" | "sourceId" | "eventId">,
  state: SessionControlState = "active",
): Acknowledgement => ({
  version: WIRE_VERSION,
  status: "accepted",
  sourceId: request.sourceId,
  eventId:
    request.eventId ??
    (request.kind === "heartbeat"
      ? HEARTBEAT_ACK_EVENT_ID
      : CAPABILITY_ACK_EVENT_ID),
  control: control(state),
});

export const refusedAck = (
  code: RefusalCode,
  state?: SessionControlState,
): Acknowledgement => ({
  version: WIRE_VERSION,
  status: "refused",
  code,
  ...(state ? { control: control(state) } : {}),
});

export type FakeStudio = {
  fetch: FetchLike;
  requests: RecordedRequest[];
  // The control state every acknowledgement reports.
  state: SessionControlState;
  // While true, every request fails at the network.
  down: boolean;
  // Decides a reply before the default; return undefined to fall through.
  script?:
    | ((request: RecordedRequest, index: number) => Reply | undefined)
    | undefined;
};

export function fakeStudio(): FakeStudio {
  const studio: FakeStudio = {
    requests: [],
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
      const reply =
        studio.script?.(request, index) ??
        acceptedAck(request.message, studio.state);
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
