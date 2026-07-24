import { beforeEach, describe, expect, it, vi } from "vitest";

const createOpenAiCompatibleProvider = vi.fn((options) => ({
  summary: {
    id: options.id,
    label: options.label,
    model: options.model,
  },
  generateText: vi.fn(),
}));

vi.mock("./openai-compatible.js", () => ({
  createOpenAiCompatibleProvider,
}));

const { createAiClientFromEnv } = await import("./config.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAiClientFromEnv", () => {
  it("requires a non-empty base URL and model", () => {
    expect(() => createAiClientFromEnv({})).toThrow(
      "AI_BASE_URL and AI_MODEL must be configured.",
    );
    expect(() =>
      createAiClientFromEnv({ AI_BASE_URL: "  ", AI_MODEL: "model" }),
    ).toThrow("AI_BASE_URL and AI_MODEL must be configured.");
  });

  it("trims values and applies safe defaults", () => {
    const client = createAiClientFromEnv({
      AI_BASE_URL: " http://localhost/v1/ ",
      AI_MODEL: " fake-model ",
    });

    expect(createOpenAiCompatibleProvider).toHaveBeenCalledWith({
      id: "default",
      label: "Default",
      baseUrl: "http://localhost/v1/",
      model: "fake-model",
      timeoutMs: 120_000,
    });
    expect(client.getDefaultProviderId()).toBe("default");
  });

  it("forwards explicit identity, credentials, and timeout", () => {
    createAiClientFromEnv({
      AI_BASE_URL: "http://provider",
      AI_MODEL: "model",
      AI_PROVIDER_ID: " local ",
      AI_PROVIDER_LABEL: " Local Model ",
      AI_API_KEY: "secret",
      AI_TIMEOUT_MS: "5000",
    });

    expect(createOpenAiCompatibleProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "local",
        label: "Local Model",
        apiKey: "secret",
        timeoutMs: 5000,
      }),
    );
  });
});
