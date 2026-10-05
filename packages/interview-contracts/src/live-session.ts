// The browser-facing contract of the Active Session routes
// (/api/interview/t/:tenantSlug/sessions, ADR-0011 and ADR-0012). The Hono
// routes and the Studio Live view both import it, so the wire shape has one
// definition. It carries no identity: tenant and actor come from the signed-in
// membership, never from a request body or query.
//
// Responses are plain objects (unknown fields are stripped, so the server can
// add a field without breaking an older client); requests are strict.
import { z } from "zod";

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
const ownerInputId = z
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
export const LIVE_OWNER_LANGUAGES = ["typescript", "react"] as const;
export const liveOwnerLanguageSchema = z.enum(LIVE_OWNER_LANGUAGES);
export type LiveOwnerLanguage = z.infer<typeof liveOwnerLanguageSchema>;
export const LIVE_OWNER_LANGUAGE_LABELS: Record<LiveOwnerLanguage, string> = {
  typescript: "TypeScript",
  react: "React",
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

export const liveOwnerInputRequestSchema = z
  .strictObject({
    requestId: ownerInputId,
    ...liveOwnerHintFields,
    operation: z.enum(["analyze", "follow-up", "solve"]),
    // When the input is about an existing task revision the owner can see.
    target: z
      .strictObject({
        taskId: z
          .string()
          .min(1)
          .max(160)
          .regex(/^[A-Za-z0-9._:-]+$/),
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
    // "solve" (generate the solution code): bound to ONE task revision the
    // owner can see, with no free text and no images of its own.
    if (input.operation === "solve") {
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
// a file part `image` and these text fields. The image is stored privately and
// analysed in the same request's `owner.input`.
export const maxOwnerCaptureBytes = 2 * 1024 * 1024;
export const LIVE_OWNER_CAPTURE_MAX_LABEL_CHARS = 80;
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
});
export type LiveOwnerCaptureRequest = z.infer<
  typeof liveOwnerCaptureRequestSchema
>;
export const liveOwnerCaptureResponseSchema = z.object({
  input: liveOwnerInputResponseSchema.shape.input,
  snapshot: z.object({ sourceId: z.string(), eventId: z.string() }),
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
    requestId: ownerInputId,
    mode: liveCaptureModeSchema,
    region: liveCaptureRegionSchema.optional(),
    // The screen selection the region was drawn against (the companion's token,
    // read from the companion capability). A region is bound to it: it is never
    // applied after the source changes. Omitted, Studio binds the region to the
    // selection the companion last declared at submission.
    selection: ownerInputId.optional(),
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

// The screen snapshot observation an action analysed, named by the same
// (sourceId, eventId) pair the stream's observations carry. Ids only.
const liveSourceSnapshotSchema = z.object({
  sourceId: z.string(),
  eventId: z.string(),
});

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
  // Absent on actions recorded before this field, or by a non-agent executor.
  generatedBy: liveGeneratedBySchema.optional(),
  // Context the draft says it could not see; lifted from result.missingContext.
  // Absent or empty means nothing missing or not assessed.
  missingContext: liveMissingContextSchema.optional(),
  // The screenshots the task revision rests on, oldest first; absent for a
  // revision built on speech alone and for rows recorded before this field.
  sourceSnapshots: z.array(liveSourceSnapshotSchema).optional(),
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
