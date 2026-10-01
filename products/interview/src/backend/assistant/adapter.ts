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
} from "@omni-assistant/contracts";
import type { CodeRunner } from "@omnitech/code-runner";
import {
  type InterviewProvenance,
  interviewClaimsSchema,
  interviewMetricSchema,
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
export const interviewModelDraftSchema = interviewDraftPatchSchema.extend({
  answer: interviewDraftPatchSchema.shape.answer
    .unwrap()
    .unwrap()
    .extend({ claims: draftClaimsSchema })
    .nullable()
    .optional(),
  claims: draftClaimsSchema,
});
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
    if (current.origin.artifactRevision !== proposal.origin.artifactRevision)
      throw new WorkspaceError("revision-conflict");
    // A proposal that changes nothing is not worth a review; the model is told.
    const unchanged = (["question", "notes", "answer"] as const).every(
      (key) =>
        patch[key] === undefined ||
        JSON.stringify(patch[key]) === JSON.stringify(current.value[key]),
    );
    if (unchanged) throw new WorkspaceError("no-change");
    if (patch.answer) {
      validateClaims(patch.answer, patch.claims ?? [], sources);
    } else if (patch.claims?.length)
      throw new WorkspaceError("claim-answer-required");
    return { proposal, patch, sources };
  };
  return {
    draftSchema: interviewModelDraftJsonSchema,
    buildProposal: async (scope, _origin, raw) => {
      const parsed = interviewModelDraftSchema.safeParse(raw);
      if (!parsed.success) throw new WorkspaceError("proposal-invalid");
      const {
        claims: besideClaims = [],
        answer: draftAnswer,
        ...rest
      } = parsed.data;
      const { claims: insideClaims = [], ...answerFields } = draftAnswer ?? {};
      const patch = {
        ...rest,
        ...(draftAnswer === undefined
          ? {}
          : { answer: draftAnswer === null ? null : answerFields }),
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
    applyProposal: async (tx, scope, proposal) => {
      const checked = await validate(tx, scope, proposal);
      const { claims, ...patch } = checked.patch;
      const edited = await workspace.editTransaction(
        tx,
        scope,
        checked.proposal.origin,
        patch,
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
