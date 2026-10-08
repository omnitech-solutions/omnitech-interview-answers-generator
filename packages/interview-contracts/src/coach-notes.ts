import { z } from "zod";

// [DOMAIN] Coach notes: short prompts pushed to the live session's window while
// the person is speaking (what to mention next, a figure to use, a link to the
// documentation for the topic on the table). They come from a coach outside
// the page (a person or an agent with the API token) and are kept in the data
// directory until cleared; they are never part of the session's record.
const line = z.string().trim().min(1).max(280);

// [DOMAIN] A talking point: one full sentence to say, with enough in it to
// stand on its own (who, what, the figure, the reason), and `**bold**` on the
// few words to land. Not a fragment: "Built this in insurance" tells the
// person nothing they can say; "At **Relay** and **Trufla** I worked on
// **schema- and configuration-driven quoting**, the same problem as your
// rules tool" does. Not a paragraph either: one sentence, so it is taken in
// at a glance. The length is the rule that holds it there, whoever (or
// whatever) writes the note.
export const TALKING_POINT_LENGTH = 240;
const talkingPoint = z.string().trim().min(1).max(TALKING_POINT_LENGTH);

// One group of talking points under a short label that says what they are
// for: "Say", "Proof", "If pushed", "Ask", "Avoid".
export const coachNoteSectionSchema = z.strictObject({
  label: z.string().trim().min(1).max(24),
  points: z.array(talkingPoint).min(1).max(5),
});

// A correction while the person is answering: what is off, and the line that
// gets them back ("That covers reads. For writes…").
export const coachNoteSteerSchema = z.strictObject({
  issue: talkingPoint,
  say: talkingPoint.optional(),
});

// What a note is, so a reader (and a generator) knows what belongs in it:
//   answer     how to answer the question just asked
//   follow-up  more for a question already answered (same askId)
//   steer      a correction mid-answer
//   ask-them   questions for the person to ask the interviewer
//   close      the closing line and next steps
export const COACH_NOTE_KINDS = [
  "answer",
  "follow-up",
  "steer",
  "ask-them",
  "close",
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
  // window prefers to draw. A note that has `sections` needs no `markdown`.
  kind: z.enum(COACH_NOTE_KINDS).default("answer"),
  // What was asked, as it was heard (the transcript line, tidied).
  heard: z.string().trim().min(1).max(600).optional(),
  // What the interviewer is looking for in the answer, in one line.
  wants: talkingPoint.optional(),
  // The talking points, in the order to say them. At most four groups.
  sections: z.array(coachNoteSectionSchema).max(4).default([]),
  steer: coachNoteSteerSchema.optional(),
  // A flow or architecture sketch, as Mermaid source (no code fence).
  diagram: z.string().trim().min(1).max(1_500).optional(),
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
export type CoachNotesResponse = z.infer<typeof coachNotesResponseSchema>;
