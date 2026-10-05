// Auto's back-off after a no-question result (D36). A capture that showed
// nothing to answer (the candidate's editor, Studio's own page, an unreadable
// screen) must not be repeated for every small change: until the picture
// changed SUBSTANTIALLY or a cooldown passed, Auto does not capture again.
// Manual capture never goes through this. Pure; the hook runs the timer.
import { type FrameHash, hamming } from "./auto-hash";

// One configuration table: the stricter change threshold (bits of 64) that
// replaces AUTO_CHANGE_BITS, and how long the back-off lasts at most.
export const AUTO_BACKOFF = {
  noQuestionChangeBits: 16,
  noQuestionCooldownMs: 60_000,
} as const;

export type BackoffInput = {
  hash: FrameHash;
  nowMs: number;
  // The frame Auto last captured, and when.
  lastHash: FrameHash | null;
  lastAnalyzedAtMs: number | null;
  // The newest published analysis result showed no interview question.
  lastResultNoQuestion: boolean;
};

// True when Auto must hold this (already changed) frame back.
export function holdAfterNoQuestion(input: BackoffInput): boolean {
  if (!input.lastResultNoQuestion) return false;
  if (input.lastHash === null || input.lastAnalyzedAtMs === null) return false;
  // An unchanged screen (the heartbeat's re-analysis included) is never worth
  // another model call after a no-question result: the cooldown only ends the
  // hold for a frame that differs.
  const distance = hamming(input.hash, input.lastHash);
  if (distance === 0) return true;
  if (input.nowMs - input.lastAnalyzedAtMs >= AUTO_BACKOFF.noQuestionCooldownMs)
    return false;
  return distance < AUTO_BACKOFF.noQuestionChangeBits;
}

// The newest draft-answer action (the capture's result) is a no-question one.
export function newestResultIsNoQuestion(
  actions: readonly {
    actionKind: string;
    createdAt: string;
    noQuestion?: true | undefined;
  }[],
): boolean {
  let newest: (typeof actions)[number] | undefined;
  for (const action of actions)
    if (
      action.actionKind === "draft-answer" &&
      (newest === undefined ||
        Date.parse(action.createdAt) >= Date.parse(newest.createdAt))
    )
      newest = action;
  return newest?.noQuestion === true;
}
