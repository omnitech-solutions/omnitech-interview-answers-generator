import { z } from "zod";

// [DOMAIN] The review of an application's context pack (ADR-0041): what a
// model extracted from the posting, the research, what the employer said and
// each stage's transcript, what code refused to keep and why, what could not
// be read, and where the person has no evidence. It is what a person checks
// before any reader (the coach, a briefing, a document) leans on the pack.
// Every count here is of records; what a record says is in `records`,
// `rejected` and `gaps`, which are the person's own material shown to them.
export const PACK_REVIEW_BOUNDS = {
  // Records, refusals and holes listed in one review.
  records: 400,
  rejected: 100,
  holes: 100,
  // What a person may write into a record they correct.
  textChars: 600,
  words: 12,
  wordChars: 80,
  corrections: 50,
} as const;

// Whether a source's part of the pack is what the source says now.
export const PACK_SOURCE_STATES = [
  // Read by a model at this revision.
  "current",
  // Read by a model, and changed since: what was extracted is no longer used.
  "changed",
  // Never read by a model.
  "unread",
  // Not sent to the model that prepared: it may not leave this device.
  "withheld",
  // A part of it could not be read.
  "partial",
  // The person's own structured material: no model reads it.
  "structured",
] as const;
export type PackSourceState = (typeof PACK_SOURCE_STATES)[number];

const record = z.object({
  id: z.string(),
  kind: z.string(),
  text: z.string(),
  sourceId: z.string(),
  // The words of the source it rests on, and where they are.
  quote: z.string().optional(),
  locator: z.string().optional(),
  section: z.string().optional(),
  level: z.string().optional(),
  stage: z.number().int().min(1).optional(),
  themes: z.array(z.string()).optional(),
  answers: z.array(z.string()).optional(),
  reviewed: z.enum(["confirmed", "edited"]).optional(),
});
export type PackReviewRecord = z.infer<typeof record>;

export const packReviewSchema = z.object({
  candidacyId: z.uuid(),
  // False: nothing was prepared by a model, and every reader uses the
  // person's material as it stands.
  prepared: z.boolean(),
  recipe: z.object({ id: z.string(), version: z.string() }),
  // False: prepared by an earlier recipe; nothing of it is read until it is
  // prepared again.
  current: z.boolean(),
  // The profile a preparation would use, and whether it runs on this device.
  profile: z
    .object({ id: z.string(), label: z.string(), onDevice: z.boolean() })
    .nullable(),
  counts: z.array(
    z.object({
      kind: z.string(),
      total: z.number().int().nonnegative(),
      // Written by a model, each with a quote code found in its source.
      extracted: z.number().int().nonnegative(),
      confirmed: z.number().int().nonnegative(),
      edited: z.number().int().nonnegative(),
    }),
  ),
  links: z.array(
    z.object({
      step: z.string(),
      total: z.number().int().nonnegative(),
      byModel: z.number().int().nonnegative(),
    }),
  ),
  // What a model extracted, for the person to confirm, correct or remove.
  records: z.array(record),
  // What a model proposed and code refused, each with the reason.
  rejected: z.array(
    z.object({
      sourceId: z.string(),
      kind: z.string().optional(),
      text: z.string().optional(),
      code: z.string().optional(),
      reason: z.string(),
    }),
  ),
  // Parts of a source nothing was extracted from.
  holes: z.array(
    z.object({
      sourceId: z.string(),
      locator: z.string().optional(),
      reason: z.enum(["locality", "not-extracted"]),
      failure: z.string(),
    }),
  ),
  // Sources not sent to the model that prepared, and why.
  withheld: z.array(
    z.object({
      sourceId: z.string(),
      title: z.string(),
      reason: z.literal("device-only"),
    }),
  ),
  // Requirements with no evidence tied to them: the real gaps.
  gaps: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      // What a model said is missing, when it said.
      note: z.string().optional(),
    }),
  ),
  // Requirements with evidence, by how strongly.
  fit: z.object({
    requirements: z.number().int().nonnegative(),
    strong: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    gap: z.number().int().nonnegative(),
    // Ties a model proposed and code refused (an end that does not exist, a
    // pair the recipe forbids).
    refused: z.number().int().nonnegative(),
  }),
  stages: z.array(
    z.object({
      ordinal: z.number().int().min(1),
      label: z.string(),
      notes: z.number().int().nonnegative(),
      transcripts: z.number().int().nonnegative(),
      // Questions, answers, signals and commitments read from its transcripts.
      extracted: z.number().int().nonnegative(),
      // No notes and no transcript: nothing to prepare this stage from.
      empty: z.boolean(),
    }),
  ),
  sources: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      title: z.string(),
      stage: z.number().int().min(1).optional(),
      state: z.enum(PACK_SOURCE_STATES),
      extracted: z.number().int().nonnegative(),
      // Whether a model reads this kind of source at all.
      readable: z.boolean(),
    }),
  ),
  // What the last preparation in this request did; absent on a plain read.
  stats: z
    .object({
      sources: z.number().int().nonnegative(),
      extracted: z.number().int().nonnegative(),
      reused: z.number().int().nonnegative(),
      pieces: z.number().int().nonnegative(),
      calls: z.number().int().nonnegative(),
      linkCalls: z.number().int().nonnegative(),
      kept: z.number().int().nonnegative(),
      rejected: z.number().int().nonnegative(),
      holes: z.number().int().nonnegative(),
      links: z.number().int().nonnegative(),
    })
    .optional(),
});
export type PackReview = z.infer<typeof packReviewSchema>;

export const packPrepareSchema = z.strictObject({
  // Read this source again though it has not changed.
  sourceId: z.string().min(1).max(200).optional(),
  // The profile that reads; absent: the Studio's pack-preparation profile.
  profileId: z.string().min(1).max(200).optional(),
});
export type PackPrepareInput = z.infer<typeof packPrepareSchema>;

const words = z
  .array(z.string().trim().min(1).max(PACK_REVIEW_BOUNDS.wordChars))
  .max(PACK_REVIEW_BOUNDS.words);
export const packCorrectionSchema = z.discriminatedUnion("action", [
  z.strictObject({ recordId: z.string().min(1), action: z.literal("confirm") }),
  z.strictObject({ recordId: z.string().min(1), action: z.literal("remove") }),
  z.strictObject({
    recordId: z.string().min(1),
    action: z.literal("edit"),
    text: z.string().trim().min(1).max(PACK_REVIEW_BOUNDS.textChars).optional(),
    themes: words.optional(),
    answers: words.optional(),
  }),
]);
export const packCorrectionsSchema = z.strictObject({
  corrections: z
    .array(packCorrectionSchema)
    .min(1)
    .max(PACK_REVIEW_BOUNDS.corrections),
});
export type PackCorrection = z.infer<typeof packCorrectionSchema>;

// One line of a preparation as it runs (NDJSON): how far it is, then the
// review, or why it stopped.
export const packProgressSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("progress"),
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    // The sources being read now, by title.
    reading: z.array(z.string()),
    calls: z.number().int().nonnegative(),
  }),
  z.object({ t: z.literal("done"), review: packReviewSchema }),
  z.object({ t: z.literal("error"), code: z.string() }),
]);
export type PackProgress = z.infer<typeof packProgressSchema>;
