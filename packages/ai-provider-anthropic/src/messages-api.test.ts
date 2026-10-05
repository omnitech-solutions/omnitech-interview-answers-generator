import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AiEvent, AiExecutionRequest } from "@omnitech/ai-contracts";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createAnthropicModelAdapter } from "./index";

// A stand-in Anthropic Messages API: JSON for a message, server-sent events
// for a stream. Each request body is recorded.
const requests: Record<string, unknown>[] = [];
let reply = "Closures capture scope.";
let stopReason = "end_turn";
let hang = false;
let server: Server;

function sse(text: string): string {
  const events: [string, unknown][] = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-test",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 4, output_tokens: 0 },
        },
      },
    ],
    [
      "content_block_start",
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    ],
    ...text.split(" ").map((word, index): [string, unknown] => [
      "content_block_delta",
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: index === 0 ? word : ` ${word}` },
      },
    ]),
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: 3 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ];
  return events
    .map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
}

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      requests.push(parsed);
      if (hang) return;
      if (parsed["stream"]) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(sse(reply));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-test",
          content: [{ type: "text", text: reply }],
          stop_reason: stopReason,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 6 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(() => {
  requests.length = 0;
  stopReason = "end_turn";
  hang = false;
  vi.unstubAllEnvs();
});

function adapter() {
  vi.stubEnv(
    "ANTHROPIC_BASE_URL",
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  );
  return createAnthropicModelAdapter({
    apiKey: "sk-ant-test",
    model: "claude-test",
  });
}

const context = {
  tenantId: "tenant",
  userId: "user",
  productId: "omnitech.interview",
  permissions: [],
};

describe("Anthropic model adapter over the Messages API", () => {
  it("sends the conversation without system turns and reports text and usage", async () => {
    reply = "Closures capture scope.";
    const request: AiExecutionRequest = {
      context,
      task: {
        type: "text-generation",
        prompt: "unused when messages are given",
        system: "Be brief.",
        messages: [
          { role: "system", content: "dropped" },
          { role: "user", content: "What is a closure?" },
          { role: "assistant", content: "A function with scope." },
          { role: "user", content: "Shorter." },
        ],
      },
    };

    const execution = await adapter().execute(request);

    expect(execution).toMatchObject({
      family: "direct-model",
      targetId: "anthropic",
      result: { text: "Closures capture scope.", finishReason: "end_turn" },
      usage: { inputTokens: 10, outputTokens: 6, totalTokens: 16 },
    });
    expect(requests[0]).toMatchObject({
      model: "claude-test",
      max_tokens: 4096,
      system: "Be brief.",
      messages: [
        { role: "user", content: "What is a closure?" },
        { role: "assistant", content: "A function with scope." },
        { role: "user", content: "Shorter." },
      ],
    });
  });

  it("returns structured output parsed against the task schema", async () => {
    reply = '{"answer":"yes"}';

    const execution = await adapter().execute({
      context,
      task: {
        type: "structured-generation",
        prompt: "Is a closure a function?",
        schema: {
          type: "object",
          required: ["answer"],
          properties: { answer: { type: "string" } },
        },
      },
    });

    expect(execution.result).toEqual({ answer: "yes" });
    expect(requests[0]).toMatchObject({
      messages: [{ role: "user", content: "Is a closure a function?" }],
    });
    expect(requests[0]).not.toHaveProperty("system");
  });

  it("streams text deltas between started and completed", async () => {
    reply = "Scope travels along";

    const events: AiEvent[] = [];
    for await (const event of adapter().stream({
      context,
      task: { type: "streaming-chat", prompt: "Explain", system: "Teach." },
    }))
      events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      "started",
      "text-delta",
      "text-delta",
      "text-delta",
      "usage",
      "completed",
    ]);
    expect(
      events
        .flatMap((event) => (event.type === "text-delta" ? [event.text] : []))
        .join(""),
    ).toBe("Scope travels along");
    expect(requests[0]).toMatchObject({ stream: true, system: "Teach." });
  });

  it("reports usage and the stop reason when streaming", async () => {
    reply = "Scope";
    stopReason = "max_tokens";
    const events: AiEvent[] = [];
    for await (const event of adapter().stream({
      context,
      task: { type: "streaming-chat", prompt: "Explain" },
    }))
      events.push(event);
    expect(events.map((event) => event.type)).toEqual([
      "started",
      "text-delta",
      "usage",
      "completed",
    ]);
    expect(events.find((event) => event.type === "usage")).toMatchObject({
      usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
    });
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      result: { finishReason: "max_tokens" },
    });
  });

  it("turns a streamed refusal into a typed failure instead of a completion", async () => {
    stopReason = "refusal";
    const events: AiEvent[] = [];
    for await (const event of adapter().stream({
      context,
      task: { type: "streaming-chat", prompt: "Explain" },
    }))
      events.push(event);
    expect(events.at(-1)).toEqual({
      type: "failed",
      error: {
        code: "policy-refused",
        message: "The model declined this request.",
        retryable: false,
      },
    });
    expect(events.some((event) => event.type === "completed")).toBe(false);
  });

  it("refuses to return a refused non-streamed message as text", async () => {
    stopReason = "refusal";
    await expect(
      adapter().execute({
        context,
        task: { type: "text-generation", prompt: "x" },
      }),
    ).rejects.toThrow("The model declined this request.");
  });

  it("stops a hanging stream when the caller aborts, with a fixed cancelled failure", async () => {
    hang = true;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const events: AiEvent[] = [];
    for await (const event of adapter().stream({
      context,
      task: { type: "streaming-chat", prompt: "Explain" },
      signal: controller.signal,
    }))
      events.push(event);
    expect(events.at(-1)).toEqual({
      type: "failed",
      error: {
        code: "cancelled",
        message: "The AI request was cancelled.",
        retryable: false,
      },
    });
  });

  it("bounds a hanging request by its own timeout without echoing provider text", async () => {
    hang = true;
    vi.stubEnv(
      "ANTHROPIC_BASE_URL",
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    );
    const bounded = createAnthropicModelAdapter({
      apiKey: "sk-ant-test",
      model: "claude-test",
      timeoutMs: 60,
    });
    await expect(
      bounded.execute({
        context,
        task: { type: "text-generation", prompt: "secret prompt text" },
      }),
    ).rejects.toThrow(/no reply within \d+ s\.$/);
  });
});
