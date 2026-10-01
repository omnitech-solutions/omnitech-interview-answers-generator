import { describe, expect, it } from "vitest";
import { createOpenAiModelAdapter } from "./index.js";

describe("OpenAI model adapter", () => {
  it("exposes the provider-neutral capability contract", () => {
    const adapter = createOpenAiModelAdapter({
      id: "test-openai",
      label: "Test OpenAI",
      model: "test-model",
      apiKey: "test-key",
      baseUrl: "http://127.0.0.1:9/v1",
    });
    expect(adapter.providerId).toBe("test-openai");
    expect(adapter.capabilities).toMatchObject({
      streaming: true,
      structuredOutput: true,
    });
  });
});
