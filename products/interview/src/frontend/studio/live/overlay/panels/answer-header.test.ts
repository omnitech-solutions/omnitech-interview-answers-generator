import { describe, expect, it } from "vitest";
import { complexityChips, lastCaptureMeta } from "./answer-header";

const draft = (createdAt: string, noQuestion?: true) => ({
  actionKind: "draft-answer",
  createdAt,
  ...(noQuestion ? { noQuestion } : {}),
});

describe("lastCaptureMeta", () => {
  it("names the newest capture when it found no question", () => {
    const meta = lastCaptureMeta([
      draft("2026-10-05T10:00:00.000Z"),
      draft("2026-10-05T10:05:00.000Z", true),
    ]);
    expect(meta?.full).toMatch(/^Last capture \d.* · no question found$/);
    expect(meta?.full.startsWith(`${meta?.lead} · `)).toBe(true);
  });
  it("is null when the newest capture had a question or there is none", () => {
    expect(lastCaptureMeta([])).toBeNull();
    expect(
      lastCaptureMeta([
        draft("2026-10-05T10:00:00.000Z", true),
        draft("2026-10-05T10:05:00.000Z"),
      ]),
    ).toBeNull();
  });
});

describe("complexityChips", () => {
  it("reads time and space bounds from one or two lines", () => {
    expect(complexityChips(["Time O(n), space O(n)."])).toEqual([
      "O(n) time",
      "O(n) space",
    ]);
    expect(complexityChips(["Time: O(n log n)", "Space: O(1)"])).toEqual([
      "O(n log n) time",
      "O(1) space",
    ]);
  });
  it("reads an unnamed bound as time and invents nothing", () => {
    expect(complexityChips(["Linear, O(n)"])).toEqual(["O(n) time"]);
    expect(complexityChips(["It is fast."])).toEqual([]);
  });
});
