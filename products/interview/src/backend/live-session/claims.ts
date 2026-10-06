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
  canonicalText,
  hasConfusableText,
  isCompensationText,
  isNoticePeriodText,
  type SourceKind,
} from "./context-snapshot";
import { hasUnapprovedLogisticsFigure } from "./logistics-figures";
import {
  digitAvailability,
  foldSpoken,
  type SpokenQuantity,
  spokenQuantities,
} from "./spoken-figures";

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
const MAX_VIOLATIONS = 50;
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
// letter are identifiers (S3, ec2, k8s, x86, sha256, h264, p99), EXCEPT after a
// currency code or an x multiplier (USD150000, GBP90k, x40), as a long run
// (salary150000: five or more digits), after a money word (salary1500) and as
// a suffixed run after three letters (base90k). Spelled-out numbers, roman
// numerals, ordinal dates and "a month" are read by spoken-figures.ts and join
// the same keys (figuresOf), so words get the same treatment as digits.
const NUMBER =
  "\\d+(?:[.,]\\d+)*(?:%|[kKmMbB](?!\\p{L})|[xX](?!\\p{L})|\\s?times(?!\\p{L})|-?fold(?!\\p{L}))?\\+?";
const CURRENCY_CODE = "usd|cad|eur|gbp|aud|nzd|chf|jpy|inr|cny|sek|nok|dkk";
const MONEY_WORD =
  "salary|base|pay|comp|compensation|bonus|rate|ote|ctc|package|equity|stock|total";
