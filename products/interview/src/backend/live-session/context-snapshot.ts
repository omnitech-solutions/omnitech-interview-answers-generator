// The pinned context snapshot of an Active Session (ADR-0011/0012): the
// approved experience matrix revision, the linked draft's employer context and
// the candidate's own preferences, cut into small citable sources.
//
// Pure data in, data out: no database, no gateway, no clock. The model may only
// cite what is in here (claims.ts verifies every reference against this
// snapshot), so the sources are WHOLE texts with deterministic ids. A bound
// shrinks the set by dropping whole sources; a source is never cut mid-text,
// because a truncated quote could not verify.
//
// Errors carry a code only, never content.
import { createHash } from "node:crypto";
import type { CandidateMatrix } from "@omnitech/interview-contracts";
import { selectCandidateFragments } from "../briefing/selection";

export type SourceKind =
  | "candidate"
  | "employer-context"
  | "candidate-preference";

export type ContextSource = {
  id: string;
  pointer: string;
  text: string;
  sourceKind: SourceKind;
  revision: number;
  sha256: string;
};

type ProfileRef = { id: string; revision: number; sha256: string };

export type ContextSnapshot = {
  // The matrix revision pinned at session start; null when no matrix exists.
  profile: ProfileRef | null;
  // The linked briefing draft's revision the context was read at, if any.
  draftRevision: number | null;
  sources: readonly ContextSource[];
  // Which preference topics exist (no content beyond the sources themselves).
  preferences: Readonly<{
    noticePeriod: boolean;
    compensation: boolean;
    other: boolean;
  }>;
};

export type SourceLimits = {
  maxSources: number;
  maxSourceChars: number;
  maxTotalChars: number;
};

// What a single task's prompt may carry.
export const TASK_VIEW_LIMITS: SourceLimits = {
  maxSources: 40,
  maxSourceChars: 400,
  maxTotalChars: 6_500,
};
// Lines of the employer brief a task view carries ahead of the matrix.
export const MAX_BRIEF_SOURCES = 20;
// The smaller window of a device profile.
export const DEVICE_MAX_TOTAL_CHARS = 2_500;
export const DEVICE_TASK_VIEW_LIMITS: SourceLimits = {
  ...TASK_VIEW_LIMITS,
  maxTotalChars: DEVICE_MAX_TOTAL_CHARS,
};
// The snapshot itself holds every citable source of the pinned matrix (a
// superset of any task view) under a generous bound.
const SNAPSHOT_LIMITS = { maxSources: 2_000, maxSourceChars: 2_000 };

export class ContextSnapshotError extends Error {
  constructor(readonly code: "invalid_limits") {
    super(code);
    this.name = "ContextSnapshotError";
  }
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

// [SAFETY] Canonical text for every comparison (review S1): NFKC (full-width
// and compatibility forms), every default-ignorable code point removed (zero
// width, bidi and variation selectors, tag characters, combining grapheme
// joiner, Arabic letter mark, Mongolian vowel separator, Khmer inherent vowels)
// plus the Hangul fillers that render blank, and every Unicode decimal digit
// mapped to its ASCII value. Case is left alone. Stripping runs before NFKC too,
// so an invisible character cannot block a composition.
const INVISIBLE =
  /[\p{Default_Ignorable_Code_Point}\u115f\u1160\u3164\uffa0]/gu;
const digitValue = (char: string): string => {
  const code = char.codePointAt(0) ?? 0;
  let run = 0;
  while (run < 50 && /^\p{Nd}$/u.test(String.fromCodePoint(code - run - 1)))
    run += 1;
  return String(run % 10);
};
export const canonicalText = (text: string): string =>
  text
    .replace(INVISIBLE, "")
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/\p{Nd}/gu, (char) => digitValue(char));

