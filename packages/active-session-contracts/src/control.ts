import { z } from "zod";
import { isoTimestampSchema, opaqueIdSchema, wireVersionSchema } from "./ids";
import {
  type MessageValidation,
  observationSchema,
  validateObservation,
  validateWireMessage,
} from "./observation";

export const sessionControlStateSchema = z.enum([
  "active",
  "paused",
  "ended",
  "purging",
]);
export type SessionControlState = z.infer<typeof sessionControlStateSchema>;

// A one-shot "capture now" request from Studio (ADR-0016 follow-up). It names
// what to capture and nothing else: no source, identity, hint or target. The
// companion honours it only for a screen source the user selected at start.
export const CAPTURE_REQUEST_MODES = [
  "focused-window",
  "region",
  "display",
] as const;
const unitInterval = z.number().min(0).max(1);
// A rectangle normalised to the chosen display: each value in [0, 1], origin
// at the display's top-left, and the rectangle stays inside the display.
export const captureRegionSchema = z
  .strictObject({
    x: unitInterval,
    y: unitInterval,
    width: unitInterval.gt(0),
    height: unitInterval.gt(0),
  })
  .refine(
    (region) => region.x + region.width <= 1 && region.y + region.height <= 1,
    { message: "region outside display" },
  );
export type CaptureRegion = z.infer<typeof captureRegionSchema>;
// Why the companion could not capture, as a closed set of content-free codes
// (ADR-0020). "no-focused-window" never widens to the display; "source-changed"
// means the screen source the request was made against is no longer the one
// selected; "source-gone" means the screen source is not running (paused, lost,
// refused or never selected).
export const CAPTURE_FAILURE_CODES = [
  "no-focused-window",
  "permission-denied",
  "source-gone",
  "source-changed",
  "capture-failed",
] as const;
export const captureFailureCodeSchema = z.enum(CAPTURE_FAILURE_CODES);
export type CaptureFailureCode = z.infer<typeof captureFailureCodeSchema>;

// What the companion receives (ADR-0018, ADR-0020). Emitted only to a companion
// that declared "capture-request.v1" (see negotiation.ts), because this strict
// object is not readable by an older companion.
//   - expiresAt is the request's deadline: the companion captures nothing at or
//     after it (Studio refuses a late frame anyway);
//   - selection binds a region to the screen selection it was drawn against (the
//     companion's own token from x-companion-screen); present exactly when the
//     mode is region, and a companion whose current selection differs reports
//     "source-changed" instead of cropping;
//   - focused-window is sampled when the companion takes the request from an
//     acknowledgement, never later and never from the press that made it.
export const captureRequestSchema = z
  .strictObject({
    requestId: opaqueIdSchema,
    mode: z.enum(CAPTURE_REQUEST_MODES),
    region: captureRegionSchema.optional(),
    selection: opaqueIdSchema.optional(),
    expiresAt: isoTimestampSchema,
  })
  .refine((request) => (request.mode === "region") === !!request.region, {
    path: ["region"],
    message: "region iff mode is region",
  })
  .refine((request) => (request.mode === "region") === !!request.selection, {
    path: ["selection"],
    message: "selection iff mode is region",
  });
export type CaptureRequest = z.infer<typeof captureRequestSchema>;

// Control reaches the companion only as these fields of acknowledgements and
// refusals; the companion holds no control credential. `capture` is the one
// pending capture request, present only while it is live and only on an answer
// to a companion that declared support for it. The object stays strict, so it
// is NOT additive for a reader that does not know the field: negotiation
// (negotiation.ts), not permissiveness, keeps an older companion working.
export const controlStatusSchema = z.strictObject({
  state: sessionControlStateSchema,
  credentialExpiresAt: isoTimestampSchema,
  capture: captureRequestSchema.optional(),
});
export type ControlStatus = z.infer<typeof controlStatusSchema>;

export const acceptedAckSchema = z.strictObject({
  version: wireVersionSchema,
  status: z.literal("accepted"),
  sourceId: opaqueIdSchema,
  eventId: opaqueIdSchema,
  control: controlStatusSchema,
});

