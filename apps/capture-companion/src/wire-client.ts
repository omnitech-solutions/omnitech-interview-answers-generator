// The companion's one network seam. The transport is injected (a fetch-like
// function), the credential rides only in the Authorization header, and every
// message is validated against the shared wire contract before it leaves.
import {
  type Acknowledgement,
  acknowledgementSchema,
  COMPANION_FEATURES_HEADER,
  COMPANION_SCREEN_HEADER,
  CREDENTIAL_TRANSPORT,
  credentialShapeSchema,
  formatCompanionFeatures,
  type IngestMessage,
  isWithinEnvelopeByteLimit,
  validateIngestMessage,
} from "@omnitech/active-session-contracts";
import { CompanionError } from "./errors";

export type FetchInit = {
  method: "POST";
  headers: Record<string, string>;
  body: string | FormData;
};
// The subset of a fetch Response the companion reads.
export type FetchResponse = {
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};
export type FetchLike = (
  url: string,
  init: FetchInit,
) => Promise<FetchResponse>;

export type WireClientOptions = {
  // Studio's address, e.g. https://studio.example.com (no credential, query or
  // userinfo: a credential never belongs in a URL).
  baseUrl: string;
  tenantSlug: string;
  credential: string;
  fetch: FetchLike;
  // The token for the selected screen source, sent with every request.
  screenSelection?: () => string | undefined;
};

export type SendOutcome =
  // Studio answered with a well-formed acknowledgement of any status.
  | { kind: "ack"; ack: Acknowledgement; retryAfterMs?: number }
  // The network failed or Studio's answer was not an acknowledgement; the
  // message was not (provably) delivered, so the caller resends the same ids.
  | { kind: "unreachable" };

export type WireClient = {
  send(message: IngestMessage, payload?: Uint8Array): Promise<SendOutcome>;
};

const TENANT_SLUG = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const MAX_RETRY_AFTER_MS = 5 * 60 * 1000;

function ingestUrl(baseUrl: string, tenantSlug: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new CompanionError("invalid_endpoint");
  }
  // https, or http only for a loopback host (mirrors the Swift Endpoint rule):
  // the bearer credential never travels in clear text to a remote host.
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    parsed.hostname,
  );
  const transportAllowed =
    parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback);
  if (
    !transportAllowed ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new CompanionError("invalid_endpoint");
  }
  if (!TENANT_SLUG.test(tenantSlug)) {
    throw new CompanionError("invalid_tenant_slug");
  }
  const prefix = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${prefix}/api/interview/t/${tenantSlug}/sessions/ingest`;
}

// Retry-After seconds as milliseconds, or undefined when absent or unusable.
function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.round(seconds * 1000));
}

export function createWireClient(options: WireClientOptions): WireClient {
  // [GUARD] Validated once, up front, so a malformed credential fails with a
  // fixed code that never echoes it.
  if (!credentialShapeSchema.safeParse(options.credential).success) {
    throw new CompanionError("credential_malformed");
  }
  const url = ingestUrl(options.baseUrl, options.tenantSlug);
  const authorization = `${CREDENTIAL_TRANSPORT.scheme} ${options.credential}`;

  return {
    async send(message, payload) {
      // [GUARD] Pre-send validation with the shared contract: an invalid
      // message is the companion's bug and must never reach Studio.
      const checked = validateIngestMessage(message);
      const envelope = JSON.stringify(message);
      if (!checked.ok || !isWithinEnvelopeByteLimit(envelope)) {
        throw new CompanionError("invalid_message");
      }
      // [DOMAIN] Negotiation (ADR-0020): every request declares what this
      // companion understands, outside the strict bodies. A Studio that does
      // not know the headers ignores them and never sends capture requests.
      const headers: Record<string, string> = {
        [CREDENTIAL_TRANSPORT.header]: authorization,
        [COMPANION_FEATURES_HEADER]: formatCompanionFeatures(),
      };
      const screen = options.screenSelection?.();
      if (screen !== undefined) headers[COMPANION_SCREEN_HEADER] = screen;
      let body: string | FormData;
      if (message.kind === "screen.snapshot") {
        // [DOMAIN] A screenshot travels as `envelope` (JSON string) plus a
        // `payload` file part, matching Studio's multipart ingest route.
        if (payload?.byteLength !== message.content.byteLength) {
          throw new CompanionError("invalid_message");
        }
        const form = new FormData();
        form.set("envelope", envelope);
        form.set(
          "payload",
          new Blob([payload as BlobPart], { type: message.content.mediaType }),
          "payload",
        );
        body = form;
      } else {
        if (payload !== undefined) throw new CompanionError("invalid_message");
        headers["Content-Type"] = "application/json";
        body = envelope;
      }

      try {
        const response = await options.fetch(url, {
          method: "POST",
          headers,
          body,
        });
        const parsed = acknowledgementSchema.safeParse(await response.json());
        if (!parsed.success) return { kind: "unreachable" };
        const wait = retryAfterMs(response.headers.get("Retry-After"));
        return wait === undefined
          ? { kind: "ack", ack: parsed.data }
          : { kind: "ack", ack: parsed.data, retryAfterMs: wait };
      } catch {
        // [SAFETY] A transport error's message could carry a URL or content;
        // it is never read.
        return { kind: "unreachable" };
      }
    },
  };
}
