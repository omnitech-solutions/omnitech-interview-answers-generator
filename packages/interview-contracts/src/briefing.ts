import { z } from "zod";

const id = z.string().trim().min(1).max(256);
const text = z.string().max(32_000);
const word = z.string().trim().min(1).max(1024);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const words = z.array(word).max(512);
const roleSchema = z.looseObject({
  company: word,
  title: word,
  period: text.optional(),
  industry: words.optional(),
  system_types: words.optional(),
  problem_spaces: words.optional(),
  technologies: words.optional(),
  patterns: words.optional(),
  responsibilities: words.optional(),
  metrics: z
    .array(
      z.looseObject({
        label: word,
        value: z.union([z.string(), z.number()]),
        direction: z.string().optional(),
      }),
    )
    .max(128)
    .optional(),
  leadership_signals: words.optional(),
  proof_points: words.optional(),
  tags: words.optional(),
});
export const candidateMatrixSchema = z.looseObject({
  candidate: z.looseObject({
    name: word.optional(),
    headline: text.optional(),
    location: text.optional(),
    profile_tags: words.optional(),
  }),
  roles: z.array(roleSchema).max(100),
  resume_variants: z.array(z.looseObject({ id: id, label: word })).optional(),
  industry_mappings: z
    .array(z.looseObject({ industry: word, best_fit_roles: words.optional() }))
    .optional(),
  technology_mappings: z
    .array(z.looseObject({ technology: word, roles: words.optional() }))
    .optional(),
  leadership_signals: z
    .array(z.looseObject({ signal: word, evidence: words.optional() }))
    .optional(),
  story_selector: z
    .array(
      z.looseObject({
        need: word,
        primary_story: word,
        backup_story: word.optional(),
      }),
    )
    .optional(),
  tag_taxonomy: z.record(z.string(), words).optional(),
  repositories_of_note: z
    .array(
      z.looseObject({
        name: word,
        owner: word.optional(),
        type: word.optional(),
        why_it_matters: text.optional(),
        signals: words.optional(),
        relevance_tags: words.optional(),
      }),
    )
    .max(200)
    .optional(),
  experience_matrix_extensions: z.record(z.string(), z.unknown()).optional(),
});
export type CandidateMatrix = z.infer<typeof candidateMatrixSchema>;