// A resend returns the original acknowledgement unchanged.
export const duplicateAckSchema = z.strictObject({
  version: wireVersionSchema,
  status: z.literal("duplicate"),
  original: acceptedAckSchema,
});

// Stable, content-free refusal codes. An unknown, expired or revoked credential
// is one code (rule:credential-strength).
export const REFUSAL_CODES = [
  "credential_refused",
  "session_paused",
  "session_ended",
  "session_purging",
  "invalid_observation",
  "unsupported_version",
  "envelope_too_large",
  "payload_too_large",
  "rate_limited",
  "limit_reached",
  // The same source and event id arrived with different content; the original
  // is kept and never overwritten.
  "event_conflict",
  // A screenshot named a capture request that is expired, replaced, cancelled,
  // failed or unknown. Nothing is stored; a snapshot with no requestId is
  // unaffected (ADR-0020).
  "capture_request_stale",
  // Studio has voice activity switched off (or does not take it for this
  // session): the companion stops sending it for the rest of its run. Nothing
  // else about the session changes.
  "voice_activity_off",
] as const;
export const refusalCodeSchema = z.enum(REFUSAL_CODES);
export type RefusalCode = z.infer<typeof refusalCodeSchema>;

export const refusedAckSchema = z.strictObject({
  version: wireVersionSchema,
  status: z.literal("refused"),
  code: refusalCodeSchema,
  // Absent when the credential itself is refused, so nothing is disclosed.
  control: controlStatusSchema.optional(),
  // Validation paths and codes only, never values.
  issues: z
    .array(
      z.strictObject({
        path: z.array(z.union([z.string(), z.number()])),
        code: z.string(),
      }),
    )
    .max(20)
    .optional(),
});

export const acknowledgementSchema = z.discriminatedUnion("status", [
  acceptedAckSchema,
  duplicateAckSchema,
  refusedAckSchema,
]);
export type Acknowledgement = z.infer<typeof acknowledgementSchema>;

// The companion's own state as codes (never content): what it is doing, each
// selected source's status and a speech failure if any. Optional, so an older
// companion that does not send it is still understood; it exists so Studio can
// log WHY a heartbeat stopped capturing instead of silently pausing.
const diagnosticCode = z.string().regex(/^[A-Za-z0-9_.:-]{1,32}$/);
export const heartbeatDiagnosticsSchema = z.strictObject({
  state: diagnosticCode,
  sources: z
    .record(diagnosticCode, diagnosticCode)
    .refine((sources) => Object.keys(sources).length <= 8, {
      message: "at most eight sources",
    }),
  speechFailure: diagnosticCode.nullable().optional(),
});
export type HeartbeatDiagnostics = z.infer<typeof heartbeatDiagnosticsSchema>;

// Content-free heartbeat: lets Studio see resume without any capture content.
export const heartbeatSchema = z.strictObject({
  version: wireVersionSchema,
  kind: z.literal("heartbeat"),
  sourceId: opaqueIdSchema,
  sentAt: isoTimestampSchema,
  capturing: z.boolean(),
  diagnostics: heartbeatDiagnosticsSchema.optional(),
});
export type Heartbeat = z.infer<typeof heartbeatSchema>;

// A user's session control action as Studio's own routes accept it; it carries
// no identity because the user's session supplies it.
export const controlMessageSchema = z.strictObject({
  version: wireVersionSchema,
  kind: z.literal("session.control"),
  action: z.enum(["pause", "resume", "end", "stop-work"]),
});
export type ControlMessage = z.infer<typeof controlMessageSchema>;

// Fixed acknowledgement event ids for the two content-free message kinds, which
// carry no eventId of their own.
export const HEARTBEAT_ACK_EVENT_ID = "heartbeat";
export const CAPABILITY_ACK_EVENT_ID = "capability";

