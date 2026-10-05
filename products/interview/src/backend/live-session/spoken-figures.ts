// Spelled-out quantities as figures (review S1, round 3). A notice period or a
// compensation figure may be spoken as words ("three months", "one hundred and
// fifty thousand", "a fortnight", "the first of March", "III months"), so the
// words are normalised to the same numeric keys the digit pipeline produces and
// then get the same treatment as digits in EVERY sentence of a draft.
//
// Pure, no I/O. The caller says whether the sentence is about compensation or
// notice period (`topical`): only there does a bare definite number word
// ("three") count without an adjacent unit.
import { canonicalText } from "./context-snapshot.js";

export type SpokenQuantity = {
  // The decimal value as a string ("4", "150000"), or "~word" for a vague
  // magnitude ("~hundreds", "~couple"): comparable with digit figure keys.
  key: string;
  kind: "plain" | "duration" | "money" | "date" | "vague";
  // Hundred, thousand, k, dozen... : a big number even when the digits are few.
  scaled: boolean;
  value: number;
};

// Small capitals and other Latin look-alike letters NFKC leaves alone.
const SMALL_CAPS_FROM = "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘꞯʀꜱᴛᴜᴠᴡʏᴢ";
const SMALL_CAPS_TO = "abcdefghijklmnopqrstuvwyz";

// [SAFETY] Letters of a spoken word folded to plain Latin: small capitals mapped,
// diacritics and combining marks (not touching a digit) stripped, interpunct and
// soft-hyphen removed. Non-Latin look-alikes (Cyrillic) are deliberately NOT
// folded: hasConfusableText rejects those outright.
export function foldSpoken(text: string): string {
  const mapped = [...canonicalText(text)]
    .map((char) => {
      const at = SMALL_CAPS_FROM.indexOf(char);
      return at < 0 ? char : (SMALL_CAPS_TO[at] ?? char);
    })
    .join("");
  return mapped
    .normalize("NFKD")
    .replace(/(?<!\p{Nd})\p{M}+/gu, "")
    .replace(/[·‧•⋅­]/g, "");
}

const WORDS = (list: string, start = 0, step = 1): Record<string, number> =>
  Object.fromEntries(
    list.split(" ").map((word, index) => [word, start + index * step]),
  );
const UNITS = WORDS(
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen",
);
const TENS = WORDS(
  "twenty thirty forty fifty sixty seventy eighty ninety",
  20,
  10,
);
const ORDINAL_UNITS: Record<string, number> = {
  ...WORDS("first second third fourth fifth sixth seventh eighth ninth", 1),
  ...WORDS(
    "tenth eleventh twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth",
    10,
  ),
};
const ORDINAL_TENS: Record<string, number> = {
  twentieth: 20,
  thirtieth: 30,
};
const SCALES: Record<string, number> = {
  thousand: 1e3,
  grand: 1e3,
  million: 1e6,
  billion: 1e9,
};
const VAGUE_PLURAL = new Set([
  "tens",
  "hundreds",
  "thousands",
  "millions",
  "billions",
  "dozens",
  "scores",
]);
// Quantity words that are ordinary English on their own ("one of several
// factors"): a figure only beside a unit.
const VAGUE_WORD = new Set(["couple", "few", "several", "half"]);
const DURATION = /^(?:days?|weeks?|fortnights?|months?|quarters?|years?)$/;
const A_DURATION = /^(?:days?|weeks?|fortnights?|months?|quarters?)$/;
const MONEY =
  /^(?:k|dollars?|bucks?|pounds?|quid|euros?|usd|cad|eur|gbp|aud|grand|thousand|million|billion)$/;
const MONTH_NAMES =
  "january|february|march|april|may|june|july|august|september|october|november|december";
const MONTHS = new Set(MONTH_NAMES.split("|"));

const ROMAN: Record<string, number> = {
  II: 2,
  III: 3,
  IV: 4,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
  XI: 11,
  XII: 12,
};
// A roman numeral is a figure only beside a time unit or k ("III months"):
// "I", "X" and "VI" alone are pronouns, names and markers.
const ROMAN_QUANTITY =
  /(?<![\p{L}\p{N}])(XII|XI|IX|X|VIII|VII|VI|IV|III|II)(?![\p{L}\p{N}])\s*-?\s*(days?|weeks?|fortnights?|months?|quarters?|years?|k)(?!\p{L})/giu;

// Digit durations and dates ("4 weeks", "1st of March"): the notice-period
// counterparts of the spelled forms, for the availability rule.
export function digitAvailability(text: string): string[] {
  const clean = canonicalText(text);
  const keys: string[] = [];
  for (const match of clean.matchAll(
    /(?<![\p{L}\d.,])(\d+)\s?-?\s?(?:days?|weeks?|fortnights?|months?|quarters?)(?!\p{L})/giu,
  ))
    if (match[1]) keys.push(String(Number(match[1])));
  for (const match of clean.matchAll(
    new RegExp(
      `(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH_NAMES})(?!\\p{L})|(?<!\\p{L})(?:${MONTH_NAMES})\\s+(\\d{1,2})(?!\\d)`,
      "giu",
    ),
  ))
    keys.push(String(Number(match[1] ?? match[2])));
  return keys;
}

