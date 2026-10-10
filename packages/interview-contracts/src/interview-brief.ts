import { z } from "zod";

// [DOMAIN] The interview brief (BRIEF-interview-brief-and-context-pack,
// section 3): everything a person has for ONE application. The application
// itself (company, role, posting), what the employer said (dated entries),
// what the person found out (research documents), and, for each STAGE, who
// they meet, what they prepared, what was actually said (transcripts) and how
// it went (outcome). These are the shapes the routes under
// /api/interview/documents/candidacies/:id/… read and write.
//
// [SAFETY] Every size is bounded here, at the contract: nothing larger is
// parsed, stored or handed to a reader.
export const INTERVIEW_BRIEF_BOUNDS = {
  stages: 12,
  peoplePerStage: 12,
  transcriptsPerStage: 8,
  employerSaidEntries: 100,
  researchDocuments: 40,
  nameChars: 200,
  labelChars: 120,
  // The same bound the application's notes have always had.
  notesChars: 20_000,
  outcomeChars: 4_000,
  nextStepsChars: 2_000,
  // A transcript is large: an hour of speech is about 60,000 characters, so
  // this is some sixteen hours. Its upload is one bounded request (4 MiB,
  // every character of the bound in UTF-8), neither streamed nor chunked.
  transcriptChars: 1_000_000,
  transcriptUploadBytes: 4 * 1024 * 1024,
  employerSaidChars: 8_000,
  researchChars: 200_000,
  researchUploadBytes: 1024 * 1024,
  originChars: 2_048,
} as const;
const BOUNDS = INTERVIEW_BRIEF_BOUNDS;

export const INTERVIEW_STAGE_KINDS = [
  "recruiter_screen",
  "hiring_manager",
  "technical",
  "system_design",
  "take_home",
  "panel",
  "final",
  "other",
] as const;
export const INTERVIEW_STAGE_FORMATS = ["video", "phone", "onsite"] as const;
export const INTERVIEW_STAGE_STATUSES = [
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
] as const;
// Who a person is in a stage. The candidate is the member, never listed.
export const STAGE_PERSON_ROLES = [
  "interviewer",
  "recruiter",
  "hiring_manager",
  "coordinator",
  "observer",
] as const;
// Where a transcript came from: the Studio's own "Record transcript", a file
// the person uploaded, or text they pasted.
export const TRANSCRIPT_ORIGINS = ["recorded", "uploaded", "pasted"] as const;
// The capture policy a transcript was taken under (the live session's two).
export const TRANSCRIPT_POLICIES = ["device-only", "permitted-remote"] as const;
export const EMPLOYER_SAID_CHANNELS = [
  "email",
  "call",
  "message",
  "other",
] as const;
export const RESEARCH_ORIGINS = ["url", "file", "pasted"] as const;
// A research document belongs to the company (every application to it reads
// it) or to this one application.
export const RESEARCH_SCOPES = ["company", "application"] as const;
// The company's old single research text, offered as one document until the
// person keeps it: it has no row of its own yet, so this stands for its id.
export const CARRIED_RESEARCH_ID = "carried-company-research";

export type TranscriptPolicy = (typeof TRANSCRIPT_POLICIES)[number];

// [SAFETY] The one rule on what may be sent to a model that does not run on
// this machine: a transcript taken under a device-only policy never is.
// Everything else in a brief was typed or imported by the person for the
// purpose of being read. Whoever sends a source asks this first.
export function mayLeaveDevice(source: {
  capturePolicy?: TranscriptPolicy | null | undefined;
}): boolean {
  return source.capturePolicy !== "device-only";
}

const isoTime = z.iso.datetime({ offset: true });
// A calendar day, "2026-10-02". A pattern and a check, not a named format:
// the briefing pack's schema is also compiled as JSON Schema by a validator
// that knows no "date" format.
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const line = (max: number) => z.string().trim().min(1).max(max);
// Text a person typed or imported: kept as it is, only bounded.
const body = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim() !== "");

// ---- People ---------------------------------------------------------------

export const stagePersonSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  title: z.string().nullable(),
  role: z.enum(STAGE_PERSON_ROLES),
});
export const stagePersonInputSchema = z.strictObject({
  name: line(BOUNDS.nameChars),
  title: line(BOUNDS.nameChars).optional(),
  role: z.enum(STAGE_PERSON_ROLES).optional(),
});
export type StagePerson = z.infer<typeof stagePersonSchema>;
export type StagePersonInput = z.infer<typeof stagePersonInputSchema>;

// ---- Transcripts ----------------------------------------------------------

