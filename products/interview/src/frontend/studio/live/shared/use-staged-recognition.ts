// Reads each staged screenshot as it is staged (T17b's tray), and again when a
// crop gives it new bytes. The cache is keyed by BLOB IDENTITY: a crop produces
// a new Blob, so the old read is dropped and the final bytes are read; the
// same Blob is never read twice. Removing an image (or leaving the page)
// aborts its read. The text lives in this hook's memory for one Apply: it is
// never logged and never persisted (AGENTS.md rule 8).
import type { LiveOcrBlock } from "@omnitech/interview-contracts";
import { useEffect, useMemo, useReducer, useRef } from "react";
import { studioHostInfo } from "../host-adapter";
import {
  chooseRecognizer,
  ocrBlockFor,
  ocrBlocksForRequest,
  type RecognitionFailureReason,
  type RecognitionResult,
  type TextRecognizer,
} from "./text-recognizer";
import { sharedWasmRecognizer } from "./wasm-recognizer";

export type StagedImage = {
  id: string;
  blob: Blob;
};

// What the tray shows per image.
export type ImageRecognition =
  | { status: "pending" }
  // `block` is null when the image holds no text.
  | { status: "done"; block: LiveOcrBlock | null }
  | {
      status: "failed";
      reason: Exclude<RecognitionFailureReason, "unavailable">;
    }
  // No engine can read here: the image is sent alone, and the tray says so.
  | { status: "unavailable" };

const PENDING: ImageRecognition = { status: "pending" };
const UNAVAILABLE: ImageRecognition = { status: "unavailable" };

export function recognitionFromResult(
  result: RecognitionResult,
): ImageRecognition {
  if (result.ok) return { status: "done", block: ocrBlockFor(result) };
  return result.reason === "unavailable"
    ? UNAVAILABLE
    : { status: "failed", reason: result.reason };
}

export type StagedRecognition = {
  // Per staged image id.
  states: ReadonlyMap<string, ImageRecognition>;
  // For applyContext: aligned with the images' order, null where nothing was
  // read, held to the per-request bound (later images give way).
  ocr: (LiveOcrBlock | null)[];
  // True while any image is still being read (Apply may wait, or send as is).
  pending: boolean;
};

// [STRATEGY] Pure view of the cache: one state per image, the aligned upload
// list, and whether anything is still pending.
export function summarizeRecognition(
  images: readonly StagedImage[],
  stateOf: (blob: Blob) => ImageRecognition,
): StagedRecognition {
  const states = new Map<string, ImageRecognition>();
  const blocks: (LiveOcrBlock | null)[] = [];
  let pending = false;
  for (const image of images) {
    const state = stateOf(image.blob);
    states.set(image.id, state);
    blocks.push(state.status === "done" ? state.block : null);
    if (state.status === "pending") pending = true;
  }
  return { states, ocr: ocrBlocksForRequest(blocks), pending };
}

type Entry = { controller: AbortController; state: ImageRecognition };

export function useStagedRecognition(
  images: readonly StagedImage[],
  recognizer: TextRecognizer,
): StagedRecognition {
  const [version, changed] = useReducer((n: number) => n + 1, 0);
  const entries = useRef(new Map<Blob, Entry>());
  const reading = useRef<TextRecognizer | null>(null);

  // Leaving the page aborts every read still running.
  useEffect(() => {
    const cache = entries.current;
    return () => {
      for (const entry of cache.values()) entry.controller.abort();
      cache.clear();
      reading.current = null;
    };
  }, []);

  // [STRATEGY] Reconcile the cache with what is staged now: read what is new
  // (a new blob is a new image or a crop), drop and abort what is gone.
  useEffect(() => {
    const cache = entries.current;
    if (reading.current !== recognizer) {
      for (const entry of cache.values()) entry.controller.abort();
      cache.clear();
      reading.current = recognizer;
    }
    const staged = new Set(images.map((image) => image.blob));
    for (const [blob, entry] of cache) {
      if (staged.has(blob)) continue;
      entry.controller.abort();
      cache.delete(blob);
    }
    if (!recognizer.available) return;
    for (const blob of staged) {
      if (cache.has(blob)) continue;
      const entry: Entry = {
        controller: new AbortController(),
        state: PENDING,
      };
      cache.set(blob, entry);
      void recognizer
        .recognize(blob, entry.controller.signal)
        .then((result) => {
          // An entry that was dropped meanwhile is not written to.
          if (cache.get(blob) !== entry) return;
          entry.state = recognitionFromResult(result);
          changed();
        });
    }
  }, [images, recognizer]);

  // `version` changes when an entry settles; the cache itself is a ref.
  return useMemo(
    () =>
      summarizeRecognition(images, (blob) =>
        recognizer.available
          ? (entries.current.get(blob)?.state ?? PENDING)
          : UNAVAILABLE,
      ),
    [images, recognizer, version],
  );
}

// The page's recognizer: the native shell's Vision when it offers it, else the
// WASM engine, else none. Read once (the bridge is injected before the page).
export function useTextRecognizer(): TextRecognizer {
  return useMemo(
    () => chooseRecognizer(studioHostInfo(), sharedWasmRecognizer()),
    [],
  );
}
