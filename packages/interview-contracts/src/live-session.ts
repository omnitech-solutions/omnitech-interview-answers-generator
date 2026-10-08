// The browser-facing contract of the Active Session routes
// (/api/interview/t/:tenantSlug/sessions, ADR-0011 and ADR-0012). The Hono
// routes and the Studio Live view both import it, so the wire shape has one
// definition. It carries no identity: tenant and actor come from the signed-in
// membership, never from a request body or query.
//
// Responses are plain objects (unknown fields are stripped, so the server can
// add a field without breaking an older client); requests are strict.
import { z } from "zod";
import { editorLocationSchema } from "./guide";

export const SESSION_LIST_MAX_PAGE = 100;
export const SESSION_LIST_DEFAULT_PAGE = 20;
export const SESSION_STREAM_MAX_PAGE = 500;
export const SESSION_STREAM_DEFAULT_PAGE = 200;

export const liveSessionStatusSchema = z.enum([
  "created",
  "active",
  "paused",
  "purging",
  "ended",
]);
export type LiveSessionStatus = z.infer<typeof liveSessionStatusSchema>;

export const liveRetentionModeSchema = z.enum([
  "delete-at-end",
  "thirty-days",
  "until-deleted",
]);
export type LiveRetentionMode = z.infer<typeof liveRetentionModeSchema>;

export const liveProcessingPolicySchema = z.enum([
  "device-only",
  "permitted-remote",
]);
export type LiveProcessingPolicy = z.infer<typeof liveProcessingPolicySchema>;

// D35: what of a screenshot the owner lets reach a model, a per-session choice.
// always: the image and its on-screen text (the default; sessions recorded
// before the setting read as this). text-only-when-text: the image is withheld
// only when the server judges the on-screen text carries the whole frame (see
// the image gate); any doubt sends the image. never: no image reaches a model;
// the on-screen text still does unless the session is device-only. A
// device-only session sends neither, whatever this says.
export const LIVE_SCREENSHOT_SEND_MODES = [
  "always",
  "text-only-when-text",
  "never",
] as const;
export const liveScreenshotSendSchema = z.enum(LIVE_SCREENSHOT_SEND_MODES);
export type LiveScreenshotSend = z.infer<typeof liveScreenshotSendSchema>;

// What of one screenshot left the device for one revision's model call, as it
// happened at dispatch: the image (with its text when read), its text only, or
// nothing.
export const LIVE_SCREENSHOT_SENT = ["image", "text-only", "none"] as const;
export const liveScreenshotSentSchema = z.enum(LIVE_SCREENSHOT_SENT);
export type LiveScreenshotSent = z.infer<typeof liveScreenshotSentSchema>;

export const liveCaptureSourceSchema = z.enum([
  "microphone",
  "application-audio",
  "screen",
]);
export type LiveCaptureSource = z.infer<typeof liveCaptureSourceSchema>;

const isoTime = z.string().min(1);
const workspaceDraftKeySchema = z.object({
  workspaceId: z.string(),
  artifactId: z.string(),
});

// The full session as its owner reads it. It never carries the credential or
// its hash.
export const liveSessionViewSchema = z.object({
  id: z.uuid(),
  status: liveSessionStatusSchema,
  retention: liveRetentionModeSchema,
  processingPolicy: liveProcessingPolicySchema,
  // D35; absent reads as "always".
  screenshotSend: liveScreenshotSendSchema.optional(),
  createdAt: isoTime,
  // The duration cap: the session ends by itself at this instant.
  expiresAt: isoTime,
  credentialExpiresAt: isoTime.nullable(),
  credentialRevoked: z.boolean(),
  captureSources: z.array(liveCaptureSourceSchema),
  liveAssistance: z.boolean(),
  strict: z.boolean(),
  rehearsalRunId: z.string().nullable(),
  interviewId: z.uuid().nullable(),
  candidacyId: z.uuid().nullable(),
  profile: z.object({ id: z.string(), revision: z.number().int() }).nullable(),
  workspaceDraft: workspaceDraftKeySchema.nullable(),
  // The server's record of the companion's last contact; null means no
  // contact has been recorded, so nothing may claim it is connected.
  lastHeartbeatAt: isoTime.nullable(),
  // The pause in progress (when it began), and the total length of the pauses
  // that are over, so the session clock can leave paused time out. Absent from
  // an older server: nothing was ever paused.
  pausedAt: isoTime.nullable().optional(),
  pausedMs: z.number().int().nonnegative().optional(),
  endedAt: isoTime.nullable(),
  purged: z.boolean(),
  purgeOutcome: z.string().nullable(),
  shownDraftCount: z.number().int().nonnegative(),
});
export type LiveSessionView = z.infer<typeof liveSessionViewSchema>;

// One row of the history list: no transcript, draft or answer content.
export const liveSessionSummarySchema = z.object({
  id: z.uuid(),
  status: liveSessionStatusSchema,
  retention: liveRetentionModeSchema,
  processingPolicy: liveProcessingPolicySchema,
  createdAt: isoTime,
  endedAt: isoTime.nullable(),
  purged: z.boolean(),
  interviewId: z.uuid().nullable(),
  candidacyId: z.uuid().nullable(),
  rehearsal: z.boolean(),
  shownDraftCount: z.number().int().nonnegative(),
});
export type LiveSessionSummary = z.infer<typeof liveSessionSummarySchema>;

