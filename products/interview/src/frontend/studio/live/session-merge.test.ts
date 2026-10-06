// mergeActions: the newest updatedAt wins, and a tie never moves an action
// back to in_flight (the only non-final status), whichever copy arrives last.
import { describe, expect, it } from "vitest";
import { mergeActions } from "./session-merge";
import { action } from "./testing/session-fixtures";

describe("mergeActions ties", () => {
  const same = "2026-01-01T00:00:05.000Z";
  const running = action({ dispatchStatus: "in_flight", updatedAt: same });
  const done = { ...running, dispatchStatus: "succeeded" as const };

  it("keeps the final copy when the in-flight copy arrives later with the same updatedAt", () => {
    const merged = mergeActions([done], [running]);
    expect(merged.map((item) => item.dispatchStatus)).toEqual(["succeeded"]);
  });

  it("takes the final copy when it arrives after an in-flight copy with the same updatedAt", () => {
    const merged = mergeActions([running], [done]);
    expect(merged.map((item) => item.dispatchStatus)).toEqual(["succeeded"]);
  });

  it("takes a strictly newer copy, and never an older in-flight copy over a final one", () => {
    const newer = { ...done, updatedAt: "2026-01-01T00:00:06.000Z" };
    expect(mergeActions([running], [newer])[0]?.updatedAt).toBe(
      newer.updatedAt,
    );
    const older = { ...running, updatedAt: "2026-01-01T00:00:04.000Z" };
    expect(mergeActions([done], [older])[0]?.dispatchStatus).toBe("succeeded");
  });

  it("is order independent for equal copies", () => {
    expect(mergeActions([done], [{ ...done }])).toEqual([done]);
  });
});
