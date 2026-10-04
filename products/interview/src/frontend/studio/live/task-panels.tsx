// One panel per detected task, chosen by a selector (newest first), and the
// idle state shown before any task exists. The idle copy follows the model's
// activity, so it never says "listening" when the session is paused, a source
// is lost or the companion has not been heard from.
import type {
  LiveProcessingPolicy,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { Icon, type IconName } from "../icon";
import { AnswerBody } from "./answer-body";
import { CodingPanel } from "./coding-panel";
import { noticesFor, RunNotices } from "./run-notices";
import type { ActivityKey } from "./session-banners";
import type { LiveViewModel } from "./session-state";
import type { TaskKind, TaskView } from "./session-tasks";

export const TASK_KIND: Record<TaskKind, { label: string; icon: IconName }> = {
  "experience-question": { label: "Experience question", icon: "psychology" },
  "leadership-behavioural": { label: "Behavioural question", icon: "star" },
  logistics: { label: "Logistics question", icon: "checklist" },
  concept: { label: "Concept question", icon: "school" },
  "programming-challenge": { label: "Programming challenge", icon: "code" },
  other: { label: "Question", icon: "help" },
  unclassified: { label: "New task", icon: "pending" },
};

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

export function TaskPanel({
  task,
  number,
  session,
  policy,
  onCopy,
  showWorkspaceLink = true,
}: {
  task: TaskView;
  number: number;
  session: LiveSessionView | null;
  policy: LiveProcessingPolicy | null;
  onCopy(text: string): void;
  showWorkspaceLink?: boolean;
}) {
  const kind = TASK_KIND[task.kind];
  const noticed = noticesFor(task, policy).length > 0;
  return (
    <article
      className="live-task"
      aria-label={`Task ${number}: ${kind.label}`}
      data-testid="task-panel"
      data-kind={task.kind}
    >
      <header className="live-task-head">
        <span className="live-chip accent">
          <Icon name={kind.icon} />
          {kind.label}
        </span>
        <span className="live-note">Task rev {task.currentRevision}</span>
      </header>
      <RunNotices task={task} policy={policy} />
      {task.kind === "programming-challenge" ? (
        <CodingPanel
          task={task}
          session={session}
          showWorkspaceLink={showWorkspaceLink}
        />
      ) : task.answer ? (
        <AnswerBody task={task} answer={task.answer} onCopy={onCopy} />
      ) : (
        !noticed && (
          <p className="live-note">
            No answer has been published for this task.
          </p>
        )
      )}
    </article>
  );
}
