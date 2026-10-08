// The answer pane and the code pane: the task on show, described by the shared
// task card (name, kind, constraints, badges, code) plus the published answer's
// own sections. Both say what is true of the work now: the steps of a job in
// flight, a task the owner stopped, or what the code is waiting for. Neither
// fetches or decides anything; they read the one panel session.

import {
  ActionMenu,
  Button,
  Empty,
  Panel,
  Steps,
  Tag,
} from "@oc-tech/omni-ui-components";
import {
  LIVE_OWNER_LANGUAGE_LABELS,
  LIVE_OWNER_LANGUAGES,
  type LiveOwnerLanguage,
} from "@omnitech/interview-contracts";
import { useEffect, useState } from "react";
import { Icon } from "../../../icon";
import {
  captureProblem,
  DEVICE_ONLY_ANALYZE,
} from "../../shared/capture-problem";
import { CaptureProblemBanner } from "../../shared/capture-problem-banner";
import { copyText } from "../../shared/copy-text";
import { InlineBold, plainDraft } from "../../shared/draft-text";
import {
  type MissingContextActionId,
  MissingContextStrip,
} from "../../shared/missing-context-strip";
import { revisionLine } from "../../shared/revisions";
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
import { AnswerDock } from "./answer-dock";
import { complexityChips, lastCaptureMeta } from "./answer-header";
import { CodeCard, CodeEmpty } from "./code-card";
import { FOCUS_INPUT_EVENT } from "./commands";
import {
  answerView,
  codePlaceholder,
  stoppedByYou,
  WAITS_FOR_APPROACH,
} from "./panel-model";
import type { PanelSession } from "./panel-views";
import { TextSurface } from "./text-surface";
import { answerSteps, captureControl } from "./toolbar-config";
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

// A job is in flight and the task on show has no answer yet: the panes show
// its steps in place of an answer. Once the task on show has an answer the
// steps never replace it: work running on ANOTHER task leaves this one's
// answer and code alone, and this task's own code being written is said by
// the Code panel ("Writing code…"), not by hiding the approach.
const ANSWER_TEXT = { fontSize: 17, lineHeight: 1.6 } as const;

