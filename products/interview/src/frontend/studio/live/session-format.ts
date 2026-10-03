// Small labels the live view shares. Pure.

// How long ago, by the minute: a label that changed every second would be read
// out again and again by a screen reader (the banners are live regions).
export function ageLabel(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// "3:07": how far into the session a line arrived, from the server's own
// timestamps, so the same line reads the same on every clock and in every zone.
export function clockLabel(receivedAt: string, sessionStart: string): string {
  const at = Date.parse(receivedAt);
  const start = Date.parse(sessionStart);
  if (Number.isNaN(at) || Number.isNaN(start)) return "";
  const seconds = Math.max(0, Math.floor((at - start) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

// Server time as ms, or null when the timestamp is missing or unreadable.
export function sinceMs(
  iso: string | null | undefined,
  serverNowMs: number,
): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : Math.max(0, serverNowMs - at);
}
