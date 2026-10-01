import { describe, expect, it } from "vitest";
import { createLocalModelAdapter } from "./local-model";

describe("local presentation drafts", () => {
  it("returns the requested slide count without treating instructions as content", async () => {
    const result = await createLocalModelAdapter().execute({
      context: {
        tenantId: "tenant",
        userId: "user",
        productId: "omnitech.presentation",
        permissions: [],
      },
      profileId: "document-fast",
      task: {
        type: "structured-generation",
        prompt:
          "Community garden planning\n\nCreate an outline for exactly 10 slides.\n\nWrite the outline in English.",
        schema: {
          type: "object",
          properties: { title: { type: "string" }, outline: { type: "array" } },
        },
      },
    });
    const draft = result.result as { title: string; outline: string[] };
    expect(draft.title).toBe("Community garden planning");
    expect(draft.outline).toHaveLength(10);
    expect(draft.outline.join(" ")).not.toContain("Write the outline");
    expect(draft.outline.join(" ")).not.toContain("Create an outline");
  });
});