function stepsShown(s: Pick<PanelSession, "phase" | "card">): boolean {
  if (!s.phase) return false;
  return !s.card || s.card.answerText === null;
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
  // A new problem captured and not yet applied: the pane shows the empty state
  // with the staged screenshots (the same screen as a session's first problem),
  // never the previous task's answer or stored screenshots.
  const drafting = s.open && s.tray.intent === "new" && s.tray.items.length > 0;
  const showSteps = !drafting && stepsShown(s);
  // Always offered: what the AI may have missed (a warning when it named
  // something, under the problem's kind) or the question whether it did
  // (neutral, at the end of the answer).
  const missingStrip = (
    <MissingContextStrip
      items={s.missing ?? []}
      variant="native"
      unavailable={missingUnavailable(s)}
      onContext={(text) => s.send(text)}
      onAction={(id) => {
        if (id === "screenshot") s.press("attach");
        else if (id === "context")
          window.dispatchEvent(new Event(FOCUS_INPUT_EVENT));
        else s.dismissMissing();
      }}
    />
  );
  const stopped =
    !s.phase && card && task && card.answerText === null && stoppedByYou(task);
  const newest = taskLabel(s.model.tasks.length);
  const shots = useScreenshotsView({
    tray: s.tray,
    tenant: s.tenant,
    sessionId: s.session?.id ?? null,
    taskId: drafting ? null : (s.selected?.taskId ?? null),
    taskLabel: drafting ? null : (card?.label ?? null),
    version: actionsVersion(s.snapshot.actions),
    policy: s.session?.processingPolicy ?? null,
  });
  const areaId = useAreaId();
  useTraySurface(s.tray);
  // Staged screenshots wait in the panel's dock; with none staged the area
  // keeps the stored screenshots and the add control.
  const pending = shots.staged.length > 0;
  const area = (
    <ScreenshotsArea
      onAddContext={() => window.dispatchEvent(new Event(FOCUS_INPUT_EVENT))}
      view={shots}
      id={areaId}
      variant="native"
      captureUnavailable={s.captureUnavailable}
      hideTray={pending}
      onAdd={(intent) => void s.stage(intent)}
    />
  );
  const answered = !showSteps && card && view;
  const noQuestion = lastCaptureMeta(s.snapshot.actions);
  const chips = answered ? complexityChips(view.complexity) : [];
  const meta = showSteps ? null : answered ? (
    chips.length > 0 ? (
      chips.map((chip) => (
        <Tag key={chip} variant="filled" mono>
          {chip}
        </Tag>
      ))
    ) : null
  ) : s.noQuestionLine && noQuestion ? (
    <span title={noQuestion.full} data-testid="pn-answer-meta">
      {noQuestion.lead}
      <span className="pn-meta-tail"> · no question found</span>
    </span>
  ) : null;
  const stop = captureControl(true);
  return (
    <TextSurface>
      <Panel
        title="Answer"
        data-testid="pn-analysis"
        className="pn-answer-panel"
        bodyClassName="pn-answer-body"
        {...(drafting
          ? { subtitle: "New problem" }
          : answered
            ? { subtitle: `${card.label} · ${card.name}` }
            : {})}
        meta={meta}
        actions={
          s.phase ? (
            <Button
              buttonSize="sm"
              variant="outline"
              icon={<Icon name="stop_circle" />}
              shortcut={[...nativeChord("analyze")]}
              aria-label={`${stop.label} ${nativeChord("analyze")}`}
              title={stop.title}
              onClick={() => void s.stop()}
            >
              {stop.label}
            </Button>
          ) : undefined
        }
        dock={
          pending ? (
            <AnswerDock
              view={shots}
              captureUnavailable={s.captureUnavailable}
              onAdd={(intent) => void s.stage(intent)}
              language={s.hints.language}
              onLanguage={s.setLanguage}
            />
          ) : undefined
        }
        dockClassName="pn-answer-dock"
      >
        {s.captureProblem && (
          <CaptureProblemBanner
            problem={s.captureProblem}
            onDismiss={s.dismissCaptureProblem}
            {...(s.captureProblemAction
              ? { onAction: s.captureProblemAction }
              : {})}
          />
        )}
        {showSteps ? (
          <Steps
            variant="checklist"
            role="status"
            aria-label="Analysis steps"
            data-testid="pn-steps"
            className="pn-answer-steps"
            items={steps.map((step) => ({
              key: step.id,
              state:
                step.state === "active"
                  ? "current"
                  : step.state === "waiting"
                    ? "pending"
                    : "done",
              label: (
                <>
                  {step.label}
                  {step.state === "active" && waited >= 1 && (
                    <span className="pn-step-time">{` ${waited}s`}</span>
                  )}
                </>
              ),
            }))}
          />
        ) : drafting || !card || !view ? (
          <Empty
            variant="tile"
            data-testid="pn-analysis-empty"
            icon={<Icon name="screenshot_monitor" />}
            title={drafting ? "New problem" : "Nothing analysed yet"}
            description={
              drafting
                ? "The staged screenshots become the task when you press Apply. Add another if the problem spans screens."
                : s.auto.on
                  ? "Auto is on. Studio analyses the screen when it changes, while a browser is in front."
                  : "Open the problem in your browser, then capture a screenshot. It stays on this device until you press Apply. Spoken questions are answered without pressing anything."
            }
          >
            {!drafting && (
              <Button
                buttonSize="control"
                tone="accent"
                icon={<Icon name="screenshot_monitor" />}
                shortcut={[...nativeChord("analyze")]}
                disabled={!s.open}
                aria-label={`${s.auto.on ? "Analyze screen" : "Capture screenshot"} ${nativeChord("analyze")}`}
                onClick={() => s.press("capture")}
              >
                {s.auto.on ? "Analyze screen" : "Capture screenshot"}
              </Button>
            )}
            {s.noQuestionLine && (
              <p
                className="pn-muted"
                role="status"
                data-testid="pn-no-question"
              >
                {s.noQuestionLine}
              </p>
            )}
            {!s.open && (
              <p
                className="pn-muted"
                role="status"
                data-testid="pn-capture-off"
              >
                {captureProblem("session-ended").title}.{" "}
                {captureProblem("session-ended").fix}
              </p>
            )}
            {s.tray.items.length > 0 && area}
          </Empty>
        ) : (
          <div
            className="pn-answer-content"
            data-testid="pn-answer"
            // Read from while speaking: larger and looser than the other panes.
            style={ANSWER_TEXT}
          >
            {s.noQuestionLine && (
              <p
                className="pn-muted"
                role="status"
                data-testid="pn-no-question"
              >
                {s.noQuestionLine}
              </p>
            )}
            <div className="pn-task-line" data-testid="pn-task-line">
              <span className="pn-task-id">
                {card.label} ·{" "}
                {s.selected && card.revisionCount > 1
                  ? revisionLine(s.selected, card.revision).label
                  : `rev ${card.revision}`}
              </span>
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
                  <Button
                    buttonSize="sm"
                    variant="outline"
                    onClick={() => s.select(null)}
                  >
                    Back to {newest}
                  </Button>
                </>
              )}
              <ScreenshotsToggle
                view={shots}
                variant="native"
                controls={areaId}
              />
            </div>
            <div className="pn-problem-head">
              <h2 className="pn-problem" data-testid="pn-problem">
                {card.name}
              </h2>
              <Tag data-testid="pn-type">{card.kind.label}</Tag>
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
            {(s.missing?.length ?? 0) > 0 && missingStrip}
            {card.constraints.some((each) => each.status === "current") && (
              <div className="pn-constraints">
                <strong>Constraints:</strong>
                {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the label names this part for assistive technology; the role it would need changes the accessibility tree, so it waits for an accessibility pass */}
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
                <Button
                  buttonSize="sm"
                  variant="outline"
                  icon={
                    <Icon
                      name={
                        copying.copied === "answer" ? "check" : "content_copy"
                      }
                    />
                  }
                  onClick={() =>
                    void copying.copy(
                      "answer",
                      plainDraft(card.answerText ?? ""),
                    )
                  }
                >
                  {copying.copied === "answer" ? "Copied" : "Copy answer"}
                </Button>
              </div>
            )}
            {(s.missing?.length ?? 0) === 0 && missingStrip}
            {area}
            <div className="pn-regenerate">
              <ActionMenu
                label="Language for Regenerate"
                title="Regenerate in"
                width={240}
                sections={[
                  {
                    id: "language",
                    selection: "single",
                    value: s.hints.language,
                    items: [
                      { id: "auto", label: "Detected from the screen" },
                      ...LIVE_OWNER_LANGUAGES.map((id) => ({
                        id,
                        label: LIVE_OWNER_LANGUAGE_LABELS[id],
                      })),
                    ],
                  },
                ]}
                onValueChange={(_group, id) =>
                  s.setLanguage(id as LiveOwnerLanguage | "auto")
                }
                trigger={
                  <Button
                    buttonSize="sm"
                    variant="outline"
                    icon={<Icon name="code" />}
                    iconAfter={<Icon name="expand_more" />}
                    disabled={s.tray.applying || !s.open}
                    aria-label="Regenerate in another language"
                    data-testid="pn-regenerate-language"
                  >
                    {s.hints.language === "auto"
                      ? "Language: auto"
                      : LIVE_OWNER_LANGUAGE_LABELS[s.hints.language]}
                  </Button>
                }
              />
              <Button
                buttonSize="sm"
                variant="outline"
                icon={<Icon name="refresh" />}
                disabled={s.tray.applying || !s.open}
                data-testid="pn-regenerate"
                onClick={() => void s.tray.apply()}
              >
                Regenerate
              </Button>
            </div>
          </div>
        )}
        {note && (
          <p className="pn-note" data-text-surface="" role="alert">
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
      </Panel>
    </TextSurface>
  );
}

