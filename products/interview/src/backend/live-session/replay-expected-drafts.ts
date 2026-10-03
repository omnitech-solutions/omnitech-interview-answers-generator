// What the paced replays (processor-latency.test.ts and hardening/latency.test.ts)
// must produce, per synthetic set and speed. Test support only.
import { ALL_REPLAY_SETS } from "./replay-fixture-sets.js";

// Exactly one prose draft per task revision a question reaches (Outcome: one
// draft per question, no duplicates). A set's count at real pacing is the sum
// of its final revisions. At 4x an ASR correction can arrive inside the settle
// window of the question it corrects, so the question has not been processed
// yet: the corrected text REPLACES the pending question and opens its task at
// the corrected text, so that task never has a separate first draft.
const RECRUITER_SCREEN_DRAFTS = 4;
// `via` names the harness: "direct" ingests each segment itself and delays an
// ASR correction by a few seconds of recorded time; "companion" replays through
// the fixture companion, which delivers the recruiter screen's correction
// right after the audio it corrects, so that one folds even at 1x.
export const expectedPacedDrafts = (
  name: string,
  speed: number,
  via: "direct" | "companion" = "direct",
): number => {
  const set = ALL_REPLAY_SETS[name] as { expect?: { revisions: number[] } };
  const total =
    name === "recruiter-screen"
      ? RECRUITER_SCREEN_DRAFTS
      : (set.expect?.revisions.reduce((sum, n) => sum + n, 0) ?? 0);
  const folded =
    (speed === 4 &&
      (name === "asr-error-and-correction" || name === "recruiter-screen")) ||
    (via === "companion" && name === "recruiter-screen");
  return folded ? total - 1 : total;
};
