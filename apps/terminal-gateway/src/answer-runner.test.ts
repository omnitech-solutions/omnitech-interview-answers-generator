import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildAnswerPrompt,
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
function twoSum(values: number[], target: number): number[] { return []; }`,
  usageCode: "console.log(twoSum([], 1));",
  testCode:
    'import { expect, it } from "vitest"; it("works", () => expect(twoSum([], 1)).toEqual([]));',
  notes: "Track complements.",
};

describe("answer runner", () => {
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
    ).toThrow("incomplete coding answer");
  });

  it("rejects invalid JSON shapes and missing solution headers", () => {
    const outputs = [
      "null",
      JSON.stringify({ ...answer, code: "function twoSum() {}" }),
    ];
    const spawnSync = vi.fn((_command: string, args: string[]) => {
      const outputPath = args.at(args.indexOf("--output-last-message") + 1);
      writeFileSync(outputPath!, outputs.shift()!);
      return { status: 0, stderr: "", stdout: "" };
    });

    expect(() =>
      runCodexAnswer("Find two values", { spawnSync: spawnSync as never }),
    ).toThrow("invalid coding answer");
    expect(() =>
      runCodexAnswer("Find two values", { spawnSync: spawnSync as never }),
    ).toThrow("required solution comment header");
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
          code: "# PROBLEM: Add.\n# STRATEGY: Add.\n# COMPLEXITY: O(1).\ndef add(a, b) = a + b",
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
    ).toThrow("not genuine RSpec examples");
  });

  it("accepts genuine RSpec tests", () => {
    const rubyAnswer = {
      ...answer,
      language: "ruby" as const,
      code: "# PROBLEM: Add.\n# STRATEGY: Add.\n# COMPLEXITY: O(1).\ndef add(a, b) = a + b",
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