const isDigits = (token: string) => /^\d/.test(token);

export function spokenQuantities(
  text: string,
  topical: boolean,
): SpokenQuantity[] {
  const folded = foldSpoken(text);
  const found: SpokenQuantity[] = [];
  for (const match of folded.matchAll(ROMAN_QUANTITY)) {
    const thousands = (match[2] ?? "").toLowerCase() === "k";
    const value =
      (ROMAN[(match[1] ?? "").toUpperCase()] ?? 0) * (thousands ? 1000 : 1);
    found.push({
      key: String(value),
      kind: thousands ? "money" : "duration",
      scaled: thousands,
      value,
    });
  }
  const tokens = folded.toLowerCase().match(/\p{L}+|\d+(?:[.,]\d+)*/gu) ?? [];
  const at = (index: number) => tokens[index] ?? "";
  const unitAfter = (from: number) => {
    let index = from;
    while (["of", "a", "an"].includes(at(index))) index += 1;
    return at(index);
  };
  const startsNumber = (token: string) =>
    token in UNITS ||
    token in TENS ||
    token in ORDINAL_UNITS ||
    token in ORDINAL_TENS ||
    token === "hundred" ||
    token === "dozen" ||
    token in SCALES;

  for (let i = 0; i < tokens.length; ) {
    const token = at(i);
    if (isDigits(token)) {
      i += 1;
      continue;
    }
    if (VAGUE_PLURAL.has(token)) {
      found.push({ key: `~${token}`, kind: "vague", scaled: true, value: 0 });
      i += 1;
      continue;
    }
    if (VAGUE_WORD.has(token)) {
      const unit = unitAfter(i + 1);
      if (DURATION.test(unit) || MONEY.test(unit))
        found.push({ key: `~${token}`, kind: "vague", scaled: true, value: 0 });
      i += 1;
      continue;
    }
    const article = token === "a" || token === "an";
    if (article && A_DURATION.test(at(i + 1))) {
      found.push({ key: "1", kind: "duration", scaled: false, value: 1 });
      i += 1;
      continue;
    }
    if (!(startsNumber(token) || (article && startsNumber(at(i + 1))))) {
      i += 1;
      continue;
    }

    // [STRATEGY] One number phrase: "one hundred and fifty thousand" is one
    // figure, "twelve thirty" is two, "one fifty" is two.
    if (article) i += 1;
    let total = 0;
    let current = 0;
    let scaled = false;
    let ordinal = false;
    const start = i;
    for (; i < tokens.length; i += 1) {
      const word = at(i);
      const unit = UNITS[word] ?? ORDINAL_UNITS[word];
      const ten = TENS[word] ?? ORDINAL_TENS[word];
      // An ordinal ends the phrase ("twenty first").
      if (ordinal) break;
      const atBoundary = current === 0 || current % 100 === 0;
      if (unit !== undefined) {
        const joins =
          unit >= 10
            ? atBoundary
            : atBoundary || (current % 100 >= 20 && current % 10 === 0);
        if (!joins) break;
        current += unit;
        if (word in ORDINAL_UNITS) ordinal = true;
      } else if (ten !== undefined) {
        if (!atBoundary) break;
        current += ten;
        if (word in ORDINAL_TENS) ordinal = true;
      } else if (word === "hundred") {
        if (current >= 100) break;
        current = (current || 1) * 100;
        scaled = true;
      } else if (word === "dozen") {
        if (current !== 0) break;
        current = 12;
        scaled = true;
      } else if (word in SCALES) {
        total += (current || 1) * (SCALES[word] ?? 1);
        current = 0;
        scaled = true;
      } else if (word === "k" && total + current > 0) {
        total = (total + current) * 1000;
        current = 0;
        scaled = true;
        i += 1;
        break;
      } else if (
        word === "and" &&
        (current >= 100 || total > 0) &&
        startsNumber(at(i + 1)) &&
        !(at(i + 1) in SCALES)
      )
        continue;
      else break;
    }
    if (i === start) i += 1;
    const value = total + current;
    const next = at(i);
    const kind: SpokenQuantity["kind"] = DURATION.test(next)
      ? "duration"
      : MONEY.test(next)
        ? "money"
        : "plain";
    if (ordinal) {
      const dated =
        (at(i) === "of" && MONTHS.has(at(i + 1))) || MONTHS.has(at(start - 1));
      if (dated)
        found.push({ key: String(value), kind: "date", scaled, value });
      continue;
    }
    if (kind !== "plain" || scaled || value > 10 || (topical && value !== 1))
      found.push({ key: String(value), kind, scaled, value });
  }
  return found;
}
