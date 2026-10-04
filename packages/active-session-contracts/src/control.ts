import { z } from "zod";
import {
  isoTimestampSchema,
  opaqueIdSchema,
  wireVersionSchema,
} from "./ids.js";
import {
  type MessageValidation,
  observationSchema,
  validateObservation,
  validateWireMessage,
} from "./observation.js";

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
export const captureRequestSchema = z
  .strictObject({
    requestId: opaqueIdSchema,
    mode: z.enum(CAPTURE_REQUEST_MODES),
    region: captureRegionSchema.optional(),
  })
  .refine((request) => (request.mode === "region") === !!request.region, {
    path: ["region"],
    message: "region iff mode is region",
  });
export type CaptureRequest = z.infer<typeof captureRequestSchema>;

// Control reaches the companion only as these fields of acknowledgements and
// refusals; the companion holds no control credential. `capture` is the one
// pending capture request, present only while it is live (additive: a
// companion that does not know it ignores it).
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

// Content-free heartbeat: lets Studio see resume without any capture content.
export const heartbeatSchema = z.strictObject({
  version: wireVersionSchema,
  kind: z.literal("heartbeat"),
  sourceId: opaqueIdSchema,
  sentAt: isoTimestampSchema,
  capturing: z.boolean(),
});
export type Heartbeat = z.infer<typeof heartbeatSchema>;

// A user's session control action as Studio's own routes accept it; it carries
// no identity because the user's session supplies it.
export const controlMessageSchema = z.strictObject({
  version: wireVersionSchema,
  kind: z.literal("session.control"),
  action: z.enum(["pause", "resume", "end"]),
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

export const ingestMessageSchema = z.union([
  observationSchema,
  heartbeatSchema,
  capabilityReportSchema,
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
  return validateObservation(input);
}
