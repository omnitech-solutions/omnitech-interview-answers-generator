import { createHash } from "node:crypto";
import type {
  Evidence,
  Scope,
  Transaction,
} from "@omnitech-assistant/contracts";
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
// Complete numeric/unit tokens, including signs, decimals and grouped values.
// Malformed numeric forms are retained with NaN, never accepted as a suffix.
function metricTokens(text: string, extraUnits: readonly string[]) {
  const units = [
    ...new Set(["%", "percent", "ms", "users", "requests", ...extraUnits]),
  ]
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
    .map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const token = new RegExp(
    String.raw`(?<![\p{L}\p{N}_.+-])([+-]?(?:\d[\d.,]*|\.\d+)(?:[eE][+-]?\d+)?)\s*(${units.join("|")})(?![\p{L}\p{N}_])`,
    "gu",
  );
  return [...text.matchAll(token)].map((match) => ({
    value:
      /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(
        match[1]!,
      )
        ? Number(match[1]!.replaceAll(",", ""))
        : Number.NaN,
    unit: match[2]!,
  }));
}
// Bounded structural checks, not a general truth/entailment detector. A trusted
// ingestion action supplies candidate metrics; no model-minted verification.
export function validateClaims(
  answer: NonNullable<InterviewDraft["answer"]>,
  claims: readonly InterviewClaim[],
  sources: ReadonlyMap<string, InterviewEvidence>,
): void {
  if (!claims.length) throw new WorkspaceError("missing-citation");
  const units = [
    ...[...sources.values()].flatMap(
      (source) => source.metrics?.map((metric) => metric.unit) ?? [],
    ),
    ...claims.flatMap((claim) => (claim.metric ? [claim.metric.unit] : [])),
  ];
  for (const claim of claims) {
    if (
      claim.kind === "candidate-fact" &&
      metricTokens(claim.text, units).length > 0
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
        const generated = metricTokens(claim.text, units);
        const matches = (token: { value: number; unit: string }) =>
          token.value === claim.metric!.value &&
          token.unit === claim.metric!.unit;
        if (
          !generated.length ||
          !generated.every(matches) ||
          !metricTokens(citation.quote, units).some(matches)
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
  for (const token of metricTokens(answer.answerMarkdown, units)) {
    if (
      !claims.some(
        (claim) =>
          claim.field === "answerMarkdown" &&
          metricTokens(claim.text, units).some(
            (covered) =>
              covered.value === token.value && covered.unit === token.unit,
          ),
      )
    )
      throw new WorkspaceError("missing-citation");
  }
}
