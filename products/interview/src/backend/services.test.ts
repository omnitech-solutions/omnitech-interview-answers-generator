import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guideSaying } from "../answer-fixture";

// The host's model: one structured reply per call.
const generate = vi.fn();
const scope = { tenantId: "t", actorId: "a", productId: "omnitech.interview" };

const {
  conceptExplanationSystemPrompt,
  createCodeRunner,
  generateExplanation,
  generateInterviewAnswer,
} = await import("./services");

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
    generate.mockResolvedValue({
      title: "Counter",
      language: "php",
      guide: guideSaying("Use a functional state update."),
      code: "export function Counter() {}",
      usageCode: "render(<Counter />)",
      testCode: "",
    });
  });

  it("routes the question and supplies the language workflow to the model", async () => {
    await expect(
      generateInterviewAnswer(
        {
          question: "Build an accessible React counter.",
          language: "react",
        },
        generate,
        scope,
      ),
    ).resolves.toMatchObject({
      title: "Counter",
      language: "react",
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(
      {
        system: expect.stringContaining("matches this JSON Schema"),
        prompt: expect.stringContaining("Build an accessible React counter."),
        // The answer's JSON Schema, for a host that runs on an agent runtime.
        schema: expect.objectContaining({ type: "object" }),
      },
      scope,
    );
    expect(generate.mock.calls[0]![0].prompt).toContain(
      "Target language: React",
    );
  });

  it("generates a concise explanation with candidate evidence available", async () => {
    generate.mockResolvedValueOnce({
      title: "React hooks",
      markdown: commentedExample,
    });
    await expect(
      generateExplanation(
        { topic: "Explain React hooks", context: "Technical interview" },
        generate,
        scope,
      ),
    ).resolves.toEqual({
      title: "React hooks",
      markdown: commentedExample,
    });
    const [request] = generate.mock.calls[0]!;
    expect(request.prompt).toContain("Explain React hooks");
    expect(request.prompt).toContain(
      "Additional context:\nTechnical interview",
    );
    expect(request.system).toContain(conceptExplanationSystemPrompt);
  });

  describe("candidate experience matrix", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("reads no file and says the evidence is unavailable when no path is configured", async () => {
      vi.stubEnv("INTERVIEW_EXPERIENCE_MATRIX_PATH", "");
      generate.mockResolvedValueOnce({
        title: "Queues",
        markdown: commentedExample,
      });
      await generateExplanation({ topic: "Queues" }, generate, scope);
      expect(generate.mock.calls[0]![0].prompt).toContain(
        "Candidate experience matrix is unavailable.",
      );
    });

    it("includes the configured file as evidence", async () => {
      const path = join(mkdtempSync(join(tmpdir(), "matrix-")), "matrix.json");
      writeFileSync(path, '{"evidence":"configured-matrix-marker"}');
      vi.stubEnv("INTERVIEW_EXPERIENCE_MATRIX_PATH", path);
      generate.mockResolvedValueOnce({
        title: "Queues",
        markdown: commentedExample,
      });
      await generateExplanation({ topic: "Queues" }, generate, scope);
      expect(generate.mock.calls[0]![0].prompt).toContain(
        "Candidate experience matrix (authoritative evidence):",
      );
      expect(generate.mock.calls[0]![0].prompt).toContain(
        "configured-matrix-marker",
      );
    });

    it("treats an unreadable configured path as unavailable evidence", async () => {
      vi.stubEnv(
        "INTERVIEW_EXPERIENCE_MATRIX_PATH",
        "/nonexistent/matrix.json",
      );
      generate.mockResolvedValueOnce({
        title: "Queues",
        markdown: commentedExample,
      });
      await generateExplanation({ topic: "Queues" }, generate, scope);
      expect(generate.mock.calls[0]![0].prompt).toContain("is unavailable.");
    });
  });

  it("omits optional explanation inputs", async () => {
    generate.mockResolvedValueOnce({
      title: "Queues",
      markdown: commentedExample,
    });
    await generateExplanation({ topic: "Queues" }, generate, scope);
    expect(generate.mock.calls[0]![0].prompt).not.toContain(
      "Additional context",
    );
  });

  it("rejects explanations that omit the coding-answer comment contract", async () => {
    generate.mockResolvedValueOnce({ title: "Queues", markdown: "FIFO" });

    await expect(
      generateExplanation({ topic: "Queues" }, generate, scope),
    ).rejects.toThrow("required code example");
  });

  it("gives the model one correction turn, then reports the failing fields", async () => {
    generate.mockResolvedValue({ title: "Queues" });
    await expect(
      generateExplanation({ topic: "Queues" }, generate, scope),
    ).rejects.toMatchObject({
      code: "generation-failed",
      hint: expect.stringContaining("markdown"),
    });
    expect(generate).toHaveBeenCalledTimes(2);
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
  const base = {
    title: "T",
    language: "react",
    code: "x",
    usageCode: "",
    testCode: "",
  };

  beforeEach(() => vi.clearAllMocks());

  it("renders the answer's Markdown from the model's guide", async () => {
    generate.mockResolvedValueOnce({
      title: "Counter",
      language: "react",
      guide,
      code: "export function App() {}",
      usageCode: "",
      testCode: "it('counts every click')",
    });
    const answer = await generateInterviewAnswer(
      { question: "Build a React counter.", language: "react" },
      generate,
      scope,
    );
    expect(answer.guide).toEqual(guide);
    expect(answer.answerMarkdown).toContain("## Question");
    expect(answer.answerMarkdown).toContain("1. Keep **state**.");
    expect(answer.answerMarkdown).toContain(
      "- **Rapid clicks** — covered by `counts every click`",
    );
  });

  it("refuses an answer that has Markdown but no guide", async () => {
    generate.mockResolvedValue({ ...base, answerMarkdown: "## Question" });
    await expect(
      generateInterviewAnswer(
        { question: "Q", language: "react" },
        generate,
        scope,
      ),
    ).rejects.toMatchObject({ code: "generation-failed" });
  });
});

describe("createCodeRunner", () => {
  it("runs code in Docker here, unless a runner service is named", async () => {
    const { DockerCodeRunner, RemoteCodeRunner } = await import(
      "@omnitech/code-runner"
    );
    expect(createCodeRunner({})).toBeInstanceOf(DockerCodeRunner);
    expect(
      createCodeRunner({
        CODE_RUNNER_URL: "http://host.docker.internal:3002",
        CODE_RUNNER_TOKEN: "t".repeat(32),
      }),
    ).toBeInstanceOf(RemoteCodeRunner);
  });

  it("refuses a runner service named without its token", () => {
    expect(() =>
      createCodeRunner({ CODE_RUNNER_URL: "http://host.docker.internal:3002" }),
    ).toThrow(/CODE_RUNNER_TOKEN/);
  });
});
