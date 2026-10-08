// Page-side text recognition (D31): every screenshot is read on the device
// before it is uploaded, so the model also gets exact text and numbers. ONE
// port, two adapters behind it (native-recognizer.ts: Apple Vision through the
// shell's bridge; wasm-recognizer.ts: Tesseract.js served from our own origin),
// and an explicit "none" recognizer. A caller that gets no text still sends the
// image. Text is machine-read: it is held in memory for one Apply, never logged
// and never persisted here (AGENTS.md rule 8).
import {
  LIVE_OCR_LIMITS,
  type LiveOcrBlock,
  type LiveOcrMetrics,
  type StudioHostInfo,
  type StudioHostOcr,
} from "@omnitech/interview-contracts";
import { createNativeRecognizer } from "./native-recognizer";

// The upload contract names the same two engines (LiveOcrBlock).
const ENGINES: readonly string[] = ["vision", "tesseract"];
export type RecognitionEngine = LiveOcrBlock["engine"];

// Closed vocabulary: the only ways a read can end without text.
export const RECOGNITION_FAILURES = [
  "too-large",
  "unreadable",
  "timeout",
  "unavailable",
  "aborted",
] as const;
export type RecognitionFailureReason = (typeof RECOGNITION_FAILURES)[number];

export type RecognizedText = {
  ok: true;
  engine: RecognitionEngine;
  text: string;
  // Mean recognition confidence, 0..1, when the engine reports one.
  confidence: number | null;
  // The engine cut the text at its own bound.
  truncated: boolean;
  // Where the text sits in the frame (D35, Apple Vision only). Evidence for the
  // server's image gate; absent means unknown, and unknown sends the image.
  metrics?: unknown;
};
export type RecognitionFailure = {
  ok: false;
  reason: RecognitionFailureReason;
};
export type RecognitionResult = RecognizedText | RecognitionFailure;

export type TextRecognizer = {
  // Which engine will answer, or null for the none recognizer.
  readonly engine: RecognitionEngine | null;
  // False once this recognizer knows it cannot read at all (no WebAssembly, its
  // assets missing). A callers shows it; the image is sent regardless.
  readonly available: boolean;
  // Never throws: a refusal is a typed failure. `aborted` when the signal fires.
  recognize(image: Blob, signal?: AbortSignal): Promise<RecognitionResult>;
};

export const failure = (reason: RecognitionFailureReason): RecognitionFailure =>
  ({ ok: false, reason }) as const;

// No OCR: the explicit choice when neither engine can run.
export const NO_RECOGNIZER: TextRecognizer = {
  engine: null,
  available: false,
  recognize: async () => failure("unavailable"),
};

// [STRATEGY] The native shell reads with Apple Vision when it advertises
// "text-recognition"; otherwise the in-page WASM engine; otherwise nothing.
export function chooseRecognizer(
  info: StudioHostInfo | null,
  wasm: TextRecognizer | null,
): TextRecognizer {
  if (info?.capabilities.has("text-recognition"))
    return createNativeRecognizer(info.host);
  if (wasm?.available) return wasm;
  return NO_RECOGNIZER;
}

// Cuts at the last whole line within `max` (never inside a surrogate pair), so
// a cut-off reads as missing lines, not a broken one.
export function capOcrText(
  text: string,
  max: number,
): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let cut = text.slice(0, max);
  const lineEnd = cut.lastIndexOf("\n");
  if (lineEnd > 0) cut = cut.slice(0, lineEnd);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return { text: cut.trimEnd(), truncated: true };
}

const unit = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

// [GUARD] [SAFETY] D35: the metrics the image gate reads. Exactly the four
// fields, each in range (`boxes` a whole number up to the contract bound). Any
// other shape, a missing or out-of-range field, or an extra key drops the WHOLE
// object, so the server falls back to "doubt = send the image". Never repaired.
export function validOcrMetrics(value: unknown): LiveOcrMetrics | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw).sort().join(",");
  if (keys !== "boxes,coverage,largestGap,meanConfidence") return null;
  const { coverage, meanConfidence, largestGap, boxes } = raw;
  if (!unit(coverage) || !unit(meanConfidence) || !unit(largestGap))
    return null;
  if (
    typeof boxes !== "number" ||
    !Number.isInteger(boxes) ||
    boxes < 0 ||
    boxes > 100_000
  )
    return null;
  return { coverage, meanConfidence, largestGap, boxes };
}

// [GUARD] The upload block for one result: null for a failure or for no text;
// otherwise normalised (line endings, NULs), trimmed and held to the per-image
// bound. Never throws, whatever the engine handed back.
export function ocrBlockFor(
  result: RecognitionResult | null | undefined,
): LiveOcrBlock | null {
  try {
    if (result?.ok !== true) return null;
    if (!ENGINES.includes(result.engine) || typeof result.text !== "string")
      return null;
    const capped = capOcrText(
      result.text.replace(/\r\n?/g, "\n").replaceAll("\u0000", "").trim(),
      LIVE_OCR_LIMITS.maxTextPerImage,
    );
    const text = capped.text;
    if (text === "") return null;
    // [SAFETY] D35: metrics describe the WHOLE image. Text that was cut (here
    // or by the engine) no longer matches them, so they are dropped and the
    // server's gate, seeing none, sends the image (doubt = send).
    const cut = capped.truncated || result.truncated === true;
    const confidence =
      typeof result.confidence === "number" &&
      Number.isFinite(result.confidence)
        ? Math.min(1, Math.max(0, result.confidence))
        : null;
    const metrics =
      result.engine === "vision" && !cut
        ? validOcrMetrics(result.metrics)
        : null;
    return {
      engine: result.engine,
      text,
      ...(confidence === null ? {} : { confidence }),
      ...(metrics === null ? {} : { metrics }),
    };
  } catch {
    return null;
  }
}

// The upload block for the text the shell read while it captured (Auto and
// hands-free frames): the same guard, bounds and metrics rule as a staged read.
export function ocrBlockForHostCapture(
  ocr: StudioHostOcr | null | undefined,
): LiveOcrBlock | null {
  if (!ocr || typeof ocr !== "object") return null;
  return ocrBlockFor({
    ok: true,
    engine: ocr.engine,
    text: ocr.text,
    confidence: ocr.confidence,
    truncated: ocr.truncated === true,
    metrics: ocr.metrics,
  });
}

// The request carries at most LIVE_OCR_LIMITS.maxTextPerRequest characters in
// all, or the server refuses it: later images give way, in order, so the first
// screenshots keep their full text.
export function ocrBlocksForRequest(
  blocks: readonly (LiveOcrBlock | null)[],
): (LiveOcrBlock | null)[] {
  let left: number = LIVE_OCR_LIMITS.maxTextPerRequest;
  return blocks.map((block) => {
    if (!block || left <= 0) return null;
    const { text } = capOcrText(block.text, left);
    if (text === "") return null;
    left -= text.length;
    if (text === block.text) return block;
    // Trimmed text no longer matches the whole-image metrics: drop them.
    const { metrics: _whole, ...rest } = block;
    return { ...rest, text };
  });
}
