import { describe, expect, it } from "vitest";
import {
  type AnswerGuide,
  answerGuideSchema,
  guideText,
  renderGuideMarkdown,
  stageProgressSchema,
} from "./guide.js";
import {
  generatedAnswerSchema,
  runResultSchema,
  saveAnswerRequestSchema,
} from "./schemas.js";

const sampleGuide: AnswerGuide = {
  version: 1,
  understand: {
    prompt: "Reject concurrent updates that would overwrite each other.",
    examples: [
      {
        input: "update('r1', 'a', 1)",
        output: "revision 2",
        note: "matching revision",
      },
      { input: "update('r1', 'b', 1)", output: "StaleRevisionError" },
    ],
    constraints: ["Single process, in-memory store"],
    clarify: ["On conflict: throw, or merge?", "Do revisions start at 1?"],
  },
  plan: {
    steps: ["Store a revision per resource.", "Compare before writing."],
    complexity: { time: "O(1)", space: "O(n)", note: "n resources" },
  },
  edgeCases: [
    { name: "Stale revision", test: "rejects a stale revision" },
    { name: "Missing resource" },
  ],
  explain: [{ heading: "The problem", body: "Two writers race." }],
  talkingPoints: ["Revisions are cheap.", "Typed errors.", "Retry policy."],
};

describe("answer guide", () => {
  it("renders the five required answer headings in order", () => {
    const markdown = renderGuideMarkdown(sampleGuide);
    const headings = markdown
      .split("\n")
      .filter((line) => line.startsWith("## "));
    expect(headings).toEqual([
      "## Question",
      "## Approach",
      "## Complexity",
      "## Edge cases",
      "## Talking points",
    ]);
    expect(markdown).toContain(
      "  - `update('r1', 'a', 1)` → `revision 2` — matching revision",
    );
    expect(markdown).toContain("2. Compare before writing.");
    expect(markdown).toContain("- **Time:** `O(1)`");
    expect(markdown).toContain("- n resources");
    expect(markdown).toContain(
      "- **Stale revision** — covered by `rejects a stale revision`",
    );
    expect(markdown).toContain("- **Missing resource**\n");
  });

  it("omits empty sections without losing a heading", () => {
    const markdown = renderGuideMarkdown({
      ...sampleGuide,
      understand: { ...sampleGuide.understand, examples: [], constraints: [] },
      plan: {
        ...sampleGuide.plan,
        complexity: { time: "O(`n`)", space: "O(1)" },
      },
      edgeCases: [],
    });
    expect(markdown).not.toContain("**Examples:**");
    expect(markdown).not.toContain("**Constraints:**");
    expect(markdown).toContain("- None beyond the examples.");
    expect(markdown).toContain("- **Time:** `O(ˋnˋ)`");
  });

  it("flattens the guide for review and claims", () => {
    const text = guideText(sampleGuide);
    expect(text).toContain("Ask: On conflict: throw, or merge?");
    expect(text).toContain(
      "Edge case: Stale revision (rejects a stale revision)",
    );
    expect(text).toContain("Edge case: Missing resource\n");
    expect(text).toContain("The problem: Two writers race.");
  });

  it("requires exactly three talking points and at least one step", () => {
    expect(
      answerGuideSchema.safeParse({
        ...sampleGuide,
        talkingPoints: ["one", "two"],
      }).success,
    ).toBe(false);
    expect(
      answerGuideSchema.safeParse({
        ...sampleGuide,
        plan: { ...sampleGuide.plan, steps: [] },
      }).success,
    ).toBe(false);
  });

  it("requires a guide on every answer", () => {
    const answer = {
      title: "T",
      language: "typescript",
      answerMarkdown: "## Question",
      code: "x",
      usageCode: "",
      testCode: "",
    };
    expect(generatedAnswerSchema.safeParse(answer).success).toBe(false);
    expect(
      generatedAnswerSchema.parse({ ...answer, guide: sampleGuide }).guide,
    ).toEqual(sampleGuide);
  });

  it("renders a saved answer's Markdown from its guide", () => {
    const saved = saveAnswerRequestSchema.parse({
      title: "T",
      language: "typescript",
      answerMarkdown: "My own words",
      code: "x",
      question: "Q",
      guide: sampleGuide,
    });
    expect(saved.answerMarkdown).toBe(renderGuideMarkdown(sampleGuide));
    expect(
      saveAnswerRequestSchema.safeParse({
        title: "T",
        language: "typescript",
        answerMarkdown: "## Question",
        code: "x",
        question: "Q",
      }).success,
    ).toBe(false);
  });

  it("keeps run results without the new fields unchanged", () => {
    const run = {
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    };
    expect(runResultSchema.parse(run)).toEqual(run);
    expect(
      runResultSchema.parse({
        ...run,
        tests: [
          {
            name: "works",
            status: "passed",
            durationMs: 2,
            location: { editor: "tests", line: 3 },
          },
        ],
        diagnostics: [{ line: 4, column: 2, message: "';' expected." }],
      }).tests,
    ).toHaveLength(1);
  });

  it("validates saved stage progress", () => {
    expect(
      stageProgressSchema.parse({ stage: "plan", clarified: [0, 2] }),
    ).toEqual({ stage: "plan", clarified: [0, 2] });
    expect(
      stageProgressSchema.safeParse({ stage: "plan", clarified: [], extra: 1 })
        .success,
    ).toBe(false);
  });
});