const FIGURE_PATTERNS = [
  new RegExp(`(?<![\\p{L}\\d.,_])${NUMBER}`, "gu"),
  new RegExp(`(?<=(?<!\\p{L})(?:${CURRENCY_CODE}))${NUMBER}`, "giu"),
  // x40 is a multiplier; the well-known architectures x86, x64 and x32 are not.
  new RegExp(
    `(?<!\\p{L})[xX](?!(?:86|64|32)(?![\\d%kKmMbB]|[.,]\\d))${NUMBER}`,
    "gu",
  ),
  new RegExp(
    `(?<=\\p{L})(?:\\d{5,}(?:[.,]\\d+)*\\+?)|(?<=(?<!\\p{L})(?:${MONEY_WORD}))\\d{3,4}(?:[.,]\\d+)*\\+?`,
    "giu",
  ),
  new RegExp(`(?<=\\p{L}{3})\\d+(?:%|[kKmMbB](?!\\p{L}))\\+?`, "gu"),
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

const sentencePartsOf = (text: string) => text.split(/[.!?\n]+/);

// Spelled quantities of every sentence; only a compensation or notice-period
// sentence counts a bare definite number word ("three") without a unit.
function spokenOf(text: string): SpokenQuantity[] {
  return sentencePartsOf(text).flatMap((sentence) =>
    spokenQuantities(
      sentence,
      isCompensationText(sentence) || isNoticePeriodText(sentence),
    ),
  );
}
const spokenKeysOf = (text: string): Set<string> =>
  new Set(spokenOf(text).map((quantity) => quantity.key));

export function figuresOf(text: string): Set<string> {
  return new Set([
    ...figureMatches(text).map((match) => figureKey(match.raw)),
    ...spokenKeysOf(text),
  ]);
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
      // "150k" and "150000" are the same figure: compare as numbers.
      const scaled = base.match(/^(\d+(?:\.\d+)?)([kmb])$/);
      if (scaled?.[1] && scaled[2])
        keys.add(
          String(
            Number(scaled[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[scaled[2]] ?? 1),
          ),
        );
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
const MAX_GENERAL_INTEGER = 10;

// [DOMAIN] Technical provenance (real failure: a coding follow-up such as "what
// is the time complexity?" was withheld for O(n^2) and "up to 1000"). Figures
// are classified by where they come from, not only by size:
//   (a) algorithmic or mathematical notation is never a candidate fact:
//       O(...), n squared written n^2 or with a superscript, 2^n, 10^5, log2;
//   (b) a figure in the task's own source material (the exercise's restatement
//       and constraints read from the screenshot, the interviewer's question)
//       is allowed with that provenance;
//   (c) in a technical answer, a plain number in a sentence that says nothing
//       about the candidate (no first person, no employer, team, years) is an
//       ordinary technical number ("up to 1000", "10k elements").
// A sentence that says something about the candidate keeps the strict rules,
// as do percentages, multipliers, money and every notice or pay sentence
// (those are decided before this runs).
export type TechnicalScope = {
  // Figure keys (figuresOf) of the exercise and the interviewer's question.
  provenance: ReadonlySet<string>;
  // Normalised employer names of the approved experience.
  companies: readonly string[];
};
const SUPERSCRIPT_RUN = /[\p{L}\d)\]]?[⁰-₟²³¹]+/gu;
const POWER_NOTATION =
  /(?<![\p{L}\d])\d+(?:[.,]\d+)?\s*(?:\^|\*\*)\s*[\w{}()+-]+|(?<![\p{L}\d])[a-z]\s*(?:\^|\*\*)\s*[\w{}()+-]+|\blog\s*_?\d+\b/giu;
const CANDIDATE_SCOPE_WORDING =
  /\b(?:employer|company|companies|team|teams|manager|colleagues?|worked|previous(?:ly)?|years?|months?|used to|revenue|salary|clients?)\b|\b(?:19|20)\d{2}\b/i;
const PLAIN_TECHNICAL_NUMBER = /^\d+(?:[.,]\d+)*[kKmMbB]?$/;

// Text with algorithmic and mathematical notation removed, before the figure
// patterns run (NFKC would otherwise turn a superscript 2 into a bare 2).
function withoutNotation(text: string): string {
  return canonicalText(text.replace(SUPERSCRIPT_RUN, " "))
    .replace(COMPLEXITY_NOTATION, " ")
    .replace(POWER_NOTATION, " ");
}

// The figures of exercise-like text, as provenance keys.
// A percentage is never provenance: it reads as a result about someone.
const provenanceFigures = (texts: readonly string[]): Set<string> =>
  new Set(
    texts
      .flatMap((text) => [...figuresOf(withoutNotation(text))])
      .filter((key) => !key.includes("%")),
  );

// Keys of the figures in text that the general-knowledge allowance does NOT
// cover. With a technical scope, figures of the task's own material and plain
// numbers of a sentence that says nothing about the candidate are covered too.
export function nonGeneralFigures(
  text: string,
  scope?: TechnicalScope,
): string[] {
  const clean = withoutNotation(text);
  const lower = clean.toLowerCase().replace(/\s+/g, " ");
  const companyNamed =
    scope?.companies.some((company) => company && lower.includes(company)) ??
    false;
  const personal = FIRST_PERSON.test(clean);
  const candidateFact =
    CANDIDATE_SCOPE_WORDING.test(clean) ||
    (personal && EMPLOYER_OR_TIME_WORDING.test(clean)) ||
    companyNamed;
  const fromProvenance = (key: string) =>
    scope !== undefined && !candidateFact && scope.provenance.has(key);
  const plainTechnical = scope !== undefined && !candidateFact && !personal;
  const found: string[] = [];
  for (const { raw, index } of figureMatches(clean)) {
    if (/^\d+x?$/i.test(raw) && Number.parseInt(raw, 10) <= MAX_GENERAL_INTEGER)
      continue;
    if (STANDARD_TOKEN_CONTEXT.test(clean.slice(0, index))) continue;
    const key = figureKey(raw);
    if (fromProvenance(key)) continue;
    if (plainTechnical && PLAIN_TECHNICAL_NUMBER.test(raw)) continue;
    found.push(key);
  }
  // Spelled quantities meet the same allowance as digits: an integer up to ten
  // that is not scaled (hundred, k, dozen) is ordinary; everything else is not.
  for (const quantity of spokenOf(clean))
    if (quantity.scaled || quantity.value > MAX_GENERAL_INTEGER) {
      if (fromProvenance(quantity.key)) continue;
      if (
        plainTechnical &&
        quantity.kind !== "duration" &&
        quantity.kind !== "date" &&
        quantity.kind !== "money"
      )
        continue;
      found.push(quantity.key);
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
function riskTerms(text: string): Set<string> {
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
const MAX_UNMATCHED_TERMS = 1;

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
const crossesRoles = (refs: readonly ClaimRef[]) => {
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
  // A technical answer (coding or concept task): figures of the task's own
  // material (the exercise brief, the interviewer's question) and plain
  // numbers in sentences that say nothing about the candidate are not gated
  // by approved experience. Candidate-fact claims keep the strict rules.
  technical?: boolean | undefined;
  // Exercise text the task carries as provenance (restatement, constraints).
  exercise?: readonly string[] | undefined;
};
type StarElementText = {
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

// [SAFETY] A cited preference quote is approved for repetition only when it is
// the preference line itself or its value after the "Label:" prefix. A
// fragment of a longer line ("2 weeks" out of "4 weeks, or 2 weeks if bought
// out") would drop the condition around it, so it approves nothing.
function approvedQuote(
  ref: { sourceId: string; quote: string },
  snapshot: ContextSnapshot,
): string[] {
  const text = sourceById(snapshot, ref.sourceId)?.text;
  if (text === undefined) return [];
  const clean = (value: string) =>
    foldSpoken(value)
      .replace(/\s+/g, " ")
      .replace(/[\s.,;:!?]+$/u, "")
      .trim()
      .toLowerCase();
  const quote = clean(ref.quote);
  const whole = clean(text);
  const colon = whole.indexOf(":");
  const value = colon < 0 ? "" : whole.slice(colon + 1).trim();
  return quote && (quote === whole || quote === value) ? [ref.quote] : [];
}

type DraftCheck = {
  flag: (path: string, code: string) => void;
  logistics: boolean;
  leavingRole: boolean;
  companies: readonly string[];
  matrixTexts: readonly string[];
  matrixClaimTexts: readonly string[];
  groundedFigures: ReadonlySet<string>;
  preferenceFigures: ReadonlySet<string>;
  preferenceQuotes: readonly string[];
  capturedFigures: ReadonlySet<string>;
  sourceFigures: ReadonlySet<string>;
  technicalScope: TechnicalScope | undefined;
  // A coding task: technical, with an exercise on screen. Its drafts talk about
  // durations and availability of tasks and slots, not the candidate's own.
  coding: boolean;
};

// [DOMAIN] Reason-for-leaving lexicon (leaving-role drafts). A draft sentence
// carrying any of these cues states or hints at WHY the candidate left, which
// is the candidate's to supply. Only the placeholder, or text a verified
// matrix-backed claim already states, may carry them.
const LEAVING_REASON_CUE =
  /\b(?:because|since|so that|left|leave|leaving|quit|resign\w*|fired|laid off|layoffs?|stopped|too|wanted|wants?|burn(?:ed|t)?[- ]?out|redundan\w*|restructur\w*|downsiz\w*|dismiss\w*)\b/i;
const AVAILABILITY_WORDING =
  /\b(?:join(?:ing)? (?:you|your|the team|us)|(?:can|could|able to|available to|free to|ready to|would|will|'d) start|start(?:ing)? (?:on|in|at|from|by|date)|available|notice)\b/;
const availabilityKeysOf = (text: string): Set<string> =>
  new Set([
    ...digitAvailability(text),
    ...spokenOf(text)
      .filter(
        (quantity) => quantity.kind === "duration" || quantity.kind === "date",
      )
      .map((quantity) => quantity.key),
  ]);
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
  // [SAFETY] Availability (notice period, start date, "join you in three
  // months") is the candidate's own fact whatever the sentence's wording: any
  // duration or date, spelled or digit, must be an approved preference figure.
  // [STRATEGY] The wording rule does not apply on a coding task (L-1: "next
  // available slot", "cooldown of 3 days" are scheduling, not availability).
  // Notice and pay sentences are still decided by the topical rules below.
  if (
    !check.logistics &&
    !check.coding &&
    AVAILABILITY_WORDING.test(foldSpoken(draft).toLowerCase())
  )
    for (const key of availabilityKeysOf(draft))
      if (!check.preferenceFigures.has(key)) {
        flag("draft", "preference_only_topic");
        break;
      }
  if (check.logistics) {
    // [SAFETY] Allowlist (round 5): the only figure, unit or date a logistics
    // draft may carry is a verbatim span of an approved preference quote.
    if (hasUnapprovedLogisticsFigure(draft, check.preferenceQuotes))
      flag("draft", "ungrounded_logistics_figure");
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
        // [SAFETY] The model's category may be wrong or steered: a sentence
        // about notice, pay or availability gets the logistics allowlist
        // whatever the category says.
        if (hasUnapprovedLogisticsFigure(sentence, check.preferenceQuotes))
          flag("draft", "preference_only_topic");
        continue;
      }
      if (
        !check.coding &&
        AVAILABILITY_WORDING.test(foldSpoken(sentence).toLowerCase()) &&
        hasUnapprovedLogisticsFigure(sentence, check.preferenceQuotes)
      )
        flag("draft", "preference_only_topic");
      const loose = nonGeneralFigures(sentence, check.technicalScope).filter(
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
  // [SAFETY] Technical provenance never applies to logistics or a leaving
  // role: those are about the candidate whatever the model says.
  const technicalScope: TechnicalScope | undefined =
    context.technical && !logistics && category !== "leaving-role"
      ? {
          // The interviewer's words are provenance only on a coding task
          // (one that carries an exercise); on a bare concept question a
          // figure they said stays "spoken" and is never echoed as fact.
          provenance: provenanceFigures(
            context.exercise?.length ? [...context.exercise, ...captured] : [],
          ),
          companies,
        }
      : undefined;
  const leavingRole = category === "leaving-role";
  // Figures that a preference-backed claim legitimately carries, for the
  // logistics draft check.
  const preferenceFigures = new Set<string>();
  const preferenceQuotes: string[] = [];
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
    // Logistics: a claim that is not preference-backed carries no figure-like
    // text at all (the allowlist has no approved span for it).
    const logisticsFigure =
      logistics && claim.kind !== "preference-backed"
        ? hasUnapprovedLogisticsFigure(claim.text, [])
        : false;
    const preferenceOnlyTopic =
      isNoticePeriodText(claim.text) || isCompensationText(claim.text);

    // Matrix-backed and preference-backed: every ref must verify, then the
    // refs together must support the claim.
    const required = expectedKind(claim.kind);
    if (required) {
      if (preferenceOnlyTopic && claim.kind !== "preference-backed")
        flag(at, "preference_only_topic");
      if (
        logistics &&
        claim.kind !== "preference-backed" &&
        (claimFigures.size || logisticsFigure)
      )
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
      // A spelled-out quantity in a notice-period or compensation claim must
      // come from the cited quotes.
      const quoteKeys = supportedFigureKeys(refs.map((ref) => ref.quote));
      const spokenGrounded =
        !preferenceOnlyTopic ||
        [...spokenKeysOf(claim.text)].every((key) => quoteKeys.has(key));
      if (structurallyValid && !spokenGrounded)
        flag(at, "preference_only_topic");
      const supported =
        structurallyValid &&
        spokenGrounded &&
        supports(claim.text, refs, snapshot, claim.kind === "matrix-backed");
      if (structurallyValid && spokenGrounded && !supported)
        for (const refIndex of refs.keys())
          flag(`${at}.refs.${refIndex}`, "unsupported_reference");
      if (supported) {
        // [SAFETY] A preference-backed claim's own text is shown beside its
        // provenance chip, so in a logistics answer it obeys the same
        // allowlist as the draft: only spans of the quotes it cites.
        if (
          logistics &&
          claim.kind === "preference-backed" &&
          hasUnapprovedLogisticsFigure(
            claim.text,
            refs.flatMap((ref) => approvedQuote(ref, snapshot)),
          )
        )
          flag(at, "ungrounded_logistics_figure");
        if (claim.kind === "matrix-backed")
          matrixTexts.push(normalizeText(claim.text));
        for (const key of supportedFigureKeys([
          claim.text,
          ...refs.map((ref) => ref.quote),
        ]))
          groundedFigures.add(key);
        if (claim.kind === "preference-backed")
          for (const ref of refs) {
            preferenceQuotes.push(...approvedQuote(ref, snapshot));
            for (const key of supportedFigureKeys([ref.quote]))
              preferenceFigures.add(key);
          }
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
      if (
        logistics
          ? claimFigures.size || logisticsFigure
          : nonGeneralFigures(claim.text).length
      )
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
    if (logistics && (claimFigures.size || logisticsFigure)) {
      flag(at, "ungrounded_logistics_figure");
      continue;
    }
    const loose = nonGeneralFigures(claim.text, technicalScope);
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
      preferenceQuotes,
      capturedFigures,
      sourceFigures,
      technicalScope,
      coding:
        technicalScope !== undefined && (context.exercise?.length ?? 0) > 0,
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
