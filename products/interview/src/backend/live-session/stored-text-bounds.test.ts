// Two small read/write safeguards, no database: a stored display that is a
// malformed string reads as no display (never a throw), and a bounded runner
// text never ends in half a surrogate pair.
import { describe, expect, it } from "vitest";
import { boundedText } from "./coding-path";
import { storedDisplay } from "./session-reads";

describe("storedDisplay", () => {
  it("reads a malformed stored string as no display", () => {
    expect(storedDisplay("{not json")).toBeNull();
    expect(storedDisplay("")).toBeNull();
    expect(storedDisplay(42)).toBeNull();
  });
});

describe("boundedText", () => {
  it("never splits a surrogate pair and stays within the bound", () => {
    const text = "😀".repeat(50);
    const bounded = boundedText(text, 11);
    expect(bounded.length).toBeLessThanOrEqual(11);
    expect(bounded.endsWith("…")).toBe(true);
    expect(bounded).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(bounded).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/);
  });

  it("leaves a short text and collapses whitespace", () => {
    expect(boundedText("  a \n b  ", 10)).toBe("a b");
  });
});
