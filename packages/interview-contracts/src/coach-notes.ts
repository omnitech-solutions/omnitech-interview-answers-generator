import { z } from "zod";

// [DOMAIN] Coach notes: short prompts pushed to the live session's window while
// the person is speaking (what to mention next, a figure to use, a link to the
// documentation for the topic on the table). They come from a coach outside
// the page (a person or an agent with the API token) and are kept in the data
// directory until cleared; they are never part of the session's record.
const line = z.string().trim().min(1).max(280);

// [DOMAIN] A coaching note is structured content, never formatting: whoever
// writes it (a person, an agent, a model) says what each piece IS, and the
// window alone decides how it looks. That is what keeps every note readable
// in the two seconds the person has while still listening.
//
// A line is one full sentence to say, short enough to take in at a glance.
// The length is the rule that keeps a note from becoming a paragraph.
export const TALKING_POINT_LENGTH = 240;

// Why a piece of a line matters. Most of a line is `spoken`; mark the
// SMALLEST useful phrase otherwise, so the sentence keeps its reading rhythm.
//   spoken    the words to say
//   cue       the opening phrase that carries the line into the conversation
//             ("One thing I should have said earlier"): lifted a little, so
//             it is found first, never coloured
//   evidence  what anchors the claim: an employer, a technology, a figure
//   caution   a risk, a qualification, something not to volunteer
//   context   supporting detail the person need not say
export const COACH_ROLES = [
  "spoken",
  "cue",
  "evidence",
  "caution",
  "context",
] as const;

export const coachSegmentSchema = z.strictObject({
  // Not trimmed: a segment keeps the spaces that join it to its neighbours.
  text: z.string().min(1).max(TALKING_POINT_LENGTH),
  role: z.enum(COACH_ROLES).default("spoken"),
  // [SAFETY] Whether an `evidence` claim comes from the person's own approved
  // experience ("verified") or is the writer's inference ("inferred"). The
  // window marks an inferred claim, so the coach never puts an accomplishment
  // in the person's mouth unnoticed.
  grounding: z.enum(["verified", "inferred"]).optional(),
  // [DOMAIN] Where an `evidence` claim comes from in the person's own
  // material, as the pointer the session context already uses: a role or a
  // fact of the experience matrix ("/roles/3", "/roles/3/proof_points/1") or
  // a line of the interview brief ("/context/employerBrief/2"). An answer
  // that leans on prior experience names its source here, so the window can
  // show it and the person can trust it.
  source: z
    .string()
    .regex(/^\/(?:roles\/\d+(?:\/[\w-]+)*|context\/\w+(?:\/\d+)?)$/)
    .max(120)
    .optional(),
});

export const coachLineSchema = z
  .strictObject({ segments: z.array(coachSegmentSchema).min(1).max(12) })
  .refine(
    (line) =>
      line.segments.reduce((sum, segment) => sum + segment.text.length, 0) <=
      TALKING_POINT_LENGTH,
    { message: "A line is one sentence: too long." },
  );

// What a group of lines is for. The window labels and draws each kind itself.
//   say      the response, ready to say, in order
//   anchors  at most a few short things to hang the answer on
//   ask      what to ask the interviewer
//   caution  what to avoid or correct, with the line that gets back on track
//   context  why, for reading later; left out of the compact view
export const COACH_SECTION_KINDS = [
  "say",
  "anchors",
  "ask",
  "caution",
  "context",
] as const;

export const coachNoteSectionSchema = z.strictObject({
  kind: z.enum(COACH_SECTION_KINDS),
  // A heading in place of the kind's own ("If pushed"), when one is needed.
  label: z.string().trim().min(1).max(24).optional(),
  lines: z.array(coachLineSchema).min(1).max(5),
});

// The situation the note answers. One per note: it picks the note's template.
export const COACH_NOTE_KINDS = [
  "direct-answer",
  "technical",
  "behavioral",
  "closing",
  "follow-up",
  "missed-opportunity",
] as const;

export const coachNoteLinkSchema = z.strictObject({
  label: z.string().trim().min(1).max(80),
  url: z.url().startsWith("https://").max(600),
});

export const coachNoteInputSchema = z.strictObject({
  // What the note is about, in a few words: the question or the topic.
  title: z.string().trim().min(1).max(120),
  // "say": points to make; "watch": something to stop or avoid.
  tone: z.enum(["say", "watch"]).default("say"),
  points: z.array(line).max(6).default([]),
  // The note as Markdown, for a note that needs more shape than a few points:
  // short headings, bullets, numbered steps, **bold** for the words to land.
  // When given it is what the window shows; `points` are then left out.
  markdown: z.string().trim().min(1).max(6_000).optional(),
  links: z.array(coachNoteLinkSchema).max(5).default([]),
  // The question this note is for, restated in a few words for the questions
  // list ("Data consistency across services").
  ask: z.string().trim().min(1).max(80).optional(),
  // Notes that share an id are for the same question: a later one is a
  // follow-up under it, never a replacement.
  askId: z.string().trim().min(1).max(64).optional(),
  // [DOMAIN] The structured note: what a generator fills in, and what the
  // window draws. A note that has `sections` needs no `markdown`.
  kind: z.enum(COACH_NOTE_KINDS).default("direct-answer"),
  // What was asked, as it was heard (the transcript line, tidied).
  heard: z.string().trim().min(1).max(600).optional(),
  sections: z.array(coachNoteSectionSchema).max(4).default([]),
  // A flow or architecture sketch, as Mermaid source (no code fence).
  diagram: z.string().trim().min(1).max(1_500).optional(),
  // [DOMAIN] Revisions. A note with a `key` is one note over time: posting
  // the same key again with a higher `revision` takes its place where it
  // stands, and an older revision is refused, so a slow answer never
  // overwrites a newer one. "pending" says a revision is being prepared: the
  // last ready content stays on show until the next is ready.
  key: z.string().trim().min(1).max(64).optional(),
  revision: z.number().int().min(1).default(1),
  status: z.enum(["pending", "ready"]).default("ready"),
  // When the note was for, when that is not now: a coach restoring a
  // session's notes gives each one the moment it was first shown.
  at: z.iso.datetime().optional(),
});

export const coachNoteSchema = coachNoteInputSchema.omit({ at: true }).extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const coachNotesResponseSchema = z.strictObject({
  // Moves on every change, so a page that polls knows when to redraw.
  revision: z.number().int().nonnegative(),
  notes: z.array(coachNoteSchema),
});

export type CoachNoteInput = z.input<typeof coachNoteInputSchema>;
export type CoachNote = z.infer<typeof coachNoteSchema>;
export type CoachNoteLink = z.infer<typeof coachNoteLinkSchema>;
export type CoachNoteSection = z.infer<typeof coachNoteSectionSchema>;
export type CoachNoteKind = (typeof COACH_NOTE_KINDS)[number];
export type CoachSegment = z.infer<typeof coachSegmentSchema>;
export type CoachLine = z.infer<typeof coachLineSchema>;
export type CoachRole = (typeof COACH_ROLES)[number];
export type CoachSectionKind = (typeof COACH_SECTION_KINDS)[number];
export type CoachNotesResponse = z.infer<typeof coachNotesResponseSchema>;
