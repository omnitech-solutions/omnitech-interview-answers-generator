// A programming challenge: the restated task, its constraints across revisions,
// and what is known about the solution. Generated, tests passed and fully
// verified are three separate facts and are never merged: "verified" is shown
// only when the server says fullyVerified (rule:fenced-current-publish and
// code-states.ts). The code is an editable, runnable canvas
// (overlay/code-canvas.tsx); the Workspace draft remains the saved copy.
import type { LiveSessionView } from "@omnitech/interview-contracts";
import { Icon } from "../icon";
import { LiveCodeCanvas } from "./overlay/code-canvas";
import { RUNNER_NOTE, STATE_REASON } from "./session-draft-facts";
import type { CodeResult } from "./session-results";
import type { TaskView } from "./session-tasks";
import { useSessionDraftLink } from "./workspace-handoff";

function Constraints({ task }: { task: TaskView }) {
  return (
    <section className="live-block" aria-label="Constraints">
      <h4>Constraints</h4>
      {task.constraints.length === 0 ? (
        <p className="live-note">None stated yet</p>
      ) : (
        <ul className="live-constraints">
          {task.constraints.map((constraint) => (
            <li
              key={constraint.text}
              data-status={constraint.status}
              className={constraint.status === "superseded" ? "old" : ""}
            >
              <span>{constraint.text}</span>
              <span className="live-mono">
                {constraint.status === "superseded"
                  ? `replaced at rev ${constraint.supersededAtRevision ?? "?"}`
                  : `rev ${constraint.sinceRevision}`}
              </span>
              {constraint.status === "superseded" && (
                <span className="live-sr">Superseded constraint</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function stateValue(code: CodeResult | null, value: boolean): string {
  return code === null ? "Not yet" : value ? "Yes" : "No";
}

// The three states of one solution. `heading` says whose they are: the draft's
// (Status) or a held suggestion's, which was never written to the draft.
function Status({
  code,
  heading = "Status",
}: {
  code: CodeResult | null;
  heading?: string;
}) {
  const states = code?.states;
  const rows: { label: string; value: boolean }[] = [
    { label: "Generated", value: states?.generated ?? false },
    { label: "Tests passed", value: states?.testsPassed ?? false },
    { label: "Fully verified", value: states?.fullyVerified ?? false },
  ];
  const tests = code?.tests;
  const why = (states?.reasons ?? [])
    .map((reason) => STATE_REASON[reason])
    .filter((text): text is string => text !== undefined);
  return (
    <section className="live-block" aria-label={heading}>
      <h4>{heading}</h4>
      <dl className="live-states">
        {rows.map((row) => (
          <div
            key={row.label}
            className="live-state"
            data-state={code === null ? "unknown" : row.value ? "yes" : "no"}
          >
            <dt>{row.label}</dt>
            <dd>
              <Icon
                name={
                  code !== null && row.value
                    ? "check_circle"
                    : "radio_button_unchecked"
                }
              />
              {stateValue(code, row.value)}
            </dd>
          </div>
        ))}
      </dl>
      {tests && (
        <p className="live-note">
          {tests.total === 0
            ? "No tests ran."
            : `${tests.passed}/${tests.total} tests passed${tests.failed > 0 ? ` · ${tests.failed} failed` : ""}${tests.skipped > 0 ? ` · ${tests.skipped} skipped` : ""}`}
        </p>
      )}
      {code && !states?.fullyVerified && why.length > 0 && (
        <ul className="live-why" aria-label="Why not fully verified">
          {why.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}
      {code && code.tests.results.length > 0 && (
        <details className="live-tests">
          <summary>Test results ({code.tests.results.length})</summary>
          <ul>
            {code.tests.results.map((result, index) => (
              <li key={index} data-status={result.status}>
                {result.status}: {result.name}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function CodingPanel({
  task,
  session,
  showWorkspaceLink = true,
}: {
  task: TaskView;
  session: LiveSessionView | null;
  // Focus has its own Open in Workspace control.
  showWorkspaceLink?: boolean;
}) {
  const link = useSessionDraftLink(session, task.taskId);
  // The status grid and chip describe what the Workspace draft holds; a held
  // result is shown separately as the suggestion it is.
  const code = task.draftCode;
  const codeRevision = [...task.revisions]
    .reverse()
    .find((r) => r.code !== null && r.code === code);
  const tests = code?.tests;
  const draftLabel =
    task.draft === null
      ? null
      : tests && tests.total > 0
        ? `Draft ready · ${tests.passed}/${tests.total} tests`
        : "Draft ready";
  return (
    <div className="live-coding">
      <div className="live-coding-head">
        <h3>{task.title ?? "Programming challenge"}</h3>
        {(code?.language ?? task.answer?.codingBrief?.language) && (
          <span className="live-chip neutral">
            {code?.language ?? task.answer?.codingBrief?.language}
          </span>
        )}
      </div>
      {task.codeStale && codeRevision && (
        <div className="live-notice amber" data-testid="stale-code">
          <Icon name="history" />
          <p>
            <strong>Outdated.</strong> This solution is for task rev{" "}
            {codeRevision.revision}. The task is now at rev{" "}
            {task.currentRevision}, and no solution has been published for it
            yet.
          </p>
        </div>
      )}
      <div className="live-grid">
        <Constraints task={task} />
        <Status code={code} />
        {task.suggestion && (
          <Status
            code={task.suggestion}
            heading="Suggestion not written to your draft"
          />
        )}
      </div>
      {code && (
        <LiveCodeCanvas
          result={code}
          revision={codeRevision?.revision ?? null}
          density="maximized"
        />
      )}
      {codeRevision && (
        <p className="live-note">
          Solution for task rev {codeRevision.revision}
          {code?.replacesRevision != null
            ? ` · replaces rev ${code.replacesRevision}`
            : ""}
        </p>
      )}
      {task.heldResult && (
        <div className="live-notice amber" data-testid="held-result">
          <Icon name="lock" />
          <p>
            <strong>Held.</strong> Your edits are kept; the new result is
            offered as a suggestion in Workspace.
          </p>
        </div>
      )}
      {(draftLabel || (showWorkspaceLink && link)) && (
        <div className="live-workspace-link">
          {draftLabel && <span className="live-chip green">{draftLabel}</span>}
          {showWorkspaceLink && link && (
            <button
              type="button"
              className="studio-button"
              onClick={() => link.open()}
            >
              <Icon name="terminal" />
              Open in Workspace
            </button>
          )}
        </div>
      )}
      {code && (
        <p className="live-note" data-testid="runner-note">
          {code.runner.available
            ? RUNNER_NOTE
            : "The code runner was not available, so no test result is claimed."}
        </p>
      )}
    </div>
  );
}
