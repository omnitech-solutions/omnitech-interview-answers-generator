// The image gate (decision D35): whether a screenshot's IMAGE reaches a model
// beside, or instead of, its machine-read on-screen text. A pure decision from
// the owner's per-session setting, the text block the device sent (with the
// metrics the native recogniser measured) and the processing kind. It reads
// text only to classify its shape; it stores, logs and returns none of it.
//
// The rule that governs everything here: ANY DOUBT SENDS THE IMAGE. A missing
// block or metric, a non-native engine, a long (possibly cut) text, a frame
// that looks like code, a large untouched region, low confidence: each keeps
// the image. Only a clean, fully read, prose-like frame may go as text alone.
import type {
  LiveOcrBlock,
  LiveScreenshotSend,
} from "@omnitech/interview-contracts";

// What of one screenshot leaves the device for one model call.
export type ScreenshotSent = "image" | "text-only" | "none";

// Why the gate chose, a closed word for tests and traces (never content).
export type GateReason =
  | "device-only"
  | "setting-always"
  | "setting-never"
  | "no-text"
  | "no-ocr"
  | "engine-not-native"
  | "no-metrics"
  | "text-too-long"
  | "few-boxes"
  | "low-coverage"
  | "low-confidence"
  | "large-gap"
  | "looks-like-code"
  | "clean-text";

// The ONE table of thresholds. A frame goes as text only when every line holds.
// The grid-based coverage and gap come from the shell (OcrMetrics.swift): a
// cell counts as covered when any text box touches it, so thin text lines cover
// whole rows and a page of prose covers most of the frame.
export const IMAGE_GATE_THRESHOLDS = {
  // Text boxes must touch at least this fraction of the frame.
  minCoverage: 0.6,
  // Both the block's and the metrics' mean confidence must reach this.
  minMeanConfidence: 0.85,
  // The largest rectangle no text box touches may be at most this fraction.
  maxLargestGap: 0.15,
  // Fewer boxes than this is too little to call a frame "text".
  minBoxes: 3,
  // A text this long may have been cut at the device's 20,000-character bound,
  // and may not fit the prompt beside others: keep the image.
  maxTextChars: 12_000,
  // Code detection (the OCR text is whitespace-normalised, so indentation is
  // already gone; shape is read from lines and symbols instead). A frame is code
  // when at least `codeLineFraction` of its non-empty lines look like code
  // (and at least `codeMinLines` do), or when `symbolDensity` of its characters
  // are code punctuation.
  codeLineFraction: 0.25,
  codeMinLines: 2,
  symbolDensity: 0.04,
} as const;

const CODE_LINE: readonly RegExp[] = [
  /[{};]\s*$/,
  /^[})\]]/,
  /=>|===?|!==?|&&|\|\||->|::|\+=|-=|<=|>=|\+\+|--\s*$/,
  /^(import|export|from|const|let|var|def|class|function|return|if|else|for|while|switch|case|public|private|protected|static|async|await|package|struct|enum|interface|type|fn|func|use|namespace|#include)\b/,
  /\w\([^)]*\)\s*[{:;]?\s*$/,
];
const CODE_SYMBOLS = /[{}()[\];=<>]/g;

// A heuristic, deliberately eager: a false "code" keeps an image (safe), a
// false "prose" would drop one. Takes text only to classify its shape.
export function looksLikeCode(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return false;
  const codeLines = lines.filter((line) =>
    CODE_LINE.some((pattern) => pattern.test(line)),
  ).length;
  const t = IMAGE_GATE_THRESHOLDS;
  if (
    codeLines >= t.codeMinLines &&
    codeLines / lines.length >= t.codeLineFraction
  )
    return true;
  const symbols = text.match(CODE_SYMBOLS)?.length ?? 0;
  return text.length > 0 && symbols / text.length >= t.symbolDensity;
}

export type ImageGateDecision = { sent: ScreenshotSent; reason: GateReason };

// `kind` is the session's processing policy at dispatch. A device-only session
// sends nothing to a model whatever the setting says (its image refusal in the
// dispatch is separate and stays as it is).
export function imageGate(
  setting: LiveScreenshotSend,
  block: LiveOcrBlock | null | undefined,
  kind: "permitted-remote" | "device-only",
): ImageGateDecision {
  if (kind === "device-only") return { sent: "none", reason: "device-only" };
  const hasText = block !== null && block !== undefined && block.text !== "";
  if (setting === "always") return { sent: "image", reason: "setting-always" };
  if (setting === "never")
    return hasText
      ? { sent: "text-only", reason: "setting-never" }
      : { sent: "none", reason: "setting-never" };

  // text-only-when-text: every branch below that is not the last sends the image.
  const image = (reason: GateReason): ImageGateDecision => ({
    sent: "image",
    reason,
  });
  if (block === null || block === undefined) return image("no-ocr");
  if (block.engine !== "vision") return image("engine-not-native");
  if (!hasText) return image("no-text");
  const t = IMAGE_GATE_THRESHOLDS;
  const metrics = block.metrics;
  if (metrics === undefined) return image("no-metrics");
  if (block.text.length > t.maxTextChars) return image("text-too-long");
  if (metrics.boxes < t.minBoxes) return image("few-boxes");
  if (metrics.coverage < t.minCoverage) return image("low-coverage");
  if (
    metrics.meanConfidence < t.minMeanConfidence ||
    (block.confidence !== undefined && block.confidence < t.minMeanConfidence)
  )
    return image("low-confidence");
  if (metrics.largestGap > t.maxLargestGap) return image("large-gap");
  if (looksLikeCode(block.text)) return image("looks-like-code");
  return { sent: "text-only", reason: "clean-text" };
}
