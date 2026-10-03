import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

export const rehearsalFormatSchema = z.enum(["full", "coding", "concept"]);
export const rehearsalRevealSchema = z.enum([
  "clarify",
  "hint1",
  "edge",
  "pattern",
  "approach",
  "solution",
  "tests",
]);
// How the score is earned: ten points per checklist item ticked, three
// lost per hint opened, never below zero.
export const CHECK_POINTS = 10;
export const REVEAL_COST = 3;
export const rehearsalScore = (checks: number, reveals: number) =>
  Math.max(0, Math.min(100, checks * CHECK_POINTS - reveals * REVEAL_COST));

// Hints derived on the server from the owner's own Active Session assistance
// (drafts shown during a non-strict rehearsal) cost like opened reveals but are
// never stored as reveals; the cap matches the reveals array.
export const MAX_SESSION_HINTS = 7;

const questionRef = z.strictObject({
  // brief: a concept brief; question: a coding question's draft; prompt: one
  // of the built-in concept prompts.
  source: z.enum(["brief", "question", "prompt"]),
  ref: text(256),
  title: text(300),
});

// A finished rehearsal as the client reports it; the server scores it.
export const rehearsalSessionInputSchema = z.strictObject({
  format: rehearsalFormatSchema,
  strict: z.boolean(),
  followUps: z.boolean(),
  concept: questionRef.nullable(),
  coding: questionRef.nullable(),
  checks: z.array(z.number().int().min(0).max(19)).max(20),
  reveals: z.array(rehearsalRevealSchema).max(7),
  activeSeconds: z
    .number()
    .int()
    .min(0)
    .max(4 * 60 * 60),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
  // The opaque run id a rehearsal's Active Sessions were started with (the
  // same bounds as the session's own). The server derives the hint count from
  // the owner's sessions with this id; the client never supplies a count.
  rehearsalRunId: z.string().min(1).max(128).optional(),
});
export const rehearsalSessionSchema = rehearsalSessionInputSchema.extend({
  id: z.string(),
  score: z.number().int().min(0).max(100),
  // Present when the server derived session hints for this save.
  sessionHints: z.number().int().min(0).max(MAX_SESSION_HINTS).optional(),
});
export const rehearsalListResponseSchema = z.object({
  sessions: z.array(rehearsalSessionSchema),
});

export type RehearsalFormat = z.infer<typeof rehearsalFormatSchema>;
export type RehearsalReveal = z.infer<typeof rehearsalRevealSchema>;
export type RehearsalSessionInput = z.infer<typeof rehearsalSessionInputSchema>;
export type RehearsalSession = z.infer<typeof rehearsalSessionSchema>;
