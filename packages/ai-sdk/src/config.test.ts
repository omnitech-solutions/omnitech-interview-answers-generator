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

const {
  createAiClientFromEnv,
  resolveDefaultLanguageModel,
  resolveLanguageModels,
} = await import("./config.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAiClientFromEnv", () => {
  it("requires a non-empty base URL and model", () => {
    expect(() => createAiClientFromEnv({})).toThrow(
      "Configure AI_BASE_URL and AI_MODEL, OPENAI_MODEL, or LM_STUDIO_MODEL.",
    );
    expect(() =>
      createAiClientFromEnv({ AI_BASE_URL: "  ", AI_MODEL: "model" }),
    ).toThrow("Configure AI_BASE_URL and AI_MODEL");
  });

  it("trims values and applies safe defaults", () => {
    const client = createAiClientFromEnv({
      AI_BASE_URL: " http://localhost/v1/ ",
      AI_MODEL: " fake-model ",
    });

    expect(createOpenAiCompatibleProvider).toHaveBeenCalledWith({
      id: "lm-studio",
      label: "LM Studio",
      baseUrl: "http://localhost/v1/",
      model: "fake-model",
      timeoutMs: 120_000,
    });
    expect(client.getDefaultProviderId()).toBe("lm-studio");
  });

  it("configures OpenAI and LM Studio together with an explicit default", () => {
    const client = createAiClientFromEnv({
      OPENAI_MODEL: "gpt-5-mini",
      OPENAI_API_KEY: "openai-secret",
      LM_STUDIO_MODEL: "qwen",
      LM_STUDIO_BASE_URL: "http://localhost:1234/v1",
      AI_DEFAULT_PROVIDER_ID: "lm-studio",
    });

    expect(client.listProviders()).toEqual([
      { id: "openai", label: "OpenAI", model: "gpt-5-mini" },
      { id: "lm-studio", label: "LM Studio", model: "qwen" },
    ]);
    expect(client.getDefaultProviderId()).toBe("lm-studio");
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

describe("resolveLanguageModels", () => {
  it("is the single place every consumer reads its model settings from", () => {
    const environment = {
      AI_BASE_URL: "http://localhost:1234/v1",
      AI_MODEL: "qwen",
      AI_API_KEY: "key",
      AI_TIMEOUT_MS: "9000",
    };
    const [resolved] = resolveLanguageModels(environment);
    expect(resolved).toEqual({
      id: "lm-studio",
      label: "LM Studio",
      baseUrl: "http://localhost:1234/v1",
      model: "qwen",
      apiKey: "key",
      timeoutMs: 9000,
    });
    // The client built from the same environment uses exactly those settings.
    createAiClientFromEnv(environment);
    expect(createOpenAiCompatibleProvider).toHaveBeenCalledWith({
      id: resolved?.id,
      label: resolved?.label,
      baseUrl: resolved?.baseUrl,
      model: resolved?.model,
      apiKey: resolved?.apiKey,
      timeoutMs: resolved?.timeoutMs,
    });
  });

  it("orders endpoints AI_*, OpenAI, LM Studio and lets a default override the order", () => {
    const environment = {
      LM_STUDIO_MODEL: "qwen",
      OPENAI_MODEL: "gpt-5-mini",
    };
    expect(resolveLanguageModels(environment).map(({ id }) => id)).toEqual([
      "openai",
      "lm-studio",
    ]);
    expect(resolveDefaultLanguageModel(environment).id).toBe("openai");
    expect(
      resolveDefaultLanguageModel({
        ...environment,
        AI_DEFAULT_PROVIDER_ID: "lm-studio",
      }).id,
    ).toBe("lm-studio");
    expect(
      resolveDefaultLanguageModel({
        ...environment,
        AI_DEFAULT_PROVIDER_ID: "nope",
      }).id,
    ).toBe("openai");
  });

  it("uses the default OpenAI model when only a key is set, and nothing otherwise", () => {
    expect(resolveLanguageModels({ OPENAI_API_KEY: "k" })).toMatchObject([
      {
        id: "openai",
        model: "gpt-5-mini",
        baseUrl: "https://api.openai.com/v1",
      },
    ]);
    expect(resolveLanguageModels({})).toEqual([]);
    expect(() => resolveDefaultLanguageModel({})).toThrow(
      "Configure AI_BASE_URL and AI_MODEL",
    );
  });
});
