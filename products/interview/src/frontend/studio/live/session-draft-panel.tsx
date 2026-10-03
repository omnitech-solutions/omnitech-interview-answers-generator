// What the Workspace shows above the editor when it is a session's private
// draft: where it came from, whether the owner has edited it, the session's own
// result for it (the three distinct states and its generated tests), the work
// still running, and, when the session could not write a newer solution, that
// solution as a suggestion the owner may take or dismiss.
//
// Everything model-written (test names, code) renders as inert text
// (rule:inert-draft-rendering). Nothing here sends or submits anything.
import { type Language, languageSchema } from "@omnitech/interview-contracts";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../icon";
import { PreviewedCode } from "../workspace/assistant-change";
import type { SessionDraftState } from "../workspace/workspace-view";
import {
  type DraftFacts,
  type HeldResult,
  ownerEdited,
  RUNNER_NOTE,
  type StateLine,
  stateLines,
} from "./session-draft-facts";
import type { CodeResult } from "./session-results";

const EDITED_NOTE =
  "You’ve edited this draft. Any later AI result will be offered as a suggestion, not applied.";
const EMPTY_TITLE = "No session draft yet";
const EMPTY_BODY =
  "When the session finds a coding task, it creates a private draft here and runs the tests. Your own edits are never overwritten.";
const CONFLICT_NOTE =
  "This draft changed since you last loaded it, so the suggestion was not applied. Reload the draft, then review the suggestion again.";

// Suggestions the owner dismissed, by action id. Module state, so leaving the
// Workspace and coming back does not offer the same one again.
const dismissed = new Set<string>();

export type SessionDraftPanelProps = {
  state: SessionDraftState;
  sessionId: string;
  facts: DraftFacts;
  // The interview or rehearsal the session is for.
  target: string;
  // The session's results could be read (it is open or its summary loaded).
  resultsKnown: boolean;
  onBack(): void;
};

export function SessionDraftPanel({
  state,
  sessionId,
  facts,
  target,
  resultsKnown,
  onBack,
}: SessionDraftPanelProps) {
  const { written, held } = facts;
  const origin = state.origin;

  // [STRATEGY] The session may write the draft (or a newer revision of it)
  // while it is open here. When the owner has nothing unsaved, show it.
  const wrote = written?.artifactRevision ?? null;
  const reloaded = useRef<number | null>(null);
  useEffect(() => {
    if (wrote === null || reloaded.current === wrote) return;
    const stale =
      state.missing ||
      (origin !== undefined &&
        origin.artifactRevision < wrote &&
        state.saveState === "saved");
    if (!stale) return;
    reloaded.current = wrote;
    void state.reload().catch(() => undefined);
  }, [wrote, origin, state]);

  const from = written ? ` · from task rev ${written.taskRevision}` : "";
  const bar = (
    <div className="sd-bar">
      <Icon name="sensors" size={18} />
      <span className="sd-subtitle">
        Private session draft{from} · {target}
      </span>
      <button type="button" className="studio-button" onClick={onBack}>
        <Icon name="arrow_back" size={16} />
        Back to session
      </button>
    </div>
  );

  if (state.missing)
    return (
      <section className="sd sd-empty" aria-label="Session draft">
        {bar}
        <div className="sd-empty-body">
          <Icon name="code" size={28} />
          <p className="sd-empty-title">{EMPTY_TITLE}</p>
          <p className="sd-empty-text">{EMPTY_BODY}</p>
        </div>
      </section>
    );

  const edited = ownerEdited(state.provenance, sessionId);
  return (
    <section className="sd" aria-label="Session draft">
      {bar}
      {edited && (
        <p className="sd-note edited" role="status">
          <Icon name="edit" size={16} />
          {EDITED_NOTE}
        </p>
      )}
      {held && <Suggestion held={held} state={state} />}
      <div className="sd-body">
        {written ? (
          <ResultSummary
            heading="What the session produced"
            result={written.result}
            note={
              edited
                ? "These results describe the session’s version, not your edits. Run the tests to check your edits."
                : null
            }
          />
        ) : (
          <p className="sd-muted" role="status">
            {resultsKnown
              ? "The session has no result for this draft on record."
              : "The session’s results for this draft are not loaded."}
          </p>
        )}
        <RunChips facts={facts} />
      </div>
    </section>
  );
}

