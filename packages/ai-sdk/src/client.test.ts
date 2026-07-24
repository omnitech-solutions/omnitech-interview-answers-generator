import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { createAiClient } from "./client.js";
import type { AiProvider } from "./types.js";

function providerWithText(text = '{"answer":42}'): AiProvider {
  return {
    summary: { id: "fake", label: "Fake", model: "fake-1" },
    async generateText() {
      return {
        finishReason: "stop",
        providerId: "fake",
        text,
        usage: {},
      };
    },
  };
}

async function* streamHello() {
  yield { type: "text-delta" as const, text: "hello" };
  yield { type: "finish" as const };
}

describe("createAiClient", () => {
  it("rejects missing providers and an unknown default", () => {
    expect(() => createAiClient({ providers: [] })).toThrow(
      "At least one AI provider is required.",
    );
    expect(() =>
      createAiClient({
        providers: [providerWithText()],
        defaultProviderId: "missing",
      }),
    ).toThrow('Default provider "missing" is not configured.');
  });

  it("lists providers, selects the default, and forwards generation", async () => {
    const provider = providerWithText();
    const generateText = vi.fn(provider.generateText);
    const client = createAiClient({
      providers: [{ ...provider, generateText }],
    });

    expect(client.listProviders()).toEqual([provider.summary]);
    expect(client.getDefaultProviderId()).toBe("fake");
    await client.generateText({ prompt: "hello", temperature: 0 });
    expect(generateText).toHaveBeenCalledWith({
      prompt: "hello",
      temperature: 0,
    });
  });

  it("rejects an unknown provider selected per request", () => {
    const client = createAiClient({ providers: [providerWithText()] });

    expect(() =>
      client.generateText({ prompt: "hello", providerId: "missing" }),
    ).toThrow('AI provider "missing" is not configured.');
  });

  it.each([
    ["plain", '{"answer":42}'],
    ["fenced", '```json\n{"answer":42}\n```'],
    ["surrounding prose", 'Result: {"answer":42} done'],
  ])("extracts a valid object from %s output", async (_name, text) => {
    const client = createAiClient({ providers: [providerWithText(text)] });

    await expect(
      client.generateObject({
        prompt: "answer",
        system: "Be concise.",
        schema: z.object({ answer: z.number() }),
      }),
    ).resolves.toMatchObject({ object: { answer: 42 } });
  });

  it.each([
    ["no object", "not json", "did not return a JSON object"],
    ["invalid JSON", "{broken}", "returned invalid JSON"],
    ["schema mismatch", '{"answer":"no"}', "did not match"],
  ])("reports %s as invalid output", async (_name, text, message) => {
    const client = createAiClient({ providers: [providerWithText(text)] });

    await expect(
      client.generateObject({
        prompt: "answer",
        schema: z.object({ answer: z.number() }),
      }),
    ).rejects.toThrow(message);
  });

  it("requires streaming support and delegates when available", async () => {
    const client = createAiClient({ providers: [providerWithText()] });
    expect(() => client.streamText({ prompt: "hello" })).toThrow(
      'AI provider "fake" does not support streaming.',
    );

    const streamingClient = createAiClient({
      providers: [{ ...providerWithText(), streamText: streamHello }],
    });
    const events = [];
    for await (const event of streamingClient.streamText({ prompt: "hello" })) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: "text-delta", text: "hello" },
      { type: "finish" },
    ]);
  });
});
