// Per-claim source verification for session answers (ADR-0011 rule:no-promotion,
// plan #2 D2/D3). The model returns claims; this module verifies what it
// returned against the pinned context snapshot and nothing else. It never
// searches other snapshot entries to rescue a claim: a reference either
// supports the claim it is attached to or the claim is rejected.
//
// Output is PATH:CODE strings only. A violation never copies a claim, quote or
// any other model-controlled string (rule:id-only-traces).
import {
  canonicalText,
  type ContextSnapshot,
  type ContextSource,
  hasConfusableText,
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
  canonicalText(text).toLowerCase().replace(/\s+/g, " ").trim();

// A figure is digits with optional thousands commas or decimals, an optional %,
// k/m/b suffix or multiplier (x, times, -fold) and an optional lower-bound
// plus. All text is canonicalised first (NFKC, ASCII digits). Digits glued to a
// letter are identifiers (S3, ec2, k8s), EXCEPT after a currency code or an x
// (USD150000, GBP90k, x40) and as a long or suffixed run (salary150000,
// base90k), which are figures. Spelled-out numbers are out of scope by design.
const NUMBER =
  "\\d+(?:[.,]\\d+)*(?:%|[kKmMbB](?!\\p{L})|[xX](?!\\p{L})|\\s?times(?!\\p{L})|-?fold(?!\\p{L}))?\\+?";
const CURRENCY_CODE = "usd|cad|eur|gbp|aud|nzd|chf|jpy|inr|cny|sek|nok|dkk";
const FIGURE_PATTERNS = [
  new RegExp(`(?<![\\p{L}\\d.,])${NUMBER}`, "gu"),
  new RegExp(`(?<=(?<!\\p{L})(?:${CURRENCY_CODE}))${NUMBER}`, "giu"),
  new RegExp(`(?<!\\p{L})[xX]${NUMBER}`, "gu"),
  new RegExp(
    `(?<=\\p{L})(?:\\d{3,}(?:[.,]\\d+)*|\\d+(?:%|[kKmMbB](?!\\p{L})))\\+?`,
    "gu",
  ),
];

// Canonical comparison key: lower case, no thousands commas, multiplier forms
// unified ("40 times", "40-fold", "x40" -> "40x"). The percent sign is KEPT:
// "40%" is a different claim from "40" (a quote of "40%" may support a bare
// "40", a bare "40" never supports "40%", see supportedFigureKeys).
const figureKey = (figure: string) => {
  const key = figure.toLowerCase().replaceAll(",", "");
  const lead = key.match(/^x(\d.*)$/);
  if (lead?.[1]) return `${lead[1]}x`;
  return key.replace(/(?:\s?times|-?fold)(\+?)$/, "x$1");
};

type FigureMatch = { raw: string; index: number };
function figureMatches(text: string): FigureMatch[] {
  const clean = canonicalText(text);
  const seen = new Set<number>();
  const found: FigureMatch[] = [];
  for (const pattern of FIGURE_PATTERNS)
    for (const match of clean.matchAll(pattern))
      if (!seen.has(match.index)) {
        seen.add(match.index);
        found.push({ raw: match[0], index: match.index });
      }
  return found;
}

export function figuresOf(text: string): Set<string> {
  return new Set(figureMatches(text).map((match) => figureKey(match.raw)));
}

// A quote "4m+" supports a claim of "4m+" and of "4m"; a quote "4m" does not
// support "4m+" (an unstated lower bound is an overclaim).
export function supportedFigureKeys(texts: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const text of texts)
    for (const key of figuresOf(text)) {
      keys.add(key);
      let base = key;
      if (base.endsWith("+")) {
        base = base.slice(0, -1);
        keys.add(base);
      }
      if (base.endsWith("%")) keys.add(base.slice(0, -1));
    }
  return keys;
}

// [DOMAIN] General-knowledge figure allowance (documented, deliberately
// small). A claim or draft that is NOT backed by a cited source may carry only:
// complexity notation (O(n^2), Theta(...)), a bare integer <= 10 (no %, k, m,
// comma), or a standards/version token introduced by a keyword (HTTP 404,
// TLS 1.3, version 2, port 443). Anything else (headcounts, percentages,
// amounts, years) must come from a verified source.
const COMPLEXITY_NOTATION = /(?<![\p{L}])[OΘΩ]\((?:[^()]|\([^()]*\))*\)/gu;
const STANDARD_TOKEN_CONTEXT =
  /(?:^|[^\p{L}])(?:http|https|rfc|iso|tls|ssl|es|ipv|status|code|port|error|version|v)\s*[-/:]?\s*$/iu;
export const MAX_GENERAL_INTEGER = 10;

