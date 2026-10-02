import { createHash } from "node:crypto";
import {
  type DatabasePort,
  evidenceListSchema,
  idSchema,
  type JsonValue,
  jsonValueSchema,
  originSchema,
  type ProductAdapter,
  type Proposal,
  productContextSchema,
  proposalSchema,
  receiptSchema,
  type Scope,
  type Transaction,
} from "@omnitech-assistant/contracts";
import type { CodeRunner } from "@omnitech/code-runner";
import {
  type InterviewProvenance,
  interviewClaimsSchema,
  interviewMetricSchema,
  languageSchema,
  runResultSchema,
} from "@omnitech/interview-contracts";
import { z } from "zod";
import {
  type EvidenceAuthority,
  genericEvidence,
  permitted,
  validateClaims,
} from "./evidence.js";
import { interviewAdapterVersion, interviewPrompt } from "./prompt.js";
import {
  type InterviewEvidence,
  InterviewWorkspaceRepository,
  interviewDraftPatchSchema,
  interviewDraftSchema,
  WorkspaceError,
} from "./workspace.js";
export const interviewProposalPatchSchema = interviewDraftPatchSchema
  .extend({ claims: interviewClaimsSchema.optional() })
  .refine(
    (patch) =>
      patch.question !== undefined ||
      patch.notes !== undefined ||
      patch.answer !== undefined,
    "Empty patch",
  );
// What the model is asked for. A claim names the source and the supporting
// passage; revision, hash, claim kind and the exact quote are derived below, so
// the model never hand-copies bookkeeping.
const draftClaimSchema = z.strictObject({
  field: z.enum(["answerMarkdown", "code", "usageCode", "testCode"]),
  text: z.string().min(1).max(32_000),
  source: z.string().min(1).max(256),
  quote: z.string().min(1).max(32_000),
  metric: interviewMetricSchema.optional(),
});
// Models often put `claims` inside `answer`; both places are read, and the
// stored patch always has them beside it.
const draftClaimsSchema = z.array(draftClaimSchema).max(64).optional();
// An edit names only the answer fields it changes; the rest come from the
// current answer. No defaults here: a missing field must stay missing, or an
// empty default would overwrite what is already there.
const partialAnswerSchema = z.strictObject({
  title: z.string().max(256).trim().min(1).optional(),
  language: languageSchema.optional(),
  answerMarkdown: z.string().max(100_000).trim().min(1).optional(),
  code: z.string().max(100_000).optional(),
  usageCode: z.string().max(100_000).optional(),
  testCode: z.string().max(100_000).optional(),
  claims: draftClaimsSchema,
});
export const interviewModelDraftSchema = interviewDraftPatchSchema.extend({
  answer: partialAnswerSchema.nullable().optional(),
  claims: draftClaimsSchema,
});
const completeAnswerSchema = interviewDraftPatchSchema.shape.answer
  .unwrap()
  .unwrap();
