// The Activity tab: the work the session decided to do and what became of each
// run. The sentence about outdated results is true by rule:fenced-current-publish
// (ADR-0011): a result for a superseded task revision or fence is never
// published.
import type { ActivityRun } from "./session-runs";
import type { TaskView } from "./session-tasks";
import { taskLabel, taskOrdinal } from "./shared/task-target";

export function ActivityTab({
  runs,
  tasks,
}: {
  runs: readonly ActivityRun[];
  tasks: readonly TaskView[];
}) {
  return (
    <>
      <p className="live-note">
        Work the session decided to do, and what became of it. Results for an
        outdated task revision are never published.
      </p>
      {runs.length === 0 ? (
        <p className="live-empty">No work started yet.</p>
      ) : (
        <ol className="live-runs" aria-label="Runs">
          {[...runs].reverse().map((run) => (
            <li key={run.id} className="live-run" data-state={run.state}>
              <div className="live-run-head">
                <strong>{run.kindLabel}</strong>
                <span className="live-note">
                  {taskLabel(taskOrdinal(tasks, run.taskId) ?? 0)} · rev{" "}
                  {run.taskRevision}
                  {run.attempt > 1 ? ` · attempt ${run.attempt}` : ""}
                </span>
                <span className={`live-chip ${run.tone}`}>{run.label}</span>
              </div>
              {run.profile && <p className="live-note">{run.profile}</p>}
              {run.reasonLabel && (
                <p className="live-note">{run.reasonLabel}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
