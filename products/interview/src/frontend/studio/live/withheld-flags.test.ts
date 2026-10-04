import { describe, expect, it } from "vitest";
import { parseWithheldCodes } from "./session-results";
import { flaggedBecause } from "./session-runs";

describe("withheld flags in plain words", () => {
  it("says what was flagged from the bounded code only", () => {
    expect(flaggedBecause(["ungrounded_figure"])).toBe(
      " Flagged: a number in the draft isn't in your experience (ungrounded_figure).",
    );
  });
  it("adds nothing for an unknown code or no code", () => {
    expect(flaggedBecause([])).toBe("");
    expect(flaggedBecause(["something_new"])).toBe("");
  });
  it("reads only short snake_case codes from the result", () => {
    expect(
      parseWithheldCodes({
        withheld: {
          rejectedClaimCount: 0,
          codes: ["ungrounded_figure", "Has Spaces and content 12", 4],
        },
      }),
    ).toEqual(["ungrounded_figure"]);
    expect(parseWithheldCodes(null)).toEqual([]);
  });
});
