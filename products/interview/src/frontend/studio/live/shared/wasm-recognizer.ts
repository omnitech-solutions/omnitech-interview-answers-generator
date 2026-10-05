// The browser adapter: Tesseract.js running as WebAssembly in a worker, every
// asset served from our own origin under /ocr (apps/web/scripts/copy-ocr-assets.mjs
// copies the worker, the core and the English data there at build; no CDN, no
// remote fetch). Behind the TextRecognizer port, so removing it means deleting
// this file and the one line that passes it to chooseRecognizer.
//
// One shared worker, loaded when the first image needs it, jobs one at a time,
// each with its own budget; the worker is terminated once nothing has asked for
// it for a while. If the assets or WebAssembly are missing it says
// "unavailable" (and stays that way), never nothing.
import { LIVE_OCR_LIMITS } from "@omnitech/interview-contracts";
import {
  capOcrText,
  failure,
  type RecognitionResult,
  type TextRecognizer,
} from "./text-recognizer";

export const OCR_ASSET_PATHS = {
  worker: "/ocr/worker.min.js",
  // A directory: tesseract.js picks the right core file for the browser.
  core: "/ocr/core",
  lang: "/ocr/lang",
} as const;

export const WASM_OCR_BUDGET_MS = 15_000;
export const WASM_OCR_IDLE_MS = 30_000;
export const WASM_OCR_MAX_BYTES = 12 * 1024 * 1024;

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"];

// What the adapter needs of an OCR engine: the seam tests fake.
export type OcrEngine = {
  recognize(image: Blob): Promise<{ text: string; confidence: number }>;
  terminate(): Promise<void>;
};
export type EngineLoader = () => Promise<OcrEngine>;

export type WasmRecognizerOptions = {
  load?: EngineLoader;
  budgetMs?: number;
  idleMs?: number;
  supported?: () => boolean;
};

export type WasmRecognizer = TextRecognizer & {
  // Terminates the worker now (tests, page teardown).
  dispose(): Promise<void>;
};

const browserSupportsWasm = (): boolean =>
  typeof WebAssembly === "object" && typeof Worker === "function";

// [SAFETY] The English data is checked first: tesseract.js swallows a failed
// language load and would otherwise wait forever. Only our own origin is asked.
async function loadTesseract(): Promise<OcrEngine> {
  const data = await fetch(`${OCR_ASSET_PATHS.lang}/eng.traineddata.gz`, {
    method: "HEAD",
  });
  if (!data.ok) throw new Error("ocr data missing");
  const { createWorker } = await import("tesseract.js");
  let onWorkerError: (error: Error) => void = () => {};
  const workerFailed = new Promise<never>((_, reject) => {
    onWorkerError = reject;
  });
  const worker = await Promise.race([
    createWorker("eng", 1, {
      workerPath: OCR_ASSET_PATHS.worker,
      corePath: OCR_ASSET_PATHS.core,
      langPath: OCR_ASSET_PATHS.lang,
      gzip: true,
      // Language data is read from our own files each time; nothing is stored.
      cacheMethod: "none",
      workerBlobURL: false,
      errorHandler: (error: unknown) => onWorkerError(new Error(String(error))),
    }),
    workerFailed,
  ]);
  return {
    recognize: async (image) => {
      const { data } = await worker.recognize(image);
      return { text: data.text, confidence: data.confidence };
    },
    terminate: async () => {
      await worker.terminate();
    },
  };
}