// The companion's own local readiness: speech support and OS permission states
// only. No recognised text, audio, device names or identity (a locale is a
// language tag, not content).
export const capabilityReportSchema = z.strictObject({
  version: wireVersionSchema,
  kind: z.literal("capability.report"),
  sourceId: opaqueIdSchema,
  sentAt: isoTimestampSchema,
  speech: z.strictObject({
    locale: z
      .string()
      .min(1)
      .max(35)
      .regex(/^[A-Za-z0-9_-]+$/),
    onDeviceAvailable: z.boolean(),
    recognizerAvailable: z.boolean(),
    // Not named "authorization": that key is on the identity-field refusal list.
    authorizationStatus: z.enum([
      "authorized",
      "denied",
      "restricted",
      "not-determined",
    ]),
  }),
  permissions: z.strictObject({
    microphone: z.enum(["granted", "denied", "not-determined"]),
    screen: z.enum(["granted", "denied", "not-determined"]),
  }),
});
export type CapabilityReport = z.infer<typeof capabilityReportSchema>;

// Fixed acknowledgement event id for a capture failure report.
export const CAPTURE_FAILURE_ACK_EVENT_ID = "capture-failure";

// The companion could not capture for one request. Correlated by requestId and
// bounded to a closed code: no message, title or path. Sent only after the
// companion was handed a request, which only a negotiating Studio does.
export const captureFailureSchema = z.strictObject({
  version: wireVersionSchema,
  kind: z.literal("capture.failure"),
  sourceId: opaqueIdSchema,
  sentAt: isoTimestampSchema,
  requestId: opaqueIdSchema,
  code: captureFailureCodeSchema,
});
export type CaptureFailure = z.infer<typeof captureFailureSchema>;

// Fixed acknowledgement event id for a voice-activity report.
export const VOICE_ACTIVITY_ACK_EVENT_ID = "voice-activity";

// The audio sources that can say whether a voice is heard on them: the same
// two a transcript may name. A label of a source, never a verified identity.
export const VOICE_ACTIVITY_SOURCES = [
  "microphone",
  "application-audio",
] as const;
export type VoiceActivitySource = (typeof VOICE_ACTIVITY_SOURCES)[number];

// [DOMAIN] Whether a voice is being heard on one audio source RIGHT NOW. A
// final transcript arrives only when its phrase is over, so text alone cannot
// say that someone is still talking; this can. It is a transient signal, not
// content and not an observation: no event id, no sequence, never stored and
// never resent. The companion repeats `speaking: true` about once a second
// while the voice goes on (a signal that stops arriving lapses in Studio) and
// says `speaking: false` when it stops.
export const voiceActivitySchema = z.strictObject({
  version: wireVersionSchema,
  kind: z.literal("voice.activity"),
  sourceId: opaqueIdSchema,
  sentAt: isoTimestampSchema,
  source: z.enum(VOICE_ACTIVITY_SOURCES),
  speaking: z.boolean(),
});
export type VoiceActivity = z.infer<typeof voiceActivitySchema>;

export const ingestMessageSchema = z.union([
  observationSchema,
  heartbeatSchema,
  capabilityReportSchema,
  captureFailureSchema,
  voiceActivitySchema,
]);
export type IngestMessage = z.infer<typeof ingestMessageSchema>;

// Validates any ingest message with one issue vocabulary. Observation kinds go
// through validateObservation; the content-free kinds share its identity,
// version and code handling.
export function validateIngestMessage(
  input: unknown,
): MessageValidation<IngestMessage> {
  const kind =
    typeof input === "object" && input !== null
      ? (input as { kind?: unknown }).kind
      : undefined;
  if (kind === "heartbeat") return validateWireMessage(heartbeatSchema, input);
  if (kind === "capability.report") {
    return validateWireMessage(capabilityReportSchema, input);
  }
  if (kind === "capture.failure") {
    return validateWireMessage(captureFailureSchema, input);
  }
  if (kind === "voice.activity") {
    return validateWireMessage(voiceActivitySchema, input);
  }
  return validateObservation(input);
}
