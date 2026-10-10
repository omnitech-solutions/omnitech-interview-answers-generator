import type { PlanItemStatus } from "@omnitech/interview-contracts";
import type { DraftSummary } from "../../assistant/workspace";

// What the plan says about each item, in the words it shows. No I/O.

// What a question's latest run says, in the words the plan shows.
export function questionStatus(
  draft: DraftSummary | undefined,
): PlanItemStatus {
  if (!draft) return { label: "Question not found", tone: "warn" };
  const run = draft.lastRun;
  if (!run) return { label: "Tests not run yet", tone: "neutral" };
  if (run.total !== null && run.passed !== null)
    return {
      label: `${run.passed} of ${run.total} tests passing`,
      tone: run.passed === run.total && run.ok ? "good" : "warn",
    };
  return run.ok
    ? { label: "Tests passing", tone: "good" }
    : { label: "Tests failing", tone: "warn" };
}

// A briefing counts once it has a saved version.
export function briefingStatus(
  briefing: { savedRevision: number } | undefined,
): PlanItemStatus {
  return !briefing
    ? { label: "Briefing not found", tone: "warn" }
    : briefing.savedRevision > 0
      ? { label: "Saved", tone: "good" }
      : { label: "Draft · not saved yet", tone: "warn" };
}
