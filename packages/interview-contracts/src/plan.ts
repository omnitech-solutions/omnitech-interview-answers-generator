import { z } from "zod";

const id = z.string().trim().min(1).max(256);
const text = (max: number) => z.string().trim().min(1).max(max);

// An interview a person is preparing for.
export const interviewPlanInputSchema = z.strictObject({
  company: text(120),
  role: text(160),
  scheduledAt: z.iso.datetime({ offset: true }).nullable(),
  durationMinutes: z.number().int().min(5).max(600).nullable(),
  format: z.string().trim().max(160),
  topics: z.array(text(40)).max(12),
});
export const interviewPlanSchema = interviewPlanInputSchema.extend({
  id,
  updatedAt: z.string(),
});

export const planItemKindSchema = z.enum([
  "question",
  "briefing",
  "rehearsal",
  "task",
]);
// A step of the plan. Linked items point at the work by its id (ref).
export const planItemInputSchema = z.strictObject({
  kind: planItemKindSchema,
  ref: id.nullable(),
  title: text(200),
});
export const planItemPatchSchema = z.strictObject({
  title: text(200).optional(),
  done: z.boolean().optional(),
});
// What the linked work says right now, e.g. "5 of 6 tests passing".
export const planItemStatusSchema = z.object({
  label: z.string(),
  tone: z.enum(["neutral", "good", "warn"]),
});
export const planItemSchema = planItemInputSchema.extend({
  id,
  done: z.boolean(),
  position: z.number().int(),
  status: planItemStatusSchema.nullable(),
});
export const planResponseSchema = z.object({
  interview: interviewPlanSchema.nullable(),
  items: z.array(planItemSchema),
});

export type InterviewPlanInput = z.infer<typeof interviewPlanInputSchema>;
export type InterviewPlan = z.infer<typeof interviewPlanSchema>;
export type PlanItemKind = z.infer<typeof planItemKindSchema>;
export type PlanItemInput = z.infer<typeof planItemInputSchema>;
export type PlanItemPatch = z.infer<typeof planItemPatchSchema>;
export type PlanItemStatus = z.infer<typeof planItemStatusSchema>;
export type PlanItem = z.infer<typeof planItemSchema>;
export type PlanResponse = z.infer<typeof planResponseSchema>;
