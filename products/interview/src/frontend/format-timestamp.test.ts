import { describe, expect, it } from "vitest";
import { formatRelativeTime, formatTimestamp } from "./format-timestamp";

describe("formatTimestamp", () => {
  it("includes date, time through seconds, and a timezone", () => {
    const formatted = formatTimestamp("2026-07-28T07:38:58.485Z");

    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(formatted).toMatch(/[A-Z]{2,5}|GMT[+-]\d+/);
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-10-01T20:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it("reads naturally for recent work and falls back to a date", () => {
    expect(formatRelativeTime(ago(20_000), now)).toBe("just now");
    expect(formatRelativeTime(ago(5 * 60_000), now)).toMatch(/5 minutes ago/);
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toMatch(/3 hours ago/);
    expect(formatRelativeTime(ago(26 * 3_600_000), now)).toMatch(/yesterday/);
    expect(formatRelativeTime(ago(30 * 86_400_000), now)).toMatch(/Sep|Aug|\d/);
  });
});
