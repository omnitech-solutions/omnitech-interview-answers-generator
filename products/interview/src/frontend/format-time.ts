// Keep the existing relative-time policy as the one implementation.
export { formatRelativeTime, formatTimestamp } from "./format-timestamp";

// A duration in seconds, not a timestamp in milliseconds. Match Rehearsal's
// rounding and clamp so a countdown cannot display a negative remainder.
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