// GET .../sessions?limit=&cursor=  (newest first; nextCursor null at the end)
export const liveSessionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(SESSION_LIST_MAX_PAGE).optional(),
  cursor: z.string().min(1).max(512).optional(),
});
export const liveSessionListResponseSchema = z.object({
  sessions: z.array(liveSessionSummarySchema),
  nextCursor: z.string().nullable(),
});
export type LiveSessionListResponse = z.infer<
  typeof liveSessionListResponseSchema
>;

// GET .../sessions/current and /:sessionId, and the body of control, policy,
// retention and delete (202) responses.
export const liveSessionResponseSchema = z.object({
  session: liveSessionViewSchema,
});
export type LiveSessionResponse = z.infer<typeof liveSessionResponseSchema>;

export const liveCredentialSchema = z.object({
  // The plaintext credential: shown once, handed to the companion by the
  // owner, never stored by the browser beyond that moment.
  value: z.string(),
  expiresAt: isoTime,
});
export type LiveCredential = z.infer<typeof liveCredentialSchema>;

// POST .../sessions
export const liveSessionStartRequestSchema = z.strictObject({
  processingPolicy: liveProcessingPolicySchema,
  // D35; omitted: "always".
  screenshotSend: liveScreenshotSendSchema.optional(),
  captureSources: z.array(liveCaptureSourceSchema).min(1).max(3),
  liveAssistance: z.boolean().optional(),
  retention: liveRetentionModeSchema.optional(),
  rehearsal: z
    .strictObject({ runId: z.string().min(1).max(128), strict: z.boolean() })
    .optional(),
  interviewId: z.uuid().optional(),
  candidacyId: z.uuid().optional(),
  profile: z
    .strictObject({
      id: z.string().min(1).max(256),
      revision: z.number().int().min(1).optional(),
    })
    .optional(),
  workspaceDraft: z
    .strictObject({
      workspaceId: z.string().min(1).max(256),
      artifactId: z.string().min(1).max(256),
    })
    .optional(),
  durationMs: z.number().int().min(60_000).optional(),
});
export type LiveSessionStartRequest = z.infer<
  typeof liveSessionStartRequestSchema
>;
export const liveSessionStartResponseSchema = z.object({
  session: liveSessionViewSchema,
  credential: liveCredentialSchema,
});
export type LiveSessionStartResponse = z.infer<
  typeof liveSessionStartResponseSchema
>;

// POST .../sessions/:id/control
export const liveSessionControlRequestSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("session.control"),
  action: z.enum(["pause", "resume", "end", "stop-work"]),
});
export type LiveSessionControlRequest = z.infer<
  typeof liveSessionControlRequestSchema
>;

// POST .../sessions/:id/credential  ->  { credential }
export const liveCredentialRenewResponseSchema = z.object({
  credential: liveCredentialSchema,
});

// POST .../sessions/:id/policy and /retention (tighten and shorten only)
export const liveSessionPolicyRequestSchema = z.strictObject({
  processingPolicy: liveProcessingPolicySchema,
});
// POST .../sessions/:id/screenshot-send  ->  { session } (the owner may change it
// either way at any time; it applies to the next model call).
export const liveSessionScreenshotSendRequestSchema = z.strictObject({
  screenshotSend: liveScreenshotSendSchema,
});
export const liveSessionRetentionRequestSchema = z.strictObject({
  retention: liveRetentionModeSchema,
});

// ---- Owner input ----------------------------------------------------------

// The owner's own request for assistance (Analyze latest capture, or a typed
// follow-up), POSTed to .../sessions/:id/input. It is product-owned: stored
// DB-side only as an `owner.input` observation, never part of the capture wire
// (ADR-0016). Screen evidence is named by exact snapshot observation ids
// (source and event id), never by bytes or paths; the server joins them to the
// owner's session. Dedup is by `requestId`.
export const LIVE_OWNER_INPUT_MAX_TEXT_CHARS = 2_000;
export const LIVE_OWNER_INPUT_MAX_SNAPSHOTS = 4;
const wireId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
// A request id becomes part of a task's id, so it is shorter than a wire id.
// It has no "." because the extra images of a capture are named
// `${requestId}.${n}`: with the dot reserved, no request id can collide with
// another request's extra-image event id.
const ownerInputId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_:-]+$/);
// A capture request's id names no snapshot, so it keeps the wider alphabet.
const captureRequestId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/);

