// The capture problem, as a banner: the one place a surface draws a
// CaptureProblem (shared/capture-problem.ts). The same banner on the native
// answer pane, the card and the web hands-free band; only the surface wires its
// action. It stays until the person dismisses it or the next capture works.
import { Icon } from "../../icon";
import type { CaptureProblem } from "./capture-problem";

export function CaptureProblemBanner({
  problem,
  onDismiss,
  onAction,
}: {
  problem: CaptureProblem;
  onDismiss(): void;
  // Runs the problem's action (the surface knows how); absent: no button.
  onAction?: (id: NonNullable<CaptureProblem["action"]>["id"]) => void;
}) {
  const { action } = problem;
  return (
    <div
      className="cp"
      role="alert"
      data-testid="capture-problem"
      data-reason={problem.reason}
    >
      <div className="cp-body">
        <strong className="cp-title" data-testid="capture-problem-title">
          {problem.title}
        </strong>
        <p className="cp-fix" data-testid="capture-problem-fix">
          {problem.fix}
        </p>
        {action && onAction && (
          <div className="cp-actions">
            <button
              type="button"
              className="cp-button"
              data-testid="capture-problem-action"
              onClick={() => onAction(action.id)}
            >
              {action.label}
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        className="cp-close"
        aria-label="Dismiss message"
        data-testid="capture-problem-dismiss"
        onClick={onDismiss}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
