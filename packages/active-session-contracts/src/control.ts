import { z } from "zod";
import {
  isoTimestampSchema,
  opaqueIdSchema,
  wireVersionSchema,
} from "./ids.js";
import { observationSchema } from "./observation.js";

export const sessionControlStateSchema = z.enum([
  "active",
  "paused",
  "ended",
  "purging",
]);
export type SessionControlState = z.infer<typeof sessionControlStateSchema>;

// Control reaches the companion only as these fields of acknowledgements and
// refusals; the companion holds no control credential.
export const controlStatusSchema = z.strictObject({
  state: sessionControlStateSchema,
  credentialExpiresAt: isoTimestampSchema,
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

export const ingestMessageSchema = z.union([
  observationSchema,
  heartbeatSchema,
]);
