import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatRelativeTime,
  formatTimestamp,
} from "./format-time";
import {
  formatRelativeTime as existingRelative,
  formatTimestamp as existingTimestamp,
} from "./format-timestamp";

describe("shared time formatters", () => {
  it.each([
    [0, "0:00"],
    [7, "0:07"],
    [60, "1:00"],
    [187, "3:07"],
    [3600, "60:00"],
    [-10, "0:00"],
    [59.5, "1:00"],
    [NaN, ""],
    [Infinity, ""],
  ])("formats duration %s as %s", (seconds, expected) => {
    expect(formatClock(seconds as number)).toBe(expected);
  });
  it("reuses the existing relative and absolute timestamp policies", () => {
    expect(formatRelativeTime).toBe(existingRelative);
    expect(formatTimestamp).toBe(existingTimestamp);
    const now = Date.parse("2026-10-10T12:00:00Z");
    expect(formatRelativeTime(new Date(now - 20_000).toISOString(), now)).toBe(
      "just now",
    );
    expect(
      formatRelativeTime(new Date(now - 300_000).toISOString(), now),
    ).toMatch(/5 minutes ago/);
  });
});
