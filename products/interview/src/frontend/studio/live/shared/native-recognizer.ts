// The native adapter: the shell reads the image with Apple Vision (bridge op
// `recognizeText`). The page reads the FINAL bytes, so a crop it encoded itself
// is recognised as cropped. Only the image's type and bytes cross the bridge.
import type {
  StudioHost,
  StudioHostImage,
} from "@omnitech/interview-contracts";
// Types only: text-recognizer.ts imports this file.
import type {
  RecognitionFailure,
  RecognitionFailureReason,
  RecognitionResult,
  TextRecognizer,
} from "./text-recognizer";

// The shell refuses larger images (TextRecognition.swift maxImageBytes): refuse
// here first rather than spend a bridge round trip on bytes it will not read.
export const NATIVE_OCR_MAX_BYTES = 2 * 1024 * 1024;

const MEDIA_TYPES: readonly StudioHostImage["mediaType"][] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

// What the bridge may answer with; anything else is read as "unavailable".
const HOST_REFUSALS: readonly RecognitionFailureReason[] = [
  "too-large",
  "unreadable",
  "timeout",
  "unavailable",
];

const fail = (reason: RecognitionFailureReason): RecognitionFailure => ({
  ok: false,
  reason,
});

function toBase64(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      const comma = url.indexOf(",");
      resolve(comma < 0 ? null : url.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

// Settles with `aborted` as soon as the signal fires; the bridge call itself
// cannot be cancelled, its late answer is dropped.
function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T | RecognitionFailure> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(fail("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function createNativeRecognizer(
  host: Pick<StudioHost, "recognizeText">,
): TextRecognizer {
  return {
    engine: "vision",
    available: typeof host.recognizeText === "function",
    async recognize(image, signal): Promise<RecognitionResult> {
      // [GUARD] Type and size are checked before any bytes are read.
      if (signal?.aborted) return fail("aborted");
      const recognizeText = host.recognizeText?.bind(host);
      if (!recognizeText) return fail("unavailable");
      const mediaType = MEDIA_TYPES.find((type) => type === image.type);
      if (!mediaType) return fail("unreadable");
      if (image.size === 0) return fail("unreadable");
      if (image.size > NATIVE_OCR_MAX_BYTES) return fail("too-large");

      try {
        const base64 = await untilAborted(toBase64(image), signal);
        if (base64 !== null && typeof base64 === "object") return base64;
        if (base64 === null) return fail("unreadable");
        if (signal?.aborted) return fail("aborted");

        // [SAFETY] The host answers in a typed result; a throw is "unavailable".
        const reply = await untilAborted(
          recognizeText({ mediaType, base64 }),
          signal,
        );
        if (signal?.aborted) return fail("aborted");
        if ("ok" in reply && reply.ok === false)
          return fail(
            HOST_REFUSALS.find((reason) => reason === reply.reason) ??
              "unavailable",
          );
        if (!("ok" in reply) || reply.ok !== true) return fail("unavailable");
        return {
          ok: true,
          engine: "vision",
          text: reply.text,
          confidence: reply.confidence,
          truncated: reply.truncated,
          // Validated where the upload block is built (ocrBlockFor).
          metrics: reply.metrics,
        };
      } catch {
        return fail("unavailable");
      }
    },
  };
}
