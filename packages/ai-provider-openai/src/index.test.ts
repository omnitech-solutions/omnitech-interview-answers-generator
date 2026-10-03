import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiModelAdapter } from "./index.js";

const context = { tenantId: "t", userId: "u", productId: "p", permissions: [] };

function adapter() {
  return createOpenAiModelAdapter({
    id: "test-openai",
    label: "Test OpenAI",
    model: "test-model",
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:9/v1",
  });
}

function completion(content: string) {
  return Response.json({
    id: "m",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenAI model adapter", () => {
  it("exposes the provider-neutral capability contract", () => {
    expect(adapter().providerId).toBe("test-openai");
    expect(adapter().capabilities).toMatchObject({
      streaming: true,
      structuredOutput: true,
    });
  });

  it("generates text", async () => {
    vi.stubGlobal("fetch", async () => completion("hello"));
    expect(
      await adapter().execute({
        context,
        task: { type: "text-generation", prompt: "Q" },
      }),
    ).toMatchObject({
      family: "direct-model",
      targetId: "test-openai",
      result: { text: "hello", finishReason: "stop" },
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    });
  });

  it("asks once more when a structured reply breaks its schema", async () => {
    const systems: string[] = [];
    const replies = ['{"answer":"x"}', '{"answer":42}'];
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      systems.push(body.messages[0].content);
      return completion(replies.shift()!);
    });
    const schema = {
      type: "object",
      properties: { answer: { type: "number" } },
      required: ["answer"],
    };
    expect(
      (
        await adapter().execute({
          context,
          task: { type: "structured-generation", prompt: "Q", schema },
        })
      ).result,
    ).toEqual({ answer: 42 });
    expect(systems[0]).toBe("Return exactly one JSON object without Markdown.");
    expect(systems[1]).toMatch(/Your previous response was invalid/);
  });

  it("streams text deltas between start and completion", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          `data: ${JSON.stringify({ id: "m", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const events = [];
    for await (const event of adapter().stream({
      context,
      task: {
        type: "streaming-chat",
        prompt: "Q",
        system: "Rules",
        messages: [{ role: "user", content: "Q" }],
      },
    }))
      events.push(event.type === "started" ? { type: "started" } : event);
    expect(events).toEqual([
      { type: "started" },
      { type: "text-delta", text: "hi" },
      { type: "completed", result: { executionId: expect.any(String) } },
    ]);
  });
});