export const briefingContextSchema = z.strictObject({
  company: word,
  role: word,
  stage: z.enum(["recruiter", "hiring-manager", "leadership", "behavioural"]),
  // What the person wants from this preparation, in their words.
  request: text.optional(),
  interviewer: word.optional(),
  interviewerTitle: word.optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  jobDescription: text.optional(),
  employerNotes: text.optional(),
  // What the person found out: interviewer background, candidate reports.
  research: text.optional(),
  // A model-condensed copy of the two long fields above, for what reads the
  // pack on every turn (the assistant). The originals stay exactly as pasted;
  // the copy is dropped when either original changes, so it is never stale.
  condensed: z
    .strictObject({
      jobDescription: text.optional(),
      research: text.optional(),
    })
    .optional(),
  candidatePreferences: text.optional(),
  // The matrix roles to lean on; answers draw on these first.
  roleIds: z
    .array(z.string().regex(/^\/roles\/\d+$/))
    .max(100)
    .optional(),
  profile: z.strictObject({ id, revision }),
});
export const briefingQuestionCategorySchema = z.enum([
  "background",
  "motivation",
  "leadership",
  "delivery",
  "collaboration",
  "logistics",
  "questions-to-ask",
]);
export const briefingEvidenceRefSchema = z.strictObject({
  id,
  revision,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pointer: z.string().startsWith("/").max(2048),
  quote: z.string().min(1).max(32_000),
  sourceKind: z.enum(["candidate", "employer-context", "candidate-preference"]),
  field: z.enum(["answerMarkdown", "talkingPoints"]).optional(),
  text: z.string().min(1).max(32_000).optional(),
});
export const briefingQuestionSchema = z.strictObject({
  id,
  question: word,
  category: briefingQuestionCategorySchema,
  answerMarkdown: text,
  talkingPoints: z.array(text).length(3),
  evidenceRefs: z.array(briefingEvidenceRefSchema).max(32),
  gaps: z.array(text).max(32),
  // The person reviewed this answer and is happy to use it.
  accepted: z.boolean().optional(),
});
const line = z.string().trim().min(1).max(2_000);
const lines = z.array(line).max(20);
// What a prepared briefing says about the call, card by card: the Studio
// shows it as the pack's Overview, Stories, Ask them and Watch-outs tabs.
export const briefingPreparedContentSchema = z.strictObject({
  // What this call is: the question it answers, and what to expect.
  call: z.strictObject({ summary: line, detail: line.optional() }),
  agenda: z
    .array(
      z.strictObject({
        minutes: z.number().int().min(1).max(240),
        topic: line,
      }),
    )
    .max(12),
  interviewer: z
    .strictObject({
      note: line,
      goodToAsk: lines,
      saveForLater: line.optional(),
    })
    .optional(),
  // The few positioning points to land, in order.
  positioning: z.strictObject({ steps: lines, note: line.optional() }),
  fit: z.strictObject({
    strong: lines,
    watch: z.array(z.strictObject({ topic: line, answer: line })).max(10),
  }),
  teams: z
    .array(z.strictObject({ name: line, owns: lines, means: line }))
    .max(6),
  compensation: z.strictObject({ summary: line, advice: line }).optional(),
  pipeline: z.strictObject({ stages: lines, later: lines }).optional(),
  // Reusable stories, each from a matrix role.
  stories: z
    .array(
      z.strictObject({
        title: line,
        shape: line,
        covers: lines,
        roleId: z
          .string()
          .regex(/^\/roles\/\d+$/)
          .optional(),
      }),
    )
    .max(6),
  ask: z
    .array(
      z.strictObject({
        title: line,
        note: line.optional(),
        items: z
          .array(
            z.strictObject({
              question: line,
              why: line,
              // Ticked off by the person during the call.
              asked: z.boolean().optional(),
            }),
          )
          .max(8),
      }),
    )
    .max(4),
  watchOuts: z
    .array(
      z.strictObject({
        kind: z.enum(["avoid", "caution"]),
        title: line,
        detail: line,
        sayInstead: line.optional(),
      }),
    )
    .max(8),
});
export const briefingPreparedSchema = briefingPreparedContentSchema.extend({
  evidenceRefs: z.array(briefingEvidenceRefSchema).max(64),
  gaps: z.array(text).max(32),
});
export const briefingDraftSchema = z.strictObject({
  kind: z.literal("non-technical-briefing"),
  title: word,
  context: briefingContextSchema,
  // The prepared briefing for the call, grounded in the matrix and the
  // employer material.
  prepared: briefingPreparedSchema.optional(),
  // The questions the person expects, before their answers are drafted.
  expected: z.array(word).max(20).optional(),
  questions: z.array(briefingQuestionSchema).max(20),
});
// Ask one question of a pack: the answer is added to it straight away.
export const briefingAskSchema = z.strictObject({
  expectedRevision: revision,
  question: word,
  category: briefingQuestionCategorySchema.optional(),
  // Redraft this answer in place instead of adding a new one.
  replaceId: id.optional(),
});
// Prepare (or refresh) the pack's full briefing.
export const briefingPrepareSchema = z.strictObject({
  expectedRevision: revision,
  request: text.optional(),
});
// POST .../artifacts/:id/condense: condense the pack's long setup fields.
export const briefingCondenseSchema = z.strictObject({
  expectedRevision: revision,
});
export const briefingProfileImportSchema = z.strictObject({
  name: word,
  matrix: candidateMatrixSchema,
  profileId: id.optional(),
  expectedRevision: revision.optional(),
});
export const briefingPutSchema = z.strictObject({
  expectedRevision: revision,
  briefing: briefingDraftSchema,
});
export const briefingProposalRequestSchema = z.strictObject({
  expectedRevision: revision,
  context: briefingContextSchema,
  questions: z
    .array(
      z.strictObject({
        id,
        question: word,
        category: briefingQuestionCategorySchema,
      }),
    )
    .min(1)
    .max(20),
  storyIds: z
    .array(z.string().regex(/^\/roles\/\d+$/))
    .max(4)
    .optional(),
  instruction: text.optional(),
  questionId: id.optional(),
});
export const briefingApplySchema = z.strictObject({
  proposalId: id,
  expectedRevision: revision,
});
export const briefingSaveSchema = z.strictObject({
  expectedRevision: revision,
  requestId: id,
});
export const briefingProposalResponseSchema = z.strictObject({
  id,
  baseRevision: revision,
  briefing: briefingDraftSchema,
});
export const briefingProfileSummarySchema = z.strictObject({
  id,
  name: word,
  revision,
  updatedAt: z.string(),
});
export const briefingProfileListResponseSchema = z.strictObject({
  profiles: z.array(briefingProfileSummarySchema),
});
export const briefingProfileImportResponseSchema = z.strictObject({
  id,
  name: word,
  revision,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const briefingProfileRevisionResponseSchema =
  briefingProfileImportResponseSchema.extend({ matrix: candidateMatrixSchema });
export const briefingArtifactSummarySchema = z.strictObject({
  id,
  title: word,
  revision,
  savedRevision: revision,
  updatedAt: z.string(),
});
export const briefingArtifactListResponseSchema = z.strictObject({
  artifacts: z.array(briefingArtifactSummarySchema),
});
const briefingEnvelopeValueSchema = z.strictObject({
  question: text,
  notes: z.string().max(100_000),
  answer: z.null(),
  briefing: briefingDraftSchema,
});
export const briefingArtifactResponseSchema = z.strictObject({
  origin: z.strictObject({
    workspaceId: z.literal("briefings"),
    artifactId: id,
    artifactRevision: revision,
  }),
  value: briefingEnvelopeValueSchema,
  updatedAt: z.string(),
  provenance: z.unknown().nullable(),
});
export const briefingSavedResponseSchema = z.strictObject({
  workspaceId: z.literal("briefings"),
  artifactId: id,
  savedRevision: revision,
  draftRevision: revision,
  value: briefingEnvelopeValueSchema,
  createdAt: z.string(),
  provenance: z.unknown().nullable(),
});
export type BriefingContext = z.infer<typeof briefingContextSchema>;
export type BriefingQuestion = z.infer<typeof briefingQuestionSchema>;
export type BriefingDraft = z.infer<typeof briefingDraftSchema>;
export type BriefingProfileImport = z.infer<typeof briefingProfileImportSchema>;
export type BriefingPut = z.infer<typeof briefingPutSchema>;
export type BriefingAsk = z.infer<typeof briefingAskSchema>;
export type BriefingPrepare = z.infer<typeof briefingPrepareSchema>;
export type BriefingCondense = z.infer<typeof briefingCondenseSchema>;
export type BriefingPrepared = z.infer<typeof briefingPreparedSchema>;
export type BriefingPreparedContent = z.infer<
  typeof briefingPreparedContentSchema
>;
export type BriefingProposalRequest = z.infer<
  typeof briefingProposalRequestSchema
>;
export type BriefingApply = z.infer<typeof briefingApplySchema>;
export type BriefingSave = z.infer<typeof briefingSaveSchema>;
export type BriefingProposalResponse = z.infer<
  typeof briefingProposalResponseSchema
>;
export type BriefingProfileSummary = z.infer<
  typeof briefingProfileSummarySchema
>;
export type BriefingProfileListResponse = z.infer<
  typeof briefingProfileListResponseSchema
>;
export type BriefingProfileImportResponse = z.infer<
  typeof briefingProfileImportResponseSchema
>;
export type BriefingProfileRevisionResponse = z.infer<
  typeof briefingProfileRevisionResponseSchema
>;
export type BriefingArtifactSummary = z.infer<
  typeof briefingArtifactSummarySchema
>;
export type BriefingArtifactListResponse = z.infer<
  typeof briefingArtifactListResponseSchema
>;
export type BriefingArtifactResponse = z.infer<
  typeof briefingArtifactResponseSchema
>;
export type BriefingSavedResponse = z.infer<typeof briefingSavedResponseSchema>;

// A question's kind, from its wording, when the person does not say.
export function briefingCategoryOf(
  question: string,
): BriefingQuestion["category"] {
  const text = question.toLowerCase();
  if (
    /\b(salary|compensation|pay|rate|notice|start date|(?:could|can) you start|visa|relocat|remote|hybrid|location|based|available|availability)\b/.test(
      text,
    )
  )
    return "logistics";
  if (/\b(questions? for (us|me)|ask (us|me))\b/.test(text))
    return "questions-to-ask";
  if (/\b(why|interest|motivat|looking for|leave|leaving|excite)\b/.test(text))
    return "motivation";
  if (
    /\b(lead|led|mentor|manage|conflict|disagree|influence|decision)\b/.test(
      text,
    )
  )
    return "leadership";
  if (/\b(team|collaborat|stakeholder|cross-functional|work with)\b/.test(text))
    return "collaboration";
  if (
    /\b(deliver|project|deadline|ship|built|build|achiev|impact|challenge)\b/.test(
      text,
    )
  )
    return "delivery";
  return "background";
}
