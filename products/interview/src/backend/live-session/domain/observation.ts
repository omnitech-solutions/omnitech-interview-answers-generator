// What an observation is to ingest and whether it is accepted: reading the
// envelope, the sources it may name, whether a resend is the same message, the
// bounds, and what is stored and told. Pure: no database, no clock, no log.
import { createHash } from "node:crypto";
import {
  detectScreenshotMediaType,
  isWithinEnvelopeByteLimit,
  type Observation,
  type ObservationIssue,
  type RefusalCode,
} from "@omnitech/active-session-contracts";
import {
  OWNER_CAPTURE_SOURCE_ID,
  OWNER_INPUT_SOURCE_ID,
  OWNER_MICROPHONE_SOURCE_ID,
} from "../../db/live-session";
import { canonicalJson } from "../canonical-json";
import type { HeardLine } from "../contracts/events";
import type { IngestLimits, RefusalReason } from "../contracts/ingest";
import { dedupKey, emptyLedger, type ObservationLedger } from "../core/index";
import type { OwnerScope } from "../scope";

// [GUARD] Size and shape first: they disclose nothing about any session. A
// string is measured as sent and then parsed; anything else is measured as it
// would serialise.
export function readEnvelope(
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; code: RefusalCode } {
  let serialized: string;
  if (typeof raw === "string") serialized = raw;
  else {
    try {
      serialized = JSON.stringify(raw) ?? "";
    } catch {
      return { ok: false, code: "invalid_observation" };
    }
  }
  if (!isWithinEnvelopeByteLimit(serialized))
    return { ok: false, code: "envelope_too_large" };
  if (typeof raw !== "string") return { ok: true, value: raw };
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, code: "invalid_observation" };
  }
}

// The refusal a message that failed the wire schema gets.
export const validationRefusal = (
  issues: ObservationIssue[],
): RefusalReason => ({
  code: issues.some((issue) => issue.code === "unsupported_version")
    ? "unsupported_version"
    : "invalid_observation",
  issues,
});

const invalid = (path: ObservationIssue["path"]): RefusalReason => ({
  code: "invalid_observation",
  issues: [{ path, code: "invalid_value" }],
});

// [SAFETY] The owner-input source namespace is reserved (ADR-0016): the
// companion can never pre-claim the dedup key of an owner input, an owner
// capture or the owner's own heard speech.
export const reservedSourceRefusal = (
  observation: Observation,
): RefusalReason | null =>
  observation.sourceId === OWNER_INPUT_SOURCE_ID ||
  observation.sourceId === OWNER_CAPTURE_SOURCE_ID ||
  observation.sourceId === OWNER_MICROPHONE_SOURCE_ID
    ? invalid(["sourceId"])
    : null;

// [SAFETY] The companion cannot broaden the sources fixed at start
// (rule:versioned-wire-contract, ADR-0011): a screenshot needs the screen
// source and a transcript needs an audio source. A transcript that names its
// audio source must name one the session registered at start: microphone text
// never passes as application audio, or the reverse (the label is a source,
// never a verified identity). Refused by path and code only.
export function unpermittedSourceRefusal(
  observation: Observation,
  permitted: readonly string[],
): RefusalReason | null {
  const needed =
    observation.kind === "screen.snapshot"
      ? ["screen"]
      : observation.kind === "transcript.final"
        ? observation.content.source
          ? [observation.content.source]
          : ["microphone", "application-audio"]
        : null;
  if (!needed || needed.some((source) => permitted.includes(source)))
    return null;
  return invalid(
    observation.kind === "transcript.final" && observation.content.source
      ? ["content", "source"]
      : ["kind"],
  );
}

