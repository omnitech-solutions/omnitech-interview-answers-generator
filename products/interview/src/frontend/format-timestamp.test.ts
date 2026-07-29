import { describe, expect, it } from "vitest";
import { formatTimestamp } from "./format-timestamp";

describe("formatTimestamp", () => {
  it("includes date, time through seconds, and a timezone", () => {
    const formatted = formatTimestamp("2026-07-28T07:38:58.485Z");

    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(formatted).toMatch(/[A-Z]{2,5}|GMT[+-]\d+/);
  });
});
