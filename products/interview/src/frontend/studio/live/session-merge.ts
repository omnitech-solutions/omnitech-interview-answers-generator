// Pure merging of stream pages into what the browser already holds, and the
// server-clock helpers. No timers, no storage, no React.
import type {
  LiveAction,
  LiveObservation,
  LiveSessionView,
} from "@omnitech/interview-contracts";

const timeOf = (iso: string): number => {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
};

// Actions arrive created OR changed, with a short overlap, so one id can come
// in many times: the newest updatedAt wins, and an older copy that arrives
// late never replaces a newer one. Order is creation order, so a task's runs
// read oldest first.
export function mergeActions(
  held: readonly LiveAction[],
  incoming: readonly LiveAction[],
): LiveAction[] {
  if (incoming.length === 0) return [...held];
  const byId = new Map(held.map((item) => [item.id, item]));
  for (const next of incoming) {
    const previous = byId.get(next.id);
    if (!previous || timeOf(next.updatedAt) >= timeOf(previous.updatedAt))
      byId.set(next.id, next);
  }
  return [...byId.values()].sort(
    (a, b) =>
      timeOf(a.createdAt) - timeOf(b.createdAt) || a.id.localeCompare(b.id),
  );
}

// Observations are append-only and ordered by sequence; a re-read page never
// duplicates a row.
export function mergeObservations(
  held: readonly LiveObservation[],
  incoming: readonly LiveObservation[],
): LiveObservation[] {
  if (incoming.length === 0) return [...held];
  const bySequence = new Map(held.map((item) => [item.sequence, item]));
  for (const next of incoming) bySequence.set(next.sequence, next);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

// Server clock offset: serverNow minus the browser clock when a page was read.
export function serverClockOffset(
  serverNow: string,
  browserNowMs: number,
): number {
  return timeOf(serverNow) - browserNowMs;
}

// The server's current time as best the browser knows it.
export function estimateServerNow(
  offsetMs: number,
  browserNowMs: number,
): number {
  return browserNowMs + offsetMs;
}

// Elapsed time of a session: server time minus a SERVER timestamp, never the
// browser clock alone. It is wall time since the session was created, up to
// its end; pauses are not subtracted because the session record does not keep
// them. Never negative.
export function elapsedMs(
  session: Pick<LiveSessionView, "createdAt" | "endedAt">,
  offsetMs: number,
  browserNowMs: number,
): number {
  const end = session.endedAt
    ? timeOf(session.endedAt)
    : estimateServerNow(offsetMs, browserNowMs);
  return Math.max(0, end - timeOf(session.createdAt));
}

// "m:ss" or "h:mm:ss".
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${two(minutes)}:${two(seconds)}`
    : `${minutes}:${two(seconds)}`;
}