// What a list shows: never the words.
export const stageTranscriptSchema = z.object({
  id: z.uuid(),
  stageId: z.uuid(),
  title: z.string(),
  origin: z.enum(TRANSCRIPT_ORIGINS),
  // The file it was read from (an upload's name, a recording's file).
  originName: z.string().nullable(),
  capturePolicy: z.enum(TRANSCRIPT_POLICIES),
  // mayLeaveDevice of its policy, stated so no reader has to work it out.
  sendable: z.boolean(),
  // When the conversation took place, when known.
  occurredAt: isoTime.nullable(),
  chars: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative(),
  sha256,
  createdAt: isoTime,
  updatedAt: isoTime,
});
export const transcriptTurnSchema = z.object({
  // The speaker's label as the transcript gives it; "" when it names none.
  speaker: z.string(),
  text: z.string(),
  // Milliseconds on the transcript's own clock.
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});
export const stageTranscriptDetailSchema = stageTranscriptSchema.extend({
  text: z.string(),
  spoken: z.array(transcriptTurnSchema),
});
const transcriptTitle = line(BOUNDS.nameChars);
export const transcriptPasteSchema = z.strictObject({
  title: transcriptTitle.optional(),
  text: body(BOUNDS.transcriptChars),
  occurredAt: isoTime.optional(),
  // Absent: it stays on this device.
  capturePolicy: z.enum(TRANSCRIPT_POLICIES).optional(),
});
// "Attach the transcript I just recorded": one of the Studio's own recordings,
// by the file name the recordings list gave.
export const transcriptAttachSchema = z.strictObject({
  file: z.string().regex(/^[0-9T-]{10,40}-[0-9a-f]{8}\.txt$/),
  title: transcriptTitle.optional(),
});
export const transcriptUpdateSchema = z.strictObject({
  title: transcriptTitle.optional(),
  occurredAt: isoTime.nullable().optional(),
  capturePolicy: z.enum(TRANSCRIPT_POLICIES).optional(),
});
export const stageRecordingSchema = z.object({
  file: z.string(),
  startedAt: isoTime,
  bytes: z.number().int().nonnegative(),
  // The policy of the session it was recorded in.
  capturePolicy: z.enum(TRANSCRIPT_POLICIES),
  // Already attached to a stage of this application.
  attached: z.boolean(),
});
export const stageRecordingsResponseSchema = z.object({
  recordings: z.array(stageRecordingSchema),
});
export type StageTranscript = z.infer<typeof stageTranscriptSchema>;
export type StageTranscriptDetail = z.infer<typeof stageTranscriptDetailSchema>;
export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;
export type StageRecording = z.infer<typeof stageRecordingSchema>;

// ---- Stages ---------------------------------------------------------------

export const interviewStageSchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int().min(1),
  kind: z.enum(INTERVIEW_STAGE_KINDS),
  label: z.string(),
  scheduledAt: isoTime.nullable(),
  durationMinutes: z.number().int().nullable(),
  format: z.enum(INTERVIEW_STAGE_FORMATS).nullable(),
  status: z.enum(INTERVIEW_STAGE_STATUSES),
  // The person's own preparation for this stage.
  notes: z.string().nullable(),
  // The application's old notes, offered to the first stage while it has none
  // of its own and until the person moves them. Null everywhere else.
  offeredNotes: z.string().nullable(),
  // What happened, and what comes next.
  outcome: z.string().nullable(),
  nextSteps: z.string().nullable(),
  people: z.array(stagePersonSchema),
  transcripts: z.array(stageTranscriptSchema),
});
export const stageCreateSchema = z.strictObject({
  kind: z.enum(INTERVIEW_STAGE_KINDS),
  label: line(BOUNDS.labelChars),
});
const cleared = (max: number) => z.string().max(max).nullable().optional();
export const stageUpdateSchema = z.strictObject({
  kind: z.enum(INTERVIEW_STAGE_KINDS).optional(),
  label: line(BOUNDS.labelChars).optional(),
  scheduledAt: isoTime.nullable().optional(),
  durationMinutes: z.number().int().min(5).max(480).nullable().optional(),
  format: z.enum(INTERVIEW_STAGE_FORMATS).nullable().optional(),
  status: z.enum(INTERVIEW_STAGE_STATUSES).optional(),
  // A blank text clears the field, as null does.
  notes: cleared(BOUNDS.notesChars),
  outcome: cleared(BOUNDS.outcomeChars),
  nextSteps: cleared(BOUNDS.nextStepsChars),
  // The stage's people, whole: who is not listed is no longer in the stage.
  people: z.array(stagePersonInputSchema).max(BOUNDS.peoplePerStage).optional(),
});
// Every stage of the application, in the order wanted.
export const stageOrderSchema = z.strictObject({
  order: z.array(z.uuid()).min(1).max(BOUNDS.stages),
});
export type InterviewStage = z.infer<typeof interviewStageSchema>;
export type StageCreate = z.infer<typeof stageCreateSchema>;
export type StageUpdate = z.infer<typeof stageUpdateSchema>;

// ---- Employer said --------------------------------------------------------