// Whether a stored observation is the same message as the one resent. A
// transcript, disconnect or gap is the same when kind, source sequence and body
// match; occurredAt is a clock stamp a companion may re-take on a resend, so it
// is not compared. A screenshot is compared by body only (its sequence is the
// capture loop's bookkeeping, not what was seen) plus the payload bytes when
// both sides have them.
export function sameObservation(
  stored: { kind: string; content: unknown; payloadSha256: string | null },
  observation: Observation,
  payload: Uint8Array | undefined,
): boolean {
  if (stored.kind !== observation.kind) return false;
  const content = stored.content as {
    sourceSequence?: unknown;
    body?: unknown;
  };
  if (canonicalJson(content.body) !== canonicalJson(observation.content))
    return false;
  if (
    observation.kind !== "screen.snapshot" &&
    content.sourceSequence !== observation.sequence
  )
    return false;
  if (!payload || stored.payloadSha256 === null) return true;
  return (
    createHash("sha256").update(payload).digest("hex") === stored.payloadSha256
  );
}

// [STRATEGY] The core decides dedup and the per-session sequence; the ledger
// handed to it holds only this message's stored acknowledgement and the next
// sequence, which is all the decision needs here.
export function ledgerFor(
  observation: Observation,
  stored: { sequence: number; ack: unknown } | undefined,
  maxSequence: number,
): ObservationLedger {
  return {
    ...emptyLedger(),
    nextSeq: maxSequence + 1,
    acks: stored
      ? {
          [dedupKey(observation.sourceId, observation.eventId)]: {
            seq: Number(stored.sequence),
            ack: stored.ack as never,
          },
        }
      : {},
  };
}

// [SAFETY] The session's cap comes before its rate: one over-limit message is
// refused with a content-free code and NOTHING is stored.
export function volumeRefusal(
  counts: { total: number; recent: number },
  limits: Pick<
    IngestLimits,
    "maxObservationsPerSession" | "maxIngestPerMinute"
  >,
): RefusalReason | null {
  if (counts.total >= limits.maxObservationsPerSession)
    return { code: "limit_reached" };
  if (counts.recent >= limits.maxIngestPerMinute)
    return { code: "rate_limited" };
  return null;
}

type Snapshot = Extract<Observation, { kind: "screen.snapshot" }>;
export type AcceptedScreenshot = { bytes: Uint8Array; mediaType: string };

// A screenshot's own bounds, in order: the session's count, the payload being
// there, its size, its leading bytes, its declared length. The payload is
// accepted by its leading bytes only: SVG, HTML and everything else is refused
// and never decoded (rule:screenshots-as-private-artifacts).
export function checkScreenshot(
  observation: Snapshot,
  payload: Uint8Array | undefined,
  screenshots: number,
  limits: Pick<IngestLimits, "maxScreenshotsPerSession" | "maxScreenshotBytes">,
):
  | { ok: true; screenshot: AcceptedScreenshot }
  | { ok: false; refusal: RefusalReason } {
  const refuse = (refusal: RefusalReason) => ({ ok: false as const, refusal });
  if (screenshots >= limits.maxScreenshotsPerSession)
    return refuse({ code: "limit_reached" });
  if (!payload)
    return refuse({
      code: "invalid_observation",
      issues: [{ path: ["payload"], code: "too_small" }],
    });
  if (
    payload.byteLength > limits.maxScreenshotBytes ||
    observation.content.byteLength > limits.maxScreenshotBytes
  )
    return refuse({ code: "payload_too_large" });
  const detected = detectScreenshotMediaType(payload);
  if (detected === null || detected !== observation.content.mediaType)
    return refuse(invalid(["payload"]));
  if (payload.byteLength !== observation.content.byteLength)
    return refuse(invalid(["content", "byteLength"]));
  return { ok: true, screenshot: { bytes: payload, mediaType: detected } };
}

// What is stored of an observation beside its ids (final transcript text lives
// only here; interim text never reaches ingest).
export const storedContentOf = (observation: Observation) => ({
  occurredAt: observation.occurredAt,
  sourceSequence: observation.sequence,
  body: observation.content,
});

// [SAFETY] The line a listener is told for a transcript this request newly
// stored, with whether its owner allowed processing off the device.
export function heardLineOf(
  observation: Extract<Observation, { kind: "transcript.final" }>,
  session: { scope: OwnerScope; sessionId: string; remote: boolean },
): HeardLine {
  return {
    remote: session.remote,
    text: observation.content.text,
    ...(observation.content.source
      ? { source: observation.content.source }
      : {}),
    occurredAt: observation.occurredAt,
    session: { ...session.scope, sessionId: session.sessionId },
  };
}