// A word is suspicious when it mixes Latin with a script whose letters pass for
// Latin (Cyrillic, Cherokee, Armenian, or a Greek look-alike), or is a
// non-Latin word made only of Latin look-alikes (a Cyrillic "CEO"). Plain
// accented Latin is fine, and so are ordinary technical symbols: a Greek mu in
// "5 µs" (NFKC maps the micro sign to Greek mu) or a lone alpha or epsilon in
// "weight α" and "ε-greedy". A combining mark touching a digit splits or hides
// a figure and is confusable too.
const LOOKALIKE =
  "АВЕКМНОРСТХаеорсухіјѕԁԛѵАВЕЗІЈКМНОРЅТХҮαβεικνορτυχΑΒΕΖΗΙΚΜΝΟΡΤΥΧοıՕօՍսՈոԱԲԵՒՀհԶզՑց";
const ALWAYS_CONFUSABLE_SCRIPT =
  /[\p{Script=Cyrillic}\p{Script=Cherokee}\p{Script=Armenian}]/u;
const GREEK = /\p{Script=Greek}/u;
export const hasConfusableText = (text: string): boolean => {
  const clean = canonicalText(text);
  if (/\p{Nd}\p{M}|\p{M}\p{Nd}/u.test(clean)) return true;
  for (const word of clean.match(/\p{L}[\p{L}\p{M}]*/gu) ?? []) {
    const letters = [...word].filter((char) => /\p{L}/u.test(char));
    const latin = letters.filter((char) => /\p{Script=Latin}/u.test(char));
    if (latin.length === letters.length) continue;
    const foreign = letters.filter((char) => !/\p{Script=Latin}/u.test(char));
    if (latin.length > 0) {
      if (
        foreign.some(
          (char) =>
            ALWAYS_CONFUSABLE_SCRIPT.test(char) || LOOKALIKE.includes(char),
        )
      )
        return true;
      continue;
    }
    // Cherokee letters are near-copies of capital Latin letters; no interview
    // content needs them.
    if (letters.some((char) => /\p{Script=Cherokee}/u.test(char))) return true;
    if (!letters.every((char) => LOOKALIKE.includes(char))) continue;
    // One Greek letter (alpha, epsilon) is mathematical notation, not a word.
    if (letters.length === 1 && GREEK.test(letters[0] ?? "")) continue;
    return true;
  }
  return false;
};
// Folds the look-alikes onto Latin so wording lexicons still detect them.
const FOLD_FROM = "АВЕКМНОРСТХаеорсухіјѕΑΒΕΖΗΙΚΜΝΟΡΤΥΧοι";
const FOLD_TO = "ABEKMHOPCTXaeopcyxijsABEZHIKMNOPTYXoi";
const foldLookalikes = (text: string) =>
  [...text]
    .map((char) => {
      const at = FOLD_FROM.indexOf(char);
      return at < 0 ? char : (FOLD_TO[at] ?? char);
    })
    .join("");
const wordingText = (text: string) => foldLookalikes(canonicalText(text));

// [DOMAIN] Notice period and compensation are the candidate's own facts: they
// live only in candidate preferences. Shared with claims.ts so the snapshot and
// the verifier agree on what counts as that wording.
const NOTICE_PERIOD_WORDING =
  /\bnotice\b|\bstart date\b|\bavailable to start\b|\bearliest start\b|\b(?:can|able to) start\b/i;
const COMPENSATION_WORDING =
  /\bsalary\b|\bcompensation\b|\bcomp\b|\bbase pay\b|\btake-home\b|\bote\b|\bstock options?\b|\brsus?\b|\bbonus\b|\bhourly rate\b|\bday rate\b|\bper (?:hour|annum|year)\b|[$£€]\s?\d|\b\d[\d,.]*\s?(?:k\s?)?(?:usd|cad|eur|gbp)\b|\b(?:usd|cad|eur|gbp|aud)\s?\d/i;
const WORK_ARRANGEMENT_WORDING =
  /\bwork (?:arrangement|location|mode)\b|\bremote\b|\bhybrid\b|\bon[- ]?site\b|\bin[- ]office\b|\boffice[- ]based\b|\bwork from home\b|\bwfh\b/i;

export const isNoticePeriodText = (text: string) =>
  NOTICE_PERIOD_WORDING.test(wordingText(text));