export function CodePane({ s }: { s: PanelSession }) {
  const { card } = s;
  const drafting = s.open && s.tray.intent === "new" && s.tray.items.length > 0;
  const task = s.shown;
  const pending = stepsShown(s);
  const writing = card?.stages[1].state === "running";
  const seconds = useElapsed(writing, card?.taskId);
  const copying = useCopy(s);
  const example = task ? answerView(task).example : null;
  // A new problem not yet applied: nothing of the previous task is shown.
  if (drafting) return <CodeEmpty text={WAITS_FOR_APPROACH} busy={false} />;
  // While the newest revision's code is being written the pane spins: the
  // code left from the revision before it is not what is coming. Picking an
  // earlier revision shows that revision's code as it stands.
  const working =
    card?.stages.some((stage) => stage.state === "running") ?? false;
  const regenerating = working && card?.revision === card?.currentRevision;
  if (card?.code && !pending && !regenerating)
    return (
      <CodeCard
        code={card.code}
        constraints={card.constraints}
        badges={card.badges}
        example={example}
        revisions={
          s.selected && card.revisionCount > 1
            ? {
                task: s.selected,
                selected: card.revision,
                current: card.currentRevision,
                onPick: s.pickRevision,
              }
            : null
        }
        copy={{
          label: "Copy code",
          copied: copying.copied === "code",
          onCopy: (text) => void copying.copy("code", text),
        }}
      />
    );
  // The approach of a new revision is still being redrafted: its code has
  // not started, and the pane says so with the spinner.
  if (regenerating && !writing && !pending)
    return <CodeEmpty text="Working on the new revision…" busy />;
  const placeholder = codePlaceholder({
    card,
    approachPending: pending,
    stoppedByYou: task ? stoppedByYou(task) : false,
    seconds,
  });
  return <CodeEmpty text={placeholder.text} busy={placeholder.busy} />;
}
