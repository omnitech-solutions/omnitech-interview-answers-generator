// Which task a follow-up or an added screenshot is about. Both surfaces use
// this one rule: the task the person is looking at (the one they pinned, else
// the newest), at that task's own current revision. Never "whatever was acted
// on last": looking at an earlier task must not redirect what is asked of it.
import type { TaskView } from "../session-tasks";

// What the owner-input route takes to bind an input to a task revision.
export type TaskTarget = { taskId: string; revision: number };

// The task on show: the pinned one if it still exists, else the newest.
export function selectedTask(
  tasks: readonly TaskView[],
  pinnedTaskId: string | null | undefined,
): TaskView | undefined {
  return (
    tasks.find((task) => task.taskId === pinnedTaskId) ??
    tasks[tasks.length - 1]
  );
}

// Tasks are numbered in creation order (the view model sorts them that way).
export function taskOrdinal(
  tasks: readonly TaskView[],
  taskId: string,
): number | null {
  const index = tasks.findIndex((task) => task.taskId === taskId);
  return index >= 0 ? index + 1 : null;
}

export const taskLabel = (ordinal: number): string => `T${ordinal}`;

export const targetOf = (task: TaskView | undefined): TaskTarget | null =>
  task ? { taskId: task.taskId, revision: task.currentRevision } : null;

export type ResolvedTarget = {
  task: TaskView;
  target: TaskTarget;
  // "T2": for placeholders such as "Follow-up about T2".
  targetLabel: string;
};

// The selected task and its target, or null when there is no task at all. A
// null target is an explicit general question; callers pass it on as such and
// never substitute another task.
export function resolveTarget(
  tasks: readonly TaskView[],
  pinnedTaskId: string | null | undefined,
): ResolvedTarget | null {
  const task = selectedTask(tasks, pinnedTaskId);
  const target = targetOf(task);
  if (!(task && target)) return null;
  return {
    task,
    target,
    targetLabel: taskLabel(taskOrdinal(tasks, task.taskId) ?? 1),
  };
}