export const isCompensationText = (text: string) =>
  COMPENSATION_WORDING.test(wordingText(text));
export const isWorkArrangementText = (text: string) =>
  WORK_ARRANGEMENT_WORDING.test(wordingText(text));

// Employer text is an UNTRUSTED observation: the prompt builder labels every
// source of this kind as data, never as policy.
export const isUntrustedSource = (source: ContextSource) =>
  source.sourceKind === "employer-context";

function leaves(
  value: unknown,
  pointer: string,
  into: { pointer: string; text: string }[],
) {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    if (text) into.push({ pointer, text });
  } else if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      leaves(item, `${pointer}/${index}`, into);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value))
      leaves(
        item,
        `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        into,
      );
  }
}

// Lines and sentences become individually citable pieces; bullets lose their
// marker so a quote never depends on list syntax.
function pieces(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/(?<=[.!?;])\s+/))
    .map((piece) => piece.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

export type BuildInput = {
  matrix: CandidateMatrix | null;
  profile: ProfileRef | null;
  employer?:
    | {
        jobDescription?: string | undefined;
        employerNotes?: string | undefined;
        research?: string | undefined;
        // The model-cleaned employer brief as labelled lines (session-context).
        brief?: string | undefined;
      }
    | undefined;
  candidatePreferences?: string | undefined;
  draftRevision?: number | undefined;
  limits?: Partial<typeof SNAPSHOT_LIMITS> | undefined;
};

function assertPositive(values: readonly number[]) {
  if (values.some((value) => !Number.isInteger(value) || value < 1))
    throw new ContextSnapshotError("invalid_limits");
}

export function buildContextSnapshot(input: BuildInput): ContextSnapshot {
  const maxSources = input.limits?.maxSources ?? SNAPSHOT_LIMITS.maxSources;
  const maxSourceChars =
    input.limits?.maxSourceChars ?? SNAPSHOT_LIMITS.maxSourceChars;
  assertPositive([maxSources, maxSourceChars]);
  const draftRevision = input.draftRevision ?? null;
  const contextRevision = draftRevision ?? 0;
  const seen = new Set<string>();

  // [STRATEGY] Context sources are built first so a large matrix can never
  // crowd out the preferences the logistics answers depend on.
  const context: ContextSource[] = [];
  const addContext = (
    key: string,
    sourceKind: "employer-context" | "candidate-preference",
    text: string | undefined,
  ) => {
    if (!text) return;
    for (const [index, piece] of pieces(text).entries()) {
      if (piece.length > maxSourceChars) continue;
      const id = sha(`${key}:${piece}`);
      if (seen.has(id)) continue;
      seen.add(id);
      context.push({
        id,
        pointer: `/context/${key}/${index}`,
        text: piece,
        sourceKind,
        revision: contextRevision,
        sha256: sha(piece),
      });
    }
  };
  addContext(
    "jobDescription",
    "employer-context",
    input.employer?.jobDescription,
  );
  addContext(
    "employerNotes",
    "employer-context",
    input.employer?.employerNotes,
  );
  addContext("research", "employer-context", input.employer?.research);
  addContext("employerBrief", "employer-context", input.employer?.brief);
  addContext(
    "candidatePreferences",
    "candidate-preference",
    input.candidatePreferences,
  );

  const candidate: ContextSource[] = [];
  if (input.matrix && input.profile) {
    const { id: profileId, revision } = input.profile;
    const found: { pointer: string; text: string }[] = [];
    // Matrix order is stable; ranking relies on it for ties.
    for (const [key, value] of Object.entries(input.matrix))
      leaves(
        value,
        `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        found,
      );
    for (const { pointer, text } of found) {
      if (candidate.length + context.length >= maxSources) break;
      if (text.length > maxSourceChars) continue;
      const id = sha(`${profileId}:${pointer}`);
      if (seen.has(id)) continue;
      seen.add(id);
      candidate.push({
        id,
        pointer,
        text,
        sourceKind: "candidate",
        revision,
        sha256: sha(text),
      });
    }
  }

  const sources = [
    ...candidate,
    ...context.slice(0, Math.max(0, maxSources - candidate.length)),
  ];
  const preferenceTexts = sources
    .filter((source) => source.sourceKind === "candidate-preference")
    .map((source) => source.text);
  return {
    profile: input.matrix ? input.profile : null,
    draftRevision,
    sources,
    preferences: {
      noticePeriod: preferenceTexts.some(isNoticePeriodText),
      compensation: preferenceTexts.some(isCompensationText),
      other: preferenceTexts.some(
        (text) => !isNoticePeriodText(text) && !isCompensationText(text),
      ),
    },
  };
}

