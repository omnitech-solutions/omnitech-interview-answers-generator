// [DOMAIN] What a line of a template becomes when some of its values are
// empty. A finished document must not show the scaffolding around a value
// that is not there: no "|  |  |  Calgary, AB", no "~  (- )", no bullet or
// "Label:" with nothing after it. The same rules serve DOCX paragraphs and
// Markdown lines, which is why they work on a line's text and the places its
// placeholders sit in it, not on either format.

export type LinePlaceholder = {
  start: number;
  end: number;
  key: string;
  // The value this placeholder will be replaced with is empty.
  empty: boolean;
};

export type LineLayout = {
  // Fields of a block that does not apply to this document.
  absent: ReadonlySet<string>;
  // Fields that head a block that does apply (employer, title, dates).
  header: ReadonlySet<string>;
};

const NO_LAYOUT: LineLayout = { absent: new Set(), header: new Set() };
// What sets the parts of a line apart: "a | b", "a ~ b", "a · b".
const SEPARATOR = /\s*[|~•·]\s*/g;
const WORD = /[\p{L}\p{N}]/u;

/**
 * Decide a line with empty values. Returns "remove" when the whole line goes,
 * or the characters of `text` to delete (true at an index deletes it); the
 * caller writes the remaining literal text and the values.
 *
 *   - A line whose placeholders all belong to a block that does not apply, or
 *     are otherwise empty with at least one such field, is removed.
 *   - A line whose placeholders are all empty is removed when it is a list
 *     item, a "Label: value" or "Label (value)" line, or holds nothing else;
 *     a block's own heading is kept, without its empty decorations.
 *   - Otherwise each part between separators that is left with no value and
 *     no words is dropped with one separator, and inside a kept part an empty
 *     value takes its brackets or its joining comma or dash with it.
 */
export function blankLine(
  text: string,
  placeholders: readonly LinePlaceholder[],
  options: { listItem?: boolean; layout?: LineLayout } = {},
): "remove" | boolean[] {
  const layout = options.layout ?? NO_LAYOUT;
  const deleted = Array.from({ length: text.length }, () => false);
  if (placeholders.length === 0) return deleted;
  const gone = (item: LinePlaceholder) =>
    item.empty || layout.absent.has(item.key);
  if (
    placeholders.some((item) => layout.absent.has(item.key)) &&
    placeholders.every(gone)
  )
    return "remove";
  if (!placeholders.some(gone)) return deleted;

  // The line with its placeholders blanked out: what the template itself says.
  const literal = [...text];
  for (const item of placeholders)
    for (let index = item.start; index < item.end; index++)
      literal[index] = "\uFFFC";
  const literalText = literal.join("");
  const words = (from: number, to: number) =>
    WORD.test(literalText.slice(from, to).replaceAll("\uFFFC", ""));

  if (placeholders.every(gone)) {
    const heading = placeholders.every((item) => layout.header.has(item.key));
    const firstStart = Math.min(...placeholders.map((item) => item.start));
    const label = /[:(]\s*$/.test(
      literalText.slice(0, firstStart).replaceAll("\uFFFC", ""),
    );
    if (!heading && (options.listItem || label || !words(0, text.length)))
      return "remove";
  }

  const drop = (from: number, to: number) => {
    for (
      let index = Math.max(0, from);
      index < Math.min(text.length, to);
      index++
    )
      deleted[index] = true;
  };

  // Parts between separators. A separator is only ever template text.
  const separators = Array.from(literalText.matchAll(SEPARATOR), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const parts: Array<{ start: number; end: number; kept: boolean }> = [];
  let cursor = 0;
  for (const separator of [
    ...separators,
    { start: text.length, end: text.length },
  ]) {
    const inside = placeholders.filter(
      (item) => item.start >= cursor && item.end <= separator.start,
    );
    parts.push({
      start: cursor,
      end: separator.start,
      kept:
        inside.length === 0 ||
        !inside.every(gone) ||
        words(cursor, separator.start),
    });
    cursor = separator.end;
  }
  if (parts.every((part) => !part.kept)) return "remove";
  // One separator stays between two kept parts: the one just before the later.
  let seenKept = false;
  parts.forEach((part, index) => {
    if (!part.kept) drop(part.start, part.end);
    const separator = separators[index - 1];
    if (separator && !(part.kept && seenKept))
      drop(separator.start, separator.end);
    if (part.kept) seenKept = true;
  });

  // Inside a kept part, an empty value takes its own scaffolding with it.
  for (const item of placeholders) {
    if (!gone(item) || deleted[item.start]) continue;
    const part = parts.find(
      (candidate) => item.start >= candidate.start && item.end <= candidate.end,
    );
    if (!part) continue;
    // Brackets that would be left holding nothing: "(", spaces, dashes, ")".
    const open = literalText.lastIndexOf("(", item.start);
    const close = literalText.indexOf(")", item.end);
    if (
      open >= part.start &&
      close >= 0 &&
      close < part.end &&
      !literalText.slice(open + 1, item.start).includes(")") &&
      !words(open, close) &&
      placeholders
        .filter((other) => other.start > open && other.end <= close)
        .every(gone)
    ) {
      let from = open;
      while (from > part.start && /\s/.test(text[from - 1] ?? "")) from--;
      drop(from, close + 1);
      continue;
    }
    // A joining comma or dash: the one before the value, else the one after.
    // A dash joins only when it stands apart from a word ("{a}- {b}", "a – b").
    const before = /(?:,\s*|(?:\s+|(?<=\uFFFC))[-–—]\s*)$/.exec(
      literalText.slice(part.start, item.start),
    );
    const after = /^(?:\s*,\s*|\s*[-–—](?:\s+|(?=\uFFFC)))/.exec(
      literalText.slice(item.end, part.end),
    );
    if (before) drop(item.start - before[0].length, item.start);
    else if (after) drop(item.end, item.end + after[0].length);
    else {
      // No joiner: the space that followed the value goes with it, so the
      // words either side are not left two spaces apart.
      const space = /^\s+/.exec(literalText.slice(item.end, part.end));
      const edge =
        item.start === part.start || /\s/.test(text[item.start - 1] ?? "");
      if (space && edge) drop(item.end, item.end + space[0].length);
    }
  }
  return deleted;
}

/** The line as written: literal text that was not deleted, and each value in its place. */
export function writeBlankLine(
  text: string,
  placeholders: readonly LinePlaceholder[],
  deleted: readonly boolean[],
  value: (item: LinePlaceholder) => string,
): string {
  let out = "";
  let index = 0;
  for (const item of [...placeholders].sort((a, b) => a.start - b.start)) {
    for (; index < item.start; index++) if (!deleted[index]) out += text[index];
    if (!deleted[item.start]) out += value(item);
    index = item.end;
  }
  for (; index < text.length; index++) if (!deleted[index]) out += text[index];
  return out;
}
