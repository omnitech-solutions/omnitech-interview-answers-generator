import { describe, expect, it } from "vitest";
import { problemNameIn } from "./task-name";

describe("a problem name the answer gives", () => {
  it("takes a quoted name", () => {
    expect(
      problemNameIn('This is LeetCode 2, "Add Two Numbers": two lists'),
    ).toBe("Add Two Numbers");
    expect(problemNameIn("This is “Two Sum” again")).toBe("Two Sum");
  });

  it("takes the name after a LeetCode number", () => {
    expect(
      problemNameIn("This is LeetCode 37, Sudoku Solver: fill a 9x9 board"),
    ).toBe("Sudoku Solver");
    expect(
      problemNameIn(
        "This is LeetCode 32, Longest Valid Parentheses: given a string",
      ),
    ).toBe("Longest Valid Parentheses");
  });

  it("ignores text that is not a name", () => {
    expect(problemNameIn("no name here")).toBeNull();
    expect(problemNameIn('He said "do it now." and left')).toBeNull();
    expect(problemNameIn('a "x" b')).toBeNull();
  });
});
