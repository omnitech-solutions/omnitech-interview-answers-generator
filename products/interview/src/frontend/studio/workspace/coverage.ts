import type { AnswerGuide, TestResult } from "@omnitech/interview-contracts";

export type CoverageState =
  | "passing"
  | "failing"
  | "not-run"
  | "no-test"
  // A test is named, but the last run had no test by that title.
  | "not-found";
export type EdgeCoverage = {
  name: string;
  test?: string | undefined;
  state: CoverageState;
  result?: TestResult | undefined;
};

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// A test report names tests by their title, sometimes with their describe
// path ("suite › title"); PHP's Pest prefixes "it ". Match on the title.
function findTest(test: string, results: readonly TestResult[]) {
  const wanted = normalise(test);
  return results.find((result) => {
    const name = normalise(result.name);
    return name === wanted || name.endsWith(` ${wanted}`);
  });
}

// Which edge cases a named test covers, and how that test last ran.
export function edgeCoverage(
  guide: AnswerGuide,
  results: readonly TestResult[] | undefined,
): EdgeCoverage[] {
  return guide.edgeCases.map((edge) => {
    if (!edge.test) return { name: edge.name, state: "no-test" };
    const result = results ? findTest(edge.test, results) : undefined;
    return {
      name: edge.name,
      test: edge.test,
      result,
      state: !result
        ? results
          ? "not-found"
          : "not-run"
        : result.status === "passed"
          ? "passing"
          : result.status === "failed"
            ? "failing"
            : "not-run",
    };
  });
}
