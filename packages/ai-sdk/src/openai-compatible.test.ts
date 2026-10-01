import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleProvider } from "./openai-compatible.js";
const options = {
  id: "local",
  label: "Local model",
  model: "test-model",
  baseUrl: "http://localhost:1234/v1/",
  apiKey: randomUUID(),
  headers: { "X-Test": "yes" },
  timeoutMs: 500,
};
function response(text = "answer", reason = "stop", usage?: unknown) {
  return new Response(
    JSON.stringify({
      id: "m",
      object: "chat.completion",
      created: 0,
      model: "test-model",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: reason,
        },
      ],
      ...(usage ? { usage } : {}),
    }),
    { headers: { "content-type": "application/json" } },
  );
}
afterEach(() => vi.unstubAllGlobals());
describe("createOpenAiCompatibleProvider", () => {
  it("configures and describes the provider", async () => {
    let url: unknown;
    let headers: Headers | undefined;
    vi.stubGlobal("fetch", async (u: unknown, init: RequestInit) => {
      url = u;
      headers = new Headers(init.headers);
      return response();
    });
    const p = createOpenAiCompatibleProvider(options);
    expect(p.summary).toEqual({
      id: "local",
      label: "Local model",
      model: "test-model",
    });
    await p.generateText({ prompt: "Q" });
    expect(String(url)).toBe("http://localhost:1234/v1/chat/completions");
    expect(headers?.get("X-Test")).toBe("yes");
  });
  it("maps messages and optional generation settings", async () => {
    let body: any;
    vi.stubGlobal("fetch", async (_u: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return response("answer", "stop", {
        prompt_tokens: 3,
        completion_tokens: 2,
        total_tokens: 5,
      });
    });
    const p = createOpenAiCompatibleProvider(options);
    expect(
      await p.generateText({
        messages: [
          { role: "user", content: "Question" },
          { role: "assistant", content: "Context" },
        ],
        system: "Be concise",
        temperature: 0.2,
        maxOutputTokens: 100,
      }),
    ).toEqual({
      finishReason: "stop",
      providerId: "local",
      text: "answer",
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    });
    expect(body).toMatchObject({
      messages: [
        { role: "system", content: "Be concise" },
        { role: "user", content: "Question" },
        { role: "assistant", content: "Context" },
      ],
      temperature: 0.2,
      max_tokens: 100,
    });
  });
  it("prefers an explicit prompt and omits unavailable usage", async () => {
    let body: any;
    let headers: Headers | undefined;
    vi.stubGlobal("fetch", async (_u: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      headers = new Headers(init.headers);
      return response("partial", "length");
    });
    const { apiKey: _key, headers: _headers, ...anonymous } = options;
    const p = createOpenAiCompatibleProvider({
      ...anonymous,
      headers: { "X-Test": "local-header" },
    });
    expect(
      await p.generateText({ prompt: "Direct prompt", messages: [] }),
    ).toMatchObject({ text: "partial", usage: {} });
    expect(body.messages).toEqual([{ role: "user", content: "Direct prompt" }]);
    expect(headers?.has("authorization")).toBe(false);
    expect(headers?.get("X-Test")).toBe("local-header");
  });
  it("classifies cancellation separately from provider failures", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { message: "failed" } }), {
          status: 400,
        }),
    );
    const p = createOpenAiCompatibleProvider(options);
    const controller = new AbortController();
    controller.abort();
    await expect(
      p.generateText({ prompt: "Q", signal: controller.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
    await expect(p.generateText({ prompt: "Q" })).rejects.toMatchObject({
      code: "provider_failure",
    });
  });
  it("streams text deltas followed by a finish event", async () => {
    const chunks = ["first", " second"].map((content) => ({
      id: "m",
      object: "chat.completion.chunk",
      created: 0,
      model: "m",
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    }));
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
            "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const p = createOpenAiCompatibleProvider(options);
    const events = [];
    for await (const e of p.streamText!({ prompt: "Q" })) events.push(e);
    expect(events).toEqual([
      { type: "text-delta", text: "first" },
      { type: "text-delta", text: " second" },
      { type: "finish" },
    ]);
  });
});
