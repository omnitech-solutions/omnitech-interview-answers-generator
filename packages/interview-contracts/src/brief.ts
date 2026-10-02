import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

export const briefKindSchema = z.enum(["concept", "system-design"]);

// A spoken answer to a technical topic, sized for 60–90 seconds: one headline,
// exactly three points, an example to use, what not to say, and the
// follow-ups an interviewer is likely to ask.
export const conceptBriefSchema = z.object({
  version: z.literal(1),
  headline: text(600),
  // An array of exactly three (strict JSON Schema needs minItems/maxItems).
  points: z.array(z.object({ heading: text(80), body: text(600) })).length(3),
  example: text(800),
  pitfall: text(600),
  followUps: z
    .array(z.object({ question: text(300), answer: text(800) }))
    .min(1)
    .max(5),
});

export const briefRequestSchema = z.strictObject({
  kind: briefKindSchema,
  topic: text(500),
});
export const briefSummarySchema = z.object({
  id: z.string(),
  kind: briefKindSchema,
  topic: z.string(),
  title: z.string(),
  updatedAt: z.string(),
});
export const briefSchema = briefSummarySchema.extend({
  brief: conceptBriefSchema,
});
export const briefListResponseSchema = z.object({
  briefs: z.array(briefSummarySchema),
});

export type BriefKind = z.infer<typeof briefKindSchema>;
export type ConceptBrief = z.infer<typeof conceptBriefSchema>;
export type BriefRequest = z.infer<typeof briefRequestSchema>;
export type BriefSummary = z.infer<typeof briefSummarySchema>;
export type Brief = z.infer<typeof briefSchema>;
