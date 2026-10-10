// The Workspace's shapes: the host's database port, the draft, evidence and
// origin schemas, the records the service returns, its refusals, and how a
// stored row becomes a record. No I/O.
import {
  briefingDraftSchema,
  generatedAnswerSchema,
  type InterviewProvenance,
  interviewMetricSchema,
  interviewProvenanceSchema,
  renderGuideMarkdown,
  stageProgressSchema,
} from "@omnitech/interview-contracts";
import {
  type ProductErrorStatus,
  ProductOperationError,
} from "@omnitech-assistant/contracts";
import { z } from "zod";

// Structural host ports: compatible with the portable package's built exports,
// with no dependency on another checkout's TypeScript source or global store.
export interface WorkspaceTransaction {
  query(
    sql: string,
    values?: readonly unknown[],
  ): Promise<readonly Record<string, unknown>[]>;
}
export interface WorkspaceDatabasePort {
  tenantTransaction<T>(
    tenantId: string,
    fn: (tx: WorkspaceTransaction) => Promise<T>,
  ): Promise<T>;
}
export const id = z.string().max(256).trim().min(1);
export const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const scopeSchema = z.strictObject({
  tenantId: id,
  actorId: id,
  productId: id,
});
export const originSchema = z.strictObject({
  workspaceId: id,
  artifactId: id,
  artifactRevision: revision,
});
const boundedAnswerSchema = generatedAnswerSchema
  .extend({
    title: z.string().max(256).trim().min(1),
    answerMarkdown: z.string().max(100_000).trim().min(1),
    code: z.string().max(100_000),
    usageCode: z.string().max(100_000).default(""),
    testCode: z.string().max(100_000).default(""),
  })
  .strict();
export const interviewDraftSchema = z
  .strictObject({
    question: z.string().max(32_000).trim().min(1),
    notes: z.string().max(100_000).default(""),
    answer: boundedAnswerSchema.nullable().default(null),
    briefing: briefingDraftSchema.nullable().optional(),
    // Where the person is in the Workspace stages; never part of the answer.
    progress: stageProgressSchema.optional(),
  })
  .refine(
    (value) => !(value.answer && value.briefing),
    "Coding answer and briefing cannot coexist",
  );
// A patch must not inherit creation defaults: omitting notes/answer preserves
// the existing fields rather than resetting them during a proposal edit.
export const interviewDraftPatchSchema = z.strictObject({
  question: z.string().max(32_000).trim().min(1).optional(),
  notes: z.string().max(100_000).optional(),
  answer: boundedAnswerSchema.nullable().optional(),
  briefing: briefingDraftSchema.nullable().optional(),
  progress: stageProgressSchema.optional(),
});
export const evidenceSchema = z.strictObject({
  id,
  revision,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  locator: z.string().min(1).max(2048),
  text: z.string().max(100_000),
  sourceKind: z.enum(["candidate", "technical-reference"]),
  classification: z.enum(["public", "internal", "confidential", "restricted"]),
  audience: z.array(id).min(1).max(64),
  metrics: z.array(interviewMetricSchema).max(128).optional(),
});
export type WorkspaceScope = Readonly<z.infer<typeof scopeSchema>>;
export type WorkspaceOrigin = Readonly<z.infer<typeof originSchema>>;
export type InterviewDraft = Readonly<z.infer<typeof interviewDraftSchema>>;
export type InterviewDraftPatch = Readonly<
  z.infer<typeof interviewDraftPatchSchema>
>;
export type InterviewEvidence = Readonly<
  Omit<z.infer<typeof evidenceSchema>, "audience"> & {
    audience: readonly string[];
  }
>;
// The outcome of a question's latest test run. passed/total count tests when
// the framework reported them; ok is whether the run as a whole passed.
export type RunSummary = Readonly<{
  ok: boolean;
  passed: number | null;
  total: number | null;
  at: string;
}>;
export type DraftSummary = Readonly<{
  artifactId: string;
  title: string;
  kind: "coding" | "briefing";
  language: string | null;
  revision: number;
  updatedAt: string;
  lastRun: RunSummary | null;
}>;

export type WorkspaceDraftRecord = Readonly<{
  origin: WorkspaceOrigin;
  value: InterviewDraft;
  updatedAt: string;
  provenance: InterviewProvenance | null;
}>;
export type AnswerRevisionRecord = Readonly<{
  workspaceId: string;
  artifactId: string;
  savedRevision: number;
  draftRevision: number;
  value: InterviewDraft;
  createdAt: string;
  provenance: InterviewProvenance | null;
}>;
// The answer's Markdown is always its guide's rendering, whatever was sent.
export function withRenderedAnswer(
  draft: z.infer<typeof interviewDraftSchema>,
) {
  return draft.answer
    ? {
        ...draft,
        answer: {
          ...draft.answer,
          answerMarkdown: renderGuideMarkdown(draft.answer.guide),
        },
      }
    : draft;
}
// Advice the model sees when a proposal is refused, so it can fix the next one.
const refusalHints: Readonly<Record<string, string>> = {
  "missing-citation":
    'Add a top-level `claims` list beside `answer` in the arguments. Each claim is {"field":"guide","text":"<exact words from that answer field>","source":"<evidence id>","quote":"<passage from that evidence that supports the text>"}. You do not supply hashes or revisions.',
  "citation-quote-conflict":
    "Each citation quote must be copied exactly, character for character, from that evidence's text.",
  "evidence-hash-conflict":
    "Copy each citation's sha256 exactly from the evidence you were given.",
  "claim-text-conflict":
    "Each claim's text must appear exactly in the answer field it names.",
  "claim-answer-required":
    "Claims describe an answer; include the answer in the same patch.",
  "unsupported-metric":
    "Do not state numbers or metrics that are not in the provided candidate evidence.",
  "candidate-fact-conflict":
    "Facts about the candidate need candidate evidence; remove them or mark them uncertain.",
  "no-change":
    "The proposal equals the current draft. Tell the user nothing needs to change.",
  "changed-since":
    "The draft was edited after this change was applied, so undoing it would overwrite those edits.",
};
export class WorkspaceError extends ProductOperationError {
  constructor(code: string, hint?: string) {
    const status: ProductErrorStatus =
      code === "not-found"
        ? 404
        : code === "evidence-forbidden"
          ? 403
          : code === "runner-unavailable"
            ? 501
            : [
                  "revision-conflict",
                  "idempotency-conflict",
                  "effect-interrupted",
                  "effect-conflict",
                  "evidence-revision-conflict",
                  "changed-since",
                ].includes(code)
              ? 409
              : 400;
    super(code, status, hint ?? refusalHints[code]);
  }
}
export const timestamp = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value);
export const draft = (row: Record<string, unknown>): WorkspaceDraftRecord => ({
  origin: originSchema.parse({
    workspaceId: row["workspace_id"],
    artifactId: row["artifact_id"],
    artifactRevision: Number(row["revision"]),
  }),
  value: interviewDraftSchema.parse(row["value"]),
  updatedAt: timestamp(row["updated_at"]),
  provenance: row["provenance"]
    ? interviewProvenanceSchema.parse(row["provenance"])
    : null,
});
export const source = (row: Record<string, unknown>): InterviewEvidence =>
  evidenceSchema.parse({
    id: row["id"],
    revision: Number(row["revision"]),
    sha256: row["sha256"],
    locator: row["locator"],
    text: row["text"],
    sourceKind: row["source_kind"],
    classification: row["classification"],
    audience: row["audience"],
    ...(Array.isArray(row["metrics"]) && row["metrics"].length
      ? { metrics: row["metrics"] }
      : {}),
  });