// Settles with "timeout" or "aborted"; `stop` clears the timer and listener.
function guard(budgetMs: number, signal: AbortSignal | undefined) {
  let stop = () => {};
  const settled = new Promise<"timeout" | "aborted">((resolve) => {
    const timer = Number.isFinite(budgetMs)
      ? setTimeout(() => resolve("timeout"), budgetMs)
      : undefined;
    const onAbort = () => resolve("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });
    stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
  });
  return { settled, stop };
}

export function createWasmRecognizer(
  options: WasmRecognizerOptions = {},
): WasmRecognizer {
  const load = options.load ?? loadTesseract;
  const budgetMs = options.budgetMs ?? WASM_OCR_BUDGET_MS;
  const idleMs = options.idleMs ?? WASM_OCR_IDLE_MS;
  const supported = options.supported ?? browserSupportsWasm;

  let engine: Promise<OcrEngine> | null = null;
  let broken = false;
  let active = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  // Jobs run one at a time, each with its own budget; the tail never rejects.
  let tail: Promise<unknown> = Promise.resolve();

  const terminate = async (): Promise<void> => {
    const current = engine;
    engine = null;
    if (!current) return;
    try {
      await (await current).terminate();
    } catch {
      // Nothing left to stop.
    }
  };

  // Loaded once and shared; a failed load marks the recognizer unavailable.
  const ensureEngine = (): Promise<OcrEngine> => {
    engine ??= load().catch((error: unknown) => {
      engine = null;
      broken = true;
      throw error;
    });
    return engine;
  };

  async function run(
    image: Blob,
    signal: AbortSignal | undefined,
  ): Promise<RecognitionResult> {
    if (signal?.aborted) return failure("aborted");
    if (broken || !supported()) return failure("unavailable");
    const limit = guard(budgetMs, signal);
    try {
      let ready: OcrEngine | "timeout" | "aborted";
      try {
        ready = await Promise.race([ensureEngine(), limit.settled]);
      } catch {
        return failure("unavailable");
      }
      if (typeof ready === "string") return failure(ready);

      let read: { text: string; confidence: number } | "timeout" | "aborted";
      try {
        read = await Promise.race([ready.recognize(image), limit.settled]);
      } catch {
        return failure("unreadable");
      }
      if (read === "timeout") {
        // A stuck job would hold the worker: start over with a fresh one.
        void terminate();
        return failure("timeout");
      }
      if (read === "aborted") return failure("aborted");

      // [COMMENT] Text bounded at a line boundary; confidence 0..100 -> 0..1.
      const capped = capOcrText(
        typeof read.text === "string" ? read.text : "",
        LIVE_OCR_LIMITS.maxTextPerImage,
      );
      return {
        ok: true,
        engine: "tesseract",
        text: capped.text,
        confidence: Number.isFinite(read.confidence)
          ? Math.min(1, Math.max(0, read.confidence / 100))
          : null,
        truncated: capped.truncated,
      };
    } finally {
      limit.stop();
    }
  }

  return {
    engine: "tesseract",
    get available() {
      return !broken && supported();
    },
    async recognize(image, signal) {
      // [GUARD] Type and size before anything loads.
      if (signal?.aborted) return failure("aborted");
      if (broken || !supported()) return failure("unavailable");
      if (!MEDIA_TYPES.includes(image.type) || image.size === 0)
        return failure("unreadable");
      if (image.size > WASM_OCR_MAX_BYTES) return failure("too-large");

      active += 1;
      clearTimeout(idleTimer);
      const job = tail.then(() => run(image, signal));
      tail = job.catch(() => undefined);
      const caller = guard(Number.POSITIVE_INFINITY, signal);
      try {
        // A caller that gives up does not wait behind the queue.
        const outcome = await Promise.race([job, caller.settled]);
        return typeof outcome === "string" ? failure("aborted") : outcome;
      } catch {
        return failure("unavailable");
      } finally {
        caller.stop();
        active -= 1;
        if (active === 0)
          idleTimer = setTimeout(() => {
            if (active === 0) void terminate();
          }, idleMs);
      }
    },
    async dispose() {
      clearTimeout(idleTimer);
      await terminate();
    },
  };
}

// The page's one worker: created on first use, shared by every caller.
let shared: WasmRecognizer | null = null;
export function sharedWasmRecognizer(): WasmRecognizer {
  shared ??= createWasmRecognizer();
  return shared;
}
