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