// What is in the answer's code and tests, listed exactly. Questions like "which
// tests do I have?" are then answered from a list rather than from skimming code.
const TEST_TITLE =
  /\b(it|test|describe|specify|context)\s*\(?\s*(['"`])((?:\\.|(?!\2).)*)\2/g;
const DEFINITION = /\b(?:class|function|def|interface)\s+([A-Za-z_$][\w$]*)/g;
function outlineOf(answer: { code: string; testCode: string } | null) {
  const unique = (items: string[]) => [...new Set(items)].slice(0, 60);
  const titles = [...(answer?.testCode ?? "").matchAll(TEST_TITLE)];
  return {
    suites: unique(
      titles
        .filter((m) => m[1] === "describe" || m[1] === "context")
        .map((m) => m[3]!),
    ),
    tests: unique(
      titles
        .filter((m) => !["describe", "context"].includes(m[1]!))
        .map((m) => m[3]!),
    ),
    definitions: unique(
      [...(answer?.code ?? "").matchAll(DEFINITION)].map((m) => m[1]!),
    ),
  };
}
// Finds the real passage a model's quote refers to, tolerating case and runs of
// whitespace; the returned text is always a substring of the source.
function locateQuote(text: string, quote: string): string | undefined {
  if (text.includes(quote)) return quote;
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return undefined;
  const pattern = new RegExp(
    words
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+"),
    "i",
  );
  return pattern.exec(text)?.[0];
}
const wire = (schema: {
  toJSONSchema(options: { unrepresentable: "any" }): unknown;
}) =>
  JSON.parse(JSON.stringify(schema.toJSONSchema({ unrepresentable: "any" })));
// Refinements stay authoritative in product validation; wire represents the
// bounded structural shape only. It cannot turn a citation into verified truth.
export const interviewPatchJsonSchema = wire(
  interviewDraftPatchSchema.extend({
    claims: interviewClaimsSchema.optional(),
  }),
);
export const interviewModelDraftJsonSchema = wire(interviewModelDraftSchema);
export interface InterviewAdapterOptions extends Partial<EvidenceAuthority> {
  runner?: Pick<CodeRunner, "runAll">;
}
// Exact strings have an explicit total order, including canonically equivalent
// Unicode IDs. Locale collation can compare distinct lock keys as equal.
const citedSources = (proposal: Proposal) =>
  [...proposal.evidence].sort(
    (a, b) =>
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || a.revision - b.revision,
  );
export function createInterviewAdapter(
  database: DatabasePort,
  options: InterviewAdapterOptions = {},
): ProductAdapter {
  const workspace = new InterviewWorkspaceRepository(database);
  const authority: EvidenceAuthority = {
    authorizeEvidence:
      options.authorizeEvidence ??
      (async (_scope, source) => source.classification === "public"),
    verifyTechnicalReference:
      options.verifyTechnicalReference ?? (async () => false),
  };
  const op = (
    permission: string,
    inputSchema: unknown,
    outputSchema: unknown,
  ) => ({
    version: interviewAdapterVersion,
    inputSchema: inputSchema as never,
    outputSchema: outputSchema as never,
    requiredPermissions: [permission],
  });
  const visible = async (tx: Transaction, scope: Scope, query?: string) => {
    const found = await workspace.evidenceTransaction(tx, scope, query),
      allowed: InterviewEvidence[] = [];
    for (const source of found) {
      try {
        await permitted(scope, source, tx, authority);
        allowed.push(source);
      } catch (error) {
        if (
          !(error instanceof WorkspaceError) ||
          !["evidence-forbidden", "reference-unverified"].includes(error.code)
        )
          throw error;
      }
    }
    return allowed;
  };
  const validate = async (tx: Transaction, scope: Scope, raw: Proposal) => {
    const proposal = proposalSchema.parse(raw);
    const parsedPatch = interviewProposalPatchSchema.safeParse(proposal.patch);
    if (!parsedPatch.success) throw new WorkspaceError("proposal-invalid");
    const patch = parsedPatch.data;
    const sources = new Map<string, InterviewEvidence>();
    // Source locks precede the draft everywhere: standalone validation,
    // preview/replay authorization and acceptance share the same order.
    for (const cited of citedSources(proposal)) {
      const source = await workspace.readEvidenceTransaction(
        tx,
        scope,
        cited.id,
        cited.revision,
      );
      await permitted(scope, source, tx, authority);
      if (JSON.stringify(genericEvidence(source)) !== JSON.stringify(cited))
        throw new WorkspaceError("evidence-lineage-conflict");
      sources.set(`${source.id}:${source.revision}`, source);
    }
    const current = await workspace.readTransaction(
      tx,
      scope,
      proposal.origin.workspaceId,
      proposal.origin.artifactId,
      true,
    );
    // A proposal applies to the revision it was made from, or to the revision
    // its own undo produced (applying it again after undo).
    const base =
      (await workspace.revertedRevisionTransaction(tx, scope, proposal.id)) ??
      proposal.origin.artifactRevision;
    if (current.origin.artifactRevision !== base)
      throw new WorkspaceError("revision-conflict");
    // A proposal that changes nothing is not worth a review; the model is told.
    const unchanged = (["question", "notes", "answer"] as const).every(
      (key) =>
        patch[key] === undefined ||
        JSON.stringify(patch[key]) === JSON.stringify(current.value[key]),
    );
    if (unchanged) throw new WorkspaceError("no-change");
    if (patch.answer) {
      // Only new prose needs a source behind it; changing code or tests does not.
      validateClaims(patch.answer, patch.claims ?? [], sources, {
        proseChanged:
          !current.value.answer ||
          patch.answer.answerMarkdown !== current.value.answer.answerMarkdown,
      });
    } else if (patch.claims?.length)
      throw new WorkspaceError("claim-answer-required");
    return { proposal, patch, sources, current };
  };
  return {
    draftSchema: interviewModelDraftJsonSchema,
    buildProposal: async (scope, origin, raw) => {
      const parsed = interviewModelDraftSchema.safeParse(raw);
      if (!parsed.success) throw new WorkspaceError("proposal-invalid");
      const {
        claims: besideClaims = [],
        answer: draftAnswer,
        ...rest
      } = parsed.data;
      const { claims: insideClaims = [], ...answerFields } = draftAnswer ?? {};
      let mergedAnswer: z.infer<typeof completeAnswerSchema> | null | undefined;
      if (draftAnswer === null) mergedAnswer = null;
      else if (draftAnswer !== undefined) {
        const existing = await workspace
          .transaction(scope, (tx, current) =>
            workspace.readTransaction(
              tx,
              current,
              origin.workspaceId,
              origin.artifactId,
            ),
          )
          .then((record) => record.value.answer);
        const complete = completeAnswerSchema.safeParse({
          ...(existing ?? {}),
          ...answerFields,
        });
        if (!complete.success)
          throw new WorkspaceError(
            "proposal-invalid",
            "There is no answer to change yet. A new answer needs all of: title, language, answerMarkdown, code, usageCode, testCode.",
          );
        mergedAnswer = complete.data;
      }
      const patch = {
        ...rest,
        ...(mergedAnswer === undefined ? {} : { answer: mergedAnswer }),
      };
      const seen = new Set<string>();
      const draftClaims = [...besideClaims, ...insideClaims].filter((claim) => {
        const key = JSON.stringify(claim);
        return seen.has(key) ? false : (seen.add(key), true);
      });
      const available = await workspace.transaction(scope, (tx, current) =>
        visible(tx, current),
      );
      const used = new Map<string, InterviewEvidence>();
      const claims = draftClaims.map((claim) => {
        const source = available.find((item) => item.id === claim.source);
        if (!source)
          throw new WorkspaceError(
            "evidence-unavailable",
            `Cite only these evidence ids: ${available.map((item) => item.id).join(", ") || "(none provided)"}.`,
          );
        const quote = locateQuote(source.text, claim.quote);
        if (quote === undefined)
          throw new WorkspaceError(
            "citation-quote-conflict",
            `Quote not found in "${source.id}". Copy a passage from its text: «${source.text.slice(0, 360)}»`,
          );
        used.set(source.id, source);
        return {
          kind:
            source.sourceKind === "technical-reference"
              ? ("technical" as const)
              : claim.metric
                ? ("candidate-metric" as const)
                : ("candidate-fact" as const),
          field: claim.field,
          text: claim.text,
          ...(claim.metric ? { metric: claim.metric } : {}),
          citations: [
            {
              id: source.id,
              revision: source.revision,
              sha256: source.sha256,
              quote,
            },
          ],
        };
      });
      return {
        patch: jsonValueSchema.parse({
          ...patch,
          ...(claims.length ? { claims } : {}),
        }) as Record<string, JsonValue>,
        evidenceRefs: [...used.values()].map((source) => ({
          id: source.id,
          revision: source.revision,
        })),
      };
    },
    descriptor: {
      id: "interview",
      version: interviewAdapterVersion,
      operations: {
        getContext: op(
          "interview:read",
          wire(originSchema),
          wire(productContextSchema),
        ),
        searchEvidence: op(
          "interview:evidence:read",
          wire(z.strictObject({ query: z.string().trim().min(1).max(2048) })),
          wire(evidenceListSchema),
        ),
        validateProposal: op("interview:review", wire(proposalSchema), true),
        applyProposal: op(
          "interview:edit",
          wire(proposalSchema),
          wire(receiptSchema),
        ),
        runCode: op(
          "interview:run-code",
          wire(z.strictObject({ origin: originSchema, requestId: idSchema })),
          wire(z.strictObject({ receiptId: idSchema, passed: z.boolean() })),
        ),
      },
    },
    getContext: async (scope, origin) =>
      workspace.transaction(scope, async (tx, scope) => {
        const current = await workspace.readTransaction(
          tx,
          scope,
          origin.workspaceId,
          origin.artifactId,
        );
        const sources = await visible(tx, scope);
        return {
          origin: current.origin,
          instructions: interviewPrompt.instructions,
          context: jsonValueSchema.parse({
            prompt: {
              version: interviewPrompt.version,
              taskProfile: interviewPrompt.taskProfile,
            },
            question: current.value.question,
            notes: current.value.notes,
            answer: current.value.answer,
            outline: outlineOf(current.value.answer),
            provenance: current.provenance,
            evidenceMetadata: sources.map((source) => ({
              id: source.id,
              revision: source.revision,
              sha256: source.sha256,
              sourceKind: source.sourceKind,
              metrics: source.metrics ?? [],
            })),
          }),
          evidence: sources.map(genericEvidence),
        };
      }),
    searchEvidence: async (scope, query, signal) => {
      signal?.throwIfAborted();
      z.string().trim().min(1).max(2048).parse(query);
      const found = await workspace.transaction(scope, async (tx, scope) =>
        (await visible(tx, scope, query)).map(genericEvidence),
      );
      signal?.throwIfAborted();
      return found;
    },
    authorizeProposal: async (tx, scope, raw) => {
      const proposal = proposalSchema.parse(raw);
      for (const cited of citedSources(proposal)) {
        const head = await workspace.latestEvidenceTransaction(
          tx,
          scope,
          cited.id,
        );
        if (
          !head.audience.includes(scope.actorId) ||
          !(await authority.authorizeEvidence(scope, head, tx))
        )
          throw new WorkspaceError("evidence-forbidden");
        const source = await workspace.readEvidenceTransaction(
          tx,
          scope,
          cited.id,
          cited.revision,
          false,
        );
        await permitted(scope, source, tx, authority);
      }
    },
    validateProposal: async (scope, proposal) => {
      await workspace.transaction(scope, async (tx, scope) => {
        await validate(tx, scope, proposal);
      });
    },
    supportsPartialApply: true,
    describeProposal: async (scope, proposal) => {
      const patch = interviewProposalPatchSchema.parse(proposal.patch);
      const current = await workspace.read(
        scope,
        proposal.origin.workspaceId,
        proposal.origin.artifactId,
      );
      return describeChanges(current.value, patch);
    },
    applyProposal: async (tx, scope, proposal, options) => {
      const checked = await validate(tx, scope, proposal);
      const { claims, ...patch } = options?.surfaces
        ? pickSurfaces(checked.patch, checked.current.value, options.surfaces)
        : checked.patch;
      const edited = await workspace.editTransaction(
        tx,
        scope,
        checked.current.origin,
        patch,
      );
      await workspace.rememberReplacedTransaction(
        tx,
        scope,
        proposal.id,
        edited,
        checked.current,
      );
      if (patch.answer) {
        const provenance: InterviewProvenance = {
          proposalId: proposal.id,
          draftRevision: edited.origin.artifactRevision,
          acceptedDraftRevision: edited.origin.artifactRevision,
          promptVersion: interviewPrompt.version,
          adapterVersion: interviewAdapterVersion,
          claims: claims ?? [],
          sources: [...checked.sources.values()].map((source) => ({
            id: source.id,
            revision: source.revision,
            sha256: source.sha256,
            sourceKind: source.sourceKind,
            classification: source.classification,
            audience: [...source.audience],
            locator: source.locator,
          })),
        };
        await workspace.setProvenanceTransaction(
          tx,
          scope,
          edited.origin,
          provenance,
        );
      }
      return {
        proposalId: proposal.id,
        artifactRevision: edited.origin.artifactRevision,
      };
    },
    revertProposal: async (tx, scope, proposal) => {
      await workspace.revertTransaction(tx, scope, proposal.id);
    },
    runCode: async (scope, request, signal) => {
      signal.throwIfAborted();
      const origin = originSchema.parse(request.origin),
        requestId = idSchema.parse(request.requestId);
      if (!options.runner) throw new WorkspaceError("runner-unavailable");
      const operation = await workspace.transaction(
        scope,
        async (tx, scope) => {
          const existing = await workspace.readEffectTransaction(
            tx,
            scope,
            "run-code",
            requestId,
          );
          if (existing) {
            const bound = originSchema.parse(
              (existing.payload as Record<string, unknown>)["origin"],
            );
            if (JSON.stringify(bound) !== JSON.stringify(origin))
              throw new WorkspaceError("idempotency-conflict");
            return {
              effect: { fresh: false, ...existing },
              answer: null,
              codeFingerprint: null,
            };
          }
          const current = await workspace.readTransaction(
            tx,
            scope,
            origin.workspaceId,
            origin.artifactId,
            true,
          );
          if (current.origin.artifactRevision !== origin.artifactRevision)
            throw new WorkspaceError("revision-conflict");
          if (!current.value.answer)
            throw new WorkspaceError("answer-required");
          const { language, code, usageCode, testCode } = current.value.answer;
          const codeFingerprint = createHash("sha256")
            .update(
              JSON.stringify({
                language,
                code,
                usageCode,
                testCode,
                stdin: "",
              }),
            )
            .digest("hex");
          const effect = await workspace.beginEffectTransaction(
            tx,
            scope,
            "run-code",
            requestId,
            { origin, codeFingerprint },
          );
          return { effect, answer: current.value.answer, codeFingerprint };
        },
      );
      if (!operation.effect.fresh) {
        if (operation.effect.state !== "completed")
          throw new WorkspaceError("effect-interrupted");
        return z
          .strictObject({
            receipt: z.strictObject({
              receiptId: idSchema,
              passed: z.boolean(),
            }),
            execution: runResultSchema,
          })
          .parse(operation.effect.result).receipt;
      }
      try {
        signal.throwIfAborted();
        // Legacy CodeRunner has no native AbortSignal method. Ignore a late result
        // after cancellation and retain a durable ambiguous receipt, never rerun.
        const result = runResultSchema.parse(
          await options.runner.runAll({ ...operation.answer!, stdin: "" }),
        );
        signal.throwIfAborted();
        const receipt = {
          receiptId: operation.effect.id,
          passed: result.exitCode === 0 && !result.timedOut,
        };
        await workspace.transaction(scope, async (tx, scope) => {
          await workspace.completeEffectTransaction(
            tx,
            scope,
            "run-code",
            requestId,
            { receipt, execution: result },
          );
        });
        return receipt;
      } catch (error) {
        await workspace.interruptEffect(scope, requestId);
        throw error;
      }
    },
  };
}

// The parts of an interview draft a proposal can change, as people name them.
const SURFACES = [
  { id: "question", label: "Question", icon: "quiz" },
  { id: "title", label: "Title", icon: "title" },
  { id: "answerMarkdown", label: "Answer", icon: "notes" },
  { id: "code", label: "Main Solution", icon: "code" },
  { id: "usageCode", label: "Usage / Output", icon: "terminal" },
  { id: "testCode", label: "Tests", icon: "science" },
  { id: "notes", label: "Notes", icon: "edit_note" },
] as const;
type Draft = z.infer<typeof interviewDraftSchema>;
type ProposalPatch = z.infer<typeof interviewProposalPatchSchema>;
const ANSWER_FIELDS = [
  "title",
  "answerMarkdown",
  "code",
  "usageCode",
  "testCode",
] as const;
type AnswerField = (typeof ANSWER_FIELDS)[number];

const lineCount = (text: string) => (text ? text.split("\n").length : 0);
// What each changed surface looks like before and after, for review.
export function describeChanges(current: Draft, patch: ProposalPatch) {
  const language = patch.answer?.language ?? current.answer?.language ?? "text";
  const pairs: Record<
    string,
    { before: string; after: string; language?: string }
  > = {};
  if (patch.question !== undefined && patch.question !== current.question)
    pairs["question"] = { before: current.question, after: patch.question };
  if (patch.notes !== undefined && patch.notes !== current.notes)
    pairs["notes"] = {
      before: current.notes,
      after: patch.notes,
      language: "markdown",
    };
  if (patch.answer)
    for (const field of ANSWER_FIELDS) {
      const before = current.answer?.[field] ?? "";
      const after = patch.answer[field];
      if (before !== after)
        pairs[field] = {
          before,
          after,
          language:
            field === "answerMarkdown"
              ? "markdown"
              : field === "title"
                ? "text"
                : language,
        };
    }
  return SURFACES.filter((surface) => pairs[surface.id]).map((surface) => {
    const pair = pairs[surface.id]!;
    const added = Math.max(0, lineCount(pair.after) - lineCount(pair.before));
    return {
      id: surface.id,
      label: surface.label,
      icon: surface.icon,
      description: !pair.before
        ? `Add ${lineCount(pair.after)} line${lineCount(pair.after) === 1 ? "" : "s"}`
        : added
          ? `Change and add ${added} line${added === 1 ? "" : "s"}`
          : "Change in place",
      ...(pair.language ? { language: pair.language } : {}),
      before: pair.before,
      after: pair.after,
    };
  });
}

// Only the surfaces the person picked. Answer fields merge into the current
// answer; without one, the answer is all or nothing. Claims support the prose,
// so they go only when the prose does.
export function pickSurfaces(
  patch: ProposalPatch,
  current: Draft,
  surfaces: readonly string[],
): ProposalPatch {
  const picked = new Set(surfaces);
  const fields = ANSWER_FIELDS.filter((field) => picked.has(field));
  let answer: ProposalPatch["answer"];
  if (patch.answer && fields.length)
    answer = current.answer
      ? {
          ...current.answer,
          ...Object.fromEntries(
            fields.map((field: AnswerField) => [field, patch.answer![field]]),
          ),
          ...(picked.has("code") ? { language: patch.answer.language } : {}),
        }
      : patch.answer;
  const next = {
    ...(picked.has("question") && patch.question !== undefined
      ? { question: patch.question }
      : {}),
    ...(picked.has("notes") && patch.notes !== undefined
      ? { notes: patch.notes }
      : {}),
    ...(answer ? { answer } : {}),
    ...(answer && picked.has("answerMarkdown") && patch.claims
      ? { claims: patch.claims }
      : {}),
  };
  if (!Object.keys(next).length)
    throw new WorkspaceError(
      "proposal-invalid",
      "Pick at least one change to apply.",
    );
  return next as ProposalPatch;
}
