// A task's short heading: the title the surfaces show, and the model's longer
// restatement kept apart as detail.
import type { TaskView } from "../session-tasks";
import { TASK_KIND } from "./task-kind";

// "hundred", "thousand" and hyphenated compounds ("twenty-one"); a lone "Two"
// in a problem name ("Two Sum") is not a spelled-out number.
const SPELLED_NUMBER =
  /\b(?:hundred|thousand)\b|\b[a-z]+ty-(?:one|two|three|four|five|six|seven|eight|nine)\b|\b(?:one|two|three|four|five|six|seven|eight|nine)-(?:hundred|thousand)\b/i;
const TITLE_MAX = 64;

// A short title for the head. The model's restatement can be a whole sentence
// (and may spell its numbers out); it is then kept as a detail and the title
// is the kind of problem. Nothing is rewritten.
export function taskHeading(task: TaskView): {
  title: string;
  restated: string | null;
} {
  const label = TASK_KIND[task.kind].label;
  const text = task.title?.trim() ?? "";
  if (text === "") return { title: label, restated: null };
  const short = text.length <= TITLE_MAX && !SPELLED_NUMBER.test(text);
  return short
    ? { title: text, restated: null }
    : { title: label, restated: text };
}
