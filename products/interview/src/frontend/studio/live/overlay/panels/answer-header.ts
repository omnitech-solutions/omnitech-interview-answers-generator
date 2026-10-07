// What the Answer panel header says, derived from the session snapshot. The
// panel reads these two functions and nothing else for its header meta and its
// complexity chips, so the source can move (a shared selector) without touching
// the view.
import { timeLabel } from "../../shared/use-screenshots-view";

type CaptureAction = {
  actionKind: string;
  createdAt: string;
  noQuestion?: true | undefined;
};

export type CaptureMeta = { full: string; lead: string };

// "Last capture 08:33 · no question found" while the newest capture found no
// question. `lead` is the part before the first " · " (what a narrow header
// keeps); null when the newest capture had a question or there is none.
export function lastCaptureMeta(
  actions: readonly CaptureAction[],
): CaptureMeta | null {
  let newest: CaptureAction | undefined;
  for (const action of actions)
    if (
      action.actionKind === "draft-answer" &&
      (newest === undefined ||
        Date.parse(action.createdAt) >= Date.parse(newest.createdAt))
    )
      newest = action;
  if (newest?.noQuestion !== true) return null;
  const at = timeLabel(newest.createdAt);
  const lead = at ? `Last capture ${at}` : "Last capture";
  return { lead, full: `${lead} · no question found` };
}

const TIME_SPACE = /\b(time|space)\b[^O]{0,24}?(O\([^)]*\))/gi;
const BIG_O = /\bO\([^)]*\)/;

// "O(n) time", "O(n) space" from the answer's complexity lines; a line that
// gives a bound without saying which is read as time. Nothing is invented: no
// bound in the lines, no chips.
export function complexityChips(lines: readonly string[]): string[] {
  const chips: string[] = [];
  const add = (chip: string) => {
    if (!chips.includes(chip)) chips.push(chip);
  };
  for (const line of lines) {
    const named = [...line.matchAll(TIME_SPACE)];
    if (named.length > 0) {
      for (const [, kind, bound] of named)
        add(`${bound} ${(kind ?? "").toLowerCase()}`);
      continue;
    }
    const bound = BIG_O.exec(line)?.[0];
    if (bound) add(`${bound} time`);
  }
  return chips.slice(0, 2);
}
