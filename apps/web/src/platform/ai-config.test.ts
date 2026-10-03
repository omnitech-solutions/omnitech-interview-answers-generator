import { validateAgentProfile } from "@omnitech/agent-runtime-contracts";
import { describe, expect, it } from "vitest";
import {
  resolveAgentProfiles,
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

describe("resolveAgentProfiles", () => {
  it("defines every agent profile once, versioned and bounded", () => {
    const profiles = resolveAgentProfiles({});
    expect([...profiles.keys()]).toEqual([
      "coding-fast",
      "coding-quality",
      "document-quality",
      "presentation-editor",
      "assistant-claude-code",
      "assistant-codex",
    ]);
    for (const profile of profiles.values()) {
      expect(() => validateAgentProfile(profile)).not.toThrow();
      expect(profile.version).toBe(1);
      expect(profile.sandbox).toBe("read-only");
      expect(profile.additionalDirectories).toEqual([]);
    }
  });

  // ADR-0007 Decision 4: a profile's bounds are pinned to its version. A
  // change to any bound here without bumping that profile's version fails, so
  // every job snapshot names the exact revision it ran under. Only the model
  // name comes from the environment, so it is left out of the pin.
  it.each([
    [
      "coding-fast",
      {
        version: 1,
        runtime: "codex",
        effort: "low",
        sessionPersistence: false,
        maximumTurns: 1,
        timeoutMs: 120_000,
        maximumOutputBytes: 2_000_000,
      },
    ],
    [
      "coding-quality",
      {
        version: 1,
        runtime: "codex",
        effort: "high",
        tools: ["read"],
        sessionPersistence: true,
        maximumTurns: 2,
        timeoutMs: 300_000,
        maximumOutputBytes: 4_000_000,
      },
    ],
    [
      "document-quality",
      {
        version: 1,
        runtime: "claude-code",
        effort: "high",
        sessionPersistence: false,
        maximumTurns: 2,
        maximumBudgetUsd: 5,
        timeoutMs: 300_000,
        maximumOutputBytes: 4_000_000,
      },
    ],
    [
      "presentation-editor",
      {
        version: 1,
        runtime: "claude-code",
        effort: "high",
        sessionPersistence: true,
        maximumTurns: 3,
        maximumBudgetUsd: 8,
        timeoutMs: 300_000,
        maximumOutputBytes: 4_000_000,
        outputSchema: {
          type: "object",
          required: ["sourceXml"],
          properties: { sourceXml: { type: "string" } },
        },
      },
    ],
    [
      "assistant-claude-code",
      {
        version: 1,
        runtime: "claude-code",
        effort: "medium",
        sessionPersistence: false,
        maximumTurns: 1,
        timeoutMs: 300_000,
        maximumOutputBytes: 1_000_000,
      },
    ],
    [
      "assistant-codex",
      {
        version: 1,
        runtime: "codex",
        effort: "low",
        sessionPersistence: false,
        maximumTurns: 1,
        timeoutMs: 300_000,
        maximumOutputBytes: 1_000_000,
      },
    ],
  ])("pins %s's bounds to its version", (id, pinned) => {
    const { model: _model, ...bounds } = resolveAgentProfiles({}).get(id) ?? {};
    expect(bounds).toEqual({
      fallbackModels: [],
      tools: [],
      sandbox: "read-only",
      approvalPolicy: "never",
      additionalDirectories: [],
      webSearch: false,
      ...pinned,
      id,
    });
  });

  it("takes model names, never bounds, from the environment", () => {
    const profiles = resolveAgentProfiles({
      CLAUDE_ASSISTANT_MODEL: "opus",
      CODEX_ASSISTANT_MODEL: "gpt-x",
    });
    expect(profiles.get("assistant-claude-code")?.model).toBe("opus");
    expect(profiles.get("assistant-codex")).toMatchObject({
      model: "gpt-x",
      effort: "low",
      maximumTurns: 1,
    });
  });
});
