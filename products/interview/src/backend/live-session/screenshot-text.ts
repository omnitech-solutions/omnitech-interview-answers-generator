// Text read from a screenshot on the owner's device (OCR). It is session content
// like the screenshot itself: stored on the screenshot's observation, never
// logged, never returned to the browser, and sent to a model only beside the
// image (device-only sessions send neither). Two pure helpers live here: the
// normalisation applied before storing, and the mechanical "looks cut off" hint.

// What one call may carry of the text read from its screenshots, in UTF-8 bytes
// of the JSON-encoded text (the prompt window is 48 KB of bytes, so a character
// count would let a CJK or Cyrillic screen overrun it; a whole text is kept or
// left out).
export const OCR_PROMPT_MAX_BYTES = 24_000;

// What a text costs in the prompt: its JSON encoding, in UTF-8 bytes.
export function ocrPromptBytes(text: string): number {
  return Buffer.byteLength(JSON.stringify(text));
}

// One screenshot's text as the prompt shows it: the attached image's name, the
// session's S{n}, the text, and whether it appears to stop mid-sentence.
// `image` is the attached image's name, or null when the owner's setting
// withheld the image and only this text is given.
export type ScreenshotText = {
  image: string | null;
  label: string;
  text: string;
  cutOff: boolean;
};

// Whitespace-normalised plain text: line breaks unified, control characters
// removed, runs of spaces collapsed, line ends trimmed, blank-line runs
// shortened. Nothing is cut to length: the caller refuses an over-long text.
export function normalizeOcrText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, (char) => (char === "\n" ? char : ""))
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const OPEN_TO_CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
};
const TERMINAL = /[.!?:;)\]}"'”’`»]$/;
const OPENERS = /[([{"“‘'«]$/;
const LOWERCASE_WORD = /\p{Ll}[\p{L}\p{N}'’-]*$/u;

// A hint, never a verdict: the text appears to stop mid-sentence or
// mid-structure. True when the last non-empty line has no terminal punctuation
// and ends with a lowercase word or an open bracket or quote, or when brackets
// left open or double quotes are odd anywhere in the text.
export function ocrLooksCutOff(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const last = lines[lines.length - 1];
  if (last === undefined) return false;
  if (unbalanced(text)) return true;
  if (TERMINAL.test(last)) return false;
  return OPENERS.test(last) || LOWERCASE_WORD.test(last);
}

function unbalanced(text: string): boolean {
  const stack: string[] = [];
  for (const char of text) {
    if (char in OPEN_TO_CLOSE) stack.push(OPEN_TO_CLOSE[char] as string);
    // A closer with no opener is ignored ("1) item" is a list marker).
    else if (stack[stack.length - 1] === char) stack.pop();
  }
  if (stack.length > 0) return true;
  return (text.match(/"/g)?.length ?? 0) % 2 === 1;
}