// Owner hints (shared by the typed follow-up and the capture route): a closed
// skill and a closed coding language. Each value maps to one CONSTANT sentence
// in the assist policy; no free text from the owner ever reaches a prompt.
export const LIVE_OWNER_SKILLS = [
  "programming",
  "dsa",
  "system-design",
  "behavioral",
  "data-science",
  "sales-business",
  "presentation",
  "negotiation",
  "devops",
] as const;
export const liveOwnerSkillSchema = z.enum(LIVE_OWNER_SKILLS);
export type LiveOwnerSkill = z.infer<typeof liveOwnerSkillSchema>;
export const LIVE_OWNER_SKILL_LABELS: Record<LiveOwnerSkill, string> = {
  programming: "Programming",
  dsa: "Data Structures & Algorithms",
  "system-design": "System Design",
  behavioral: "Behavioral Interview",
  "data-science": "Data Science",
  "sales-business": "Sales & Business",
  presentation: "Presentation Skills",
  negotiation: "Negotiation",
  devops: "DevOps & Infrastructure",
};
// The ONE definition of what the Active Session coding path supports today:
// the owner hints, the assist stage's coding brief and the coding stage's
// solution all import it, so a language added here is offered, accepted and
// generated everywhere or nowhere.
export const LIVE_OWNER_LANGUAGES = [
  "typescript",
  "react",
  "php",
  "ruby",
] as const;
export const liveOwnerLanguageSchema = z.enum(LIVE_OWNER_LANGUAGES);
export type LiveOwnerLanguage = z.infer<typeof liveOwnerLanguageSchema>;
export const LIVE_OWNER_LANGUAGE_LABELS: Record<LiveOwnerLanguage, string> = {
  typescript: "TypeScript",
  react: "React",
  php: "PHP",
  ruby: "Ruby",
};
// A hint value on the wire: a closed value, or "auto". The owner's hints are
// sticky within a task: the newest input that carries one wins and an input
// that OMITS the hint keeps the earlier one. "auto" is the owner choosing
// automatic detection again, so it RESETS any earlier hint to none (it is
// never itself a hint a prompt sees).
export const LIVE_OWNER_HINT_AUTO = "auto" as const;
export const liveOwnerSkillHintSchema = z.enum([
  ...LIVE_OWNER_SKILLS,
  LIVE_OWNER_HINT_AUTO,
]);
export const liveOwnerLanguageHintSchema = z.enum([
  ...LIVE_OWNER_LANGUAGES,
  LIVE_OWNER_HINT_AUTO,
]);
export type LiveOwnerSkillHint = z.infer<typeof liveOwnerSkillHintSchema>;
export type LiveOwnerLanguageHint = z.infer<typeof liveOwnerLanguageHintSchema>;
// One fragment, spread into both owner request schemas.
export const liveOwnerHintFields = {
  skill: liveOwnerSkillHintSchema.optional(),
  language: liveOwnerLanguageHintSchema.optional(),
};

// A task id is an opaque server-made string; this is the alphabet and length
// every route and request that names one accepts.
export const liveTaskIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const liveOwnerInputRequestSchema = z
  .strictObject({
    requestId: ownerInputId,
    ...liveOwnerHintFields,
    operation: z.enum(["analyze", "follow-up", "solve", "regenerate"]),
    // When the input is about an existing task revision the owner can see.
    target: z
      .strictObject({
        taskId: liveTaskIdSchema,
        revision: z.number().int().min(1).max(1_000_000),
      })
      .optional(),
    text: z.string().min(1).max(LIVE_OWNER_INPUT_MAX_TEXT_CHARS).optional(),
    snapshots: z
      .array(z.strictObject({ sourceId: wireId, eventId: wireId }))
      .max(LIVE_OWNER_INPUT_MAX_SNAPSHOTS),
  })
  .superRefine((input, context) => {
    if (input.operation === "analyze" && input.snapshots.length === 0)
      context.addIssue({ code: "custom", path: ["snapshots"] });
    if (input.operation === "follow-up" && input.text === undefined)
      context.addIssue({ code: "custom", path: ["text"] });
    if (input.operation === "follow-up" && input.snapshots.length > 0)
      context.addIssue({ code: "custom", path: ["snapshots"] });
    // "solve" (generate the solution code) and "regenerate" (a new revision of
    // the same task from the same sources): bound to ONE task revision the
    // owner can see, with no free text and no images of their own.
    if (input.operation === "solve" || input.operation === "regenerate") {
      if (input.target === undefined)
        context.addIssue({ code: "custom", path: ["target"] });
      if (input.text !== undefined)
        context.addIssue({ code: "custom", path: ["text"] });
      if (input.snapshots.length > 0)
        context.addIssue({ code: "custom", path: ["snapshots"] });
    }
  });
export type LiveOwnerInputRequest = z.infer<typeof liveOwnerInputRequestSchema>;

// The constant instruction a "solve" input stands for. No free text from the
// owner ever travels with it.
export const LIVE_OWNER_SOLVE_TEXT =
  "Write the complete solution code for this problem, with usage and tests.";

// Heard speech (ADR-0022): one final phrase the owner's own browser heard through
// the microphone while hands-free Auto is on, sent to the same /input route.
// The server stores it as a transcript segment from the reserved owner
// microphone source, so the processor reads it like any heard speech. Bounded
// text only: no snapshots, no target and no hints.
export const LIVE_HEARD_MAX_TEXT_CHARS = 1_000;
export const liveHeardRequestSchema = z.strictObject({
  requestId: ownerInputId,
  operation: z.literal("heard"),
  text: z.string().min(1).max(LIVE_HEARD_MAX_TEXT_CHARS),
});
export type LiveHeardRequest = z.infer<typeof liveHeardRequestSchema>;
export const liveOwnerInputResponseSchema = z.object({
  input: z.object({
    requestId: z.string(),
    sequence: z.number().int().nonnegative(),
  }),
});

