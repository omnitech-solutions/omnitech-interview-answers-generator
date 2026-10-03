import { describe, expect, it } from "vitest";
import {
  resolveDefaultLanguageModel,
  resolveLanguageModels,
} from "./ai-config";

describe("resolveLanguageModels", () => {
  it("needs both a non-empty base URL and model", () => {
    expect(resolveLanguageModels({})).toEqual([]);
    expect(
      resolveLanguageModels({ AI_BASE_URL: "  ", AI_MODEL: "model" }),
    ).toEqual([]);
    expect(resolveDefaultLanguageModel({})).toBeNull();
  });

  it("trims values and applies safe defaults", () => {
    expect(
      resolveLanguageModels({
        AI_BASE_URL: " http://localhost/v1/ ",
        AI_MODEL: " fake-model ",
      }),
    ).toEqual([
      {
        id: "lm-studio",
        label: "LM Studio",
        baseUrl: "http://localhost/v1/",
        model: "fake-model",
        timeoutMs: 120_000,
      },
    ]);
    expect(
      resolveLanguageModels({
        AI_BASE_URL: "https://x.test/v1",
        AI_MODEL: "m",
      })[0],
    ).toMatchObject({ id: "openai", label: "OpenAI" });
  });

  it("reads explicit identity, credentials, and timeout", () => {
    expect(
      resolveLanguageModels({
        AI_BASE_URL: "http://provider",
        AI_MODEL: "model",
        AI_PROVIDER_ID: " local ",
        AI_PROVIDER_LABEL: " Local Model ",
        AI_API_KEY: "secret",
        AI_TIMEOUT_MS: "5000",
      }),
    ).toEqual([
      {
        id: "local",
        label: "Local Model",
        baseUrl: "http://provider",
        model: "model",
        apiKey: "secret",
        timeoutMs: 5000,
      },
    ]);
  });

  it("orders endpoints AI_*, OpenAI, LM Studio and lets a default override the order", () => {
    const environment = {
      LM_STUDIO_MODEL: "qwen",
      LM_STUDIO_API_KEY: "local-key",
      OPENAI_MODEL: "gpt-5-mini",
      OPENAI_API_KEY: "openai-secret",
    };
    expect(resolveLanguageModels(environment)).toEqual([
      {
        id: "openai",
        label: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5-mini",
        apiKey: "openai-secret",
        timeoutMs: 120_000,
      },
      {
        id: "lm-studio",
        label: "LM Studio",
        baseUrl: "http://127.0.0.1:1234/v1",
        model: "qwen",
        apiKey: "local-key",
        timeoutMs: 120_000,
      },
    ]);
    expect(resolveDefaultLanguageModel(environment)?.id).toBe("openai");
    expect(
      resolveDefaultLanguageModel({
        ...environment,
        AI_DEFAULT_PROVIDER_ID: "lm-studio",
      })?.id,
    ).toBe("lm-studio");
    expect(
      resolveDefaultLanguageModel({
        ...environment,
        AI_DEFAULT_PROVIDER_ID: "nope",
      })?.id,
    ).toBe("openai");
  });

  it("does not repeat an endpoint AI_* already names", () => {
    expect(
      resolveLanguageModels({
        AI_BASE_URL: "http://127.0.0.1:1234/v1",
        AI_MODEL: "qwen",
        LM_STUDIO_MODEL: "other",
        OPENAI_BASE_URL: "https://proxy.test/v1",
        OPENAI_MODEL: "gpt",
      }).map(({ id, baseUrl }) => [id, baseUrl]),
    ).toEqual([
      ["lm-studio", "http://127.0.0.1:1234/v1"],
      ["openai", "https://proxy.test/v1"],
    ]);
  });

  it("uses the default OpenAI model when only a key is set", () => {
    expect(resolveLanguageModels({ OPENAI_API_KEY: "k" })).toMatchObject([
      {
        id: "openai",
        model: "gpt-5-mini",
        baseUrl: "https://api.openai.com/v1",
      },
    ]);
  });
});
