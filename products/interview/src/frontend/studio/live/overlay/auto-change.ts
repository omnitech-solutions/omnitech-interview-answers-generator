// When has the screen changed enough, and stayed put long enough, to be worth a
// capture? Pure: it is fed hashes and a clock and answers a state. The caller
// takes the capture and then calls `markCaptured`, so a capture that is refused
// or rate-limited leaves the change pending and it fires once it is allowed.
import { type FrameHash, hamming } from "./auto-hash";

// Bits (of 64) that must differ from the last captured frame: typing a line of
// code stays below it, opening another problem or page is far above it.
export const CHANGE_BITS = 12;
// Bits that may differ between two samples that still count as "the same
// picture" (a blinking cursor, video noise).
export const JITTER_BITS = 4;
// How long the new picture must hold still before it is captured.
export const STABLE_MS = 3_000;
// How often the shared source is sampled.
export const SAMPLE_MS = 2_000;

export type ChangeState =
  // Near-identical to the last captured frame: nothing to do.
  | "same"
  // Different, but still moving or not yet held for STABLE_MS.
  | "settling"
  // Different and stable: capture it.
  | "ready";

export type ChangeDetector = {
  observe(hash: FrameHash, nowMs: number): ChangeState;
  // The frame last observed was captured: it is the new baseline.
  markCaptured(): void;
  reset(): void;
};

export function createChangeDetector(): ChangeDetector {
  let baseline: FrameHash | null = null;
  let last: FrameHash | null = null;
  let stableSince = 0;
  return {
    observe(hash, nowMs) {
      // [STATE] `last` is the picture being held; it moves only when a sample
      // differs from it by more than jitter, and the stable clock restarts.
      if (last === null || hamming(hash, last) > JITTER_BITS) {
        last = hash;
        stableSince = nowMs;
      }
      // [GUARD] No baseline yet reads as changed: the first stable picture of
      // a hands-free session is analysed once.
      const changed =
        baseline === null || hamming(last, baseline) >= CHANGE_BITS;
      if (!changed) return "same";
      return nowMs - stableSince >= STABLE_MS ? "ready" : "settling";
    },
    markCaptured() {
      baseline = last;
    },
    reset() {
      baseline = null;
      last = null;
      stableSince = 0;
    },
  };
}
