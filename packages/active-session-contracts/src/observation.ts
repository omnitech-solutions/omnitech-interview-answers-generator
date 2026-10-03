import { z } from "zod";
import {
  captureSourceSchema,
  isoTimestampSchema,
  opaqueIdSchema,
  WIRE_VERSION,
  wireVersionSchema,
} from "./ids.js";
import { ACTIVE_SESSION_LIMITS } from "./limits.js";

// Identity comes only from the session credential (rule:identity-from-credential),
// so an observation never carries any. Every schema is strict, and
// validateObservation also refuses these names explicitly with a clear path.
const IDENTITY_FIELD_NAMES = new Set([
  "tenant",
  "tenantid",
  "user",
  "userid",
  "actor",
  "actorid",
  "session",
  "sessionid",
  "owner",
  "ownerid",
  "account",
  "accountid",
  "member",
  "memberid",
  "organization",
  "organizationid",
  "org",
  "orgid",
  "credential",
  "token",
  "authorization",
]);

const normalizeKey = (key: string) => key.toLowerCase().replace(/[-_]/g, "");
export const isIdentityFieldName = (key: string) =>
  IDENTITY_FIELD_NAMES.has(normalizeKey(key));

const speakerLabelSchema = z
  .string()
  .min(1)
  .max(ACTIVE_SESSION_LIMITS.maxSpeakerLabelChars)
  .regex(/^[A-Za-z0-9 ._-]+$/);

const envelopeFields = {
  version: wireVersionSchema,
  sourceId: opaqueIdSchema,
  // Dedup key together with sourceId (rule:idempotent-observation).
  eventId: opaqueIdSchema,
  occurredAt: isoTimestampSchema,
  // Monotonic per source; Studio orders by it and detects gaps.
  sequence: z.number().int().min(0),
};

export const transcriptFinalSchema = z.strictObject({
  ...envelopeFields,
  kind: z.literal("transcript.final"),
  content: z
    .strictObject({
      // A source label such as "speaker-1" or "microphone"; never a verified identity.
      speaker: speakerLabelSchema,
      // Which captured audio source produced the text. Optional so earlier
      // senders stay valid within wire version 1; a source label, never an
      // identity (the speaker is not verified).
      source: z.enum(["microphone", "application-audio"]).optional(),
      text: z.string().min(1).max(ACTIVE_SESSION_LIMITS.maxTranscriptTextChars),
      startMs: z.number().int().min(0),
      endMs: z.number().int().min(0),
      // An ASR correction names the earlier eventId it replaces.
      supersedes: opaqueIdSchema.optional(),
    })
    .refine((content) => content.endMs >= content.startMs, {
      path: ["endMs"],
      message: "end before start",
    }),
});

export const SCREENSHOT_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const screenSnapshotSchema = z.strictObject({
  ...envelopeFields,
  kind: z.literal("screen.snapshot"),
  content: z.strictObject({
    // The pixels travel as a separate payload; the envelope only references it.
    payloadRef: opaqueIdSchema,
    mediaType: z.enum(SCREENSHOT_MEDIA_TYPES),
    byteLength: z
      .number()
      .int()
      .min(1)
      .max(ACTIVE_SESSION_LIMITS.maxScreenshotBytes),
    windowLabel: z.string().max(ACTIVE_SESSION_LIMITS.maxWindowLabelChars),
  }),
});

export const sourceDisconnectedSchema = z.strictObject({
  ...envelopeFields,
  kind: z.literal("source.disconnected"),
  content: z.strictObject({
    source: captureSourceSchema,
    reason: z.enum([
      "user-stopped",
      "permission-revoked",
      "device-lost",
      "error",
    ]),
  }),
});

export const captureGapSchema = z.strictObject({
  ...envelopeFields,
  kind: z.literal("capture.gap"),
  content: z.strictObject({
    source: captureSourceSchema,
    durationMs: z.number().int().min(0),
    reason: z.enum([
      "buffer-overflow",
      "source-interrupted",
      "paused",
      "error",
    ]),
  }),
});

