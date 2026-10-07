// What the open session's views share above any one panel: which task is
// pinned, and which older revision of a task the person chose to view. Both
// are layout only: they never touch the session, and pinning is presentation
// (no submit, no counts).
//
// Nothing here is persisted: a new visit to the live page follows the newest
// task.
import { useSyncExternalStore } from "react";

export type Presentation = {
  // null follows the newest task; an id pins an earlier one.
  pinnedTaskId: string | null;
  // Per task: the OLDER revision the person chose to view. A task with no entry
  // shows its current revision and follows whichever arrives next. View-only:
  // nothing here reaches the server, and a follow-up targets the current one.
  revisionPicks: Readonly<Record<string, number>>;
};

const INITIAL: Presentation = {
  pinnedTaskId: null,
  revisionPicks: {},
};

let state: Presentation | null = null;
const current = (): Presentation => {
  // Never remembered across visits.
  if (!state) state = { ...INITIAL };
  return state;
};
const listeners = new Set<() => void>();

function update(patch: Partial<Presentation>) {
  const before = current();
  const next = { ...before, ...patch };
  if (
    next.pinnedTaskId === before.pinnedTaskId &&
    next.revisionPicks === before.revisionPicks
  )
    return;
  state = next;
  for (const listener of [...listeners]) listener();
}

export const presentation = {
  get: (): Presentation => current(),
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  pin: (taskId: string | null) => update({ pinnedTaskId: taskId }),
  // An older revision to view, or null to follow the task's newest again.
  pickRevision(taskId: string, revision: number | null) {
    const { revisionPicks } = current();
    if ((revisionPicks[taskId] ?? null) === revision) return;
    const { [taskId]: _dropped, ...rest } = revisionPicks;
    update({
      revisionPicks: revision === null ? rest : { ...rest, [taskId]: revision },
    });
  },
  // Back to following the newest task. Never a session command.
  reset() {
    const changed =
      state !== null && JSON.stringify(state) !== JSON.stringify(INITIAL);
    state = { ...INITIAL };
    if (changed) for (const listener of [...listeners]) listener();
  },
};

export function usePresentation(): Presentation {
  return useSyncExternalStore(
    presentation.subscribe,
    presentation.get,
    presentation.get,
  );
}