// Capture and analyze: POST .../sessions/:id/capture, multipart/form-data with
// one to LIVE_OWNER_INPUT_MAX_SNAPSHOTS file parts `image` (each up to
// maxOwnerCaptureBytes) and these text fields. The images are stored privately
// and analysed in the same request's one `owner.input`.
export const maxOwnerCaptureBytes = 2 * 1024 * 1024;
// The smallest side, in pixels, of an image the server accepts: a crop below
// it is refused (invalid_input, reason image_dimensions). The crop tool
// enforces the same number.
export const LIVE_OWNER_CAPTURE_MIN_SIDE = 32;
export const LIVE_OWNER_CAPTURE_MAX_LABEL_CHARS = 80;
// On-device text recognition of one image (the client reads it before sending):
// plain text, bounded per image and per request, never trimmed silently beyond
// the cap (a longer one refuses the request). Stored with the screenshot's
// observation and never returned to the browser: only `engine` comes back.
export const LIVE_OCR_ENGINES = ["vision", "tesseract"] as const;
export const LIVE_OCR_LIMITS = {
  maxTextPerImage: 20_000,
  maxTextPerRequest: 60_000,
} as const;
// Where the text sits in the frame, measured by the native recogniser from the
// text boxes on a coarse grid (D35). Numbers only. Evidence for the image gate;
// absent means unknown, and unknown always sends the image.
export const liveOcrMetricsSchema = z.strictObject({
  // Fraction of the frame touched by a text box.
  coverage: z.number().min(0).max(1),
  meanConfidence: z.number().min(0).max(1),
  // Area fraction of the largest rectangle no text box touches.
  largestGap: z.number().min(0).max(1),
  boxes: z.number().int().min(0).max(100_000),
});
export type LiveOcrMetrics = z.infer<typeof liveOcrMetricsSchema>;
export const liveOcrBlockSchema = z.strictObject({
  engine: z.enum(LIVE_OCR_ENGINES),
  text: z.string().max(LIVE_OCR_LIMITS.maxTextPerImage),
  confidence: z.number().min(0).max(1).optional(),
  metrics: liveOcrMetricsSchema.optional(),
});
export type LiveOcrBlock = z.infer<typeof liveOcrBlockSchema>;

// Which display a screenshot was captured on, as the studio host reports it,
// stored with the screenshot's observation. A closed label: never the numeric
// display id (it names hardware across sessions), so a stored screenshot can
// say "Display 2 of 3" without identifying the machine.
export const liveCaptureDisplaySchema = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[^\p{C}]+$/u),
    index: z.number().int().min(1).max(1_000),
    count: z.number().int().min(1).max(1_000),
  })
  .refine((display) => display.index <= display.count);
export type LiveCaptureDisplay = z.infer<typeof liveCaptureDisplaySchema>;

export const liveOwnerCaptureRequestSchema = z.strictObject({
  requestId: ownerInputId,
  operation: z.literal("analyze"),
  targetTaskId: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[A-Za-z0-9._:-]+$/)
    .optional(),
  targetRevision: z.number().int().min(1).max(1_000_000).optional(),
  ...liveOwnerHintFields,
  // Plain text: no control or format characters.
  label: z
    .string()
    .min(1)
    .max(LIVE_OWNER_CAPTURE_MAX_LABEL_CHARS)
    .regex(/^[^\p{C}]+$/u)
    .optional(),
  // One entry per image, in the order the images are sent (null: not read).
  ocr: z
    .array(liveOcrBlockSchema.nullable())
    .max(LIVE_OWNER_INPUT_MAX_SNAPSHOTS)
    .refine(
      (blocks) =>
        blocks.reduce((total, block) => total + (block?.text.length ?? 0), 0) <=
        LIVE_OCR_LIMITS.maxTextPerRequest,
    )
    .optional(),
  // One entry per image, in the order the images are sent (null: unknown).
  display: z
    .array(liveCaptureDisplaySchema.nullable())
    .max(LIVE_OWNER_INPUT_MAX_SNAPSHOTS)
    .optional(),
});
export type LiveOwnerCaptureRequest = z.infer<
  typeof liveOwnerCaptureRequestSchema
>;
// One request may carry up to LIVE_OWNER_INPUT_MAX_SNAPSHOTS `image` parts (a
// task's added context): all or nothing, one `owner.input`, one revision.
// `snapshots` names the stored images in the order sent.
export const liveOwnerCaptureResponseSchema = z.object({
  input: liveOwnerInputResponseSchema.shape.input,
  snapshots: z
    .array(z.object({ sourceId: z.string(), eventId: z.string() }))
    .min(1)
    .max(LIVE_OWNER_INPUT_MAX_SNAPSHOTS),
});
export type LiveOwnerCaptureResponse = z.infer<
  typeof liveOwnerCaptureResponseSchema
