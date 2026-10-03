// Per-claim source verification for session answers (ADR-0011 rule:no-promotion,
// plan #2 D2/D3). The model returns claims; this module verifies what it
// returned against the pinned context snapshot and nothing else. It never
// searches other snapshot entries to rescue a claim: a reference either
// supports the claim it is attached to or the claim is rejected.
//
// Output is PATH:CODE strings only. A violation never copies a claim, quote or
// any other model-controlled string (rule:id-only-traces).
import {
  type ContextSnapshot,
  type ContextSource,
  isCompensationText,
  isNoticePeriodText,
  type SourceKind,
} from "./context-snapshot.js";

export const CLAIM_KINDS = [
  "matrix-backed",
  "preference-backed",
  "suggested-interpretation",
  "general-knowledge",
  "not-in-matrix",
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export type ClaimRef = {
  sourceId: string;
  revision: number;
  pointer: string;
  quote: string;
};
export type Claim = { kind: ClaimKind; text: string; refs: ClaimRef[] };

export type ClaimVerification =
  | { ok: true }
  | { ok: false; violations: readonly string[] };

// The one sentence a leaving-role draft may carry about the reason: the reason
// is the candidate's to supply, never generated.
export const LEAVING_REASON_PLACEHOLDER =
  "[candidate input needed: reason for leaving]";

export const MAX_REFS_PER_CLAIM = 8;
export const MAX_VIOLATIONS = 50;
// [DOMAIN] The cited quotes must carry at least this share of the claim's
// significant words (see significantWords). Half: a faithful paraphrase of one
// or two entries clears it easily; a claim about a topic the entry never
// mentions shares nothing and is far below it.
export const MIN_SUPPORT_SHARE = 0.5;

const normalizeText = (text: string) =>
  text.toLowerCase().replace(/\s+/g, " ").trim();

// A figure is digits with optional thousands commas or decimals, an optional %
// or k/m/b suffix and an optional lower-bound plus. Digits glued to a letter
// (S3, ec2, k8s) are identifiers, not figures. Spelled-out numbers are out of
// scope by design.
const FIGURE = /(?<![\p{L}\d.,])\d+(?:[.,]\d+)*(?:%|[kKmMbB](?![\p{L}]))?\+?/gu;

// Canonical comparison key: lower case, no thousands commas, no percent sign.
const figureKey = (figure: string) =>
  figure.toLowerCase().replaceAll(",", "").replace("%", "");

export function figuresOf(text: string): Set<string> {
  return new Set((text.match(FIGURE) ?? []).map(figureKey));
}

// A quote "4m+" supports a claim of "4m+" and of "4m"; a quote "4m" does not
// support "4m+" (an unstated lower bound is an overclaim).
function supportedFigureKeys(texts: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const text of texts)
    for (const key of figuresOf(text)) {
      keys.add(key);
      if (key.endsWith("+")) keys.add(key.slice(0, -1));
    }
  return keys;
}

const STOPWORDS = new Set(
  "that this these those with from have has had were was been being their there they them then than what when which while would could should about into over also more most some such very your will here where only each other after before during under between through because just like make made does done onto upon within without across among both many much".split(
    " ",
  ),
);

// Light, deterministic stemming so "migrated" and "migration" meet.
const SUFFIXES = ["ions", "ion", "ments", "ment", "ing", "ed", "es", "s"];
const stem = (word: string) => {
  const suffix = SUFFIXES.find(
    (item) => word.endsWith(item) && word.length - item.length >= 4,
  );
  const base = suffix ? word.slice(0, -suffix.length) : word;
  // "service" and "services" meet at "servic", "migrate" and "migration" at "migrat".
  return base.length > 4 && base.endsWith("e") ? base.slice(0, -1) : base;
};

// [DOMAIN] Significant words: lower-cased alphabetic words of length >= 4,
// minus a short stopword list, stemmed. Figures are checked separately.
export function significantWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z][a-z0-9+#]*/g) ?? [];
  return new Set(
    words.filter((word) => word.length >= 4 && !STOPWORDS.has(word)).map(stem),
  );
}

// The role prefix of a candidate pointer, e.g. "/roles/2/".
const ROLE_PREFIX = /^\/roles\/\d+\//;

export type VerifyContext = {
  snapshot: ContextSnapshot;
  captured: readonly string[];
  category: string;
  draft?: string | undefined;
};

const FIRST_PERSON = /\b(?:i|i've|i'd|i'm|my|me|we|we've|our|us)\b/i;
const EMPLOYER_OR_TIME_WORDING =
  /\b(?:employer|company|companies|team|job|role|position|manager|colleagues?|worked|previous(?:ly)?|last|current(?:ly)?|since|ago|years?|months?|used to|when i)\b|\b(?:19|20)\d{2}\b/i;

