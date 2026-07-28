import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildAnswerPrompt,
  formatAnswerFailure,
  normalizeSolutionHeader,
  publishAnswer,
  runCodexAnswer,
} from "./answer-runner.js";

const answer = {
  title: "Two Sum",
  language: "typescript" as const,
  answerMarkdown:
    "## Question\n- Find a pair.\n## Approach\n- Map.\n## Complexity\n- O(n).\n## Edge cases\n- None.\n## Talking points\n- Invariant.",
  code: `// PROBLEM: Find two values.
// STRATEGY: Track complements.
// COMPLEXITY: O(n) time and O(n) space.
function twoSum(values: number[], target: number): number[] {
  // [STRATEGY] Keep the result contract explicit when no pair exists.
  return [];
}`,
  usageCode: "console.log(twoSum([], 1));",
  testCode:
    'import { expect, it } from "vitest"; it("works", () => expect(twoSum([], 1)).toEqual([]));',
  notes: "Track complements.",
};

describe("answer runner", () => {
  it("formats failures with a stable terminal marker", () => {
    expect(formatAnswerFailure(new Error("RSpec failed"))).toContain(
      "[ANSWER_FAILED]\r\nStage: answer generation or publication\r\nType: Error\r\nDetails: RSpec failed",
    );
    expect(formatAnswerFailure(new Error("RSpec failed"))).toContain(
      "existing Playground answer was preserved",
    );
    expect(formatAnswerFailure("Provider unavailable")).toContain(
      "Type: string\r\nDetails: Provider unavailable",
    );
  });

  it("uses one isolated, schema-constrained Codex call", () => {
    const spawnSync = vi.fn(
      (_command: string, args: string[], _options: unknown) => {
        const outputPath = args.at(args.indexOf("--output-last-message") + 1);
        writeFileSync(outputPath!, JSON.stringify(answer));
        return { status: 0, stderr: "", stdout: "" };
      },
    );

    expect(
      runCodexAnswer("Find two values", { spawnSync: spawnSync as never }),
    ).toEqual(answer);
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "exec",
        "--ephemeral",
        "--ignore-rules",
        "--output-schema",
        "--output-last-message",
      ]),
      expect.objectContaining({
        input: expect.stringContaining("Find two values"),
      }),
    );
    expect(buildAnswerPrompt("Add values")).toContain(
      "Do not inspect files, run commands, use",
    );
    expect(
      buildAnswerPrompt("Add values", {
        currentAnswer: answer,
        refinement: "Support decimals",
      }),
    ).toContain("Return a complete replacement answer");
  });

  it("rejects incomplete output before publishing", () => {
    const spawnSync = vi.fn((_command: string, args: string[]) => {
      const outputPath = args.at(args.indexOf("--output-last-message") + 1);
      writeFileSync(outputPath!, JSON.stringify({ ...answer, testCode: "" }));
      return { status: 0, stderr: "", stdout: "" };
    });

    expect(() =>
      runCodexAnswer("Find two values", { spawnSync: spawnSync as never }),
    ).toThrow(
      "Answer validation failed after 2 attempts: Codex returned an incomplete coding answer",
    );
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid JSON shapes after one focused retry", () => {
    const outputs = ["null", "null"];
    const spawnSync = vi.fn(
      (_command: string, args: string[], _options: unknown) => {
        const outputPath = args.at(args.indexOf("--output-last-message") + 1);
        writeFileSync(outputPath!, outputs.shift()!);
        return { status: 0, stderr: "", stdout: "" };
      },
    );

    expect(() =>
      runCodexAnswer("Find two values", { spawnSync: spawnSync as never }),
    ).toThrow("Answer validation failed after 2 attempts");
    expect(spawnSync.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        input: expect.stringContaining(
          "CORRECTION: The previous response failed validation",
        ),
      }),
    );
  });

  it("repairs missing solution headers deterministically", () => {
    const spawnSync = vi.fn((_command: string, args: string[]) => {
      const outputPath = args.at(args.indexOf("--output-last-message") + 1);
      writeFileSync(
        outputPath!,
        JSON.stringify({
          ...answer,
          code: `function twoSum() {
  // [STRATEGY] Keep the empty result explicit.
  return [];
}`,
        }),
      );
      return { status: 0, stderr: "", stdout: "" };
    });

    const result = runCodexAnswer("Find two values", {
      spawnSync: spawnSync as never,
    });
    expect(result.code).toMatch(
      /^\/\/ PROBLEM:.*\n\/\/ STRATEGY:.*\n\/\/ COMPLEXITY:/,
    );
    expect(result.code).toContain("function twoSum()");
    expect(spawnSync).toHaveBeenCalledTimes(1);

    expect(
      normalizeSolutionHeader(
        "# PROBLEM: Keep this.\ndef solve = true",
        "ruby",
      ),
    ).toMatch(
      /^# PROBLEM:.*\n# STRATEGY:.*\n# COMPLEXITY:.*\ndef solve = true/,
    );
  });

  it("regenerates answers that omit comments inside the solution body", () => {
    let attempt = 0;
    const spawnSync = vi.fn(
      (_command: string, args: string[], _options: unknown) => {
        attempt += 1;
        const outputPath = args.at(args.indexOf("--output-last-message") + 1);
        writeFileSync(
          outputPath!,
          JSON.stringify(
            attempt === 1
              ? {
                  ...answer,
                  code: `// PROBLEM: Find two values.
// STRATEGY: Track complements.
// COMPLEXITY: O(n) time and O(n) space.
function twoSum(): number[] { return []; }`,
                }
              : answer,
          ),
        );
        return { status: 0, stderr: "", stdout: "" };
      },
    );

    expect(
      runCodexAnswer("Find two values", {
        spawnSync: spawnSync as never,
      }),
    ).toEqual(answer);
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(spawnSync.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        input: expect.stringContaining(
          "omitted labeled comments inside the solution body",
        ),
      }),
    );
    expect(buildAnswerPrompt("Find two values")).toContain(
      "INSIDE function/component bodies",
    );
  });

  it("requires original example inputs in an entry-point body trace", () => {
    const tracedAnswer = {
      ...answer,
      code: `// PROBLEM: Find two values.
// STRATEGY: Track complements.
// COMPLEXITY: O(n) time and O(n) space.
function twoSum(values: number[], target: number): number[] {
  // [TRACE] Input: values = [2, 7], target = 9.
  // [STRATEGY] Keep the result contract explicit when no pair exists.
  return [];
}`,
    };
    let attempt = 0;
    const spawnSync = vi.fn(
      (_command: string, args: string[], _options: unknown) => {
        attempt += 1;
        const outputPath = args.at(args.indexOf("--output-last-message") + 1);
        writeFileSync(
          outputPath!,
          JSON.stringify(attempt === 1 ? answer : tracedAnswer),
        );
        return { status: 0, stderr: "", stdout: "" };
      },
    );

    expect(
      runCodexAnswer("Example: values = [2, 7], target = 9", {
        spawnSync: spawnSync as never,
      }),
    ).toEqual(tracedAnswer);
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(spawnSync.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        input: expect.stringContaining(
          "omitted the original example inputs from the entry-point body",
        ),
      }),
    );
  });

  it("surfaces Codex process failures", () => {
    expect(() =>
      runCodexAnswer("Find two values", {
        spawnSync: (() => ({
          error: new Error("codex unavailable"),
          status: null,
        })) as never,
      }),
    ).toThrow("codex unavailable");

    expect(() =>
      runCodexAnswer("Find two values", {
        spawnSync: (() => ({
          status: 7,
          stderr: "provider failed",
        })) as never,
      }),
    ).toThrow("provider failed");

    expect(() =>
      runCodexAnswer("Find two values", {
        spawnSync: (() => ({ status: 9, stderr: "" })) as never,
      }),
    ).toThrow("Codex exited with status 9");
  });

  it("rejects top-level custom Ruby assertions", () => {
    const spawnSync = vi.fn((_command: string, args: string[]) => {
      const outputPath = args.at(args.indexOf("--output-last-message") + 1);
      writeFileSync(
        outputPath!,
        JSON.stringify({
          ...answer,
          language: "ruby",
          code: `# PROBLEM: Add.
# STRATEGY: Add.
# COMPLEXITY: O(1).
def add(a, b)
  # [STRATEGY] Addition directly satisfies the numeric contract.
  a + b
end`,
          testCode:
            "def assert_equal(expected, actual); raise unless expected == actual; end\nassert_equal(3, add(1, 2))",
        }),
      );
      return { status: 0, stderr: "", stdout: "" };
    });

    expect(() =>
      runCodexAnswer("Add values in Ruby", {
        spawnSync: spawnSync as never,
      }),
    ).toThrow("Answer validation failed after 2 attempts");
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it("accepts genuine RSpec tests", () => {
    const rubyAnswer = {
      ...answer,
      language: "ruby" as const,
      code: `# PROBLEM: Add.
# STRATEGY: Add.
# COMPLEXITY: O(1).
def add(a, b)
  # [STRATEGY] Addition directly satisfies the numeric contract.
  a + b
end`,
      testCode:
        'RSpec.describe "add" do\n  it("adds") { expect(add(1, 2)).to eq(3) }\nend',
    };
    const spawnSync = vi.fn((_command: string, args: string[]) => {
      const outputPath = args.at(args.indexOf("--output-last-message") + 1);
      writeFileSync(outputPath!, JSON.stringify(rubyAnswer));
      return { status: 0, stderr: "", stdout: "" };
    });

    expect(
      runCodexAnswer("Add values in Ruby", {
        spawnSync: spawnSync as never,
      }),
    ).toEqual(rubyAnswer);
  });

  it("requires genuine Pest tests for PHP answers", () => {
    const invalidPhp = {
      ...answer,
      language: "php" as const,
      code: `// PROBLEM: Add.
// STRATEGY: Add.
// COMPLEXITY: O(1).
function add(int $a, int $b): int {
    // [STRATEGY] Addition directly satisfies the numeric contract.
    return $a + $b;
}`,
      testCode:
        "if (add(1, 2) !== 3) { throw new RuntimeException('failed'); }\nprint 'All tests passed';",
    };
    const validPhp = {
      ...invalidPhp,
      testCode:
        "test('adds values', function () { expect(add(1, 2))->toBe(3); });",
    };
    let attempt = 0;
    const spawnSync = vi.fn(
      (_command: string, args: string[], _options: unknown) => {
        attempt += 1;
        const outputPath = args.at(args.indexOf("--output-last-message") + 1);
        writeFileSync(
          outputPath!,
          JSON.stringify(attempt === 1 ? invalidPhp : validPhp),
        );
        return { status: 0, stderr: "", stdout: "" };
      },
    );

    expect(
      runCodexAnswer("Add values in PHP", {
        spawnSync: spawnSync as never,
      }),
    ).toEqual(validPhp);
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(spawnSync.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        input: expect.stringContaining("not genuine Pest tests"),
      }),
    );
    expect(buildAnswerPrompt("Add values in PHP")).toContain(
      "PHP: genuine Pest",
    );
  });

  it("publishes all answer fields in one Playground patch", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );

    await publishAnswer("Find two values", answer, { fetch });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/v1/playground-control",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          view: "playground",
          question: "Find two values",
          language: "typescript",
          answer: {
            title: answer.title,
            language: answer.language,
            answerMarkdown: answer.answerMarkdown,
            code: answer.code,
            usageCode: answer.usageCode,
            testCode: answer.testCode,
          },
          notes: answer.notes,
          panel: "output",
        }),
      }),
    );
  });

  it("supports an explicit endpoint and reports update failures", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response("unavailable", { status: 503 })),
    );

    await expect(
      publishAnswer("Find two values", answer, {
        fetch,
        url: "http://example.test/control",
      }),
    ).rejects.toThrow("HTTP 503");
    expect(fetch).toHaveBeenCalledWith(
      "http://example.test/control",
      expect.any(Object),
    );
  });
});
