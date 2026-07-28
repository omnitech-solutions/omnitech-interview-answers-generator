import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
const createAiClientFromEnv = vi.fn(() => ({ generateObject }));

vi.mock("@omnitech/ai-sdk", () => ({ createAiClientFromEnv }));

const { generateExplanation, generateInterviewAnswer } = await import(
  "./services.js"
);

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
        maxOutputTokens: 8_000,
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
      object: { title: "React hooks", markdown: "## Talking points" },
    });
    await expect(
      generateExplanation({
        topic: "Explain React hooks",
        context: "Technical interview",
        providerId: "local",
      }),
    ).resolves.toEqual({
      title: "React hooks",
      markdown: "## Talking points",
    });
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "local",
        prompt: expect.stringContaining("Explain React hooks"),
        maxOutputTokens: 2_200,
        system: expect.stringMatching(
          /where to start[\s\S]*Question N[\s\S]*> \*\*Answer:\*\*/,
        ),
      }),
    );
  });

  it("omits optional explanation inputs", async () => {
    generateObject.mockResolvedValueOnce({
      object: { title: "Queues", markdown: "FIFO" },
    });
    await generateExplanation({ topic: "Queues" });
    expect(generateObject).toHaveBeenCalledWith(
      expect.not.objectContaining({ providerId: expect.anything() }),
    );
  });
});
