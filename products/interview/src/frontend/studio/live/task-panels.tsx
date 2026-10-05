// One card per detected task, chosen by a selector (newest first), and the
// idle state shown before any task exists. The idle copy follows the model's
// activity, so it never says "listening" when the session is paused, a source
// is lost or the companion has not been heard from.
import type {
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
import { STAGE_PRESENTATION, type TaskCard } from "./shared/task-card-model";
import { TASK_KIND } from "./shared/task-kind";

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
export function idleCopy(key: ActivityKey): Idle | null {
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
    .map((task, index) => ({ task, number: index + 1 }))
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
          Task {number} · {TASK_KIND[task.kind].label}
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

function EarlierTaskBanner({ onBack }: { onBack(): void }) {
  return (
    <div className="live-banner earlier" role="status">
      <Icon name="history" />
      <span className="live-banner-text">
        Viewing an earlier task. Studio still tracks the newest one.
      </span>
      <button type="button" className="live-banner-action" onClick={onBack}>
        Back to now
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
  showWorkspaceLink = true,
}: {
  task: TaskView;
  // The one derivation of this task's identity, stages and model.
  card: TaskCard;
  session: LiveSessionView | null;
  policy: LiveProcessingPolicy | null;
  onCopy(text: string): void;
  onBackToNow(): void;
  showWorkspaceLink?: boolean;
}) {
  const noticed = noticesFor(task, policy).length > 0;
  const meta = [
    `${card.label} · rev ${card.revision}`,
    card.snapshotLabel ? `from screenshot ${card.snapshotLabel}` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <>
      {card.earlier && <EarlierTaskBanner onBack={onBackToNow} />}
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
        </header>
        <h3 className="live-task-name">{card.name}</h3>
        <ModelLine card={card} answer={task.answer} />
        <StageTiles card={card} noticed={noticed} />
        <RunNotices task={task} policy={policy} />
        {card.kind.id === "programming-challenge" ? (
          <CodingPanel
            task={task}
            card={card}
            session={session}
            onCopy={onCopy}
            showWorkspaceLink={showWorkspaceLink}
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
