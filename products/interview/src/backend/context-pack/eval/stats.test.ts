import { describe, expect, it } from "vitest";
import {
  bootstrap,
  holm,
  mcnemar,
  ndcg,
  paired,
  percentile,
  wilson,
  withInterval,
} from "./stats";

describe("the evaluation's arithmetic", () => {
  it("gives the Wilson interval the audit quotes for the fixture's scores", () => {
    // evaluation-standards-and-audit.md, section 2.2.
    const of = (right: number, total: number) => {
      const { low, high } = wilson({ right, of: total });
      return [Math.round(low * 100), Math.round(high * 100)];
    };
    expect(of(16, 28)).toEqual([39, 73]);
    expect(of(24, 28)).toEqual([69, 94]);
    expect(of(2, 2)).toEqual([34, 100]);
    expect(wilson({ right: 0, of: 0 })).toEqual({ low: 0, high: 1 });
  });

  it("gives McNemar's exact p for a paired difference", () => {
    // Nine gained and none lost; ten gained and one lost (audit, 2.2).
    expect(mcnemar(9, 0)).toBeCloseTo(0.0039, 3);
    expect(mcnemar(10, 1)).toBeCloseTo(0.0117, 3);
    // One question changed proves nothing; none changed is no difference.
    expect(mcnemar(1, 0)).toBe(1);
    expect(mcnemar(0, 0)).toBe(1);
    expect(mcnemar(3, 3)).toBe(1);
  });

  it("names the questions gained and lost between two arms", () => {
    const before = new Map([
      ["a", true],
      ["b", false],
      ["c", false],
      ["d", true],
    ]);
    const after = new Map([
      ["a", true],
      ["b", true],
      ["c", true],
      ["d", false],
    ]);
    expect(paired(before, after)).toMatchObject({
      gained: ["b", "c"],
      lost: ["d"],
    });
  });

  it("scores a graded order against the best order the gold allows", () => {
    expect(ndcg([2, 1], [2, 1])).toBe(1);
    expect(ndcg([1, 2], [2, 1])).toBeLessThan(1);
    expect(ndcg([0, 0], [2, 1])).toBe(0);
    expect(ndcg([], [])).toBe(0);
  });

  it("gives the same bootstrap interval run after run, around the mean", () => {
    const values = [1, 1, 0.5, 0, 1, 0.33, 1, 0];
    const first = bootstrap(values);
    expect(bootstrap(values)).toEqual(first);
    expect(first.low).toBeLessThan(0.6);
    expect(first.high).toBeGreaterThan(0.6);
    expect(bootstrap([])).toEqual({ low: 0, high: 0 });
  });

  it("corrects several comparisons, and reads a percentile", () => {
    expect(holm([0.01, 0.04, 0.03])).toEqual([0.03, 0.06, 0.06]);
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
    expect(percentile([], 0.5)).toBe(0);
    expect(withInterval({ right: 24, of: 28 })).toBe(
      "24 of 28 (86%, 69 to 94)",
    );
    expect(withInterval({ right: 0, of: 0 })).toBe("0 of 0");
  });
});
