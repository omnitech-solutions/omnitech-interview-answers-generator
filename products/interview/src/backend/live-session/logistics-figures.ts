// Logistics outcome allowlist (review S1, round 5). Notice period,
// compensation, start date and availability are the candidate's own facts, so
// a logistics draft may carry a figure, unit or date expression ONLY when it
// is a verbatim span of an approved preference quote. Anything else that looks
// like a quantity, spelled or digit, ordinal, range, Roman numeral, month,
// weekday or bare unit is refused, with or without a unit. This replaces the
// blacklist of figure shapes for this one outcome: new spellings cannot slip
// through because the check is "nothing figure-like remains", not "no known
// figure shape".
//
// Pure, no I/O, and no copy of the draft or a quote leaves it.
import { foldSpoken } from "./spoken-figures.js";

const NUMBER_WORDS = new Set(
  (
    "zero two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen " +
    "twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion grand dozen " +
    "tens dozens scores hundreds thousands millions billions " +
    "third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth " +
    "twentieth thirtieth fortieth fiftieth sixtieth seventieth eightieth ninetieth hundredth thousandth"
  ).split(" "),
);
// Units of time and money, and date words. "may" is handled separately: it is
// a modal verb first.
const UNIT_WORDS = new Set(
  (
    "day days weekday weekdays week weeks wk wks fortnight fortnights month months mo mos quarter quarters year years yr yrs " +
    "annual annually annum k dollar dollars buck bucks pound pounds quid euro euros usd gbp eur cad aud figure figures " +
    "january february march april june july august september october november december " +
    "monday tuesday wednesday thursday friday saturday sunday tomorrow tonight summer autumn winter spring"
  ).split(" "),
);
const ROMAN_LOWER = new Set(
  "ii iii iv vi vii viii ix xi xii xiii xiv xv xvi xx".split(" "),
);
const ROMAN_UPPER =
  /^(?=[MDCLXVI])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;
// "6months", "threeweeks": a number glued to a unit.
const GLUED = /^(?:[a-z]+|\p{N}+)(?:days?|weeks?|months?|years?|wks?|yrs?)$/u;
const SPELLED_PREFIX =
  /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)/;

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The spans of a preference quote a draft may repeat verbatim: the whole quote
// and its value after a "Label:" prefix, without trailing punctuation.
export function approvedSpans(quotes: readonly string[]): string[] {
  const spans = new Set<string>();
  for (const quote of quotes) {
    const clean = squash(foldSpoken(quote)).replace(/[\s.,;:!?]+$/u, "");
    if (!clean) continue;
    spans.add(clean);
    const colon = clean.indexOf(":");
    const value = colon < 0 ? "" : clean.slice(colon + 1).trim();
    if (value) spans.add(value);
  }
  return [...spans].sort((a, b) => b.length - a.length);
}

const figureBearingToken = (token: string, index: number, all: string[]) => {
  const lower = token.toLowerCase();
  if (/\p{N}/u.test(token)) return true;
  if (NUMBER_WORDS.has(lower) || UNIT_WORDS.has(lower)) return true;
  if (ROMAN_LOWER.has(lower)) return true;
  if (token !== "I" && token === token.toUpperCase() && ROMAN_UPPER.test(token))
    return true;
  if (GLUED.test(lower) && (/\p{N}/u.test(lower) || SPELLED_PREFIX.test(lower)))
    return true;
  const before = (all[index - 1] ?? "").toLowerCase();
  const after = (all[index + 1] ?? "").toLowerCase();
  // "may" is a month only in a date position.
  if (lower === "may")
    return (
      /^(?:in|of|by|until|early|late|end|mid|from|since|before|after|the)$/.test(
        before,
      ) || /^(?:\p{N}.*|first|second)$/u.test(after)
    );
  // "first" and "second" are ordinary words except as a day of the month
  // ("on the first", "the second of the month").
  if (lower === "first" || lower === "second")
    return (
      /^(?:on|by|until|from|since)$/.test(before) ||
      (before === "the" &&
        /^(?:on|by|until|from|since)$/.test(
          (all[index - 2] ?? "").toLowerCase(),
        )) ||
      after === "of"
    );
  return false;
};

// True when the draft carries a figure, unit or date expression that is not a
// verbatim span of an approved preference quote.
export function hasUnapprovedLogisticsFigure(
  draft: string,
  approvedQuotes: readonly string[],
): boolean {
  let rest = ` ${squash(foldSpoken(draft))} `;
  for (const span of approvedSpans(approvedQuotes))
    rest = rest.replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}])${escape(span).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`,
        "giu",
      ),
      " ",
    );
  if (/[$£€%]/u.test(rest)) return true;
  const tokens = rest.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  return tokens.some((token, index) =>
    figureBearingToken(token, index, tokens),
  );
}