>;

// Capture now: POST .../sessions/:id/capture-request asks the native companion
// to capture ONCE (the focused window, a region the owner masked, or the whole
// display) and Studio analyses what comes back. One pending request per
// session; a newer one replaces it; it expires 20 seconds after it is made.
// The region is normalised to the chosen display (each value in [0, 1], origin
// top-left) and is required exactly when the mode is "region".
export const LIVE_CAPTURE_REQUEST_TTL_MS = 20_000;
export const LIVE_CAPTURE_MODES = [
  "focused-window",
  "region",
  "display",
] as const;
export const liveCaptureModeSchema = z.enum(LIVE_CAPTURE_MODES);
export type LiveCaptureMode = z.infer<typeof liveCaptureModeSchema>;
const unit = z.number().min(0).max(1);
export const liveCaptureRegionSchema = z
  .strictObject({
    x: unit,
    y: unit,
    width: unit.gt(0),
    height: unit.gt(0),
  })
  .refine((r) => r.x + r.width <= 1 && r.y + r.height <= 1);
export type LiveCaptureRegion = z.infer<typeof liveCaptureRegionSchema>;
export const liveCaptureRequestSchema = z
  .strictObject({
    requestId: captureRequestId,
    mode: liveCaptureModeSchema,
    region: liveCaptureRegionSchema.optional(),
    // The screen selection the region was drawn against (the companion's token,
    // read from the companion capability). A region is bound to it: it is never
    // applied after the source changes. Omitted, Studio binds the region to the
    // selection the companion last declared at submission.
    selection: captureRequestId.optional(),
    targetTaskId: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .optional(),
    targetRevision: z.number().int().min(1).max(1_000_000).optional(),
    ...liveOwnerHintFields,
  })
  .superRefine((request, context) => {
    if ((request.mode === "region") !== (request.region !== undefined))
      context.addIssue({ code: "custom", path: ["region"] });
    if (request.selection !== undefined && request.mode !== "region")
      context.addIssue({ code: "custom", path: ["selection"] });
    if (
      (request.targetTaskId === undefined) !==
      (request.targetRevision === undefined)
    )
      context.addIssue({ code: "custom", path: ["targetRevision"] });
  });
export type LiveCaptureRequest = z.infer<typeof liveCaptureRequestSchema>;
export const liveCaptureStatusSchema = z.enum([
  "pending",
  "captured",
  "expired",
  // Studio would not ask the companion (see LIVE_CAPTURE_REFUSALS).
  "refused",
  // The companion was asked and reported it could not capture (see
  // LIVE_CAPTURE_FAILURES); reported as soon as it says so, not at expiry.
  "failed",
]);
export type LiveCaptureStatus = z.infer<typeof liveCaptureStatusSchema>;
// Fixed reason codes. Refused: the session cannot send an image to an agent,
// the connected companion build cannot take capture requests (an update is
// needed), or the region was drawn against a screen selection that changed.
// Failed: the companion's own closed failure code.
export const LIVE_CAPTURE_REFUSALS = [
  "vision_device_only",
  "companion_update_required",
  "source_changed",
] as const;
export const LIVE_CAPTURE_FAILURES = [
  "no-focused-window",
  "permission-denied",
  "source-gone",
  "source-changed",
  "capture-failed",
] as const;
// `reason` is a fixed code, present when refused or failed.
export const liveCaptureStateSchema = z.object({
  requestId: z.string(),
  status: liveCaptureStatusSchema,
  expiresAt: isoTime,
  reason: z.string().optional(),
});
export type LiveCaptureState = z.infer<typeof liveCaptureStateSchema>;

// ---- Stream ---------------------------------------------------------------

export const liveObservationSchema = z.object({
  sequence: z.number().int().nonnegative(),
  sourceId: z.string(),
  eventId: z.string(),
  kind: z.string(),
  receivedAt: isoTime,
  // What the server stored for the observation: the companion's own clock and
  // sequence, and the wire content as `body` (a transcript segment, a screen
  // snapshot reference, a source or gap notice). Render `body` only as inert
  // text.
  content: z.object({
    occurredAt: z.string(),
    sourceSequence: z.number().int().nonnegative(),
    body: z.unknown(),
    // On a screenshot whose text was read on the device: which engine read it.
    // The text itself is never sent to the browser.
    ocr: z.object({ engine: z.enum(LIVE_OCR_ENGINES) }).optional(),
    // On an owner capture screenshot: the display it came from (a label only).
    display: liveCaptureDisplaySchema.optional(),
  }),
  screenshotArtifactId: z.string().nullable(),
});
export type LiveObservation = z.infer<typeof liveObservationSchema>;

export const liveActionDispatchStatusSchema = z.enum([
  "in_flight",
  "succeeded",
  "failed",
  "suppressed",
]);
export type LiveActionDispatchStatus = z.infer<
  typeof liveActionDispatchStatusSchema
>;

