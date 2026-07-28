import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  appendConcept,
  buildConceptPrompt,
  normalizeCommentedExample,
  runCodexConcept,
} from "./concept-runner.js";

describe("concept runner", () => {
  it("uses a narrow prompt and an isolated Codex execution", () => {
    const markdown = `# Answer
\`\`\`tsx
// PROBLEM: Explain memoized rendering.
// STRATEGY: Show a stable primitive prop.
// COMPLEXITY: O(1) per comparison.
// [DOMAIN] Primitive props preserve value equality.
const Child = React.memo(({ count }: { count: number }) => <p>{count}</p>);
\`\`\``;
    const spawnSync = vi.fn(
      (_command: string, args: string[], _options: unknown) => {
        const outputPath = args.at(args.indexOf("--output-last-message") + 1);
        writeFileSync(
          outputPath!,
          JSON.stringify({ title: "React memo", markdown }),
        );
        return { status: 0, stderr: "", stdout: "" };
      },
    );

    expect(
      runCodexConcept("How does React.memo work?", {
        spawnSync: spawnSync as never,
      }),
    ).toEqual({ title: "React memo", markdown });

    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-rules",
        "--output-schema",
        "--output-last-message",
      ]),
      expect.objectContaining({
        input: expect.stringContaining("How does React.memo work?"),
      }),
    );
    expect(buildConceptPrompt("React")).toContain(
      "Do not inspect files, run commands, use",
    );
    expect(buildConceptPrompt("React")).toContain('"// PROBLEM:"');
    expect(buildConceptPrompt("React")).toContain('"// STRATEGY:"');
    expect(buildConceptPrompt("React")).toContain('"// COMPLEXITY:"');
    expect(spawnSync.mock.calls[0]?.[2]).not.toHaveProperty("timeout");
  });

  it("rejects an answer without the Playground comment contract", () => {
    const spawnSync = vi.fn((_command: string, args: string[]) => {
      const outputPath = args.at(args.indexOf("--output-last-message") + 1);
      writeFileSync(
        outputPath!,
        JSON.stringify({ title: "React memo", markdown: "# Answer" }),
      );
      return { status: 0, stderr: "", stdout: "" };
    });

    expect(() =>
      runCodexConcept("How does React.memo work?", {
        spawnSync: spawnSync as never,
      }),
    ).toThrow("required code example");
  });

  it("repairs missing Playground comments without discarding the answer", () => {
    const markdown = normalizeCommentedExample(
      "#### Example\n```tsx\nconst Child = React.memo(() => <p>Saved</p>);\n```",
    );

    expect(markdown).toContain("// PROBLEM:");
    expect(markdown).toContain("// STRATEGY:");
    expect(markdown).toContain("// COMPLEXITY:");
    expect(markdown).toContain("// [DOMAIN]");
    expect(markdown).toContain("const Child = React.memo(() => <p>Saved</p>);");
    expect(markdown.indexOf("// PROBLEM:")).toBeLessThan(
      markdown.indexOf("// [DOMAIN]"),
    );
  });

  it("uses Ruby comments and preserves existing headers", () => {
    const markdown = normalizeCommentedExample(
      "```ruby\n# PROBLEM: Explain memoization.\n# STRATEGY: Compare values.\n# COMPLEXITY: O(1).\n# [COMMENT] Identity matters.\nvalue = object_id\n```",
    );

    expect(markdown).toContain("# PROBLEM: Explain memoization.");
    expect(markdown).toContain("# [COMMENT] Identity matters.");
    expect(markdown).not.toContain("// [DOMAIN]");
  });

  it("regenerates once when Codex omits the code block", () => {
    let attempts = 0;
    const spawnSync = vi.fn(
      (_command: string, args: string[], _options: unknown) => {
        attempts += 1;
        const outputPath = args.at(args.indexOf("--output-last-message") + 1);
        writeFileSync(
          outputPath!,
          JSON.stringify({
            title: "React memo",
            markdown:
              attempts === 1
                ? "# Answer"
                : "```tsx\nconst Child = React.memo(() => <p>Saved</p>);\n```",
          }),
        );
        return { status: 0, stderr: "", stdout: "" };
      },
    );

    expect(
      runCodexConcept("How does React.memo work?", {
        spawnSync: spawnSync as never,
      }).markdown,
    ).toContain("// PROBLEM:");
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(spawnSync.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        input: expect.stringContaining("CRITICAL CORRECTION"),
      }),
    );
  });

  it("rejects invalid answer fields and surfaces process failures", () => {
    const invalidSpawn = vi.fn((_command: string, args: string[]) => {
      const outputPath = args.at(args.indexOf("--output-last-message") + 1);
      writeFileSync(outputPath!, JSON.stringify({ title: "", markdown: 7 }));
      return { status: 0, stderr: "", stdout: "" };
    });
    expect(() =>
      runCodexConcept("React", { spawnSync: invalidSpawn as never }),
    ).toThrow("invalid concept answer");

    expect(() =>
      runCodexConcept("React", {
        spawnSync: (() => ({
          error: new Error("codex unavailable"),
          status: null,
        })) as never,
      }),
    ).toThrow("codex unavailable");

    expect(() =>
      runCodexConcept("React", {
        spawnSync: (() => ({
          status: 4,
          stderr: "generation failed",
        })) as never,
      }),
    ).toThrow("generation failed");

    expect(() =>
      runCodexConcept("React", {
        spawnSync: (() => ({ status: 5, stderr: "" })) as never,
      }),
    ).toThrow("Codex exited with status 5");
  });

  it("always appends the generated answer", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );

    await appendConcept(
      "How does React.memo work?",
      { title: "React memo", markdown: "# Answer" },
      { fetch },
    );

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/v1/playground-control/explanations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "React memo",
          markdown: "# Answer",
          topic: "How does React.memo work?",
        }),
      }),
    );
  });

  it("supports an explicit endpoint and reports append failures", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response("unavailable", { status: 503 })),
    );

    await expect(
      appendConcept(
        "React",
        { title: "React", markdown: "# React" },
        { fetch, url: "http://example.test/explanations" },
      ),
    ).rejects.toThrow("HTTP 503");
    expect(fetch).toHaveBeenCalledWith(
      "http://example.test/explanations",
      expect.any(Object),
    );
  });
});
