import { z } from "zod";

// [DOMAIN] Coach notes: short prompts pushed to the live session's window while
// the person is speaking (what to mention next, a figure to use, a link to the
// documentation for the topic on the table). They come from a coach outside
// the page (a person or an agent with the API token) and are kept in the data
// directory until cleared; they are never part of the session's record.
const line = z.string().trim().min(1).max(280);

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
});

export const coachNoteSchema = coachNoteInputSchema.extend({
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
export type CoachNotesResponse = z.infer<typeof coachNotesResponseSchema>;
