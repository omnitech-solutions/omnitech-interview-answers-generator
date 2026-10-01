import { createHash } from "node:crypto";
import type { Evidence, Scope, Transaction } from "@omni-assistant/contracts";
import type { InterviewClaim } from "@omnitech/interview-contracts";
import {
  type InterviewDraft,
  type InterviewEvidence,
  WorkspaceError,
} from "./workspace.js";
export interface EvidenceAuthority {
  authorizeEvidence(
    scope: Scope,
    source: InterviewEvidence,
    tx: Transaction,
  ): Promise<boolean>;
  verifyTechnicalReference(
    scope: Scope,
    source: InterviewEvidence,
    tx: Transaction,
  ): Promise<boolean>;
}
export function genericEvidence(source: InterviewEvidence): Evidence {
  const { sourceKind: _kind, metrics: _metrics, ...generic } = source;
  return generic;
}
export async function permitted(
  scope: Scope,
  source: InterviewEvidence,
  tx: Transaction,
  authority: EvidenceAuthority,
): Promise<void> {
  if (
    !source.audience.includes(scope.actorId) ||
    !(await authority.authorizeEvidence(scope, source, tx))
  )
    throw new WorkspaceError("evidence-forbidden");
  if (createHash("sha256").update(source.text).digest("hex") !== source.sha256)
    throw new WorkspaceError("evidence-hash-conflict");
  if (
    source.sourceKind === "technical-reference" &&
    !(await authority.verifyTechnicalReference(scope, source, tx))
  )
    throw new WorkspaceError("reference-unverified");
}
// Bounded structural checks, not a general truth/entailment detector. A trusted
// ingestion action supplies candidate metrics; no model-minted verification.
export function validateClaims(
  answer: NonNullable<InterviewDraft["answer"]>,
  claims: readonly InterviewClaim[],
  sources: ReadonlyMap<string, InterviewEvidence>,
): void {
  if (!claims.length) throw new WorkspaceError("missing-citation");
  for (const claim of claims) {
    if (
      claim.kind === "candidate-fact" &&
      /\b\d+(?:\.\d+)?\s*(?:%|percent|ms|users|requests)/.test(claim.text)
    )
      throw new WorkspaceError("unsupported-metric");
    if (claim.kind === "technical" && /\b(?:I|my|we|our)\b/i.test(claim.text))
      throw new WorkspaceError("source-kind-conflict");
    if (!answer[claim.field].includes(claim.text))
      throw new WorkspaceError("claim-text-conflict");
    for (const citation of claim.citations) {
      const source = sources.get(`${citation.id}:${citation.revision}`);
      if (!source) throw new WorkspaceError("evidence-unavailable");
      if (source.sha256 !== citation.sha256)
        throw new WorkspaceError("evidence-hash-conflict");
      if (
        (claim.kind === "technical") !==
        (source.sourceKind === "technical-reference")
      )
        throw new WorkspaceError("source-kind-conflict");
      if (!source.text.includes(citation.quote))
        throw new WorkspaceError("citation-quote-conflict");
      if (claim.kind === "candidate-metric") {
        if (
          !claim.metric ||
          !source.metrics?.some(
            (metric) =>
              metric.value === claim.metric!.value &&
              metric.unit === claim.metric!.unit,
          )
        )
          throw new WorkspaceError("unsupported-metric");
        const literal = `${claim.metric.value}${claim.metric.unit}`;
        if (
          !claim.text.replace(/\s+/g, "").includes(literal) ||
          !citation.quote.replace(/\s+/g, "").includes(literal)
        )
          throw new WorkspaceError("unsupported-metric");
      } else if (claim.metric) throw new WorkspaceError("claim-kind-conflict");
      if (
        claim.kind === "candidate-fact" &&
        !citation.quote.includes(claim.text)
      )
        throw new WorkspaceError("candidate-fact-conflict");
    }
  }
  for (const personal of answer.answerMarkdown.matchAll(
    /\b(?:I|my|we|our)\b[^.!?\n]*(?:[.!?]|$)/gi,
  )) {
    if (
      !claims.some(
        (claim) =>
          claim.field === "answerMarkdown" &&
          claim.kind !== "technical" &&
          claim.text.includes(personal[0]),
      )
    )
      throw new WorkspaceError("missing-citation");
  }
  // Explicit numeric coverage prevents leaving a metric out of the structured
  // claim list. This checks literal coverage, not the truth of surrounding prose.
  for (const field of [
    "answerMarkdown",
    "code",
    "usageCode",
    "testCode",
  ] as const) {
    if (field !== "answerMarkdown") continue;
    for (const match of answer[field].matchAll(
      /\b\d+(?:\.\d+)?\s*(?:%|percent|ms|users|requests)/g,
    )) {
      if (
        !claims.some(
          (claim) => claim.field === field && claim.text.includes(match[0]),
        )
      )
        throw new WorkspaceError("missing-citation");
    }
  }
}
