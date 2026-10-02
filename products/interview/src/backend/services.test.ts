import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
const createAiClientFromEnv = vi.fn(() => ({ generateObject }));

vi.mock("@omnitech/ai-sdk", () => ({ createAiClientFromEnv }));

const {
  conceptExplanationSystemPrompt,
  generateExplanation,
  generateInterviewAnswer,
} = await import("./services.js");

const commentedExample = `## Talking points
\`\`\`typescript
// PROBLEM: Explain the concept.
// STRATEGY: Ground it in a typed operation.
// COMPLEXITY: O(1).
// [DOMAIN] Keep the example focused on the interview distinction.
const enabled: boolean = true;
\`\`\``;

describe("conceptExplanationSystemPrompt", () => {
  it("adapts examples to the question without expanding its scope", () => {
    expect(conceptExplanationSystemPrompt).toMatch(/Never invent subquestions/);
    expect(conceptExplanationSystemPrompt).toMatch(/comparison\/trade-off/i);
    expect(conceptExplanationSystemPrompt).toMatch(/DSA pattern/);
    expect(conceptExplanationSystemPrompt).toMatch(/mini-STAR/);
    expect(conceptExplanationSystemPrompt).toMatch(
      /Always include exactly 3 short Talking points/,
    );
    for (const requirement of [
      "PROBLEM",
      "STRATEGY",
      "COMPLEXITY",
      "[COMMENT]",
      "[GUARD]",
      "[DOMAIN]",
      "[SAFETY]",
    ]) {
      expect(conceptExplanationSystemPrompt).toContain(requirement);
    }
  });

  it("protects the React re-render regression requirements", () => {
    for (const requirement of [
      "state updates",
      "parent renders",
      "consumed context",
      "useMemo",
      "useCallback",
      "useEffect",
      "reconciliation",
      "DOM commit",
      "Object.is",
      "shallow per-prop comparison",
      "deep-compare",
    ]) {
      expect(conceptExplanationSystemPrompt).toContain(requirement);
    }
  });
});

describe("generateInterviewAnswer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateObject.mockResolvedValue({
      object: {
        title: "Counter",
        language: "php",
        answerMarkdown: "Use a functional state update.",
        code: "export function Counter() {}",
        usageCode: "render(<Counter />)",
        testCode: "",
      },
    });
  });

  it("routes the question and supplies the language workflow to the AI client", async () => {
    await expect(
      generateInterviewAnswer({
        question: "Build an accessible React counter.",
        language: "react",
        providerId: "local",
      }),
    ).resolves.toMatchObject({
      title: "Counter",
      language: "react",
    });

    expect(createAiClientFromEnv).toHaveBeenCalledOnce();
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "local",
        prompt: expect.stringContaining("Build an accessible React counter."),
        schema: expect.any(Object),
        temperature: 0.2,
        maxOutputTokens: 12_000,
      }),
    );
  });

  it("keeps optional provider configuration out of the request", async () => {
    await generateInterviewAnswer({
      question: "Solve this array problem in PHP.",
      language: "php",
    });

    expect(generateObject).toHaveBeenCalledWith(
      expect.not.objectContaining({ providerId: expect.anything() }),
    );
  });

  it("generates a concise explanation with candidate evidence available", async () => {
    generateObject.mockResolvedValueOnce({
      object: { title: "React hooks", markdown: commentedExample },
    });
    await expect(
      generateExplanation({
        topic: "Explain React hooks",
        context: "Technical interview",
        providerId: "local",
      }),
    ).resolves.toEqual({
      title: "React hooks",
      markdown: commentedExample,
    });
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "local",
        prompt: expect.stringContaining("Explain React hooks"),
        maxOutputTokens: 2_200,
        system: conceptExplanationSystemPrompt,
      }),
    );
  });

  it("omits optional explanation inputs", async () => {
    generateObject.mockResolvedValueOnce({
      object: { title: "Queues", markdown: commentedExample },
    });
    await generateExplanation({ topic: "Queues" });
    expect(generateObject).toHaveBeenCalledWith(
      expect.not.objectContaining({ providerId: expect.anything() }),
    );
  });

  it("rejects explanations that omit the coding-answer comment contract", async () => {
    generateObject.mockResolvedValueOnce({
      object: { title: "Queues", markdown: "FIFO" },
    });

    await expect(generateExplanation({ topic: "Queues" })).rejects.toThrow(
      "required code example",
    );
  });
});

describe("generateInterviewAnswer with a guide", () => {
  const guide = {
    version: 1,
    understand: {
      prompt: "Count clicks.",
      examples: [],
      constraints: [],
      clarify: ["Start at zero?"],
    },
    plan: {
      steps: ["Keep **state**."],
      complexity: { time: "O(1)", space: "O(1)" },
    },
    edgeCases: [{ name: "Rapid clicks", test: "counts every click" }],
    explain: [{ heading: "The idea", body: "State drives the render." }],
    talkingPoints: ["One", "Two", "Three"],
  };

  it("renders the answer's Markdown from the model's guide", async () => {
    generateObject.mockResolvedValueOnce({
      object: {
        title: "Counter",
        language: "react",
        guide,
        code: "export function App() {}",
        usageCode: "",
        testCode: "it('counts every click')",
      },
    });
    const answer = await generateInterviewAnswer({
      question: "Build a React counter.",
      language: "react",
    });
    expect(answer.guide).toEqual(guide);
    expect(answer.answerMarkdown).toContain("## Question");
    expect(answer.answerMarkdown).toContain("1. Keep **state**.");
    expect(answer.answerMarkdown).toContain(
      "- **Rapid clicks** — covered by `counts every click`",
    );
  });

  it("accepts older-style Markdown and refuses an answer with neither", async () => {
    const { schema } = generateObject.mock.calls.at(-1)?.[0] ?? {};
    await generateInterviewAnswer({ question: "Q", language: "react" });
    const used = generateObject.mock.calls.at(-1)![0].schema as {
      safeParse(value: unknown): { success: boolean };
    };
    expect(schema ?? used).toBeDefined();
    const base = {
      title: "T",
      language: "react",
      code: "x",
      usageCode: "",
      testCode: "",
    };
    expect(
      used.safeParse({ ...base, answerMarkdown: "## Question" }).success,
    ).toBe(true);
    expect(used.safeParse(base).success).toBe(false);
  });
});