// The result of a suppressed action whose draft verification withheld: a
// content-free record (a count and violation codes, never claim text, quotes or
// ids). Parse `result` with this when suppressionReason is "invalid_output".
export const liveWithheldResultSchema = z.object({
  withheld: z.object({
    rejectedClaimCount: z.number().int().nonnegative(),
    codes: z.array(z.string()),
  }),
});
export type LiveWithheldResult = z.infer<typeof liveWithheldResultSchema>;

// Which runtime and model generated an action's result (for example "claude"
// and "claude-sonnet-5-5"). Display metadata copied from the executor's own
// profile: never user input, never content, and never a reason to branch.
export const liveGeneratedBySchema = z.object({
  runtime: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
});
export type LiveGeneratedBy = z.infer<typeof liveGeneratedBySchema>;

// What the model believes a screen-based draft could not see (for example the
// constraints were cut off), so the app can ask the person for it. Display
// metadata only: a closed kind plus an optional short plain-text note, never a
// quote of the screen or of private content, and nothing branches on it.
export const LIVE_MISSING_CONTEXT_KINDS = [
  "constraints",
  "examples",
  "signature",
  "language",
  "statement-cut-off",
  "other",
] as const;
export const LIVE_MISSING_CONTEXT_MAX_ITEMS = 4;
export const LIVE_MISSING_CONTEXT_MAX_NOTE = 120;
// Plain text: no control or format characters (bidi, zero width, line breaks).
export const MISSING_CONTEXT_NOTE_FORBIDDEN =
  /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u061c\u115f\u1160\u180e\u3164\uffa0]/u;
export const liveMissingContextItemSchema = z.strictObject({
  kind: z.enum(LIVE_MISSING_CONTEXT_KINDS),
  note: z
    .string()
    .min(1)
    .max(LIVE_MISSING_CONTEXT_MAX_NOTE)
    .refine((note) => !MISSING_CONTEXT_NOTE_FORBIDDEN.test(note))
    .optional(),
});
export const liveMissingContextSchema = z
  .array(liveMissingContextItemSchema)
  .max(LIVE_MISSING_CONTEXT_MAX_ITEMS)
  .refine(
    (items) => new Set(items.map((item) => item.kind)).size === items.length,
  );
export type LiveMissingContextItem = z.infer<
  typeof liveMissingContextItemSchema
>;
export type LiveMissingContext = readonly LiveMissingContextItem[];

// What a stored solve-code result keeps of the runner's report, bounded. The
// message and diagnostics are about generated code (the same content class as
// the code itself): stored and shown, never logged. stdout, stderr and per-test
// durations are not stored at all.
export const LIVE_CODE_LIMITS = {
  tests: 50,
  testName: 200,
  testMessage: 300,
  diagnostics: 20,
  diagnosticMessage: 200,
} as const;
export const liveCodeTestSchema = z.object({
  name: z.string().max(LIVE_CODE_LIMITS.testName),
  status: z.enum(["passed", "failed", "skipped"]),
  message: z.string().max(LIVE_CODE_LIMITS.testMessage).optional(),
  location: editorLocationSchema.optional(),
});
export type LiveCodeTest = z.infer<typeof liveCodeTestSchema>;
export const liveCodeDiagnosticSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
  message: z.string().max(LIVE_CODE_LIMITS.diagnosticMessage),
});
export type LiveCodeDiagnostic = z.infer<typeof liveCodeDiagnosticSchema>;

// The screen snapshot observation an action analysed, named by the same
// (sourceId, eventId) pair the stream's observations carry. Ids only.
const liveSourceSnapshotSchema = z.object({
  sourceId: z.string(),
  eventId: z.string(),
});

// Why a task revision exists when the owner's own input made it: a plain
// re-run, or a screenshot added to the task. Absent for every other revision.
export const LIVE_REVISION_REASONS = [
  "regenerate",
  "added-screenshot",
] as const;
export const liveRevisionReasonSchema = z.enum(LIVE_REVISION_REASONS);
export type LiveRevisionReason = z.infer<typeof liveRevisionReasonSchema>;

export const liveActionSchema = z.object({
  id: z.uuid(),
  taskId: z.string(),
  taskRevision: z.number().int().nonnegative(),
  // "draft-answer" | "solve-code" | "agent-solve" today; a string so a new
  // kind never breaks an older client.
  actionKind: z.string(),
  dispatchStatus: liveActionDispatchStatusSchema,
  attempt: z.number().int().min(1),
  fenceAtDispatch: z.number().int().nonnegative(),
  jobId: z.uuid().nullable(),
  jobCreated: z.boolean(),
  // The published result (a structured draft or solution): session content,
  // present on a succeeded action. A suppressed action whose draft was
  // withheld carries only { withheld } (liveWithheldResultSchema), no content.
  // Render only as inert text.
  result: z.unknown(),
  // The draft's text so far while the action is in flight (streamed from the
  // model); absent once it is settled. Render only as inert text.
  progress: z.object({ draft: z.string().max(20_000) }).optional(),
  // Absent on actions recorded before this field, or by a non-agent executor.
  generatedBy: liveGeneratedBySchema.optional(),
  // Context the draft says it could not see; lifted from result.missingContext.
  // Absent or empty means nothing missing or not assessed.
  missingContext: liveMissingContextSchema.optional(),
  // D36: the result says the capture showed no interview question (derived
  // from the stored category). Absent otherwise; such an action is not a task.
  noQuestion: z.literal(true).optional(),
  // D35: what of each screenshot the revision's model call carried, by the
  // session's S{n} ordinal, as it happened at dispatch. Absent on a revision
  // built without screenshots, on a failed one, and on rows recorded before this.
  screenshotsSent: z
    .array(
      z.object({
        ordinal: z.number().int().min(1),
        sent: liveScreenshotSentSchema,
      }),
    )
    .optional(),
  // The screenshots the task revision rests on, oldest first; absent for a
  // revision built on speech alone and for rows recorded before this field.
  sourceSnapshots: z.array(liveSourceSnapshotSchema).optional(),
  revisionReason: liveRevisionReasonSchema.optional(),
  shown: z.boolean(),
  suppressionReason: z.string().nullable(),
  createdAt: isoTime,
  // Set on every status change, so a changed action is read again.
  updatedAt: isoTime,
});
export type LiveAction = z.infer<typeof liveActionSchema>;

