import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { createAnthropicModelAdapter } from "./index";

describe("Anthropic model adapter", () => {
  it("exposes the provider-neutral capability contract", () => {
    const adapter = createAnthropicModelAdapter({
      apiKey: "test-key",
      model: "test-model",
      client: new Anthropic({ apiKey: "test-key" }),
    });
    expect(adapter.providerId).toBe("anthropic");
    expect(adapter.capabilities).toMatchObject({
      streaming: true,
      structuredOutput: true,
    });
  });

  it("retries once when structured output is invalid", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        content: [{ type: "text", text: '{"title":4}' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "end_turn",
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: '{"title":"Ready"}' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "end_turn",
      });
    const adapter = createAnthropicModelAdapter({
      apiKey: "test-key",
      model: "test-model",
      client: {
        messages: { create },
      } as unknown as Anthropic,
    });

    const result = await adapter.execute({
      context: {
        tenantId: "tenant",
        userId: "user",
        productId: "product",
        permissions: [],
      },
      task: {
        type: "structured-generation",
        prompt: "title",
        schema: {
          type: "object",
          required: ["title"],
          properties: { title: { type: "string" } },
        },
      },
    });

    expect(result.result).toEqual({ title: "Ready" });
    expect(create).toHaveBeenCalledTimes(2);
  });
});
