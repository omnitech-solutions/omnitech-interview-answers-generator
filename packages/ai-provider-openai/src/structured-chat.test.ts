import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiModelAdapter } from "./index";
import { parseStructuredOutput } from "./structured-output";

const schema = {
  type: "object",
  properties: { value: { $ref: "#/$defs/value" } },
  required: ["value"],
  additionalProperties: false,
  $defs: { value: { enum: [0, false, null] } },
};
const context = { tenantId: "t", userId: "u", productId: "p", permissions: [] };
afterEach(() => vi.unstubAllGlobals());
function stream(content: string) {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}
async function collect(source: AsyncIterable<unknown>) {
  const out = [];
  for await (const part of source) out.push(part);
  return out;
}
describe("host structured adapter", () => {
  it("preserves schema, roles, model and limits in built local provider request bytes", async () => {
    let body: any;
    let headers: Headers | undefined;
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      headers = new Headers(init.headers);
      return stream('{"value":false}');
    });
    const adapter = createOpenAiModelAdapter({
      id: "local-provider",
      label: "Local",
      model: "native-model",
      baseUrl: "http://127.0.0.1:1234/v1",
      maxOutputTokens: 77,
    });
    const out = await collect(
      adapter.streamStructured!({
        context,
        profileId: "logical-profile",
        schema,
        messages: [
          { role: "system", parts: [{ type: "text", text: "Rules" }] },
          { role: "user", parts: [{ type: "text", text: "Q" }] },
          {
            role: "assistant",
            parts: [
              { type: "tool-call", id: "call-17", name: "lookup", input: {} },
            ],
          },
          {
            role: "tool",
            parts: [
              { type: "tool-result", id: "call-17", output: { ok: false } },
            ],
          },
        ],
      }),
    );
    expect(body.model).toBe("native-model");
    expect(body.max_completion_tokens).toBe(77);
    expect(body.response_format.json_schema.schema).toEqual(schema);
    expect(body.messages[3]).toMatchObject({
      role: "tool",
      tool_call_id: "call-17",
    });
    expect(headers?.has("Authorization")).toBe(false);
    expect(out.at(-1)).toMatchObject({
      type: "usage",
      usage: { status: "unavailable", cost: { status: "unavailable" } },
    });
  });
  it("fails invalid final output after text and validates streamed structured output against the schema", async () => {
    vi.stubGlobal("fetch", async () => stream('{"value":1}'));
    const adapter = createOpenAiModelAdapter({
      id: "local",
      label: "Local",
      model: "m",
      baseUrl: "http://localhost:1234/v1",
    });
    await expect(
      collect(
        adapter.streamStructured!({
          context,
          profileId: "p",
          schema,
          messages: [{ role: "user", parts: [{ type: "text", text: "Q" }] }],
        }),
      ),
    ).rejects.toThrow(/Invalid final output schema/);
    expect(() => parseStructuredOutput('{"value":1}', schema)).toThrow(
      /validation failed/,
    );
    expect(parseStructuredOutput('{"value":null}', schema)).toEqual({
      value: null,
    });
  });
});
