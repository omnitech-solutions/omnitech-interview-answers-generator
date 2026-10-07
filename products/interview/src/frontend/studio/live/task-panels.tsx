// One card per detected task, chosen by a selector (newest first), and the
// idle state shown before any task exists. The idle copy follows the model's
// activity, so it never says "listening" when the session is paused, a source
// is lost or the companion has not been heard from.
import type {
  LiveMissingContext,
  LiveProcessingPolicy,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { Icon, type IconName } from "../icon";
import { AnswerBody } from "./answer-body";
import { claimSummary } from "./claim-chips";
import { CodingPanel } from "./coding-panel";
import { noticesFor, RunNotices } from "./run-notices";
import type { ActivityKey } from "./session-banners";
import type { AnswerResult } from "./session-results";
import type { LiveViewModel } from "./session-state";
import type { TaskView } from "./session-tasks";
import {
  type MissingContextActionId,
  MissingContextStrip,
} from "./shared/missing-context-strip";
import { revisionLine } from "./shared/revisions";
import { RevisionsControl } from "./shared/revisions-control";
import type { TrayIntent } from "./shared/screenshot-tray";
import {
  ScreenshotsArea,
  ScreenshotsToggle,
  useAreaId,
} from "./shared/screenshots-area";
import { STAGE_PRESENTATION, type TaskCard } from "./shared/task-card-model";
import { TASK_KIND } from "./shared/task-kind";
import { taskLabel, taskOrdinal } from "./shared/task-target";
import {
  type ScreenshotTray,
  useTraySurface,
} from "./shared/use-screenshot-tray";
import { useScreenshotsView } from "./shared/use-screenshots-view";

// What the web page hands the screenshots area: the one tray (Manual stages,
// Apply generates), where the stored list is read from and how a capture is
// staged. Absent when this page cannot capture (no hands-free controller).
export type WebScreenshots = {
  tray: ScreenshotTray;
  tenant: string;
  sessionId: string | null;
  version: string | number;
  policy: LiveProcessingPolicy | null;
  onAdd(intent: TrayIntent): void;
  unavailable: string | null;
};

// The area under a task, or, with no task yet, the tray of a new problem once
// something is staged.
export function StagingOnly({ screenshots }: { screenshots?: WebScreenshots }) {
  const view = useScreenshotsView({
    tray: screenshots?.tray ?? null,
    tenant: screenshots?.tenant ?? "",
    sessionId: screenshots?.sessionId ?? null,
    taskId: null,
    taskLabel: null,
    version: screenshots?.version ?? 0,
    policy: screenshots?.policy ?? null,
  });
  const id = useAreaId();
  useTraySurface(screenshots?.tray ?? null);
  if (!screenshots || !view || view.tray.items.length === 0) return null;
  return (
    <ScreenshotsArea
      view={view}
      id={id}
      variant="web"
      captureUnavailable={screenshots.unavailable}
      onAdd={screenshots.onAdd}
    />
  );
}

export type Idle = { icon: IconName; title: string; detail: string };
const IDLE: Partial<Record<ActivityKey, Idle>> = {
  idle: {
    icon: "center_focus_strong",
    title: "Ready",
    detail:
      "Share a window, tab or screen and press Capture & analyze, dictate, or type a follow-up. Studio answers when you ask.",
  },
  paused: {
    icon: "pause_circle",
    title: "Paused",
    detail:
      "Studio is not starting any work. Resume the session to have it answer again.",
  },
};

// What the session is waiting for, in words (the idle title and detail).
function idleCopy(key: ActivityKey): Idle | null {
  return IDLE[key] ?? IDLE["idle"] ?? null;
}

export function IdleState({ model }: { model: LiveViewModel }) {
  const idle = idleCopy(model.activity.key);
  if (!idle) return null;
  return (
    <div
      className="live-idle"
      data-testid="live-idle"
      data-activity={model.activity.key}
    >
      <span className="live-idle-icon">
        <Icon name={idle.icon} />
      </span>
      <h3>{idle.title}</h3>
      <p>{idle.detail}</p>
    </div>
  );
}

export function TaskSelector({
  tasks,
  selectedId,
  onSelect,
}: {
  // Oldest first, as the model holds them.
  tasks: readonly TaskView[];
  selectedId: string;
  onSelect(taskId: string): void;
}) {
  if (tasks.length < 2) return null;
  const newestFirst = tasks
    .map((task, index) => ({
      task,
      number: taskOrdinal(tasks, task.taskId) ?? index + 1,
    }))
    .reverse();
  return (
    <div className="live-task-select" role="group" aria-label="Detected tasks">
      {newestFirst.map(({ task, number }) => (
        <button
          key={task.taskId}
          type="button"
          className="live-chip live-chip-button"
          aria-pressed={task.taskId === selectedId}
          onClick={() => onSelect(task.taskId)}
        >
          {taskLabel(number)} · {TASK_KIND[task.kind].label}
        </button>
      ))}
    </div>
  );
}

// What the answer rests on: the model that wrote it, then either how many of
// its claims are grounded in the owner's own words or, when none are, that it
// is general knowledge and not a claim about them.
function ModelLine({
  card,
  answer,
}: {
  card: TaskCard;
  answer: AnswerResult | null;
}) {
  if (!card.modelLabel) return null;
  const grounded = answer
    ? answer.claimCounts["matrix-backed"] +
        answer.claimCounts["preference-backed"] >
      0
    : false;
  return (
    <p className="live-model-line" data-testid="model-line">
      <span className="live-chip neutral">
        <Icon name="auto_awesome" />
        {card.modelLabel}
      </span>
      {answer && (
        <span className="live-note">
          {grounded
            ? claimSummary(answer.claimCounts)
            : "General knowledge, not a claim about you."}
        </span>
      )}
    </p>
  );
}

// The three stages as tiles. A running stage spins; "Not established" is a
// plain statement that nothing says it is true, never a failure.
function StageTiles({
  card,
  noticed,
}: {
  card: TaskCard;
  // A run notice below already says why a stopped or refused stage ended.
  noticed: boolean;
}) {
  return (
    <ul className="live-stages" aria-label="Stages">
      {card.stages.map((stage) => {
        const look = STAGE_PRESENTATION[stage.state];
        return (
          <li
            key={stage.id}
            className="live-stage"
            data-stage={stage.id}
            data-state={stage.state}
            data-tone={look.tone}
          >
            <span className="live-stage-name">{stage.label}</span>
            <span className="live-stage-state">
              <Icon name={look.icon} />
              {look.word}
            </span>
            {stage.detail &&
              !(
                noticed &&
                (stage.state === "stopped" || stage.state === "unavailable")
              ) && (
                <span className="live-note live-stage-detail">
                  {stage.detail}
                </span>
              )}
          </li>
        );
      })}
    </ul>
  );
}

function EarlierTaskBanner({
  newest,
  onBack,
}: {
  newest: string;
  onBack(): void;
}) {
  return (
    <div className="live-banner earlier" role="status">
      <Icon name="history" />
      <span className="live-banner-text">
        Viewing an earlier task. Studio still tracks the newest one.
      </span>
      <button type="button" className="live-banner-action" onClick={onBack}>
        Back to {newest}
      </button>
    </div>
  );
}

export function TaskPanel({
  task,
  card,
  session,
  policy,
  onCopy,
  onBackToNow,
  onPickRevision,
  missing = null,
  screenshots,
}: {
  // The task at the revision on show (see taskAtRevision); `revisions` and
  // `currentRevision` are still the task's own.
  task: TaskView;
  // The one derivation of this task's identity, stages and model.
  card: TaskCard;
  session: LiveSessionView | null;
  policy: LiveProcessingPolicy | null;
  onCopy(text: string): void;
  onBackToNow(): void;
  // View-only: show another revision of this task.
  onPickRevision(revision: number): void;
  // What the model could not see and what the person can do about it; null
  // when nothing is missing or the person said it looks complete.
  missing?: {
    items: LiveMissingContext;
    onAction(id: MissingContextActionId): void;
    unavailable: Partial<Record<MissingContextActionId, string>>;
  } | null;
  screenshots?: WebScreenshots;
}) {
  const shots = useScreenshotsView({
    tray: screenshots?.tray ?? null,
    tenant: screenshots?.tenant ?? "",
    sessionId: screenshots?.sessionId ?? null,
    taskId: task.taskId,
    taskLabel: card.label,
    version: screenshots?.version ?? 0,
    policy: screenshots?.policy ?? null,
  });
  const areaId = useAreaId();
  useTraySurface(screenshots?.tray ?? null);
  const noticed = noticesFor(task, policy).length > 0;
  const meta = [
    `${card.label} · ${
      card.revisionCount > 1
        ? revisionLine(task, card.revision).label
        : `rev ${card.revision}`
    }`,
    card.snapshotLabel ? `from screenshot ${card.snapshotLabel}` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <>
      {card.earlier && (
        <EarlierTaskBanner newest={card.newestLabel} onBack={onBackToNow} />
      )}
      <article
        key={card.taskId}
        className="live-task"
        aria-label={`Task ${card.ordinal}: ${card.kind.label}`}
        data-testid="task-panel"
        data-kind={card.kind.id}
      >
        <header className="live-task-head">
          <span className="live-chip accent">
            <Icon name={card.kind.icon} />
            {card.kind.label}
          </span>
          <span className="live-note">{meta}</span>
          <RevisionsControl
            task={task}
            selected={card.revision}
            variant="web"
            onPick={onPickRevision}
          />
          {card.revision !== card.currentRevision && (
            <span className="live-note" data-testid="earlier-revision">
              Viewing an earlier revision. The current one is rev{" "}
              {card.currentRevision}.
            </span>
          )}
          {shots && (
            <ScreenshotsToggle view={shots} variant="web" controls={areaId} />
          )}
        </header>
        {shots && screenshots && (
          <ScreenshotsArea
            view={shots}
            id={areaId}
            variant="web"
            captureUnavailable={screenshots.unavailable}
            onAdd={screenshots.onAdd}
          />
        )}
        <h3 className="live-task-name">{card.name}</h3>
        <ModelLine card={card} answer={task.answer} />
        <StageTiles card={card} noticed={noticed} />
        <RunNotices task={task} policy={policy} />
        {missing && (
          <MissingContextStrip
            variant="web"
            items={missing.items}
            onAction={missing.onAction}
            unavailable={missing.unavailable}
          />
        )}
        {card.kind.id === "programming-challenge" ? (
          <CodingPanel
            task={task}
            card={card}
            session={session}
            onCopy={onCopy}
          />
        ) : task.answer ? (
          <AnswerBody
            task={task}
            card={card}
            answer={task.answer}
            onCopy={onCopy}
          />
        ) : (
          !noticed && (
            <p className="live-note">
              No answer has been published for this task.
            </p>
          )
        )}
      </article>
    </>
  );
}