// The session's work on the task right now: one chip per kind of run (an
// answer draft, the coding draft, an agent job) with what became of it.
function RunChips({ facts }: { facts: DraftFacts }) {
  if (facts.runs.length === 0) return null;
  return (
    <div className="sd-runs" role="status" aria-label="Session work">
      <div className="sd-label">SESSION WORK</div>
      <div className="sd-run-chips">
        {facts.runs.map((run) => (
          <span
            key={run.id}
            className={`live-chip ${run.tone}`}
            {...(run.reasonLabel ? { title: run.reasonLabel } : {})}
          >
            {run.kindLabel} · {run.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// The three states, kept apart, then the generated tests that back them.
function ResultSummary({
  heading,
  result,
  note,
}: {
  heading: string;
  result: CodeResult;
  note: string | null;
}) {
  const lines = stateLines(result);
  const { tests } = result;
  return (
    <div className="sd-result">
      <div className="sd-label">{heading.toUpperCase()}</div>
      <ul className="sd-states" aria-label="Verification states">
        {lines.map((line) => (
          <StateRow key={line.key} line={line} />
        ))}
      </ul>
      {note && <p className="sd-muted">{note}</p>}
      <div className="sd-label">GENERATED TESTS</div>
      {tests.results.length > 0 ? (
        <ul className="sd-tests" aria-label="Generated tests">
          {tests.results.map((test, index) => (
            <li
              key={`${index}:${test.name}`}
              className={`sd-test ${test.status}`}
            >
              <span
                className={
                  test.status === "passed"
                    ? "ws-tone-green"
                    : test.status === "failed"
                      ? "ws-tone-red"
                      : "ws-tone-muted"
                }
              >
                <Icon
                  name={
                    test.status === "passed"
                      ? "check_circle"
                      : test.status === "failed"
                        ? "cancel"
                        : "pending"
                  }
                  size={16}
                />
              </span>
              <span className="sd-test-name">{test.name}</span>
              <span className="sd-faint">{test.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sd-muted">The session reported no tests.</p>
      )}
      {result.runner.available && (
        <p className="sd-muted">
          {RUNNER_NOTE}
          {result.runner.durationMs !== null
            ? ` Took ${result.runner.durationMs} ms.`
            : ""}
        </p>
      )}
    </div>
  );
}

function StateRow({ line }: { line: StateLine }) {
  return (
    <li className={`sd-state ${line.on ? "on" : "off"}`} data-state={line.key}>
      <span className={line.on ? "ws-tone-green" : "ws-tone-muted"}>
        <Icon
          name={line.on ? "check_circle" : "radio_button_unchecked"}
          size={17}
          filled={line.on}
        />
      </span>
      <span>
        <span className="sd-state-label">{line.label}</span>
        <span className="sd-faint">{line.detail}</span>
      </span>
    </li>
  );
}

// A solution the session could not write because the draft was edited. It is
// offered, never applied: Apply replaces the solution, usage and tests against
// the revision the owner sees, and the server refuses it if the draft moved.
function Suggestion({
  held,
  state,
}: {
  held: HeldResult;
  state: SessionDraftState;
}) {
  const [hidden, setHidden] = useState(() => dismissed.has(held.runId));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<
    "applied" | "conflict" | "failed" | null
  >(null);
  const { files } = state;
  const { result } = held;
  const same =
    files !== null &&
    files.code === result.code &&
    files.usageCode === result.usageCode &&
    files.testCode === result.testCode;

  useEffect(() => setHidden(dismissed.has(held.runId)), [held.runId]);

  if (message === "applied")
    return (
      <p className="sd-note applied" role="status">
        <Icon name="check_circle" size={16} />
        Suggestion applied. What you had not saved as a version has been
        replaced.
      </p>
    );
  if (hidden || files === null || (same && message === null)) return null;

  const language = languageSchema.safeParse(result.language);
  const apply = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await state.applySolution({
        code: result.code,
        usageCode: result.usageCode,
        testCode: result.testCode,
        ...(language.success ? { language: language.data as Language } : {}),
      });
      setMessage("applied");
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === "revision-conflict"
          ? "conflict"
          : "failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="sd-suggestion"
      role="region"
      aria-label="Suggested solution"
    >
      <div className="sd-suggestion-head">
        <Icon name="lightbulb" size={18} />
        <span>
          <strong>Suggested solution · task rev {held.taskRevision}.</strong>{" "}
          The session finished a solution after you edited this draft, so it was
          not applied. Applying replaces your solution, usage and tests.
        </span>
        <button
          type="button"
          className="studio-button"
          disabled={busy}
          onClick={() => {
            dismissed.add(held.runId);
            setHidden(true);
          }}
        >
          Dismiss
        </button>
        <button
          type="button"
          className="studio-button primary"
          disabled={busy}
          onClick={() => void apply()}
        >
          Apply
        </button>
      </div>
      {message === "conflict" && (
        <p className="sd-note error" role="alert">
          <Icon name="error" size={16} />
          {CONFLICT_NOTE}{" "}
          <button
            type="button"
            className="studio-button"
            onClick={() => void state.reload().then(() => setMessage(null))}
          >
            Reload draft
          </button>
        </p>
      )}
      {message === "failed" && (
        <p className="sd-note error" role="alert">
          <Icon name="error" size={16} />
          The suggestion could not be applied. Your draft is unchanged.
        </p>
      )}
      <details className="sd-suggestion-detail">
        <summary>Review the changes and its results</summary>
        <PreviewedCode
          change={{
            id: "code",
            label: "Solution",
            before: files.code,
            after: result.code,
          }}
        />
        <ResultSummary
          heading="The suggestion’s results"
          result={result}
          note={null}
        />
      </details>
    </div>
  );
}