// One thing the employer or a recruiter told the person. The fields a person
// fills in, as the Interview form and the Briefings form both keep them.
export const employerSaidInputSchema = z.strictObject({
  said: body(BOUNDS.employerSaidChars),
  // Who said it ("Sam, recruiter").
  saidBy: line(BOUNDS.nameChars).optional(),
  // How: an email, a call, a message.
  channel: z.enum(EMPLOYER_SAID_CHANNELS).optional(),
  // The day it was said; absent for an entry with no date (the old single
  // "employer notes" text is carried over as one of these).
  saidOn: day.optional(),
});
export const employerSaidUpdateSchema = z.strictObject({
  said: body(BOUNDS.employerSaidChars).optional(),
  saidBy: line(BOUNDS.nameChars).nullable().optional(),
  channel: z.enum(EMPLOYER_SAID_CHANNELS).nullable().optional(),
  saidOn: day.nullable().optional(),
});
export const employerSaidEntrySchema = z.object({
  id: z.uuid(),
  said: z.string(),
  saidBy: z.string().nullable(),
  channel: z.enum(EMPLOYER_SAID_CHANNELS).nullable(),
  saidOn: day.nullable(),
  sha256,
  createdAt: isoTime,
  updatedAt: isoTime,
});
export type EmployerSaidInput = z.infer<typeof employerSaidInputSchema>;
export type EmployerSaidEntry = z.infer<typeof employerSaidEntrySchema>;

// One entry as a line of text a reader is given: when, who and how lead what
// was said ("2026-10-02, Sam (email): no AI assistants in live rounds").
export function employerSaidLine(entry: {
  said: string;
  saidBy?: string | null | undefined;
  channel?: string | null | undefined;
  saidOn?: string | null | undefined;
}): string {
  const who = [entry.saidBy, entry.channel ? `(${entry.channel})` : ""]
    .filter(Boolean)
    .join(" ");
  const lead = [entry.saidOn, who].filter(Boolean).join(", ");
  return lead ? `${lead}: ${entry.said.trim()}` : entry.said.trim();
}

// ---- Research -------------------------------------------------------------

export const researchDocumentSchema = z.object({
  // A document's id, or CARRIED_RESEARCH_ID for the company's old text.
  id: z.string(),
  scope: z.enum(RESEARCH_SCOPES),
  title: z.string(),
  origin: z.enum(RESEARCH_ORIGINS),
  // The URL it was read from, or the file's name; null when pasted.
  originRef: z.string().nullable(),
  chars: z.number().int().nonnegative(),
  sha256,
  // True for the company's old single research text, not yet kept.
  carried: z.boolean(),
  createdAt: isoTime.nullable(),
  updatedAt: isoTime.nullable(),
});
export const researchDocumentDetailSchema = researchDocumentSchema.extend({
  text: z.string(),
});
const researchTitle = line(BOUNDS.nameChars);
export const researchCreateSchema = z
  .strictObject({
    scope: z.enum(RESEARCH_SCOPES).optional(),
    title: researchTitle,
    // A pasted page, or the text of a link (the URL says where it is from;
    // nothing is fetched). A file goes through the upload route.
    origin: z.enum(["pasted", "url"]).optional(),
    originRef: z.url().max(BOUNDS.originChars).optional(),
    text: body(BOUNDS.researchChars),
  })
  .refine((input) => input.origin !== "url" || input.originRef !== undefined);
export const researchUpdateSchema = z.strictObject({
  scope: z.enum(RESEARCH_SCOPES).optional(),
  title: researchTitle.optional(),
  text: body(BOUNDS.researchChars).optional(),
});
export type ResearchDocument = z.infer<typeof researchDocumentSchema>;
export type ResearchDocumentDetail = z.infer<
  typeof researchDocumentDetailSchema
>;

// ---- The brief ------------------------------------------------------------

// GET .../candidacies/:id/interview-brief
export const interviewBriefSchema = z.object({
  candidacyId: z.uuid(),
  companyName: z.string(),
  title: z.string(),
  // The application's own notes (the old single field): readable until moved.
  applicationNotes: z.string().nullable(),
  stages: z.array(interviewStageSchema),
  employerSaid: z.array(employerSaidEntrySchema),
  research: z.array(researchDocumentSchema),
});
export type InterviewBrief = z.infer<typeof interviewBriefSchema>;

// The closed set of codes these routes answer with; a body is { error: { code } }.
export const INTERVIEW_BRIEF_ERROR_CODES = [
  "not-found",
  "invalid-request",
  "body-too-large",
  "limit-reached",
  "invalid-transcript",
  "unsupported-format",
  "stage-in-use",
  "loosening-refused",
  "nothing-to-carry",
] as const;
export type InterviewBriefErrorCode =
  (typeof INTERVIEW_BRIEF_ERROR_CODES)[number];
