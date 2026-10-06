// A programming challenge: its constraints across revisions and two tabs, the
// answer (the model's restatement and suggested answer) and the code. Generated,
// tests passed and fully verified are three separate facts and are never
// merged: the stage tiles and badges come from the one task card model, and
// "verified" is shown only when the server says fullyVerified
// (rule:fenced-current-publish and code-states.ts). The code is an editable,
// runnable canvas (overlay/code-canvas.tsx); the Workspace draft remains the
// saved copy.
import type { LiveSessionView } from "@omnitech/interview-contracts";
import { type KeyboardEvent, useRef, useState } from "react";
import { Icon } from "../icon";
import { AnswerBody } from "./answer-body";
import { LiveCodeCanvas } from "./overlay/code-canvas";
import { RUNNER_NOTE } from "./session-draft-facts";
import type { CodeResult } from "./session-results";
import type { TaskView } from "./session-tasks";
import {
  badgesOf,
  type CardBadge,
  type TaskCard,
} from "./shared/task-card-model";
import { useSessionDraftLink } from "./workspace-handoff";

type CodingTabId = "answer" | "code";
const CODING_TABS: readonly { id: CodingTabId; label: string }[] = [
  { id: "answer", label: "Answer" },
  { id: "code", label: "Code" },
];

function Constraints({ card }: { card: TaskCard }) {
  return (
    <section className="live-block" aria-label="Constraints">
      <h4>Constraints</h4>
      {card.constraints.length === 0 ? (
        <p className="live-note">None stated yet</p>
      ) : (
        <ul className="live-constraints">
          {card.constraints.map((constraint) => (
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

function Badges({ badges }: { badges: readonly CardBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <ul className="live-badges" aria-label="What is established">
      {badges.map((badge) => (
        <li
          key={badge.id}
          className={`live-chip ${badge.ok ? "green" : "neutral"}`}
          data-badge={badge.id}
          data-ok={badge.ok}
        >
          <Icon name={badge.ok ? "check_circle" : "radio_button_unchecked"} />
          {badge.label}
        </li>
      ))}
    </ul>
  );
}

// The failed and skipped counts and each test's own result: the server's
// numbers, shown beside the badge that says how many passed.
function TestResults({ code }: { code: CodeResult }) {
  const { tests } = code;
  const odd = [
    tests.failed > 0 ? `${tests.failed} failed` : null,
    tests.skipped > 0 ? `${tests.skipped} skipped` : null,
  ].filter((part) => part !== null);
  return (
    <>
      {tests.total === 0 && <p className="live-note">No tests ran.</p>}
      {odd.length > 0 && <p className="live-note">{odd.join(" · ")}</p>}
      {tests.results.length > 0 && (
        <details className="live-tests">
          <summary>Test results ({tests.results.length})</summary>
          <ul>
            {tests.results.map((result, index) => (
              // Index key: results arrive in the runner's fixed order, test names may repeat, and the list is replaced whole.
              <li key={index} data-status={result.status}>
                {result.status}: {result.name}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

// A held result is judged by the same badge rules as the solution on show, so
// its badges cannot differ in meaning from the draft's.
const suggestionBadges = (
  task: TaskView,
  suggestion: CodeResult,
): readonly CardBadge[] =>
  badgesOf({ ...task, draftCode: suggestion, code: suggestion });

function CodingTabs({
  tab,
  onTab,
}: {
  tab: CodingTabId;
  onTab(tab: CodingTabId): void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (event: KeyboardEvent, index: number) => {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next =
      CODING_TABS[(index + step + CODING_TABS.length) % CODING_TABS.length];
    if (!next) return;
    onTab(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <div className="live-coding-tabs" role="tablist" aria-label="Task views">
      {CODING_TABS.map((each, index) => (
        <button
          key={each.id}
          ref={(node) => {
            refs.current[each.id] = node;
          }}
          type="button"
          role="tab"
          id={`coding-tab-${each.id}`}
          aria-selected={tab === each.id}
          aria-controls={`coding-panel-${each.id}`}
          tabIndex={tab === each.id ? 0 : -1}
          className="live-coding-tab"
          onClick={() => onTab(each.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {each.label}
        </button>
      ))}
    </div>
  );
}

export function CodingPanel({
  task,
  card,
  session,
  onCopy,
}: {
  task: TaskView;
  card: TaskCard;
  session: LiveSessionView | null;
  onCopy(text: string): void;
}) {
  const link = useSessionDraftLink(session, task.taskId);
  const [tab, setTab] = useState<CodingTabId>(task.answer ? "answer" : "code");
  // The badges and the canvas describe what the Workspace draft holds; a held
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
  const language = code?.language ?? task.answer?.codingBrief?.language;
  const codeStage = card.stages[1];
  return (
    <div className="live-coding">
      <div className="live-grid">
        <Constraints card={card} />
      </div>
      {language && (
        <p className="live-coding-language">
          <span className="live-chip neutral">{language}</span>
        </p>
      )}
      <CodingTabs tab={tab} onTab={setTab} />
      {tab === "answer" ? (
        <div
          role="tabpanel"
          id="coding-panel-answer"
          aria-labelledby="coding-tab-answer"
          className="live-coding-pane"
        >
          {card.restatement && (
            <section className="live-block" aria-label="The task">
              <h4>The task</h4>
              <p className="live-draft-text">{card.restatement}</p>
            </section>
          )}
          {task.answer ? (
            <AnswerBody
              task={task}
              card={card}
              answer={task.answer}
              onCopy={onCopy}
            />
          ) : (
            <p className="live-note">
              No answer has been published for this task.
            </p>
          )}
        </div>
      ) : (
        <div
          role="tabpanel"
          id="coding-panel-code"
          aria-labelledby="coding-tab-code"
          className="live-coding-pane"
        >
          {task.codeStale && codeRevision && (
            <div className="live-notice amber" data-testid="stale-code">
              <Icon name="history" />
              <p>
                <strong>Outdated.</strong> This solution is for task rev{" "}
                {codeRevision.revision}. The task is now at rev {card.revision},
                and no solution has been published for it yet.
              </p>
            </div>
          )}
          {code ? (
            <>
              <LiveCodeCanvas
                result={code}
                revision={codeRevision?.revision ?? null}
                density="maximized"
              />
              <Badges badges={card.badges} />
              <TestResults code={code} />
            </>
          ) : (
            <p className="live-note">
              {codeStage?.detail ??
                "No solution has been published for this task yet."}
            </p>
          )}
          {task.suggestion && (
            <section
              className="live-block"
              aria-label="Suggestion not written to your draft"
            >
              <h4>Suggestion not written to your draft</h4>
              <Badges badges={suggestionBadges(task, task.suggestion)} />
              <TestResults code={task.suggestion} />
            </section>
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
          {(draftLabel || link) && (
            <div className="live-workspace-link">
              {draftLabel && (
                <span className="live-chip green">{draftLabel}</span>
              )}
              {link && (
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
      )}
    </div>
  );
}
