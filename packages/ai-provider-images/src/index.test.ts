import { describe, expect, it } from "vitest";
import {
  createFakeImageProvider,
  createImageProviderAdapter,
  fillWorkflowPrompt,
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

describe("image model id boundary", () => {
  const context = {
    tenantId: "tenant",
    userId: "user",
    productId: "product",
    permissions: [],
  };
  for (const modelId of [
    "../../admin",
    "/leading/slash",
    "https://evil.example/model",
    "fal-ai/../x",
    "model?query=1",
    "model#frag",
    "a".repeat(101),
    "",
  ]) {
    it(`refuses ${JSON.stringify(modelId.slice(0, 30))} before any transport runs`, async () => {
      let transportCalled = false;
      const adapter = createImageProviderAdapter({
        id: "fal",
        model: "fal-ai/flux-pro/v1.1-ultra",
        aspectRatios: ["16:9"],
        generate: async () => {
          transportCalled = true;
          return { url: "https://example.com/a.png" };
        },
        persist: async () => ({ reference: "asset", mimeType: "image/png" }),
      });
      await expect(
        adapter.generate({
          context,
          task: { type: "image-generation", prompt: "p", image: { modelId } },
        }),
      ).rejects.toThrow("The image model id is not allowed.");
      expect(transportCalled).toBe(false);
    });
  }

  it("accepts catalog names", async () => {
    const adapter = createImageProviderAdapter({
      id: "fal",
      model: "m",
      aspectRatios: ["16:9"],
      generate: async () => ({ url: "https://example.com/a.png" }),
      persist: async () => ({ reference: "asset", mimeType: "image/png" }),
    });
    for (const modelId of [
      "fal-ai/flux-pro/v1.1-ultra",
      "black-forest-labs/FLUX.1-schnell-Free",
      "gpt-image-1",
    ]) {
      await expect(
        adapter.generate({
          context,
          task: { type: "image-generation", prompt: "p", image: { modelId } },
        }),
      ).resolves.toMatchObject({ modelId });
    }
  });
});

describe("fillWorkflowPrompt", () => {
  it("keeps quotes, backslashes and braces in the prompt as data", () => {
    const workflow = {
      "6": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}" } },
      "7": { inputs: { list: ["a {{prompt}} b", 3, null] } },
    };
    const hostile = 'x", "9": {"class_type": "Evil"} \\ {{prompt}} $& \n';
    const filled = fillWorkflowPrompt(workflow, hostile) as typeof workflow;
    expect(Object.keys(filled)).toEqual(["6", "7"]);
    expect(filled["6"].inputs.text).toBe(hostile);
    expect(filled["7"].inputs.list).toEqual([`a ${hostile} b`, 3, null]);
    // The input workflow is not mutated.
    expect(workflow["6"].inputs.text).toBe("{{prompt}}");
    expect(JSON.parse(JSON.stringify(filled))).toEqual(filled);
  });
});
