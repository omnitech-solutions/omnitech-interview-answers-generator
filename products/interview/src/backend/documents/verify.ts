import { createHash } from "node:crypto";
import {
  type DocumentField,
  type DocumentFieldError,
  documentBlocks,
  documentLayout,
  type UnsupportedClaim,
} from "@omnitech/interview-contracts";
import {
  type CastRole,
  castRoles,
  consultancies,
  type DocumentCast,
} from "./cast";

// [SAFETY] What the model wrote is checked in code against the person's own
// record, as the coach's notes are (`coach/reply.ts`), never by the model
// saying so. For a field tied to a role, every figure and every proper noun in
// its text must occur in that role's entry in the experience matrix; a field
// tied to no role (a summary, a skills line) is checked against the whole
// matrix. What is not found is recorded on the field.
//
// The normalisations, all applied to both the text and the evidence:
//   - case and accents are ignored; punctuation inside a name is ignored
//     ("Node.js" = "NodeJS" = "node js");
//   - a trailing "js" and a plural "s" are ignored ("React" = "React.js",
//     "APIs" = "API");
//   - a hyphen or slash joins or splits ("micro-frontends" = "microfrontends",
//     "CI/CD" is "CI" and "CD");
//   - a figure keeps its unit: "40%" = "40 percent", "45ms" = "45 ms",
//     "6h" = "6 hours", "50min" = "50 minutes", "8+ years" = "8 yrs",
//     "2.1M" = "2.1 million" = "2,100,000", "$3k" = "3000"; "10+" = "10",
//     "8.x" = "8"; a bare number matches only the same bare number;
//   - what the matrix says about a role outside its entry (a leadership
//     signal's evidence that names the employer) counts as that role's.

const ALIASES: Readonly<Record<string, string>> = {
  postgresql: "postgres",
  golang: "go",
  k8s: "kubernetes",
};

// Capitalised engineering vocabulary that names no employer, product or
// technology choice, so it is never held against the matrix.
const GENERIC = new Set(
  [
    "API",
    "UI",
    "UX",
    "CI",
    "CD",
    "QA",
    "SLA",
    "SLO",
    "KPI",
    "MVP",
    "PR",
    "SDK",
    "CLI",
    "B2B",
    "B2C",
    "SaaS",
    "ROI",
    "I",
  ].map((word) => word.toLowerCase()),
);

/** A name as it is compared: lower case, no accents or punctuation, no "js" or plural ending. */
export function normalName(token: string): string {
  let name = token
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]/g, "");
  name = ALIASES[name] ?? name;
  if (name.length > 4 && name.endsWith("js")) name = name.slice(0, -2);
  if (name.length > 3 && name.endsWith("s") && !name.endsWith("ss"))
    name = name.slice(0, -1);
  return name;
}

const SCALE: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};
// A unit of time, however it is written: "6h" = "6 hours", "50min" = "50 minutes".
const TIME: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries({
    ms: ["ms", "millisecond", "milliseconds"],
    s: ["s", "sec", "secs", "second", "seconds"],
    min: ["min", "mins", "minute", "minutes"],
    h: ["h", "hr", "hrs", "hour", "hours"],
    d: ["d", "day", "days"],
    w: ["w", "wk", "wks", "week", "weeks"],
    mo: ["mo", "month", "months"],
    y: ["y", "yr", "yrs", "year", "years"],
  }).flatMap(([unit, spellings]) => spellings.map((word) => [word, unit])),
);
// A number that is not part of a name ("S3", "OAuth2" are names), with the
// unit written against it, the percent that follows it, or the word for a
// scale or a time that follows it after a space.
const FIGURE =
  /(?<![A-Za-z0-9.])\d[\d,]*(?:\.\d+)?(?:\.x\b)?\+?(?:\s?%|\s+(?:percent|thousand|million|billion|ms|milliseconds?|secs?|seconds?|mins?|minutes?|hrs?|hours?|days?|wks?|weeks?|months?|yrs?|years?)\b|[a-zA-Z]+\b)?\+?/g;
// Ways of writing "always" or "one to one" that are not measurements.
const NOT_FIGURES = /\b(?:24\/7|1:1|1-on-1|one-on-one)\b/gi;

/** The figures in a text, each as it is compared ("40%", "45ms", "6h", "2100000"). */
export function figuresOf(text: string): Array<{ text: string; key: string }> {
  const found: Array<{ text: string; key: string }> = [];
  for (const match of text.replace(NOT_FIGURES, " ").matchAll(FIGURE)) {
    const raw = match[0].trim();
    const number = /^\d[\d,]*(?:\.\d+)?/.exec(raw)?.[0] ?? "";
    let unit = raw
      .slice(number.length)
      .replace(/^\.x/i, "")
      .replaceAll("+", "")
      .trim()
      .toLowerCase();
    if (unit === "percent") unit = "%";
    let value = Number(number.replaceAll(",", ""));
    if (!Number.isFinite(value)) continue;
    const scale = SCALE[unit];
    if (scale) {
      value *= scale;
      unit = "";
    }
    unit = TIME[unit] ?? unit;
    // Rounded so "2.1 million" and "2100000" are one figure.
    found.push({ text: raw, key: `${Number(value.toPrecision(12))}${unit}` });
  }
  return found;
}

