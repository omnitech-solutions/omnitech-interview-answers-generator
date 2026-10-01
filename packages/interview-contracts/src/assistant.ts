import { z } from "zod";

const id = z.string().max(256).trim().min(1);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const interviewMetricSchema = z.strictObject({
  value: z.number().finite(),
  unit: z.string().trim().min(1).max(64),
});
export const interviewClaimSchema = z.strictObject({
  kind: z.enum(["candidate-fact", "candidate-metric", "technical"]),
  field: z.enum(["answerMarkdown", "code", "usageCode", "testCode"]),
  text: z.string().min(1).max(32000),
  metric: interviewMetricSchema.optional(),
  citations: z
    .array(
      z.strictObject({
        id,
        revision,
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        quote: z.string().min(1).max(32000),
      }),
    )
    .min(1)
    .max(16),
});
export const interviewClaimsSchema = z.array(interviewClaimSchema).max(128);
export const interviewProvenanceSchema = z.strictObject({
  proposalId: id,
  draftRevision: revision,
  acceptedDraftRevision: revision,
  promptVersion: id,
  adapterVersion: id,
  claims: interviewClaimsSchema,
  sources: z
    .array(
      z.strictObject({
        id,
        revision,
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        sourceKind: z.enum(["candidate", "technical-reference"]),
        classification: z.enum([
          "public",
          "internal",
          "confidential",
          "restricted",
        ]),
        audience: z.array(id).min(1).max(64),
        locator: z.string().min(1).max(2048),
      }),
    )
    .max(256),
});
export type InterviewClaim = z.infer<typeof interviewClaimSchema>;
export type InterviewProvenance = z.infer<typeof interviewProvenanceSchema>;
