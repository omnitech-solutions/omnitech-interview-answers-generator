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
import { createAnthropicModelAdapter } from "./index.js";

// A stand-in Anthropic Messages API: JSON for a message, server-sent events
// for a stream. Each request body is recorded.
const requests: Record<string, unknown>[] = [];
let reply = "Closures capture scope.";
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
        delta: { stop_reason: "end_turn", stop_sequence: null },
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
          stop_reason: "end_turn",
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
      "completed",
    ]);
    expect(
      events
        .flatMap((event) => (event.type === "text-delta" ? [event.text] : []))
        .join(""),
    ).toBe("Scope travels along");
    expect(requests[0]).toMatchObject({ stream: true, system: "Teach." });
  });
});
