const fullTimestamp = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

export function formatTimestamp(value: string): string {
  return fullTimestamp.format(new Date(value));
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const shortDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// "just now", "5 minutes ago", "yesterday"; older than a week shows the date.
export function formatRelativeTime(value: string, now = Date.now()): string {
  const elapsed = now - new Date(value).getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR)
    return relative.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY)
    return relative.format(-Math.floor(elapsed / HOUR), "hour");
  if (elapsed < 7 * DAY)
    return relative.format(-Math.floor(elapsed / DAY), "day");
  return shortDate.format(new Date(value));
}
