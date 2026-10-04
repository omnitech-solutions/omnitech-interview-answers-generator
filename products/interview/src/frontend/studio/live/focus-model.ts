// What the Focus presentation says beyond the task itself: the newest
// capture, source health, locality and the actual verification state. Pure,
// from the view model and the observations the store holds.
import type { LiveObservation } from "@omnitech/interview-contracts";
import { claimSummary } from "./claim-chips";
import { ageLabel } from "./session-format";
import { SOURCE_LABEL } from "./session-sources";
import type { LiveViewModel } from "./session-state";
import type { TaskView } from "./session-tasks";

export type FocusFacts = {
  // The newest screen snapshot: what "Analyze latest capture" would use.
  capture: { sourceLabel: string; ageText: string } | null;
  sourceHealth: { text: string; ok: boolean };
  locality: string;
  verification: string;
};

function newestSnapshot(
  observations: readonly LiveObservation[],
): LiveObservation | null {
  let newest: LiveObservation | null = null;
  for (const observation of observations)
    if (
      observation.kind === "screen.snapshot" &&
      (!newest || observation.sequence > newest.sequence)
    )
      newest = observation;
  return newest;
}

// Only what the server says: a draft is "verified" when fullyVerified is true,
// never because it was generated or its tests passed.
export function verificationText(task: TaskView | undefined): string {
  if (!task) return "Nothing to verify yet";
  if (task.kind === "programming-challenge") {
    const states = task.draftCode?.states ?? task.code?.states;
    if (!states) return "No solution yet";
    if (states.fullyVerified) return "Fully verified";
    return states.testsPassed
      ? "Tests passed, not fully verified"
      : states.generated
        ? "Generated, not verified"
        : "Not generated";
  }
  if (!task.answer) return "No answer yet";
  const counts = claimSummary(task.answer.claimCounts);
  return counts === "" ? "Answer has no claims to check" : counts;
}

export function focusFacts(
  model: LiveViewModel,
  observations: readonly LiveObservation[],
  task: TaskView | undefined,
): FocusFacts {
  const shot = newestSnapshot(observations);
  const at = shot ? Date.parse(shot.receivedAt) : Number.NaN;
  const capture =
    shot && !Number.isNaN(at)
      ? {
          sourceLabel: SOURCE_LABEL.screen,
          ageText: `${ageLabel(model.serverNowMs - at)} ago`,
        }
      : null;
  const trouble = model.sources.filter(
    (source) => source.selected && source.health !== "receiving",
  );
  return {
    capture,
    sourceHealth:
      trouble.length === 0
        ? { text: "Sources receiving", ok: true }
        : {
            text: trouble.map((s) => `${s.label}: ${s.health}`).join(" · "),
            ok: false,
          },
    locality: model.locality?.label ?? "",
    verification: verificationText(task),
  };
}
