import { describe, expect, it } from "vitest";
import { createImageProviderAdapter } from "./index.js";

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
});
