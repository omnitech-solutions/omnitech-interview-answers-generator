import { describe, expect, it } from "vitest";
import { edgeCoverage } from "./coverage";

const guide = {
  version: 1 as const,
  understand: { prompt: "p", examples: [], constraints: [], clarify: [] },
  plan: { steps: ["s"], complexity: { time: "O(1)", space: "O(1)" } },
  edgeCases: [
    { name: "Empty", test: "returns null for empty array" },
    { name: "Negative", test: "handles negatives" },
    { name: "Renamed", test: "a test that was renamed" },
    { name: "Untested" },
    { name: "Skipped", test: "later" },
  ],
  explain: [{ heading: "h", body: "b" }],
  talkingPoints: ["a", "b", "c"],
};

describe("edge case coverage", () => {
  it("waits for a run before judging", () => {
    expect(edgeCoverage(guide, undefined).map((edge) => edge.state)).toEqual([
      "not-run",
      "not-run",
      "not-run",
      "no-test",
      "not-run",
    ]);
  });

  it("matches tests by title, including describe paths and Pest's 'it'", () => {
    const results = [
      {
        name: "twoSum › returns null for empty array",
        status: "passed" as const,
      },
      { name: "it handles negatives", status: "failed" as const },
      { name: "later", status: "skipped" as const },
    ];
    expect(edgeCoverage(guide, results).map((edge) => edge.state)).toEqual([
      "passing",
      "failing",
      "not-found",
      "no-test",
      "not-run",
    ]);
  });
});
