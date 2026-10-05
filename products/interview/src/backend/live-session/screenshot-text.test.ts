// The two pure helpers for text read from a screenshot on the device.
import { describe, expect, it } from "vitest";
import { normalizeOcrText, ocrLooksCutOff } from "./screenshot-text";

describe("normalizeOcrText", () => {
  it.each([
    ["a  b\t c", "a b c"],
    [
      "line one  \r\nline two\r\n\r\n\r\n\r\nline three",
      "line one\nline two\n\nline three",
    ],
    ["  padded  ", "padded"],
    ["bell\u0007 and zero​width", "bell and zerowidth"],
    ["   \n \n ", ""],
  ])("normalises %j", (raw, expected) => {
    expect(normalizeOcrText(raw)).toBe(expected);
  });
});

describe("ocrLooksCutOff", () => {
  it.each([
    ["Given an array of integers, return the sum of the", true],
    ["Constraints:\n1 <= n <= 10^5\nfoo(", true],
    ["Example 1: input = [1, 2, 3", true],
    ['He said "stop', true],
    ["Return the sum of the array.", false],
    ["What is the complexity?", false],
    ["Input: nums = [1,2,3]\nOutput: 6", false],
    ["Example:\n1) first item\n2) second item.", false],
    ["Return the result (an integer) when done.", false],
    ["Function signature: sum(nums: number[]): number;", false],
    ["", false],
    ["   \n  ", false],
    ["ends with a number 42", false],
  ])("%j -> %s", (text, expected) => {
    expect(ocrLooksCutOff(text)).toBe(expected);
  });
});
