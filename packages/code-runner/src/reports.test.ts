import { describe, expect, it } from "vitest";
import {
  parseDiagnostics,
  parseJunitReport,
  parseRspecReport,
  parseVitestReport,
  testSourceMap,
} from "./reports";

const strip = (source: string) =>
  source.replace(/<\?php\s*/gi, "").replace(/\?>\s*/g, "");

// Shapes taken from real runs of the runner images.
const vitest = JSON.stringify({
  testResults: [
    {
      assertionResults: [
        {
          ancestorTitles: ["add"],
          title: "adds",
          status: "passed",
          duration: 1.4,
          failureMessages: [],
          location: { line: 6, column: 3 },
        },
        {
          ancestorTitles: ["add", "edge cases"],
          title: "fails on purpose",
          status: "failed",
          duration: 2,
          failureMessages: [
            "AssertionError: expected 2 to be 3 // Object.is equality\n    at /workspace/solution.test.ts:13:23\n    at /runner/node_modules/x.js:1:1",
          ],
          location: { line: 12, column: 3 },
        },
        {
          ancestorTitles: ["add"],
          title: "skipped",
          status: "skipped",
          duration: null,
          failureMessages: [],
          location: null,
        },
      ],
    },
  ],
});

describe("test source map", () => {
  it("maps joined lines back to the solution and the tests", () => {
    const map = testSourceMap({
      language: "typescript",
      code: "a\nb\nc",
      testCode: "t1\nt2",
    });
    expect(map(2)).toEqual({ editor: "solution", line: 2 });
    expect(map(4)).toBeUndefined();
    expect(map(5)).toEqual({ editor: "tests", line: 1 });
    expect(map(6)).toEqual({ editor: "tests", line: 2 });
  });

  it("accounts for PHP's single opening tag", () => {
    const map = testSourceMap({
      language: "php",
      code: "<?php\n\nfunction add() {}\n",
      testCode: "<?php\n\nit('adds');\n",
      strip,
    });
    // File: 1 "<?php", 2 function, 3 "", 4 "", 5 it(...)
    expect(map(2)).toEqual({ editor: "solution", line: 3 });
    expect(map(5)).toEqual({ editor: "tests", line: 3 });
    expect(map(1)).toBeUndefined();
  });

  it("starts the tests at the top when there is no solution", () => {
    const map = testSourceMap({ language: "ruby", code: " ", testCode: "t" });
    expect(map(1)).toEqual({ editor: "tests", line: 1 });
  });
});

describe("report parsers", () => {
  const map = testSourceMap({
    language: "typescript",
    code: "x\ny\nz",
    testCode: "...",
  });

  it("reads Vitest JSON, preferring the failing line", () => {
    expect(parseVitestReport(vitest, "solution.test.ts", map)).toEqual([
      {
        name: "adds",
        status: "passed",
        durationMs: 1,
        location: { editor: "tests", line: 2 },
      },
      {
        name: "edge cases › fails on purpose",
        status: "failed",
        durationMs: 2,
        message: "AssertionError: expected 2 to be 3 // Object.is equality",
        location: { editor: "tests", line: 9 },
      },
      { name: "skipped", status: "skipped" },
    ]);
    expect(parseVitestReport("{}", "solution.test.ts", map)).toEqual([]);
  });

  it("reads RSpec JSON", () => {
    const report = JSON.stringify({
      examples: [
        {
          description: "adds",
          status: "passed",
          line_number: 6,
          run_time: 0.0004,
        },
        {
          description: "fails",
          status: "failed",
          line_number: 9,
          run_time: 0.002,
          exception: {
            class: "RSpec::Expectations::ExpectationNotMetError",
            message: "expected: 3\n     got: 2",
            backtrace: ["/workspace/solution_spec.rb:10:in 'block'"],
          },
        },
        { description: "later", status: "pending" },
      ],
    });
    expect(parseRspecReport(report, "solution_spec.rb", map)).toEqual([
      {
        name: "adds",
        status: "passed",
        durationMs: 0,
        location: { editor: "tests", line: 2 },
      },
      {
        name: "fails",
        status: "failed",
        durationMs: 2,
        message:
          "RSpec::Expectations::ExpectationNotMetError: expected: 3\n     got: 2",
        location: { editor: "tests", line: 6 },
      },
      { name: "later", status: "skipped" },
    ]);
  });

  it("reads Pest's JUnit log and drops the repeated test name", () => {
    const xml = `<?xml version="1.0"?>
<testsuites><testsuite name="SolutionTest">
  <testcase name="it adds" file="/workspace/SolutionTest.php" time="0.002"/>
  <testcase name="it fails &amp; reports" time="0.003"><failure type="Failed">it fails &amp; reportsFailed asserting that 2 is identical to 3.
at /workspace/SolutionTest.php:9</failure></testcase>
  <testcase name="it waits" line="12"><skipped/></testcase>
  <testcase name="it errors" time="x"><error>Error: &#x41;&#66; boom &unknown;</error></testcase>
</testsuite></testsuites>`;
    expect(parseJunitReport(xml, "SolutionTest.php", map)).toEqual([
      { name: "it adds", status: "passed", durationMs: 2 },
      {
        name: "it fails & reports",
        status: "failed",
        durationMs: 3,
        message: "Failed asserting that 2 is identical to 3.",
        location: { editor: "tests", line: 5 },
      },
      {
        name: "it waits",
        status: "skipped",
        location: { editor: "tests", line: 8 },
      },
      {
        name: "it errors",
        status: "failed",
        message: "Error: AB boom &unknown;",
      },
    ]);
  });
});

describe("syntax diagnostics", () => {
  it("places TypeScript problems by line and column", () => {
    expect(
      parseDiagnostics(
        "typescript",
        "1:11: Expression expected.\nnoise\n",
        "x",
      ),
    ).toEqual([{ line: 1, column: 11, message: "Expression expected." }]);
    expect(parseDiagnostics("react", "2:3: ')' expected.", "x")).toHaveLength(
      1,
    );
  });

  it("places PHP problems in the person's source", () => {
    const output =
      'PHP Parse error: syntax error, unexpected token ";" in /workspace/solution.php on line 2\nErrors parsing /workspace/solution.php';
    expect(parseDiagnostics("php", output, "<?php\n\n$a = ;\n")).toEqual([
      { line: 3, message: 'Parse error: syntax error, unexpected token ";"' },
    ]);
    expect(parseDiagnostics("php", output, "$a = ;")).toEqual([
      { line: 1, message: 'Parse error: syntax error, unexpected token ";"' },
    ]);
  });

  it("uses Ruby's caret detail when it gives one", () => {
    const output =
      "ruby: /workspace/solution.rb:2: syntax errors found (SyntaxError)\n  1 | def x\n> 2 |   1 +\n    |      ^ expected an `end` to close the `def` statement\n";
    expect(parseDiagnostics("ruby", output, "")).toEqual([
      { line: 2, message: "expected an `end` to close the `def` statement" },
    ]);
    expect(parseDiagnostics("ruby", "solution.rb:4: syntax error", "")).toEqual(
      [{ line: 4, message: "syntax error" }],
    );
  });
});
