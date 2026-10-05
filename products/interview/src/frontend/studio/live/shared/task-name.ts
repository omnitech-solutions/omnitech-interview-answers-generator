// What to call a task. The name a surface shows comes from the published
// answer's own words only; a task with nothing to name it is "Analysis".
import { approach } from "../overlay/overlay-model";
import { taskHeading } from "../overlay/overlay-task";
import type { TaskView } from "../session-tasks";
import { TASK_KIND } from "../task-panels";

const NAME_MAX = 60;

// A problem name the answer itself gives: in quotes ('This is LeetCode 2, "Add Two
// Numbers": ...') or after a LeetCode number ('LeetCode 37, Sudoku Solver: ...').
// Short and not a sentence, or it is not a name.
const QUOTED_NAME = /["“]([^"”]{3,60})["”]/;
const NUMBERED_NAME =
  /\bLeetCode\s*#?\d+\s*[,:\-–—]\s*([^:.\n"“]{3,60}?)\s*[:.]/i;
export function problemNameIn(text: string): string | null {
  const name = (QUOTED_NAME.exec(text) ??
    NUMBERED_NAME.exec(text))?.[1]?.trim();
  return name && !/[.!?]$/.test(name) ? name : null;
}

// The problem's name if the answer gives one, else the start of the model's
// restatement (first sentence, trimmed), else "Analysis".
export function taskName(task: TaskView): string {
  const firstLine =
    approach(task)?.items.find((item) => item.kind === "line")?.text ?? "";
  const named = problemNameIn(firstLine);
  if (named) return named;
  const heading = taskHeading(task);
  const text = heading.restated ?? heading.title;
  const generic = TASK_KIND[task.kind].label;
  if (heading.restated === null && (task.title?.trim() ?? "") === "")
    return "Analysis";
  if (heading.restated === null && heading.title === generic) return "Analysis";
  const sentence =
    text.split(/(?<=[.!?])\s/)[0]?.replace(/[.!?:\s]+$/, "") ?? "";
  return sentence.length <= NAME_MAX
    ? sentence
    : `${sentence.slice(0, NAME_MAX - 1).trimEnd()}…`;
}
