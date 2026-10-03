import { describe, expect, it } from "vitest";
import { isoAt, systemClock } from "./clock.js";

describe("clock", () => {
  it("formats epoch milliseconds as an ISO timestamp", () => {
    expect(isoAt(Date.UTC(2026, 9, 3, 10, 0, 0))).toBe(
      "2026-10-03T10:00:00.000Z",
    );
  });

  it("the system clock reads real time and sleeps", async () => {
    const before = systemClock.now();
    await systemClock.sleep(1);
    expect(systemClock.now()).toBeGreaterThanOrEqual(before);
  });
});
