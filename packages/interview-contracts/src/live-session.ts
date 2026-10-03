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
  action: z.enum(["pause", "resume", "end"]),
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

// ---- Stream ---------------------------------------------------------------

export const liveObservationSchema = z.object({
  sequence: z.number().int().nonnegative(),
  sourceId: z.string(),
  eventId: z.string(),
  kind: z.string(),
  receivedAt: isoTime,
  // The wire observation's content (a transcript segment, a screen snapshot
  // reference, a source or gap notice). Render only as inert text.
  content: z.unknown(),
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
  // present only on a succeeded action. Render only as inert text.
  result: z.unknown(),
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
