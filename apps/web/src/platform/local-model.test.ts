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

describe("local drafts without a model service", () => {
  const context = {
    tenantId: "tenant",
    userId: "user",
    productId: "omnitech.presentation",
    permissions: [],
  };

  it("drafts one slide as markup with the brief escaped", async () => {
    const result = await createLocalModelAdapter().execute({
      context,
      profileId: "document-fast",
      task: {
        type: "structured-generation",
        prompt: "Q&A <live>. Bring questions for the panel.",
        schema: { type: "object", properties: { sourceXml: {} } },
      },
    });
    expect(result.result).toEqual({
      sourceXml:
        '<SECTION layout="vertical"><H1>Q&amp;A &lt;live&gt;</H1><P>Bring questions for the panel.</P></SECTION>',
    });
  });

  it("outlines five slides by default, numbering repeated sections", async () => {
    const adapter = createLocalModelAdapter();
    const draft = async (prompt: string) =>
      (
        await adapter.execute({
          context,
          profileId: "document-fast",
          task: { type: "structured-generation", prompt },
        })
      ).result as { title: string; outline: string[] };
    const short = await draft("  ");
    expect(short.title).toBe("New presentation");
    expect(short.outline).toHaveLength(5);
    const long = await draft(
      "Roadmap\n\nCreate an outline for exactly 12 slides.",
    );
    expect(long.outline[10]).toBe("Overview 2: Roadmap");
  });

  it("answers plain text and streams it", async () => {
    const adapter = createLocalModelAdapter();
    const text = await adapter.execute({
      context,
      profileId: "document-fast",
      task: { type: "text-generation", prompt: "Hello" },
    });
    expect(text.result).toEqual({
      text: "Local draft: Hello",
      finishReason: "stop",
    });
    const events = [];
    for await (const event of adapter.stream({
      context,
      profileId: "document-fast",
      task: { type: "streaming-chat", prompt: "Hello" },
    }))
      events.push(event);
    expect(events.map((event) => event.type)).toEqual([
      "started",
      "text-delta",
      "completed",
    ]);
    expect(events[1]).toEqual({
      type: "text-delta",
      text: "Local draft: Hello",
    });
  });
});