// [SAFETY] Small, documented lexicon: harsh judgement of a person or
// organisation the candidate worked for. Pairs a negative term with an
// employer-side noun so "toxicity detection" or "a terrible bug" stay fine.
const EMPLOYER_NOUN =
  "company|employer|boss|manager|managers|management|leadership|team|culture|workplace|coworkers?|colleagues?|ceo|founders?|executives?|organi[sz]ation";
const DISPARAGEMENT = [
  new RegExp(
    `\\b(?:toxic|dysfunctional|chaotic|terrible|awful|horrible|miserable|worst|incompetent|useless|clueless|corrupt)\\b(?:\\W+\\w+){0,3}?\\W+(?:${EMPLOYER_NOUN})\\b`,
    "i",
  ),
  new RegExp(
    `\\b(?:hated|despised|loathed|(?:could|can)(?:'|’)?n(?:'|’)?t stand|couldn't stand)\\b(?:\\W+\\w+){0,3}?\\W+(?:${EMPLOYER_NOUN})\\b`,
    "i",
  ),
  new RegExp(
    `\\b(?:${EMPLOYER_NOUN})\\b\\W+(?:was|were|is|are)\\s+(?:an?\\s+|so\\s+|really\\s+)?(?:incompetent|idiots?|useless|clueless|liars?|toxic|terrible|awful|a joke|corrupt)\\b`,
    "i",
  ),
  /\bmicromanag\w*|\bunderpaid\b|\blied to (?:me|us)\b/i,
];

export const disparagesEmployer = (text: string) =>
  DISPARAGEMENT.some((pattern) => pattern.test(text));

const sourceById = (snapshot: ContextSnapshot, id: string) =>
  snapshot.sources.find((source) => source.id === id);

const expectedKind = (kind: ClaimKind): SourceKind | null =>
  kind === "matrix-backed"
    ? "candidate"
    : kind === "preference-backed"
      ? "candidate-preference"
      : null;

function refPathCode(
  ref: ClaimRef,
  source: ContextSource | undefined,
  snapshot: ContextSnapshot,
  kind: SourceKind,
): string | null {
  if (!source) return "unknown_reference";
  if (source.sourceKind !== kind) return "wrong_source_kind";
  // The pinned revision: the profile's for matrix entries, the source's own
  // (the draft revision read) for context entries.
  const pinned =
    kind === "candidate" ? snapshot.profile?.revision : source.revision;
  if (
    pinned === undefined ||
    ref.revision !== pinned ||
    source.revision !== pinned
  )
    return "stale_revision";
  if (ref.pointer !== source.pointer) return "pointer_mismatch";
  const quote = normalizeText(ref.quote);
  if (!quote || !normalizeText(source.text).includes(quote))
    return "quote_mismatch";
  return null;
}

// [DOMAIN] The reference SUPPORTS the claim when every figure of the claim is
// in the cited quotes (or in the cited role's own metric values) AND the
// quotes carry at least MIN_SUPPORT_SHARE of the claim's significant words.
// Only the cited sources are consulted, never a search of the rest.
function supports(
  claimText: string,
  refs: readonly ClaimRef[],
  snapshot: ContextSnapshot,
  withMetrics: boolean,
): boolean {
  const texts = refs.map((ref) => ref.quote);
  if (withMetrics) {
    const roles = new Set(
      refs.flatMap((ref) => ref.pointer.match(ROLE_PREFIX) ?? []),
    );
    for (const source of snapshot.sources)
      if (
        source.sourceKind === "candidate" &&
        [...roles].some(
          (role) =>
            source.pointer.startsWith(`${role}metrics/`) &&
            source.pointer.endsWith("/value"),
        )
      )
        texts.push(source.text);
  }
  const allowed = supportedFigureKeys(texts);
  for (const figure of figuresOf(claimText))
    if (!allowed.has(figure)) return false;
  const claimWords = significantWords(claimText);
  if (claimWords.size === 0) return false;
  const quoteWords = significantWords(refs.map((ref) => ref.quote).join(" "));
  let shared = 0;
  for (const word of claimWords) if (quoteWords.has(word)) shared += 1;
  return shared > 0 && shared / claimWords.size >= MIN_SUPPORT_SHARE;
}

const allSourceFigures = (snapshot: ContextSnapshot) =>
  supportedFigureKeys(snapshot.sources.map((source) => source.text));

