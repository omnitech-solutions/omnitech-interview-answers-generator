import { describe, expect, it } from "vitest";
import { AT_END_PX, isAtEnd } from "./follow-latest";

describe("following the latest line", () => {
  const box = (scrollTop: number) => ({
    scrollHeight: 1000,
    clientHeight: 400,
    scrollTop,
  });

  it("is at the end at the bottom and within a few px of it", () => {
    expect(isAtEnd(box(600))).toBe(true);
    expect(isAtEnd(box(600 - AT_END_PX))).toBe(true);
  });

  it("is not at the end once the person has scrolled up", () => {
    expect(isAtEnd(box(600 - AT_END_PX - 1))).toBe(false);
    expect(isAtEnd(box(0))).toBe(false);
  });
});
