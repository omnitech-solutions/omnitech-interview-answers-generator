import type { IconName } from "./icon";
import type { QuestionSummary } from "./use-studio-lists";

// How a question's last run reads in a list.
export function runStatus(question: Pick<QuestionSummary, "lastRun">): {
  label: string;
  icon: IconName;
  tone: "good" | "warn" | "neutral";
} {
  const run = question.lastRun;
  if (!run) return { label: "In progress", icon: "pending", tone: "neutral" };
  const allPassed =
    run.total !== null ? run.passed === run.total && run.ok : run.ok;
  if (allPassed) return { label: "Passed", icon: "check_circle", tone: "good" };
  return {
    label:
      run.total !== null
        ? `${run.passed} / ${run.total} tests`
        : "Tests failing",
    icon: "error",
    tone: "warn",
  };
}