// GET .../sessions/:id/stream?afterSequence=&limit=&actionCursor=
//
// Observations page by sequence (afterSequence, ascending). Actions page by an
// opaque keyset cursor over (updatedAt, id): every action CREATED OR CHANGED
// after the cursor is returned, oldest change first, so a row that settles
// later is read again. Pass nextActionCursor back as actionCursor; omit it for
// the first read. An action can appear more than once across reads (a
// re-read after a change, and a short overlap when caught up), so merge by
// action id and let the newest updatedAt win. When hasMoreObservations or
// hasMoreActions is true, read again at once; otherwise poll.
export const liveStreamQuerySchema = z.object({
  afterSequence: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(SESSION_STREAM_MAX_PAGE).optional(),
  actionCursor: z.string().min(1).max(512).optional(),
});
export const liveStreamResponseSchema = z.object({
  session: liveSessionViewSchema,
  observations: z.array(liveObservationSchema),
  actions: z.array(liveActionSchema),
  nextAfterSequence: z.number().int().nonnegative(),
  nextActionCursor: z.string(),
  hasMoreObservations: z.boolean(),
  hasMoreActions: z.boolean(),
  // The database clock when the page was read. Elapsed time is serverNow minus
  // a server timestamp, never the browser's own clock.
  serverNow: isoTime,
});
export type LiveStreamResponse = z.infer<typeof liveStreamResponseSchema>;

// GET .../sessions/:id/tasks/:taskId/screenshots: the screenshots a task's
// revisions rest on, oldest first, as ids, ordinals and times only. Fetch an
// image through the existing screenshot route with its artifactId.
const liveTaskScreenshotSchema = z.object({
  // The session's S{n}: rank among its screen.snapshot observations.
  ordinal: z.number().int().min(1),
  sourceId: z.string(),
  eventId: z.string(),
  sequence: z.number().int().nonnegative(),
  capturedAt: isoTime,
  // null once the image is purged or withheld.
  artifactId: z.string().nullable(),
  // Which engine read the screenshot's text on the device; null: not read. The
  // text is never returned.
  ocrEngine: z.enum(LIVE_OCR_ENGINES).nullable(),
  // The display the screenshot was captured on; null or absent: not recorded.
  display: liveCaptureDisplaySchema.nullable().optional(),
  // The task revisions this screenshot fed, ascending.
  revisions: z.array(z.number().int().min(1)).min(1),
  // D35: what left the device for this screenshot, per revision whose call
  // finished (ascending); a revision with no entry has no record.
  sentByRevision: z
    .array(
      z.object({
        revision: z.number().int().min(1),
        sent: liveScreenshotSentSchema,
      }),
    )
    .optional(),
});
export const liveTaskScreenshotsResponseSchema = z.object({
  taskId: z.string(),
  screenshots: z.array(liveTaskScreenshotSchema),
});
export type LiveTaskScreenshotsResponse = z.infer<
  typeof liveTaskScreenshotsResponseSchema
>;

// ---- Setup choices --------------------------------------------------------

// GET .../sessions/choices: what the setup screen needs and nothing else.
export const liveInterviewChoiceSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  kind: z.string(),
  scheduledAt: isoTime.nullable(),
});
export const liveCandidacyChoiceSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  companyName: z.string(),
  createdAt: isoTime,
  // Whether the candidacy carries a job description and an AI-cleaned employer
  // brief (presence only; the text stays server-side). Absent: older server.
  hasJobSpec: z.boolean().optional(),
  hasBrief: z.boolean().optional(),
  // An interview is agreed only through its candidacy, so start sends both ids.
  interviews: z.array(liveInterviewChoiceSchema),
});
export const liveProfileChoiceSchema = z.object({
  profileId: z.string(),
  name: z.string(),
  revision: z.number().int().min(1),
  createdAt: isoTime,
  // The number of roles in the approved matrix revision; never its text.
  entryCount: z.number().int().nonnegative(),
  // True for the revision a start with no explicit revision would pin.
  latest: z.boolean(),
});
export const liveSessionChoicesResponseSchema = z.object({
  candidacies: z.array(liveCandidacyChoiceSchema),
  // Newest first.
  profiles: z.array(liveProfileChoiceSchema),
});
export type LiveSessionChoicesResponse = z.infer<
  typeof liveSessionChoicesResponseSchema
