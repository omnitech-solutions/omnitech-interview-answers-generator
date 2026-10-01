import { describe, expect, it } from "vitest";
import {
  createFakeImageProvider,
  createImageProviderAdapter,
} from "./index.js";

describe("image provider boundary", () => {
  it("rejects remote loopback results before persistence", async () => {
    const adapter = createImageProviderAdapter({
      id: "fal",
      model: "test",
      aspectRatios: ["16:9"],
      generate: async () => ({ url: "http://127.0.0.1/private.png" }),
      persist: async () => ({ reference: "asset", mimeType: "image/png" }),
    });
    await expect(
      adapter.generate({
        context: {
          tenantId: "tenant",
          userId: "user",
          productId: "product",
          permissions: [],
        },
        task: { type: "image-generation", prompt: "test" },
      }),
    ).rejects.toThrow("loopback");
  });

  it("provides a deterministic fake for product and contract tests", async () => {
    const adapter = createFakeImageProvider(async (payload) => ({
      reference: payload.url,
      mimeType: "image/png",
    }));
    const result = await adapter.generate({
      context: {
        tenantId: "tenant",
        userId: "user",
        productId: "presentation",
        permissions: [],
      },
      task: { type: "image-generation", prompt: "mountain" },
    });
    expect(result.providerId).toBe("fake-image");
    expect(result.assetReference).toContain("generate%3Amountain");
  });
});

it("accepts inline PNG output from OpenAI before persistence", async () => {
  const inline = "data:image/png;base64,aGVsbG8=";
  const adapter = createImageProviderAdapter({
    id: "openai-image",
    model: "test",
    aspectRatios: ["1:1"],
    generate: async () => ({ url: inline }),
    persist: async (payload) => ({
      reference: payload.url,
      mimeType: "image/png",
    }),
  });
  await expect(
    adapter.generate({
      context: {
        tenantId: "tenant",
        userId: "user",
        productId: "product",
        permissions: [],
      },
      task: { type: "image-generation", prompt: "test" },
    }),
  ).resolves.toMatchObject({ assetReference: inline });
});