// Words of a text, split where a name can end: spaces and the punctuation
// that separates names. A hyphen or slash also splits, and the joined form is
// kept as well.
function words(text: string): string[] {
  return text
    .replace(FIGURE, " ")
    .split(/[\s,;:()[\]{}"“”‘’!?|•·~—–]+|\.(?=\s|$)/)
    .map((word) => word.replace(/^['.]+|['.]+$/g, "").replace(/['’]s$/i, ""))
    .filter(Boolean);
}
const pieces = (word: string): string[] => word.split(/[-/&]+/).filter(Boolean);

export type Evidence = { names: Set<string>; figures: Set<string> };

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "number") out.push(String(value));
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) strings(item, out);
  return out;
}

/** Everything a record says, as the names and figures a claim may use. */
export function evidenceOf(...records: unknown[]): Evidence {
  const names = new Set<string>();
  const figures = new Set<string>();
  for (const text of strings(records)) {
    for (const figure of figuresOf(text)) figures.add(figure.key);
    // A name written with its number ("PHP 8", "Vue 3") is a name too.
    const all = text.split(/[\s,;:()[\]{}"“”‘’!?|•·~—–]+/).filter(Boolean);
    let before = "";
    for (const word of all) {
      const whole = normalName(word);
      if (whole) names.add(whole);
      const parts = pieces(word).map(normalName).filter(Boolean);
      for (const part of parts) names.add(part);
      // Two words that are one name elsewhere ("Graph QL" for "GraphQL").
      if (before && whole) names.add(normalName(`${before}${word}`));
      before = word;
    }
  }
  return { names, figures };
}

// A word that reads as a name: a capital or a digit somewhere in it.
const nameLike = (word: string) => /[A-Z]/.test(word) || /\d/.test(word);

// A name is supported when the evidence has it whole, or has each of its
// name-like parts ("React-based" needs "React"; "CI/CD" needs both).
const hasName = (evidence: Evidence, word: string): boolean => {
  const whole = normalName(word);
  if (!whole || evidence.names.has(whole)) return true;
  const parts = pieces(word).filter(nameLike).map(normalName).filter(Boolean);
  return (
    pieces(word).length > 1 &&
    parts.every((part) => GENERIC.has(part) || evidence.names.has(part))
  );
};

const LIST_FIELD = /skills?\b|technolog|stack|tools/i;

/**
 * The proper nouns a text claims. A word is one when it carries a capital
 * inside it or a digit ("GraphQL", "AWS", "S3"), or starts with a capital
 * anywhere but the start of a sentence. In a list field (a skills line) an
 * item is a claim, so its first word counts too when the item is that one
 * word ("Kubernetes") or has another name in it ("Ruby on Rails"); the first
 * word of a phrase in sentence case ("Team leadership") does not. The first
 * word of a sentence counts only when the matrix knows it as a name (`known`).
 */
export function namesOf(
  text: string,
  options: { list: boolean; known: ReadonlySet<string> },
): string[] {
  const found: string[] = [];
  const segments = text
    .split(options.list ? /[,;\n•·|]+|\.\s+/ : /[.!?]\s+|[\n•·|;]+|:\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  for (const segment of segments) {
    const all = words(segment);
    // Whether a capital on the first word is a name's or only the phrase's.
    const titled =
      all.length === 1 ||
      all.slice(1).some((word) => /[A-Z]/.test(word) || /\d/.test(word));
    all.forEach((word, index) => {
      if (!/[A-Za-z]/.test(word)) return;
      if (GENERIC.has(word.toLowerCase()) || GENERIC.has(normalName(word)))
        return;
      const inner = /[A-Z]/.test(word.slice(1)) || /\d/.test(word);
      const capital = /^[A-Z]/.test(word);
      if (!inner && !capital) return;
      if (!inner && index === 0 && !(options.list && titled)) {
        // "Led", "Built": a sentence's first word, unless it is a known name.
        if (!pieces(word).some((part) => options.known.has(normalName(part))))
          return;
      }
      found.push(word);
    });
  }
  return [...new Set(found)];
}

export const fieldHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/** The confirmations a revision keeps: field key to the hash of the text vouched for. */
export function revisionConfirmations(
  provenance: unknown,
): Record<string, string> {
  if (!provenance || typeof provenance !== "object") return {};
  const kept = (provenance as Record<string, unknown>)["confirmedFields"];
  if (!kept || typeof kept !== "object" || Array.isArray(kept)) return {};
  return Object.fromEntries(
    Object.entries(kept).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** The confirmations that still stand: a field's lapses when its text changes. */
export function standingConfirmations(
  confirmed: Readonly<Record<string, string>>,
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(confirmed).filter(
      ([key, hash]) =>
        (values[key] ?? "").trim() !== "" &&
        fieldHash(values[key] ?? "") === hash,
    ),
  );
}

export type VerificationInput = {
  fields: readonly DocumentField[];
  values: Readonly<Record<string, string>>;
  // The fields whose text is prose (the model's, or the person's edit of it).
  checkedKeys: readonly string[];
  matrix: unknown;
  cast: DocumentCast | null;
  // Names every field may use without evidence: the employer and role being
  // applied to.
  allowed?: readonly string[];
  confirmed?: Readonly<Record<string, string>>;
};

/**
 * The fields whose text says something its evidence does not. A field the
 * person confirmed (for exactly this text) and a field of a block that does
 * not apply are not checked.
 */
export function verifyDocumentFields(
  input: VerificationInput,
): DocumentFieldError[] {
  const roles = castRoles(input.matrix);
  const byId = new Map(roles.map((role) => [role.id, role]));
  const whole = evidenceOf(input.matrix, input.allowed ?? []);
  // [DOMAIN] The matrix also speaks of a role outside its entry ("Mentored 6
  // engineers at Northbeam" under a leadership signal). A line that names an
  // employer, by its full name or by a word only that employer has, is part
  // of that role's record.
  const outside = strings(
    Object.entries(
      input.matrix && typeof input.matrix === "object" ? input.matrix : {},
    )
      .filter(([key]) => key !== "roles")
      .map(([, value]) => value),
  );
  const companyWords = (role: CastRole) =>
    words(role.company)
      .flatMap(pieces)
      .filter((word) => nameLike(word) && word.length >= 5)
      .map(normalName);
  const shared = new Map<string, number>();
  for (const role of roles)
    for (const word of new Set(companyWords(role)))
      shared.set(word, (shared.get(word) ?? 0) + 1);
  const mentions = (role: CastRole): string[] => {
    const own = companyWords(role).filter((word) => shared.get(word) === 1);
    return outside.filter(
      (text) =>
        text.toLowerCase().includes(role.company.toLowerCase()) ||
        words(text)
          .flatMap(pieces)
          .some((word) => own.includes(normalName(word))),
    );
  };
  const roleRecord = new Map(
    roles.map((role) => [role.id, [role.entry, mentions(role)]]),
  );
  const perRole = new Map<string, Evidence>(
    roles.map((role) => [role.id, evidenceOf(roleRecord.get(role.id))]),
  );
  // What the matrix knows as a name: employers and technologies.
  const known = new Set<string>();
  for (const role of roles)
    for (const text of [role.company, ...strings(role.entry["technologies"])])
      for (const word of words(text))
        for (const part of pieces(word))
          if (nameLike(part)) known.add(normalName(part));
  const blockOf = new Map<string, string>();
  const blocks = documentBlocks(input.fields);
  for (const block of blocks)
    for (const field of block.fields) blockOf.set(field.key, block.id);
  const consultancy = consultancies(input.matrix).find(
    (item) => item.company === input.cast?.consultancy,
  );
  const { absent } = documentLayout(input.fields, input.values);
  const standing = standingConfirmations(input.confirmed ?? {}, input.values);
  const checked = new Set(input.checkedKeys);
  const errors: DocumentFieldError[] = [];

  for (const field of input.fields) {
    const value = (input.values[field.key] ?? "").trim();
    if (
      !value ||
      !checked.has(field.key) ||
      absent.has(field.key) ||
      Object.hasOwn(standing, field.key)
    )
      continue;
    const blockId = blockOf.get(field.key);
    const held = (blockId ? (input.cast?.slots[blockId] ?? []) : [])
      .map((id) => byId.get(id))
      .filter((role): role is CastRole => role !== undefined);
    const own = new Set(held.map((role) => role.id));
    const evidence = held.length
      ? evidenceOf(
          held.map((role) => roleRecord.get(role.id)),
          // A client contract may name the consultancy it was delivered through.
          consultancy ? [consultancy.company, consultancy.title] : [],
        )
      : whole;
    const against = held.length
      ? held.length === 1
        ? (held[0] as CastRole).company
        : `${held.length} roles`
      : "your experience matrix";
    // Where a claim does belong, when another role has it.
    const elsewhere = (has: (evidence: Evidence) => boolean) =>
      roles.find(
        (role) => !own.has(role.id) && has(perRole.get(role.id) as Evidence),
      )?.company;
    const missing: UnsupportedClaim[] = [];
    for (const figure of figuresOf(value)) {
      if (evidence.figures.has(figure.key)) continue;
      const foundIn = held.length
        ? elsewhere((other) => other.figures.has(figure.key))
        : undefined;
      missing.push({
        text: figure.text,
        kind: "figure",
        ...(foundIn ? { foundIn } : {}),
      });
    }
    const list =
      field.group?.part === "skills" ||
      LIST_FIELD.test(`${field.key} ${field.label}`);
    for (const name of namesOf(value, { list, known })) {
      if (hasName(evidence, name)) continue;
      const foundIn = held.length
        ? elsewhere((other) => hasName(other, name))
        : undefined;
      missing.push({
        text: name,
        kind: "name",
        ...(foundIn ? { foundIn } : {}),
      });
    }
    if (missing.length)
      errors.push({
        key: field.key,
        code: "unsupported",
        against,
        missing: missing.slice(0, 12),
      });
  }
  return errors;
}
