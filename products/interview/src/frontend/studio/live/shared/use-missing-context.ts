// Whether the strip shows for the task on show: the model's list for its
// current revision, unless the person said "Looks complete" for THAT revision.
// The dismissal is a per-viewer convenience kept in this browser per session,
// task and revision; a new revision that reports missing context again shows
// the strip again, and without storage the strip simply comes back on reload.
import type { LiveMissingContext } from "@omnitech/interview-contracts";
import { useCallback, useMemo, useState } from "react";
import type { TaskCard } from "./task-card-model";

const KEY = (sessionId: string) =>
  `interview-studio.live.missing-dismissed.${sessionId}`;
// Enough for a long session; the oldest are forgotten first.
const MAX_KEPT = 50;

export const dismissalKey = (taskId: string, revision: number): string =>
  `${taskId}:${revision}`;

export function loadDismissed(sessionId: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(KEY(sessionId)) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((each): each is string => typeof each === "string")
      : [];
  } catch {
    return [];
  }
}

function saveDismissed(sessionId: string, keys: readonly string[]): void {
  try {
    window.localStorage.setItem(
      KEY(sessionId),
      JSON.stringify(keys.slice(-MAX_KEPT)),
    );
  } catch {
    // Kept for this page only.
  }
}

export function useMissingContext(
  sessionId: string | null,
  card: Pick<TaskCard, "taskId" | "revision" | "missingContext"> | null,
): { missing: LiveMissingContext | null; dismiss(): void } {
  // Dismissed on this page, so it hides even where storage is unavailable.
  const [here, setHere] = useState<readonly string[]>([]);
  const key =
    sessionId && card
      ? `${sessionId}/${dismissalKey(card.taskId, card.revision)}`
      : null;
  const stored = useMemo(
    () => (sessionId ? loadDismissed(sessionId) : []),
    [sessionId],
  );
  const dismiss = useCallback(() => {
    if (!sessionId || !card) return;
    const own = dismissalKey(card.taskId, card.revision);
    const kept = loadDismissed(sessionId);
    if (!kept.includes(own)) saveDismissed(sessionId, [...kept, own]);
    setHere((now) => [...now, `${sessionId}/${own}`]);
  }, [sessionId, card?.taskId, card?.revision]);
  const hidden =
    key !== null &&
    card !== null &&
    (here.includes(key) ||
      stored.includes(dismissalKey(card.taskId, card.revision)));
  return {
    missing: card?.missingContext && !hidden ? card.missingContext : null,
    dismiss,
  };
}
