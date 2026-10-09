import { z } from "zod";

// [DOMAIN] The coach's transcript: what was said in the conversation, line by
// line, as the coach reads it. It is the coach's INPUT and nothing else: the
// lines a live session heard (where that session may be processed off the
// device), or a transcript a person attached. It is held in memory by the
// running Studio, never written to the database, a file or the log, and it
// goes when the coach's notes are cleared.
export const COACH_SPEAKERS = ["interviewer", "candidate", "unknown"] as const;

export const coachTranscriptLineInputSchema = z.strictObject({
  speaker: z.enum(COACH_SPEAKERS).default("unknown"),
  text: z.string().trim().min(1).max(4_000),
  // When it was said; now, when not given.
  at: z.iso.datetime().optional(),
});

export const coachTranscriptInputSchema = z.strictObject({
  lines: z.array(coachTranscriptLineInputSchema).min(1).max(2_000),
});

export const coachTranscriptLineSchema = z.strictObject({
  // The line's place in the transcript: rises by one, never reused.
  seq: z.number().int().positive(),
  speaker: z.enum(COACH_SPEAKERS),
  text: z.string(),
  at: z.iso.datetime(),
});

// [DOMAIN] The live session the lines were heard in, by its ids only: a coach
// with access to that session's approved context (the person's experience
// matrix, the employer brief) grounds its notes in it. Absent for a
// transcript that was only ever attached.
export const coachTranscriptSessionSchema = z.strictObject({
  tenantId: z.uuid(),
  actorId: z.uuid(),
  sessionId: z.uuid(),
});

export const coachTranscriptResponseSchema = z.strictObject({
  // Changes when the transcript is cleared or the Studio restarts: a reader
  // that sees a new one starts again from the first line.
  epoch: z.string(),
  // The newest line's `seq`; ask for what follows with `?after=`.
  cursor: z.number().int().nonnegative(),
  lines: z.array(coachTranscriptLineSchema),
  session: coachTranscriptSessionSchema.optional(),
});

export type CoachSpeaker = (typeof COACH_SPEAKERS)[number];
export type CoachTranscriptLineInput = z.input<
  typeof coachTranscriptLineInputSchema
>;
export type CoachTranscriptLine = z.infer<typeof coachTranscriptLineSchema>;
export type CoachTranscriptSession = z.infer<
  typeof coachTranscriptSessionSchema
>;
export type CoachTranscriptResponse = z.infer<
  typeof coachTranscriptResponseSchema
>;
