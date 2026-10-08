import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatRequestError, createChatCompletions } from "./chat-completions";

// biome-ignore lint/suspicious/noExplicitAny: JSON read back from the code under test; each assertion names the fields it checks
type Json = any;

const keyed = {
  label: "Local model",
  model: "test-model",
  baseUrl: "http://localhost:1234/v1/",
  apiKey: randomUUID(),
  timeoutMs: 500,
};
const anonymous = {
  label: "LM Studio",
  model: "m",
  baseUrl: "http://127.0.0.1:1234/v1/",
};

function completion(text = "answer", reason = "stop", usage?: unknown) {
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

async function collect(source: AsyncIterable<string>) {
  const out: string[] = [];
  for await (const text of source) out.push(text);
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createChatCompletions", () => {
  it("sends system, messages and schema, and normalises usage", async () => {
    let url: unknown;
    let body: Json;
    vi.stubGlobal("fetch", async (u: unknown, init: RequestInit) => {
      url = u;
      body = JSON.parse(String(init.body));
      return completion("answer", "stop", {
        prompt_tokens: 3,
        completion_tokens: 2,
        total_tokens: 5,
      });
    });
    const schema = { type: "object" };
    expect(
      await createChatCompletions(keyed).generate({
        system: "Be concise",
        messages: [
          { role: "user", content: "Question" },
          { role: "assistant", content: "Context" },
        ],
        responseSchema: schema,
      }),
    ).toEqual({
      finishReason: "stop",
      text: "answer",
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    });
    expect(String(url)).toBe("http://localhost:1234/v1/chat/completions");
    expect(body).toMatchObject({
      model: "test-model",
      messages: [
        { role: "system", content: "Be concise" },
        { role: "user", content: "Question" },
        { role: "assistant", content: "Context" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "structured_output", strict: true, schema },
      },
    });
  });

  it("prefers an explicit prompt and sends no credentials to LM Studio", async () => {
    let body: Json;
    let headers: Headers | undefined;
    vi.stubGlobal("fetch", async (_u: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      headers = new Headers(init.headers);
      return completion("partial", "length");
    });
    expect(
      await createChatCompletions(anonymous).generate({
        prompt: "Direct prompt",
        messages: [{ role: "user", content: "ignored" }],
      }),
    ).toEqual({ finishReason: "length", text: "partial", usage: {} });
    expect(body.messages).toEqual([{ role: "user", content: "Direct prompt" }]);
    expect(headers?.has("authorization")).toBe(false);
  });

  it("refuses an anonymous endpoint that is not on this machine", () => {
    expect(() =>
      createChatCompletions({
        ...anonymous,
        baseUrl: "https://remote.test/v1",
      }),
    ).toThrow();
  });

  it("classifies cancellation separately from provider failures", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { message: "failed" } }), {
          status: 400,
        }),
    );
    const chat = createChatCompletions(keyed);
    const controller = new AbortController();
    controller.abort();
    await expect(
      chat.generate({ prompt: "Q", signal: controller.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
    const failure = await chat.generate({ prompt: "Q" }).catch((e) => e);
    expect(failure).toBeInstanceOf(ChatRequestError);
    expect(failure).toMatchObject({ code: "provider" });
    // The kind of failure and the model, never the provider's own message.
    expect(failure.message).toBe("Local model (test-model) failed: HTTP 400.");
  });

  it("says when the provider does not answer in time or cannot be reached", async () => {
    // Stub first: the OpenAI client keeps the fetch it is created with.
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(
      createChatCompletions(keyed).generate({ prompt: "Q" }),
    ).rejects.toThrow(/failed: no reply within 1 s\.$/);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
      });
    });
    await expect(
      createChatCompletions(anonymous).generate({ prompt: "Q" }),
    ).rejects.toThrow(
      /failed: (could not connect to http:\/\/127\.0\.0\.1:1234|unexpected error)\.$/,
    );
  });

  it("retries LM Studio while it is busy, then gives up after three attempts", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts++;
      return new Response("{}", { status: 503 });
    });
    const failure = createChatCompletions({
      ...anonymous,
      timeoutMs: 60_000,
    })
      .generate({ prompt: "Q" })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2000 + 4000);
    expect(await failure).toMatchObject({
      code: "provider",
      message: "LM Studio (m) failed: unexpected error.",
    });
    expect(attempts).toBe(3);
  });

  it("does not retry a request LM Studio rejects", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts++;
      return new Response("{}", { status: 400 });
    });
    await expect(
      createChatCompletions(anonymous).generate({ prompt: "Q" }),
    ).rejects.toMatchObject({ code: "provider" });
    expect(attempts).toBe(1);
  });

  it("streams text deltas from either transport", async () => {
    const chunks = ["first", "", " second"].map((content) => ({
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
    expect(
      await collect(createChatCompletions(keyed).stream({ prompt: "Q" })),
    ).toEqual(["first", " second"]);
    expect(
      await collect(createChatCompletions(anonymous).stream({ prompt: "Q" })),
    ).toEqual(["first", " second"]);
  });

  it("reports a failed stream as a provider failure", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
    await expect(
      collect(createChatCompletions(keyed).stream({ prompt: "Q" })),
    ).rejects.toMatchObject({ code: "provider" });
  });
});
