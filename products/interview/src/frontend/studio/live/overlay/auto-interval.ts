// Auto's screen watch is an interval (ADR-0022, revised): every few seconds a
// frame is sampled on this device and hashed. A frame is uploaded and analysed
// only when it differs from the last ANALYSED frame, is the first, or (an
// option, off by default) a heartbeat has elapsed. Identical frames are dropped
// here and never leave the device. Pure; the hook runs the timer.
import { type FrameHash, hamming } from "./auto-hash";

export const AUTO_INTERVAL_DEFAULT_S = 8;
export const AUTO_INTERVAL_MIN_S = 3;
export const AUTO_INTERVAL_MAX_S = 30;
// Bits (of 64) that must differ from the last analysed frame.
export const AUTO_CHANGE_BITS = 4;
// With the heartbeat option on, an unchanged screen is re-analysed this often.
export const AUTO_HEARTBEAT_MS = 60_000;

export const clampIntervalSeconds = (value: number): number =>
  Number.isFinite(value)
    ? Math.min(
        AUTO_INTERVAL_MAX_S,
        Math.max(AUTO_INTERVAL_MIN_S, Math.round(value)),
      )
    : AUTO_INTERVAL_DEFAULT_S;

export type AnalyzeDecisionInput = {
  hash: FrameHash;
  nowMs: number;
  lastHash: FrameHash | null;
  lastAnalyzedAtMs: number | null;
  heartbeat: boolean;
};

export function shouldAnalyze(input: AnalyzeDecisionInput): boolean {
  // [GUARD] The first frame of a session is always analysed once.
  if (input.lastHash === null || input.lastAnalyzedAtMs === null) return true;
  if (hamming(input.hash, input.lastHash) >= AUTO_CHANGE_BITS) return true;
  return (
    input.heartbeat && input.nowMs - input.lastAnalyzedAtMs >= AUTO_HEARTBEAT_MS
  );
}
