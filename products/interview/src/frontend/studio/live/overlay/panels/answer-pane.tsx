// The answer pane and the code pane: the task on show, described by the shared
// task card (name, kind, constraints, badges, code) plus the published answer's
// own sections. Both say what is true of the work now: the steps of a job in
// flight, a task the owner stopped, or what the code is waiting for. Neither
// fetches or decides anything; they read the one panel session.
import { useEffect, useState } from "react";
import { Icon } from "../../../icon";
import { captureProblem } from "../../shared/capture-problem";
import { CaptureProblemBanner } from "../../shared/capture-problem-banner";
import { copyText } from "../../shared/copy-text";
import { InlineBold, plainDraft } from "../../shared/draft-text";
import {
  type MissingContextActionId,
  MissingContextStrip,
} from "../../shared/missing-context-strip";
import { revisionLine } from "../../shared/revisions";
import { RevisionsControl } from "../../shared/revisions-control";
import {
  ScreenshotsArea,
  ScreenshotsToggle,
  useAreaId,
} from "../../shared/screenshots-area";
import { nativeChord } from "../../shared/shortcuts";
import { STAGE_PRESENTATION } from "../../shared/task-card-model";
import { taskLabel } from "../../shared/task-target";
import { useTraySurface } from "../../shared/use-screenshot-tray";
import {
  actionsVersion,
  useScreenshotsView,
} from "../../shared/use-screenshots-view";
import { DEVICE_ONLY_ANALYZE } from "../overlay-capture";
import { CodeCard, CodeEmpty } from "./code-card";
import { FOCUS_INPUT_EVENT } from "./commands";
import { answerView, codePlaceholder, stoppedByYou } from "./panel-model";
import type { PanelSession } from "./panel-views";
import { answerSteps } from "./toolbar-config";
import { useElapsed } from "./use-elapsed";
import { TOAST_TEXT } from "./use-panel-session";

const COPIED_MS = 1_600;

// Copy answer or code through the clipboard: "Copied" is said only after the
// write succeeded; a failure says so and leaves the text for the person to copy.
function useCopy(s: PanelSession) {
  const [copied, setCopied] = useState<"answer" | "code" | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return {
    copied,
    async copy(what: "answer" | "code", text: string) {
      if (await copyText(text)) {
        setCopied(what);
        s.toast(TOAST_TEXT.copied(what));
      } else s.notify(`Couldn’t copy the ${what}. Select it and copy by hand.`);
    },
  };
}

// A job is in flight and the task on show is not what it is working on (or has
// no answer yet): the panes show its steps in place of the old answer.
function stepsShown(
  s: Pick<PanelSession, "phase" | "card" | "selected">,
): boolean {
  if (!s.phase) return false;
  if (!s.card || s.card.answerText === null) return true;
  return !s.selected?.current.runs.some((run) => run.state === "running");
}

// Adding a screenshot sends the screen, so it waits for what a capture needs.
function missingUnavailable(
  s: Pick<PanelSession, "deviceOnly" | "open">,
): Partial<Record<MissingContextActionId, string>> {
  if (s.deviceOnly) return { screenshot: DEVICE_ONLY_ANALYZE };
  if (!s.open) return { screenshot: "The session is not taking captures now." };
  return {};
}