export function verifyClaims(
  claims: readonly Claim[],
  context: VerifyContext,
): ClaimVerification {
  const { snapshot, captured, category } = context;
  const violations: string[] = [];
  const flag = (path: string, code: string) => {
    const entry = `${path}:${code}`;
    if (!violations.includes(entry)) violations.push(entry);
  };
  const sourceFigures = allSourceFigures(snapshot);
  const capturedFigures = figuresOf(captured.join("\n"));
  const companies = snapshot.sources
    .filter(
      (s) =>
        s.sourceKind === "candidate" &&
        /^\/roles\/\d+\/company$/.test(s.pointer),
    )
    .map((s) => normalizeText(s.text));
  const logistics = category === "logistics";
  const leavingRole = category === "leaving-role";
  // Figures that a preference-backed claim legitimately carries, for the
  // logistics draft check.
  const preferenceFigures = new Set<string>();

  for (const [index, claim] of claims.entries()) {
    const at = `claims.${index}`;
    if (!CLAIM_KINDS.includes(claim.kind)) {
      flag(`${at}.kind`, "unknown_kind");
      continue;
    }
    if (disparagesEmployer(claim.text)) flag(at, "disparages_employer");
    const refs = Array.isArray(claim.refs) ? claim.refs : [];
    if (refs.length > MAX_REFS_PER_CLAIM)
      flag(`${at}.refs`, "too_many_references");
    const claimFigures = figuresOf(claim.text);
    const preferenceOnlyTopic =
      isNoticePeriodText(claim.text) || isCompensationText(claim.text);

    // Matrix-backed and preference-backed: every ref must verify, then the
    // refs together must support the claim.
    const required = expectedKind(claim.kind);
    if (required) {
      if (preferenceOnlyTopic && claim.kind !== "preference-backed")
        flag(at, "preference_only_topic");
      if (logistics && claim.kind !== "preference-backed" && claimFigures.size)
        flag(at, "ungrounded_logistics_figure");
      if (refs.length === 0) {
        flag(`${at}.refs`, "missing_reference");
        continue;
      }
      let structurallyValid = true;
      for (const [refIndex, ref] of refs.entries()) {
        const code = refPathCode(
          ref,
          sourceById(snapshot, ref.sourceId),
          snapshot,
          required,
        );
        if (code) {
          flag(`${at}.refs.${refIndex}`, code);
          structurallyValid = false;
        }
      }
      if (
        structurallyValid &&
        !supports(claim.text, refs, snapshot, claim.kind === "matrix-backed")
      )
        for (const refIndex of refs.keys())
          flag(`${at}.refs.${refIndex}`, "unsupported_reference");
      if (structurallyValid && claim.kind === "preference-backed")
        for (const ref of refs)
          for (const key of figuresOf(ref.quote)) preferenceFigures.add(key);
      continue;
    }

    // Everything below carries no refs.
    if (refs.length > 0) flag(`${at}.refs`, "unexpected_reference");
    if (claim.kind === "not-in-matrix") {
      if (preferenceOnlyTopic) flag(at, "preference_only_topic");
      for (const key of claimFigures)
        if (!capturedFigures.has(key)) {
          flag(
            at,
            logistics ? "ungrounded_logistics_figure" : "ungrounded_figure",
          );
          break;
        }
      continue;
    }

    // suggested-interpretation and general-knowledge.
    if (leavingRole) {
      const placeholder =
        claim.kind === "suggested-interpretation" &&
        normalizeText(claim.text) === normalizeText(LEAVING_REASON_PLACEHOLDER);
      if (!placeholder) flag(at, "generated_reason");
    }
    if (preferenceOnlyTopic) flag(at, "preference_only_topic");
    if (logistics && claimFigures.size) {
      flag(at, "ungrounded_logistics_figure");
      continue;
    }
    for (const key of claimFigures) {
      if (capturedFigures.has(key) && !sourceFigures.has(key)) {
        // [SAFETY] Hazard 7b: a figure the interviewer said aloud and the
        // sources lack must not be echoed as fact.
        flag(at, "spoken_figure");
        break;
      }
      if (
        claim.kind === "suggested-interpretation" &&
        !sourceFigures.has(key)
      ) {
        flag(at, "ungrounded_figure");
        break;
      }
    }
    if (claim.kind === "general-knowledge") {
      const lower = normalizeText(claim.text);
      if (
        (FIRST_PERSON.test(claim.text) &&
          EMPLOYER_OR_TIME_WORDING.test(claim.text)) ||
        companies.some((company) => company && lower.includes(company))
      )
        flag(at, "personal_claim_unsourced");
    }
  }

  if (context.draft !== undefined) {
    if (disparagesEmployer(context.draft)) flag("draft", "disparages_employer");
    if (logistics)
      for (const key of figuresOf(context.draft))
        if (!preferenceFigures.has(key)) {
          flag("draft", "ungrounded_logistics_figure");
          break;
        }
  }

  return violations.length
    ? { ok: false, violations: violations.slice(0, MAX_VIOLATIONS) }
    : { ok: true };
}

// Counts per kind (zero-filled), for traces: no text, no refs.
export function summarizeClaims(
  claims: readonly Claim[],
): Record<ClaimKind, number> {
  const counts = Object.fromEntries(
    CLAIM_KINDS.map((kind) => [kind, 0]),
  ) as Record<ClaimKind, number>;
  for (const claim of claims) if (claim.kind in counts) counts[claim.kind] += 1;
  return counts;
}
