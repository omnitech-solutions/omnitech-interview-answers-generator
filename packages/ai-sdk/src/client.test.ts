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

  it("sends one correction turn with the failing fields, then accepts the fix", async () => {
    const replies = ['{"answer":"forty-two"}', '{"answer":42}'];
    const generateText = vi.fn(async () => ({
      finishReason: "stop",
      providerId: "fake",
      text: replies.shift()!,
      usage: { inputTokens: 10, outputTokens: 5 },
    }));
    const client = createAiClient({
      providers: [{ ...providerWithText(), generateText }],
    });

    const result = await client.generateObject({
      prompt: "answer",
      schema: z.object({ answer: z.number() }),
    });
    expect(result.object).toEqual({ answer: 42 });
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    const correction = (
      generateText.mock.calls[1] as unknown as [
        { messages: { content: string }[] },
      ]
    )[0].messages;
    expect(correction.map((message) => message.content)).toEqual([
      "answer",
      '{"answer":"forty-two"}',
      expect.stringContaining("- answer: Invalid input: expected number"),
    ]);
  });

  it("names the model and the failing fields when the correction fails too", async () => {
    const client = createAiClient({
      providers: [providerWithText('{"answer":"no"}')],
    });
    await expect(
      client.generateObject({
        prompt: "answer",
        schema: z.object({ answer: z.number() }),
      }),
    ).rejects.toThrow(
      /^Fake \(fake-1\) returned a reply that did not match the required format, even after one correction: answer: /,
    );
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