// Keys of the figures in text that the general-knowledge allowance does NOT
// cover.
export function nonGeneralFigures(text: string): string[] {
  const clean = canonicalText(text).replace(COMPLEXITY_NOTATION, " ");
  const found: string[] = [];
  for (const { raw, index } of figureMatches(clean)) {
    if (/^\d+x?$/i.test(raw) && Number.parseInt(raw, 10) <= MAX_GENERAL_INTEGER)
      continue;
    if (STANDARD_TOKEN_CONTEXT.test(clean.slice(0, index))) continue;
    found.push(figureKey(raw));
  }
  return found;
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
  const words =
    canonicalText(text)
      .toLowerCase()
      .match(/\p{L}[\p{L}\p{N}+#]*/gu) ?? [];
  return new Set(
    words.filter((word) => word.length >= 4 && !STOPWORDS.has(word)).map(stem),
  );
}

// [DOMAIN] Support terms: the significant words PLUS short high-risk terms.
// A three-letter term is a risk term when it is written in capitals in the
// text (SQL, AWS, API) or is on the short list below: a fabricated "CEO",
// "CTO" or "AWS" is exactly what a four-letter minimum would let through.
const HIGH_RISK_SHORT = new Set(["ceo", "cto", "cfo", "coo", "aws", "gcp"]);
export function riskTerms(text: string): Set<string> {
  const risk = new Set<string>();
  for (const word of canonicalText(text).match(
    /(?<!\p{L})\p{L}{3}(?!\p{L})/gu,
  ) ?? []) {
    const lower = word.toLowerCase();
    if (word === word.toUpperCase() || HIGH_RISK_SHORT.has(lower))
      risk.add(lower);
  }
  return risk;
}
export function supportTerms(text: string): Set<string> {
  return new Set([...significantWords(text), ...riskTerms(text)]);
}
// [DOMAIN] The residual rule: after the share, at most this many of a claim's
// support terms may be missing from the cited quotes. One covers a connective
// the paraphrase added ("tooling"); two or more is an appended clause
// ("... and received the company excellence award"). A risk term (CEO, AWS,
// SQL) has no allowance: missing from the quotes, it rejects the claim.
export const MAX_UNMATCHED_TERMS = 1;

// The role prefix of a candidate pointer, e.g. "/roles/2/".
const ROLE_PREFIX = /^\/roles\/\d+\//;

// The distinct role prefixes of refs, and whether every ref sits in a role.
// A matrix-backed claim must come from ONE role: pooling /roles/0 metrics with
// /roles/1/company would attribute one employer's result to another.
function roleScope(refs: readonly ClaimRef[]): {
  roles: Set<string>;
  allInRole: boolean;
} {
  const roles = new Set<string>();
  let allInRole = true;
  for (const ref of refs) {
    const role = ref.pointer.match(ROLE_PREFIX)?.[0];
    if (role) roles.add(role);
    else allInRole = false;
  }
  return { roles, allInRole };
}
export const crossesRoles = (refs: readonly ClaimRef[]) => {
  const { roles, allInRole } = roleScope(refs);
  return roles.size > 1 || (roles.size === 1 && !allInRole);
};

export type VerifyContext = {
  snapshot: ContextSnapshot;
  captured: readonly string[];
  category: string;
  draft?: string | undefined;
  // The non-missing STAR elements: their text is shown to the candidate, so it
  // is verified against the claims it cites (never against claim text alone).
  star?: readonly StarElementText[] | undefined;
};
export type StarElementText = {
  element: string;
  text: string;
  claimIndexes: readonly number[];
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

// [SAFETY] A quote cut mid-word ("successfully" out of "unsuccessfully") can
// flip the meaning, so each end of the quote must meet a word boundary in the
// source (a hyphen or apostrophe joins words).
const WORD_CHAR = /[\p{L}\p{N}'’-]/u;
function quoteOnWordBoundaries(source: string, quote: string): boolean {
  const startsWord = WORD_CHAR.test(quote[0] ?? "");
  const endsWord = WORD_CHAR.test(quote.at(-1) ?? "");
  for (
    let at = source.indexOf(quote);
    at >= 0;
    at = source.indexOf(quote, at + 1)
  ) {
    const before = source[at - 1];
    const after = source[at + quote.length];
    if (startsWord && before !== undefined && WORD_CHAR.test(before)) continue;
    if (endsWord && after !== undefined && WORD_CHAR.test(after)) continue;
    return true;
  }
  return false;
}

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
  if (!quote || !quoteOnWordBoundaries(normalizeText(source.text), quote))
    return "quote_mismatch";
  return null;
}

// [DOMAIN] The reference SUPPORTS the text (a claim, or a STAR element against
// the union of its cited claims' quotes) when: every figure of the text is in
// the cited quotes (or in the cited role's own metric values); every employer
// named in the text is in the quotes or is the cited role's company; the quotes
// carry at least MIN_SUPPORT_SHARE of the text's support terms; and at most
// MAX_UNMATCHED_TERMS terms are missing (no appended clause). Only the cited
// sources are consulted, never a search of the rest.
function supports(
  text: string,
  refs: readonly ClaimRef[],
  snapshot: ContextSnapshot,
  withMetrics: boolean,
): boolean {
  const quotes = refs.map((ref) => ref.quote);
  const texts = [...quotes];
  const { roles } = roleScope(refs);
  if (withMetrics) {
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
  for (const figure of figuresOf(text)) if (!allowed.has(figure)) return false;
  // Employers named in the text must come from the cited entries.
  const lowerText = normalizeText(text);
  const lowerQuotes = normalizeText(quotes.join(" "));
  const roleCompanies = new Set(
    snapshot.sources
      .filter(
        (source) =>
          source.sourceKind === "candidate" &&
          [...roles].some((role) => source.pointer === `${role}company`),
      )
      .map((source) => normalizeText(source.text)),
  );
  // The employer's own name is verified here (quote or cited role), so its
  // words count as matched rather than as unmatched terms.
  const quoteTerms = supportTerms(quotes.join(" "));
  for (const source of snapshot.sources) {
    if (
      source.sourceKind !== "candidate" ||
      !/^\/roles\/\d+\/company$/.test(source.pointer)
    )
      continue;
    const company = normalizeText(source.text);
    if (!company || !lowerText.includes(company)) continue;
    if (!lowerQuotes.includes(company) && !roleCompanies.has(company))
      return false;
    for (const term of supportTerms(source.text)) quoteTerms.add(term);
  }
  const terms = supportTerms(text);
  if (terms.size === 0) return false;
  const quoteWords = new Set(
    canonicalText(quotes.join(" "))
      .toLowerCase()
      .match(/\p{L}+/gu) ?? [],
  );
  for (const risk of riskTerms(text))
    if (!quoteWords.has(risk) && !quoteTerms.has(risk)) return false;
  let shared = 0;
  for (const term of terms) if (quoteTerms.has(term)) shared += 1;
  return (
    shared > 0 &&
    shared / terms.size >= MIN_SUPPORT_SHARE &&
    terms.size - shared <= MAX_UNMATCHED_TERMS
  );
}

const allSourceFigures = (snapshot: ContextSnapshot) =>
  supportedFigureKeys(snapshot.sources.map((source) => source.text));

type DraftCheck = {
  flag: (path: string, code: string) => void;
  logistics: boolean;
  leavingRole: boolean;
  companies: readonly string[];
  matrixTexts: readonly string[];
  matrixClaimTexts: readonly string[];
  groundedFigures: ReadonlySet<string>;
  preferenceFigures: ReadonlySet<string>;
  capturedFigures: ReadonlySet<string>;
  sourceFigures: ReadonlySet<string>;
};

// [DOMAIN] Reason-for-leaving lexicon (leaving-role drafts). A draft sentence
// carrying any of these cues states or hints at WHY the candidate left, which
// is the candidate's to supply. Only the placeholder, or text a verified
// matrix-backed claim already states, may carry them.
const LEAVING_REASON_CUE =
  /\b(?:because|since|so that|left|leave|leaving|quit|resign\w*|fired|laid off|layoffs?|stopped|too|wanted|wants?|burn(?:ed|t)?[- ]?out|redundan\w*|restructur\w*|downsiz\w*|dismiss\w*)\b/i;
const sentencesOf = (text: string) =>
  text
    .split(/[.!?\n]+/)
    .map((sentence) => normalizeText(sentence))
    .filter(Boolean);

// [SAFETY] The spoken draft is shown to the candidate whatever the model's
// category says, so it gets the grounding rules the claims get: no figure the
// verified claims do not carry, notice period and compensation only from
// preferences, employer names only beside a matrix-backed claim naming them,
// and no generated reason for leaving.
function checkDraft(draft: string, check: DraftCheck): void {
  const { flag } = check;
  if (disparagesEmployer(draft)) flag("draft", "disparages_employer");
  if (hasConfusableText(draft)) flag("draft", "confusable_text");
  const body = normalizeText(draft).replaceAll(
    normalizeText(LEAVING_REASON_PLACEHOLDER),
    " ",
  );
  const sentences = sentencesOf(draft);
  if (check.logistics) {
    for (const key of figuresOf(draft))
      if (!check.preferenceFigures.has(key)) {
        flag("draft", "ungrounded_logistics_figure");
        break;
      }
  } else {
    for (const sentence of sentences) {
      const topical =
        isCompensationText(sentence) || isNoticePeriodText(sentence);
      if (topical) {
        // Figures of notice period and compensation: preference-backed only.
        for (const key of figuresOf(sentence))
          if (!check.preferenceFigures.has(key)) {
            flag("draft", "preference_only_topic");
            break;
          }
        continue;
      }
      const loose = nonGeneralFigures(sentence).filter(
        (key) => !check.groundedFigures.has(key),
      );
      if (loose.length)
        flag(
          "draft",
          loose.some(
            (key) =>
              check.capturedFigures.has(key) && !check.sourceFigures.has(key),
          )
            ? "spoken_figure"
            : "ungrounded_figure",
        );
    }
  }
  // An employer the candidate worked for may be named only beside a
  // matrix-backed claim that names it.
  if (
    check.companies.some(
      (company) =>
        company &&
        normalizeText(draft).includes(company) &&
        !check.matrixClaimTexts.some((text) => text.includes(company)),
    )
  )
    flag("draft", "personal_claim_unsourced");
  if (check.leavingRole)
    for (const sentence of sentencesOf(body))
      if (
        LEAVING_REASON_CUE.test(sentence) &&
        !check.matrixTexts.some((text) => text.includes(sentence))
      )
        flag("draft", "generated_reason");
}

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
  // Figures a VERIFIED matrix- or preference-backed claim carries (its quotes
  // and its own text): the only non-general figures a draft may speak.
  const groundedFigures = new Set<string>();
  const matrixTexts: string[] = [];

  for (const [index, claim] of claims.entries()) {
    const at = `claims.${index}`;
    if (!CLAIM_KINDS.includes(claim.kind)) {
      flag(`${at}.kind`, "unknown_kind");
      continue;
    }
    if (disparagesEmployer(claim.text)) flag(at, "disparages_employer");
    if (hasConfusableText(claim.text)) flag(at, "confusable_text");
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
      if (claim.kind === "matrix-backed" && crossesRoles(refs)) {
        flag(`${at}.refs`, "cross_role_references");
        structurallyValid = false;
      }
      for (const [refIndex, ref] of refs.entries()) {
        if (hasConfusableText(ref.quote)) {
          flag(`${at}.refs.${refIndex}`, "confusable_text");
          structurallyValid = false;
        }
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
      const supported =
        structurallyValid &&
        supports(claim.text, refs, snapshot, claim.kind === "matrix-backed");
      if (structurallyValid && !supported)
        for (const refIndex of refs.keys())
          flag(`${at}.refs.${refIndex}`, "unsupported_reference");
      if (supported) {
        if (claim.kind === "matrix-backed")
          matrixTexts.push(normalizeText(claim.text));
        for (const key of supportedFigureKeys([
          claim.text,
          ...refs.map((ref) => ref.quote),
        ]))
          groundedFigures.add(key);
        if (claim.kind === "preference-backed")
          for (const ref of refs)
            for (const key of supportedFigureKeys([ref.quote]))
              preferenceFigures.add(key);
      }
      continue;
    }

    // Everything below carries no refs.
    if (refs.length > 0) flag(`${at}.refs`, "unexpected_reference");
    if (claim.kind === "not-in-matrix") {
      if (preferenceOnlyTopic) flag(at, "preference_only_topic");
      // [SAFETY] A not-in-matrix claim is labelled, never evidence: it carries
      // no figure beyond the general allowance, not even one the interviewer
      // said aloud (that would re-state an unverified claim as a fact).
      if (logistics ? claimFigures.size : nonGeneralFigures(claim.text).length)
        flag(
          at,
          logistics ? "ungrounded_logistics_figure" : "ungrounded_figure",
        );
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
    const loose = nonGeneralFigures(claim.text);
    if (loose.length)
      // [SAFETY] Hazard 7b: a figure the interviewer said aloud and the
      // sources lack must not be echoed as fact; any other figure outside the
      // general allowance is equally unsourced.
      flag(
        at,
        loose.some((key) => capturedFigures.has(key) && !sourceFigures.has(key))
          ? "spoken_figure"
          : "ungrounded_figure",
      );
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

  for (const element of context.star ?? []) {
    const at = `star.${element.element}`;
    if (disparagesEmployer(element.text)) flag(at, "disparages_employer");
    if (hasConfusableText(element.text)) flag(at, "confusable_text");
    const refs = element.claimIndexes.flatMap((index) => {
      const claim = claims[index];
      return claim?.kind === "matrix-backed" && Array.isArray(claim.refs)
        ? claim.refs
        : [];
    });
    if (refs.length > 0 && !supports(element.text, refs, snapshot, true))
      flag(at, "unsupported_element");
  }

  if (context.draft !== undefined)
    checkDraft(context.draft, {
      flag,
      logistics,
      leavingRole,
      companies,
      matrixTexts,
      matrixClaimTexts: claims
        .filter((claim) => claim.kind === "matrix-backed")
        .map((claim) => normalizeText(claim.text)),
      groundedFigures,
      preferenceFigures,
      capturedFigures,
      sourceFigures,
    });

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