export function AnswerPane({ s }: { s: PanelSession }) {
  const { card } = s;
  const task = s.shown;
  const view = task ? answerView(task) : null;
  // The one error line can be dismissed; a different message shows again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const note = s.note && s.note !== dismissed ? s.note : null;
  const steps = s.phase ? answerSteps(s.phase, s.model.activity.key) : [];
  const active = steps.find((step) => step.state === "active");
  const waited = useElapsed(s.phase !== null, active?.id);
  const copying = useCopy(s);
  const showSteps = stepsShown(s);
  const stopped =
    !s.phase && card && task && card.answerText === null && stoppedByYou(task);
  const newest = taskLabel(s.model.tasks.length);
  const shots = useScreenshotsView({
    tray: s.tray,
    tenant: s.tenant,
    sessionId: s.session?.id ?? null,
    taskId: s.selected?.taskId ?? null,
    taskLabel: card?.label ?? null,
    version: actionsVersion(s.snapshot.actions),
    policy: s.session?.processingPolicy ?? null,
  });
  const areaId = useAreaId();
  useTraySurface(s.tray);
  const area = (
    <ScreenshotsArea
      view={shots}
      id={areaId}
      variant="native"
      captureUnavailable={s.captureUnavailable}
      onAdd={(intent) => void s.stage(intent)}
    />
  );
  return (
    <div className="pn-card pn-analysis-text" data-testid="pn-answer-pane">
      {s.captureProblem && (
        <CaptureProblemBanner
          problem={s.captureProblem}
          onDismiss={s.dismissCaptureProblem}
          {...(s.captureProblemAction
            ? { onAction: s.captureProblemAction }
            : {})}
        />
      )}
      {s.noQuestionLine && !showSteps && (
        <p className="pn-muted" role="status" data-testid="pn-no-question">
          {s.noQuestionLine}
        </p>
      )}
      {showSteps ? (
        <ol
          className="pn-steps"
          role="status"
          aria-label="Analysis steps"
          data-testid="pn-steps"
        >
          {steps.map((step) => (
            <li key={step.id} data-state={step.state}>
              <span className="pn-step-mark" aria-hidden="true">
                {step.state === "active" ? (
                  <span className="pn-spinner" />
                ) : (
                  <Icon
                    name={
                      step.state === "done"
                        ? "check_circle"
                        : "radio_button_unchecked"
                    }
                    filled={step.state === "done"}
                  />
                )}
              </span>
              <span className="pn-step-label">{step.label}</span>
              <span className="pn-step-time">
                {step.state === "active" && waited >= 1 ? `${waited}s` : ""}
              </span>
            </li>
          ))}
        </ol>
      ) : !card || !view ? (
        <div className="pn-empty" data-testid="pn-analysis-empty">
          <span className="pn-empty-icon" aria-hidden="true">
            <Icon name="screenshot_monitor" />
          </span>
          <div className="pn-empty-title">Nothing analysed yet</div>
          <div className="pn-empty-sub">
            {s.auto.on
              ? "Auto is on. Studio analyses the screen when it changes, while a browser is in front."
              : "Open the problem in your browser, then capture a screenshot. It stays on this device until you press Apply. Spoken questions are answered without pressing anything."}
          </div>
          <button
            type="button"
            className="pn-primary"
            disabled={!s.open}
            onClick={() => s.press("capture")}
          >
            <Icon name="screenshot_monitor" />
            {s.auto.on ? "Analyze screen" : "Capture screenshot"}
            <kbd>{nativeChord("analyze")}</kbd>
          </button>
          {!s.open && (
            <p className="pn-muted" role="status" data-testid="pn-capture-off">
              {captureProblem("session-ended").title}.{" "}
              {captureProblem("session-ended").fix}
            </p>
          )}
          {s.tray.items.length > 0 && area}
        </div>
      ) : (
        <div className="pn-scroll" data-testid="pn-answer">
          <div className="pn-task-line" data-testid="pn-task-line">
            <span className="pn-task-id">
              {card.label} ·{" "}
              {s.selected && card.revisionCount > 1
                ? revisionLine(s.selected, card.revision).label
                : `rev ${card.revision}`}
            </span>
            {s.selected && (
              <RevisionsControl
                task={s.selected}
                selected={card.revision}
                variant="native"
                onPick={s.pickRevision}
              />
            )}
            {card.revision !== card.currentRevision && (
              <span className="pn-earlier" data-testid="pn-earlier-revision">
                viewing an earlier revision · current is rev{" "}
                {card.currentRevision}
              </span>
            )}
            {card.snapshotLabel && <span>from {card.snapshotLabel}</span>}
            {card.earlier && (
              <>
                <span className="pn-earlier" data-testid="pn-earlier">
                  earlier task
                </span>
                <button
                  type="button"
                  className="pn-mini-button"
                  onClick={() => s.select(null)}
                >
                  Back to {newest}
                </button>
              </>
            )}
            <ScreenshotsToggle
              view={shots}
              variant="native"
              controls={areaId}
            />
          </div>
          {area}
          <div className="pn-problem-head">
            <h2 className="pn-problem" data-testid="pn-problem">
              {card.name}
            </h2>
            <span className="pn-type-pill" data-testid="pn-type">
              {card.kind.label}
            </span>
          </div>
          {card.answerStale && (
            <p className="pn-muted" data-testid="pn-stale">
              This answer is for an earlier revision of the task.
            </p>
          )}
          {stopped && (
            <p className="pn-stopped" data-testid="pn-stopped">
              You stopped this analysis. Nothing was published for it. Press{" "}
              {nativeChord("analyze")} to start a fresh task.
            </p>
          )}
          {!stopped && card.answerText === null && (
            <p className="pn-muted" data-testid="pn-no-answer">
              {STAGE_PRESENTATION[card.stages[0].state].word}
              {card.stages[0].detail ? ` · ${card.stages[0].detail}` : ""}
            </p>
          )}
          {s.missing && (
            <MissingContextStrip
              items={s.missing}
              variant="native"
              unavailable={missingUnavailable(s)}
              onAction={(id) => {
                if (id === "screenshot") s.press("attach");
                else if (id === "context")
                  window.dispatchEvent(new Event(FOCUS_INPUT_EVENT));
                else s.dismissMissing();
              }}
            />
          )}
          {card.constraints.some((each) => each.status === "current") && (
            <div className="pn-constraints">
              <strong>Constraints:</strong>
              <div className="pn-chips" aria-label="Constraints">
                {card.constraints
                  .filter((each) => each.status === "current")
                  .map((each) => (
                    <span key={each.text} className="pn-chip">
                      {each.text}
                    </span>
                  ))}
              </div>
            </div>
          )}
          {(view.input.length > 0 || view.output.length > 0) && (
            <div>
              <strong>Input/Output:</strong>
              {view.input.length > 0 && (
                <p>
                  <b>Input:</b> <InlineBold text={view.input.join(" ")} />
                </p>
              )}
              {view.output.length > 0 && (
                <p>
                  <b>Output:</b> <InlineBold text={view.output.join(" ")} />
                </p>
              )}
            </div>
          )}
          {view.steps.map((step) => (
            <div key={step.heading}>
              <strong>{step.heading}</strong>
              {step.lines.map((line) => (
                <p key={line}>
                  <InlineBold text={line} />
                </p>
              ))}
            </div>
          ))}
          {view.complexity.length > 0 && (
            <div>
              <strong>Complexity</strong>
              {view.complexity.map((line) => (
                <p key={line}>
                  <InlineBold text={line} />
                </p>
              ))}
            </div>
          )}
          {card.answerText !== null && (
            <div className="pn-actions">
              <button
                type="button"
                className="pn-mini-button"
                onClick={() =>
                  void copying.copy("answer", plainDraft(card.answerText ?? ""))
                }
              >
                <Icon
                  name={copying.copied === "answer" ? "check" : "content_copy"}
                />
                {copying.copied === "answer" ? "Copied" : "Copy answer"}
              </button>
            </div>
          )}
        </div>
      )}
      {note && (
        <p className="pn-note" role="alert">
          <span>{note}</span>
          <button
            type="button"
            className="pn-note-close"
            aria-label="Dismiss message"
            onClick={() => setDismissed(note)}
          >
            <Icon name="close" />
          </button>
        </p>
      )}
    </div>
  );
}

export function CodePane({ s }: { s: PanelSession }) {
  const { card } = s;
  const task = s.shown;
  const pending = stepsShown(s);
  const writing = card?.stages[1].state === "running";
  const seconds = useElapsed(writing, card?.taskId);
  const copying = useCopy(s);
  const example = task ? answerView(task).example : null;
  if (card?.code && !pending)
    return (
      <CodeCard
        code={card.code}
        constraints={card.constraints}
        badges={card.badges}
        example={example}
        copy={{
          label: "Copy code",
          copied: copying.copied === "code",
          onCopy: (text) => void copying.copy("code", text),
        }}
      />
    );
  const placeholder = codePlaceholder({
    card,
    approachPending: pending,
    stoppedByYou: task ? stoppedByYou(task) : false,
    seconds,
  });
  return <CodeEmpty text={placeholder.text} busy={placeholder.busy} />;
}
