import { describe, expect, it } from "vitest";
import { createOpenAiCatalogAdapter } from "./index";

const context = {
  tenantId: "t",
  userId: "a",
  productId: "p",
  permissions: [],
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("createOpenAiCatalogAdapter", () => {
  it("lists LM Studio's installed models with its provider, minus excluded keys", async () => {
    const requested: string[] = [];
    const adapter = createOpenAiCatalogAdapter({
      id: "lm-studio-models",
      catalog: "lm-studio",
      baseUrl: "http://127.0.0.1:1234/v1",
      minContextTokens: 8_000,
      exclude: ["default-model"],
      fetch: async (url) => {
        requested.push(String(url));
        return json({
          models: [
            {
              type: "llm",
              key: "default-model",
              max_context_length: 32_000,
            },
            {
              type: "llm",
              key: "qwen",
              display_name: "Qwen",
              max_context_length: 32_000,
            },
            { type: "llm", key: "tiny", max_context_length: 2_000 },
            { type: "embedding", key: "embed", max_context_length: 32_000 },
          ],
        });
      },
    });
    const models = await adapter.listModels?.(context);
    expect(requested).toEqual(["http://127.0.0.1:1234/api/v1/models"]);
    expect(models?.map((model) => model.id)).toEqual(["lm-studio/qwen"]);
    expect(models?.[0]).toMatchObject({
      name: "Qwen",
      local: true,
      provider: { name: "LM Studio", endpoint: "127.0.0.1:1234", local: true },
    });
    expect(adapter.providerId).toBe("lm-studio-models");
  });

  it("lists only OpenRouter's free, tool-capable models", async () => {
    const adapter = createOpenAiCatalogAdapter({
      id: "openrouter-models",
      catalog: "openrouter-free",
      apiKey: "test-key",
      fetch: async () =>
        json({
          data: [
            {
              id: "vendor/free:free",
              name: "Free (free)",
              pricing: { prompt: "0", completion: "0" },
              supported_parameters: ["tools"],
              context_length: 64_000,
            },
            {
              id: "vendor/paid",
              pricing: { prompt: "0.1", completion: "0.1" },
              supported_parameters: ["tools"],
              context_length: 64_000,
            },
            {
              id: "vendor/no-tools:free",
              pricing: { prompt: "0", completion: "0" },
              supported_parameters: [],
              context_length: 64_000,
            },
          ],
        }),
    });
    const models = await adapter.listModels?.(context);
    expect(models?.map((model) => model.id)).toEqual([
      "openrouter/vendor/free:free",
    ]);
    expect(models?.[0]?.provider?.name).toBe("OpenRouter · free");
  });

  it("serves structured chat only", async () => {
    const adapter = createOpenAiCatalogAdapter({
      id: "lm-studio-models",
      catalog: "lm-studio",
      fetch: async () => json({ models: [] }),
    });
    await expect(
      adapter.execute({
        context,
        task: { type: "text-generation", prompt: "" },
      }),
    ).rejects.toThrow(/structured chat/);
  });
});
