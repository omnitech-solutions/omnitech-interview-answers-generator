// What became of the work for a task, when it did not simply publish: a draft
// withheld by claim checking, a step a policy refused, a result discarded
// because the task moved on, work still in flight. The wording rests on the
// run's fixed suppression reason (session-runs.ts), never on session content.
import type { LiveProcessingPolicy } from "@omnitech/interview-contracts";
import { Icon, type IconName } from "../icon";
import { plural } from "./session-format";
import { type ActivityRun, flaggedBecause } from "./session-runs";
import type { TaskView } from "./session-tasks";

export type RunNotice = {
  key: string;
  tone: "amber" | "red" | "neutral";
  icon: IconName;
  text: string;
  // Printed above the text: the notice's name.
  title: string;
};

// A device-only session cannot run coding or agent work: those stages have no
// on-device implementation (ADR-0012/unlisted-stage-refused).
const REMOTE_ONLY_KINDS = new Set(["solve-code", "agent-solve"]);
const POLICY_REASONS = new Set(["policy_refused", "stage_unlisted"]);

export function runNotice(
  run: ActivityRun,
  policy: LiveProcessingPolicy | null,
): RunNotice | null {
  const key = run.id;
  const reason = run.reasonLabel;
  switch (run.state) {
    case "failed":
      if (run.reason === "invalid_output" && run.actionKind === "solve-code")
        return {
          key,
          tone: "amber",
          icon: "visibility_off",
          title: "Solution withheld",
          text: reason ?? "The solution was withheld.",
        };
      if (run.reason === "invalid_output")
        return {
          key,
          tone: "amber",
          icon: "visibility_off",
          title: "Draft withheld",
          text:
            run.rejectedClaimCount !== null && run.rejectedClaimCount > 0
              ? `${plural(run.rejectedClaimCount, "claim")} could not be checked against your approved experience, so no draft was shown.${flaggedBecause(run.withheldCodes)}`
              : `The draft could not be checked against your approved experience, so no draft was shown.${flaggedBecause(run.withheldCodes)}`,
        };
      return {
        key,
        tone: "red",
        icon: "error",
        title: "Failed",
        text: reason ?? "The step did not finish.",
      };
    case "refused":
      return {
        key,
        tone: "amber",
        icon: "lock",
        title: "Not run",
        text:
          policy === "device-only" &&
          REMOTE_ONLY_KINDS.has(run.actionKind) &&
          POLICY_REASONS.has(run.reason ?? "")
            ? "Coding needs a remote model, and this session runs AI models on this Mac only."
            : (reason ?? "A policy refused this step."),
      };
    case "discarded":
      return {
        key,
        tone: "neutral",
        icon: "history",
        title: `Discarded · task rev ${run.taskRevision}`,
        text: `${reason ?? "The task changed."} Results for an outdated task revision are never published.`,
      };
    case "cancelled":
      return {
        key,
        tone: "neutral",
        icon: "cancel",
        title: "Cancelled",
        text: reason ?? "The session stopped this work.",
      };
    case "cancelling":
      return {
        key,
        tone: "neutral",
        icon: "pending",
        title: "Cancelling",
        text: "The task or session has moved on, so this result will be discarded.",
      };
    case "running":
      return {
        key,
        tone: "neutral",
        icon: "pending",
        title: run.label,
        text: `${run.kindLabel} in progress.`,
      };
    default:
      return null;
  }
}

// The current revision's runs, plus any earlier revision's result that was
// discarded (a late result is shown as discarded, never silently dropped).
export function noticesFor(
  task: TaskView,
  policy: LiveProcessingPolicy | null,
): RunNotice[] {
  const runs = [
    ...task.revisions
      .filter((revision) => !revision.current)
      .flatMap((revision) => revision.runs)
      .filter((run) => run.state === "discarded"),
    ...task.current.runs,
  ];
  return runs
    .map((run) => runNotice(run, policy))
    .filter((notice): notice is RunNotice => notice !== null);
}

export function RunNotices({
  task,
  policy,
}: {
  task: TaskView;
  policy: LiveProcessingPolicy | null;
}) {
  const notices = noticesFor(task, policy);
  if (notices.length === 0) return null;
  return (
    <div className="live-notices" aria-live="polite">
      {notices.map((notice) => (
        <div
          key={notice.key}
          className={`live-notice ${notice.tone}`}
          data-testid="run-notice"
        >
          <Icon name={notice.icon} />
          <p>
            <strong>{notice.title}.</strong> {notice.text}
          </p>
        </div>
      ))}
    </div>
  );
}