export type TaskSelection = {
  query: string;
  category: string;
  // The matrix the ranking reads (selectCandidateFragments works on roles).
  matrix: CandidateMatrix | null;
  limits?: SourceLimits | undefined;
};

const rolePointer = /^\/roles\/(\d+)(?:\/|$)/;
// Non-role sections (the candidate header, mappings) are short and framing
// critical: they rank right after the best role.
const FRAMING_RANK = 0.5;

// [STRATEGY] Rank, then keep a PREFIX of the ranking that fits the budget: the
// set shrinks by dropping the lowest-ranked sources. A source longer than the
// per-source bound is skipped whole, never cut, so every kept quote can still
// verify.
export function selectSourcesForTask(
  snapshot: ContextSnapshot,
  task: TaskSelection,
): ContextSource[] {
  const limits = task.limits ?? TASK_VIEW_LIMITS;
  assertPositive([
    limits.maxSources,
    limits.maxSourceChars,
    limits.maxTotalChars,
  ]);
  const byKind = (kind: SourceKind) =>
    snapshot.sources.filter((source) => source.sourceKind === kind);

  const roleRank = new Map<number, number>();
  if (task.matrix)
    for (const [rank, { pointer }] of selectCandidateFragments(
      task.matrix,
      task.query,
      task.category,
    ).entries())
      roleRank.set(Number(rolePointer.exec(pointer)?.[1]), rank);
  const rankOf = (source: ContextSource) => {
    const role = rolePointer.exec(source.pointer);
    return role
      ? (roleRank.get(Number(role[1])) ?? Number.MAX_SAFE_INTEGER)
      : FRAMING_RANK;
  };
  const ranked = byKind("candidate")
    .map((source, index) => ({ source, index, rank: rankOf(source) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.source);

  // Preferences are the only source of notice period and compensation, so a
  // logistics-shaped task puts them first.
  const preferencesFirst =
    task.category === "logistics" ||
    isNoticePeriodText(task.query) ||
    isCompensationText(task.query);
  const preferences = byKind("candidate-preference");
  const employer = byKind("employer-context");
  // [DOMAIN] The employer brief (the cleaned job spec, a dozen short labelled
  // lines) leads every task view: an answer about the company, the role or
  // what they value has nothing to lean on otherwise, because a full matrix
  // alone fills the view. The raw spec's sentences follow the matrix.
  const brief = employer
    .filter((source) => source.pointer.startsWith("/context/employerBrief/"))
    .slice(0, MAX_BRIEF_SOURCES);
  const employerRest = employer.filter((source) => !brief.includes(source));
  const order = preferencesFirst
    ? [...preferences, ...brief, ...ranked, ...employerRest]
    : [...brief, ...ranked, ...employerRest, ...preferences];

  const kept: ContextSource[] = [];
  let total = 0;
  for (const source of order) {
    if (source.text.length > limits.maxSourceChars) continue;
    if (kept.length >= limits.maxSources) break;
    if (total + source.text.length > limits.maxTotalChars) break;
    kept.push(source);
    total += source.text.length;
  }
  return kept;
}

// Canonical JSON (sorted keys): the digest documents/context.ts pins.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

// The digest a candidate-profile revision records for its matrix.
export const matrixSha256 = (matrix: CandidateMatrix): string =>
  sha(canonical(matrix));

export function verifyMatrixHash(
  matrix: CandidateMatrix,
  expectedSha256: string,
): boolean {
  return matrixSha256(matrix) === expectedSha256;
}
