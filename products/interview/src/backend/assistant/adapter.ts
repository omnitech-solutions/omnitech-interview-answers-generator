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
import { INTERVIEW_PRODUCT_ID } from "../../assistant-profile.js";
import { userEditedBriefing } from "../briefing/edits.js";
import { BriefingRepository } from "../briefing/repository.js";
import {
  answerGuideSchema,
  type BriefingDraft,
  guideText,
  type InterviewProvenance,
  interviewClaimsSchema,
  interviewMetricSchema,
  languageSchema,
  renderGuideMarkdown,
  runResultSchema,
} from "@omnitech/interview-contracts";
import { z } from "zod";
import {
  answerProse,
  type EvidenceAuthority,
  genericEvidence,
  permitted,
  validateClaims,
} from "./evidence.js";
import {
  briefingPrompt,
  conceptBriefPrompt,
  interviewAdapterVersion,
  interviewPrompt,
} from "./prompt.js";
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
      patch.answer !== undefined ||
      patch.briefing !== undefined,
    "Empty patch",
  );
// Spoken concept and system-design briefs live outside the drafts store; the
// assistant reads them but cannot change them.
export const CONCEPT_BRIEFS_WORKSPACE = "concept-briefs";
// What the model sends to change a pack's answers: each answer by its id.
const briefingAnswerEditSchema = z.strictObject({
  id: z.string().min(1).max(256),
  answerMarkdown: z.string().trim().min(1).max(32_000).optional(),
  talkingPoints: z
    .array(z.string().trim().min(1).max(2_000))
    .length(3)
    .optional(),
});
// What the model is asked for. A claim names the source and the supporting
// passage; revision, hash, claim kind and the exact quote are derived below, so
// the model never hand-copies bookkeeping.
const draftClaimSchema = z.strictObject({
  field: z.enum(["answerMarkdown", "code", "usageCode", "testCode", "guide"]),
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
// empty default would overwrite what is already there. There is no
// answerMarkdown: it is rendered from the guide.
const partialAnswerSchema = z.strictObject({
  title: z.string().max(256).trim().min(1).optional(),
  language: languageSchema.optional(),
  code: z.string().max(100_000).optional(),
  usageCode: z.string().max(100_000).optional(),
  testCode: z.string().max(100_000).optional(),
  guide: answerGuideSchema.optional(),
  claims: draftClaimsSchema,
});
export const interviewModelDraftSchema = interviewDraftPatchSchema
  .omit({ briefing: true })
  .extend({
    answer: partialAnswerSchema.nullable().optional(),
    claims: draftClaimsSchema,
    briefingAnswers: z
      .array(briefingAnswerEditSchema)
      .min(1)
      .max(20)
      .optional(),
  });

// [DOMAIN] A pack's answers edited by id; nothing else in the pack changes,
// and each edited answer is marked for the person to review.
function editedBriefing(
  briefing: BriefingDraft,
  edits: z.infer<typeof briefingAnswerEditSchema>[],
): BriefingDraft {
  const known = briefing.questions.map((question) => question.id);
  for (const edit of edits)
    if (!known.includes(edit.id))
      throw new WorkspaceError(
        "proposal-invalid",
        `Unknown answer id "${edit.id}". Use one of: ${known.join(", ") || "(the pack has no answers yet)"}.`,
      );
  return userEditedBriefing(
    {
      ...briefing,
      questions: briefing.questions.map((question) => {
        const edit = edits.find((item) => item.id === question.id);
        return edit
          ? {
              ...question,
              ...(edit.answerMarkdown
                ? { answerMarkdown: edit.answerMarkdown }
                : {}),
              ...(edit.talkingPoints
                ? { talkingPoints: edit.talkingPoints }
                : {}),
              accepted: false,
            }
          : question;
      }),
    },
    briefing,
  );
}

// Only the answers of a pack may change through a proposal.
const packShape = (briefing: BriefingDraft) =>
  JSON.stringify({
    ...briefing,
    questions: briefing.questions.map(({ id, question, category }) => ({
      id,
      question,
      category,
    })),
  });

// What the assistant sees of a pack: everything needed to coach the person,
// with evidence as the quotes behind each answer. [DOMAIN] The employer's
// material and the person's own are kept apart, so a model never reports the
// person's background or answers as facts about the company.
function packContext(
  briefing: BriefingDraft,
  roles: readonly {
    company: string;
    title: string;
    period?: string | undefined;
  }[],
) {
  const { evidenceRefs: _refs, ...prepared } = briefing.prepared ?? {
    evidenceRefs: [],
  };
  const {
    request,
    candidatePreferences,
    profile: _profile,
    roleIds: _roleIds,
    ...employer
  } = briefing.context;
  return {
    kind: "behavioural-briefing-pack",
    title: briefing.title,
    employer,
    you: {
      ...(request ? { request } : {}),
      ...(candidatePreferences ? { candidatePreferences } : {}),
      matrixRoles: roles.map((role, index) => ({
        roleId: `/roles/${index}`,
        company: role.company,
        title: role.title,
        ...(role.period ? { period: role.period } : {}),
      })),
      expectedQuestions: briefing.expected ?? [],
      answers: briefing.questions.map((question) => ({
        id: question.id,
        question: question.question,
        category: question.category,
        answerMarkdown: question.answerMarkdown,
        talkingPoints: question.talkingPoints,
        accepted: Boolean(question.accepted),
        gaps: question.gaps,
        evidence: question.evidenceRefs.map(({ pointer, quote }) => ({
          pointer,
          quote,
        })),
      })),
    },
    preparedBriefing: briefing.prepared ? prepared : null,
  };
}
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
  const briefings = new BriefingRepository(database);
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
    const unchanged = (
      ["question", "notes", "answer", "briefing"] as const
    ).every(
      (key) =>
        patch[key] === undefined ||
        JSON.stringify(patch[key]) === JSON.stringify(current.value[key]),
    );
    if (unchanged) throw new WorkspaceError("no-change");
    // [GUARD] A pack and a coding answer never mix, and a proposal may change
    // a pack's answers only; their evidence is re-derived, never trusted.
    const pack = current.value.briefing;
    if (pack && patch.answer !== undefined)
      throw new WorkspaceError(
        "proposal-invalid",
        "This is a briefing pack: change its answers with briefingAnswers.",
      );
    if (patch.briefing !== undefined) {
      if (
        !pack ||
        !patch.briefing ||
        packShape(patch.briefing) !== packShape(pack)
      )
        throw new WorkspaceError(
          "proposal-invalid",
          "A proposal may change a pack's answers only.",
        );
      patch.briefing = userEditedBriefing(patch.briefing, pack);
    }
    if (patch.answer) {
      // Only new prose needs a source behind it; changing code or tests does not.
      validateClaims(patch.answer, patch.claims ?? [], sources, {
        proseChanged:
          !current.value.answer ||
          answerProse(patch.answer) !== answerProse(current.value.answer),
      });
    } else if (patch.claims?.length)
      throw new WorkspaceError("claim-answer-required");
    return { proposal, patch, sources, current };
  };
  return {
    draftSchema: interviewModelDraftJsonSchema,
    buildProposal: async (scope, origin, raw) => {
      if (origin.workspaceId === CONCEPT_BRIEFS_WORKSPACE)
        throw new WorkspaceError(
          "proposal-invalid",
          "Concept briefs can't be changed from the assistant. Build a new brief in Briefings instead.",
        );
      const parsed = interviewModelDraftSchema.safeParse(raw);
      if (!parsed.success) throw new WorkspaceError("proposal-invalid");
      const {
        claims: besideClaims = [],
        answer: draftAnswer,
        briefingAnswers,
        ...rest
      } = parsed.data;
      const readDraft = () =>
        workspace.transaction(scope, (tx, current) =>
          workspace.readTransaction(
            tx,
            current,
            origin.workspaceId,
            origin.artifactId,
          ),
        );
      if (briefingAnswers) {
        const pack = (await readDraft()).value.briefing;
        if (!pack)
          throw new WorkspaceError(
            "proposal-invalid",
            "briefingAnswers only apply to a briefing pack.",
          );
        if (
          draftAnswer !== undefined ||
          rest.question !== undefined ||
          rest.notes !== undefined ||
          besideClaims.length
        )
          throw new WorkspaceError(
            "proposal-invalid",
            "In a briefing pack, change answers only, with briefingAnswers.",
          );
        return {
          patch: jsonValueSchema.parse({
            briefing: editedBriefing(pack, briefingAnswers),
          }) as Record<string, JsonValue>,
          evidenceRefs: [],
        };
      }
      const { claims: insideClaims = [], ...answerFields } = draftAnswer ?? {};
      let mergedAnswer: z.infer<typeof completeAnswerSchema> | null | undefined;
      if (draftAnswer === null) mergedAnswer = null;
      else if (draftAnswer !== undefined) {
        const record = await readDraft();
        if (record.value.briefing)
          throw new WorkspaceError(
            "proposal-invalid",
            "This is a briefing pack: change its answers with briefingAnswers.",
          );
        // The changed fields over the current answer; its Markdown is always
        // rendered from the resulting guide.
        const fields = { ...(record.value.answer ?? {}), ...answerFields };
        const complete = completeAnswerSchema.safeParse({
          ...fields,
          ...(fields.guide
            ? { answerMarkdown: renderGuideMarkdown(fields.guide) }
            : {}),
        });
        if (!complete.success)
          throw new WorkspaceError(
            "proposal-invalid",
            "There is no answer to change yet. A new answer needs all of: title, language, guide, code, usageCode, testCode.",
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
      id: INTERVIEW_PRODUCT_ID,
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
        if (origin.workspaceId === CONCEPT_BRIEFS_WORKSPACE) {
          const [row] = await tx.query(
            "SELECT kind,topic,value FROM interview.concept_briefs WHERE tenant_id=$1 AND actor_id=$2 AND product_id=$3 AND id=$4",
            [scope.tenantId, scope.actorId, scope.productId, origin.artifactId],
          );
          if (!row) throw new WorkspaceError("not-found");
          return {
            origin: { ...origin, artifactRevision: 0 },
            instructions: conceptBriefPrompt.instructions,
            context: jsonValueSchema.parse({
              prompt: {
                version: conceptBriefPrompt.version,
                taskProfile: conceptBriefPrompt.taskProfile,
              },
              kind: row["kind"],
              topic: row["topic"],
              brief: row["value"],
            }),
            evidence: [],
          };
        }
        const current = await workspace.readTransaction(
          tx,
          scope,
          origin.workspaceId,
          origin.artifactId,
        );
        const pack = current.value.briefing;
        if (pack) {
          const profile = await briefings
            .getProfileRevisionTransaction(
              tx,
              scope,
              pack.context.profile.id,
              pack.context.profile.revision,
            )
            .catch(() => null);
          return {
            origin: current.origin,
            instructions: briefingPrompt.instructions,
            context: jsonValueSchema.parse({
              prompt: {
                version: briefingPrompt.version,
                taskProfile: briefingPrompt.taskProfile,
              },
              ...packContext(pack, profile?.matrix.roles ?? []),
            }),
            evidence: [],
          };
        }
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
        // CodeRunner.runAll takes no AbortSignal. Ignore a late result after
        // cancellation and retain a durable ambiguous receipt, never rerun.
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
  { id: "guide", label: "Guide", icon: "checklist" },
  { id: "code", label: "Main Solution", icon: "code" },
  { id: "usageCode", label: "Usage / Output", icon: "terminal" },
  { id: "testCode", label: "Tests", icon: "science" },
  { id: "notes", label: "Notes", icon: "edit_note" },
] as const;
type Draft = z.infer<typeof interviewDraftSchema>;
type ProposalPatch = z.infer<typeof interviewProposalPatchSchema>;
// answerMarkdown is not among them: it follows the guide.
const ANSWER_FIELDS = ["title", "code", "usageCode", "testCode"] as const;
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
          language: field === "title" ? "text" : language,
        };
    }
  // A guide is reviewed as one readable surface; the Markdown rendered from
  // it is not a separate change to pick.
  if (patch.answer) {
    const before = current.answer ? guideText(current.answer.guide) : "";
    const after = guideText(patch.answer.guide);
    if (before !== after) pairs["guide"] = { before, after, language: "text" };
  }
  const surfaces = [
    ...SURFACES.filter((surface) => pairs[surface.id]),
    ...changedAnswers(current.briefing, patch.briefing).map(
      ({ id, label, before, after }) => {
        pairs[id] = { before, after, language: "markdown" };
        return { id, label, icon: "record_voice_over" } as const;
      },
    ),
  ];
  return surfaces.map((surface) => {
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

// A pack's answers a patch changes, each as one reviewable surface.
const spoken = (question: BriefingDraft["questions"][number]) =>
  [
    question.answerMarkdown,
    "",
    ...question.talkingPoints.map((point) => `- ${point}`),
  ].join("\n");
function changedAnswers(
  current: BriefingDraft | null | undefined,
  next: BriefingDraft | null | undefined,
) {
  if (!current || !next) return [];
  return next.questions.flatMap((question) => {
    const before = current.questions.find((item) => item.id === question.id);
    if (!before || spoken(before) === spoken(question)) return [];
    const label =
      question.question.length > 60
        ? `${question.question.slice(0, 59)}…`
        : question.question;
    return [
      {
        id: `briefing:${question.id}`,
        label,
        before: spoken(before),
        after: spoken(question),
      },
    ];
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
  // The guide carries the Markdown rendered from it.
  const guide = picked.has("guide");
  let answer: ProposalPatch["answer"];
  if (patch.answer && (fields.length || guide)) {
    const proposed = patch.answer;
    answer = current.answer
      ? {
          ...current.answer,
          ...Object.fromEntries(
            fields.map((field: AnswerField) => [field, proposed[field]]),
          ),
          ...(picked.has("code") ? { language: proposed.language } : {}),
          ...(guide
            ? { guide: proposed.guide, answerMarkdown: proposed.answerMarkdown }
            : {}),
        }
      : proposed;
  }
  // Pack answers are picked one by one; the rest keep their current text.
  const briefing =
    patch.briefing && current.briefing
      ? userEditedBriefing(
          {
            ...current.briefing,
            questions: current.briefing.questions.map(
              (question) =>
                (picked.has(`briefing:${question.id}`) &&
                  patch.briefing!.questions.find(
                    (item) => item.id === question.id,
                  )) ||
                question,
            ),
          },
          current.briefing,
        )
      : undefined;
  const next = {
    ...(briefing && changedAnswers(current.briefing, briefing).length > 0
      ? { briefing }
      : {}),
    ...(picked.has("question") && patch.question !== undefined
      ? { question: patch.question }
      : {}),
    ...(picked.has("notes") && patch.notes !== undefined
      ? { notes: patch.notes }
      : {}),
    ...(answer ? { answer } : {}),
    ...(answer && guide && patch.claims ? { claims: patch.claims } : {}),
  };
  if (!Object.keys(next).length)
    throw new WorkspaceError(
      "proposal-invalid",
      "Pick at least one change to apply.",
    );
  return next as ProposalPatch;
}