// There is deliberately no audio kind: raw audio is never persisted and never
// crosses the wire (rule:raw-audio-never-persisted).
export const observationSchema = z.discriminatedUnion("kind", [
  transcriptFinalSchema,
  screenSnapshotSchema,
  sourceDisconnectedSchema,
  captureGapSchema,
]);

export type TranscriptFinal = z.infer<typeof transcriptFinalSchema>;
export type ScreenSnapshot = z.infer<typeof screenSnapshotSchema>;
export type SourceDisconnected = z.infer<typeof sourceDisconnectedSchema>;
export type CaptureGap = z.infer<typeof captureGapSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type ObservationKind = Observation["kind"];

export type ObservationIssueCode =
  | "identity_field_forbidden"
  | "unsupported_version"
  | "unknown_kind"
  | "unknown_field"
  | "invalid_type"
  | "invalid_value"
  | "invalid_format"
  | "too_large"
  | "too_small"
  | "invalid";

// Issues name a path and a stable code only, never a value (rule:id-only-traces).
export type ObservationIssue = {
  path: Array<string | number>;
  code: ObservationIssueCode;
};

export type ObservationValidation =
  | { ok: true; value: Observation }
  | { ok: false; issues: ObservationIssue[] };

const MAX_SCAN_DEPTH = 8;

function findIdentityFields(
  node: unknown,
  path: Array<string | number>,
  issues: ObservationIssue[],
  depth: number,
): void {
  if (depth > MAX_SCAN_DEPTH || typeof node !== "object" || node === null) {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      findIdentityFields(item, [...path, index], issues, depth + 1);
    });
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (isIdentityFieldName(key)) {
      issues.push({ path: [...path, key], code: "identity_field_forbidden" });
    } else {
      findIdentityFields(child, [...path, key], issues, depth + 1);
    }
  }
}

const ZOD_CODES: Record<string, ObservationIssueCode> = {
  invalid_type: "invalid_type",
  unrecognized_keys: "unknown_field",
  too_big: "too_large",
  too_small: "too_small",
  invalid_value: "invalid_value",
  invalid_format: "invalid_format",
  custom: "invalid_value",
};

export type MessageValidation<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ObservationIssue[] };

export const validateObservation = (input: unknown): ObservationValidation =>
  validateWireMessage(observationSchema, input);

// The one validation path for every companion-to-Studio message, so a message
// added to the wire inherits the identity refusal, the version check and the
// content-free issue codes.
export function validateWireMessage<T>(
  schema: z.ZodType<T>,
  input: unknown,
): MessageValidation<T> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ path: [], code: "invalid_type" }] };
  }

  // Identity smuggled anywhere is refused first, with the path of the field.
  const identityIssues: ObservationIssue[] = [];
  findIdentityFields(input, [], identityIssues, 0);
  if (identityIssues.length > 0) return { ok: false, issues: identityIssues };

  const issues: ObservationIssue[] = [];
  if ((input as { version?: unknown }).version !== WIRE_VERSION) {
    issues.push({ path: ["version"], code: "unsupported_version" });
  }
  const parsed = schema.safeParse(input);
  if (parsed.success && issues.length === 0) {
    return { ok: true, value: parsed.data };
  }
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.filter(
        (part): part is string | number => typeof part !== "symbol",
      );
      if (path.length === 1 && path[0] === "version") continue;
      const isKind = path.length === 1 && path[0] === "kind";
      issues.push({
        path,
        code: isKind ? "unknown_kind" : (ZOD_CODES[issue.code] ?? "invalid"),
      });
    }
  }
  return { ok: false, issues };
}

// Serialized envelope size check, applied before parsing untrusted bytes.
export function isWithinEnvelopeByteLimit(serialized: string | Uint8Array) {
  const length =
    typeof serialized === "string"
      ? new TextEncoder().encode(serialized).length
      : serialized.length;
  return length <= ACTIVE_SESSION_LIMITS.maxEnvelopeBytes;
}
