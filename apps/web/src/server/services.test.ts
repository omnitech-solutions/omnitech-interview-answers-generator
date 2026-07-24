import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
const createAiClientFromEnv = vi.fn(() => ({ generateObject }));

vi.mock("@omnitech/ai-sdk", () => ({ createAiClientFromEnv }));

const { generateInterviewAnswer } = await import("./services.js");

describe("generateInterviewAnswer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateObject.mockResolvedValue({
      object: {
        title: "Counter",
        language: "php",
        answerMarkdown: "Use a functional state update.",
        code: "export function Counter() {}",
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
});
