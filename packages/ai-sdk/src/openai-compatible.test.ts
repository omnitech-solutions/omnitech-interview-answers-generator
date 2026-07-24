import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.fn();
const streamText = vi.fn();
const model = { modelId: "test-model" };
const provider = vi.fn(() => model);
const createOpenAICompatible = vi.fn(() => provider);

vi.mock("ai", () => ({ generateText, streamText }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible }));

const { createOpenAiCompatibleProvider } =
  await import("./openai-compatible.js");

const options = {
  id: "local",
  label: "Local model",
  model: "test-model",
  baseUrl: "http://localhost:1234/v1/",
  apiKey: "secret",
  headers: { "X-Test": "yes" },
  timeoutMs: 500,
};

describe("createOpenAiCompatibleProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("configures and describes the provider", () => {
    const result = createOpenAiCompatibleProvider(options);

    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "local",
      baseURL: "http://localhost:1234/v1",
      apiKey: "secret",
      headers: { "X-Test": "yes" },
    });
    expect(provider).toHaveBeenCalledWith("test-model");
    expect(result.summary).toEqual({
      id: "local",
      label: "Local model",
      model: "test-model",
    });
  });

  it("maps messages and optional generation settings", async () => {
    generateText.mockResolvedValue({
      finishReason: "stop",
      text: "answer",
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    });
    const result = createOpenAiCompatibleProvider(options);

    await expect(
      result.generateText({
        messages: [
          { role: "user", content: "Question" },
          { role: "assistant", content: "Context" },
        ],
        system: "Be concise",
        temperature: 0.2,
        maxOutputTokens: 100,
      }),
    ).resolves.toEqual({
      finishReason: "stop",
      providerId: "local",
      text: "answer",
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        prompt: "USER: Question\n\nASSISTANT: Context",
        system: "Be concise",
        temperature: 0.2,
        maxOutputTokens: 100,
        abortSignal: expect.any(AbortSignal),
      }),
    );
  });

  it("prefers an explicit prompt and omits undefined usage", async () => {
    generateText.mockResolvedValue({
      finishReason: "length",
      text: "partial",
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      },
    });
    const {
      apiKey: _apiKey,
      headers: _headers,
      ...optionsWithoutSecrets
    } = options;
    const result = createOpenAiCompatibleProvider(optionsWithoutSecrets);

    await expect(
      result.generateText({ prompt: "Direct prompt", messages: [] }),
    ).resolves.toMatchObject({ text: "partial", usage: {} });
    expect(createOpenAICompatible).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: "" }),
    );
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Direct prompt" }),
    );
  });

  it("classifies cancellation separately from provider failures", async () => {
    generateText.mockRejectedValue(new Error("failed"));
    const result = createOpenAiCompatibleProvider(options);
    const controller = new AbortController();
    controller.abort();

    await expect(
      result.generateText({ prompt: "Question", signal: controller.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
    await expect(
      result.generateText({ prompt: "Question" }),
    ).rejects.toMatchObject({ code: "provider_failure" });
  });

  it("streams text deltas followed by a finish event", async () => {
    streamText.mockReturnValue({
      textStream: (async function* () {
        yield "first";
        yield " second";
      })(),
    });
    const result = createOpenAiCompatibleProvider(options);
    const events = [];

    for await (const event of result.streamText!({ prompt: "Question" })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text-delta", text: "first" },
      { type: "text-delta", text: " second" },
      { type: "finish" },
    ]);
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Question", model }),
    );
  });
});