>;

// ---- Employer brief ----------------------------------------------------------

// The job spec and notes of a candidacy, cleaned by the model into a compact
// form the live session reads as employer material (never as evidence about the
// candidate). Every line is short; the whole brief is bounded.
const briefLine = z.string().trim().min(1).max(240);
export const employerBriefSchema = z.strictObject({
  company: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(200),
  // What the company is, in facts the candidate can say: what it does and for
  // whom, how it describes itself, recognition with years, scale, products.
  companyFacts: z.array(briefLine).max(10).optional(),
  summary: z.string().trim().max(600),
  mustHaves: z.array(briefLine).max(12),
  niceToHaves: z.array(briefLine).max(12),
  techStack: z.array(briefLine).max(24),
  responsibilities: z.array(briefLine).max(12),
  team: z.string().trim().max(400).optional(),
  values: z.array(briefLine).max(8),
  interviewFormat: z.string().trim().max(400).optional(),
  questionsToAsk: z.array(briefLine).max(8),
});
export type EmployerBrief = z.infer<typeof employerBriefSchema>;

// GET/PATCH .../documents/candidacies/:id/context: what the native panel edits.
export const candidacyContextSchema = z.object({
  id: z.uuid(),
  companyName: z.string(),
  title: z.string(),
  jobDescription: z.string().nullable(),
  notes: z.string().nullable(),
  brief: employerBriefSchema.nullable(),
});
export type CandidacyContext = z.infer<typeof candidacyContextSchema>;

// ---- Companion capability ---------------------------------------------------

// GET .../sessions/companion-capability: the capture companion's latest
// self-reported readiness for the signed-in member (speech support and OS
// permission states). Content-free: a locale is a language tag, never speech.
// `capability` is null until the companion has reported once; Studio then
// shows no blocker. It is the member's own row, so another member of the same
// workspace never reads it.
export const liveCompanionCapabilitySchema = z.object({
  reportedAt: isoTime,
  speech: z.object({
    locale: z.string().min(1).max(35),
    onDeviceAvailable: z.boolean(),
    recognizerAvailable: z.boolean(),
    authorizationStatus: z.enum([
      "authorized",
      "denied",
      "restricted",
      "not-determined",
    ]),
  }),
  permissions: z.object({
    microphone: z.enum(["granted", "denied", "not-determined"]),
    screen: z.enum(["granted", "denied", "not-determined"]),
  }),
  // Whether the companion declared it can take capture requests (false: an
  // older build; a request is refused with companion_update_required).
  captureRequests: z.boolean().optional(),
  // The companion's token for its selected screen source, when it declared one:
  // the value a region request is bound to.
  screenSelection: z.string().min(1).max(128).optional(),
});
export type LiveCompanionCapability = z.infer<
  typeof liveCompanionCapabilitySchema
>;
export const liveCompanionCapabilityResponseSchema = z.object({
  capability: liveCompanionCapabilitySchema.nullable(),
});
export type LiveCompanionCapabilityResponse = z.infer<
  typeof liveCompanionCapabilityResponseSchema
>;

// ---- Errors ---------------------------------------------------------------

// The closed set of browser-visible error codes. A body is always exactly
// { error: { code } }: no message, id or content rides along.
export const LIVE_SESSION_ERROR_CODES = [
  "not_found",
  "invalid_input",
  "link_refused",
  "open_session_exists",
  "status_refused",
  "loosening_refused",
  "retention_lengthening_refused",
  "credential_renewal_required",
  "duration_cap_reached",
  "job_cancellation_failed",
  "job_creation_refused",
  "purge_incomplete",
  "unauthorized",
  "origin_forbidden",
  "body_too_large",
  "session_unavailable",
] as const;
export const liveSessionErrorCodeSchema = z.enum(LIVE_SESSION_ERROR_CODES);
export type LiveSessionErrorCode = z.infer<typeof liveSessionErrorCodeSchema>;
export const liveSessionErrorBodySchema = z.object({
  error: z.object({ code: liveSessionErrorCodeSchema }),
});
export type LiveSessionErrorBody = z.infer<typeof liveSessionErrorBodySchema>;

// The HTTP status each code answers with (the routes use this table).
export const LIVE_SESSION_ERROR_STATUS = {
  not_found: 404,
  invalid_input: 400,
  link_refused: 422,
  open_session_exists: 409,
  status_refused: 409,
  loosening_refused: 409,
  retention_lengthening_refused: 409,
  credential_renewal_required: 409,
  duration_cap_reached: 409,
  job_cancellation_failed: 503,
  job_creation_refused: 409,
  purge_incomplete: 500,
  unauthorized: 401,
  origin_forbidden: 403,
  body_too_large: 413,
  session_unavailable: 500,
} as const satisfies Record<LiveSessionErrorCode, number>;
