import { describe, expect, it } from "vitest";
import { createAiExecutionGateway, createGatewayModelPort } from "./index.js";
const context = {
  tenantId: "t",
  userId: "a",
  productId: "p",
  permissions: ["model:use"],
};
const messages = [
  { role: "user" as const, parts: [{ type: "text" as const, text: "Q" }] },
];
const request = {
  context,
  profileId: "local",
  messages,
  schema: { type: "object" },
};
const profile = {
  id: "local",
  label: "Local",
  family: "direct-model" as const,
  targetId: "provider",
  enabled: true,
  taskTypes: ["structured-chat"],
};
function gateway(allowed: boolean, enabled = true) {
  let delegated = 0;
  let authorized = 0;
  let captured: unknown;
  const result = createAiExecutionGateway({
    profiles: [{ ...profile, enabled }],
    models: [
      {
        providerId: "provider",
        modelId: "native",
        capabilities: {
          streaming: true,
          structuredOutput: true,
          tools: true,
          vision: false,
          search: false,
        },
        async execute() {
          throw new Error("unused");
        },
        async *stream() {},
        async *streamStructured(input) {
          delegated++;
          captured = input;
          yield { type: "text", text: "{}" };
        },
      },
    ],
    images: [],
    agents: {
      async execute() {
        throw new Error("unused");
      },
      async *stream() {},
      async cancel() {},
      async *resume() {},
    },
    async authorize() {
      authorized++;
      return allowed;
    },
  });
  return { result, counters: () => ({ delegated, authorized, captured }) };
}
async function collect(source: AsyncIterable<unknown>) {
  const out = [];
  for await (const p of source) out.push(p);
  return out;
}
describe("governed structured chat", () => {
  it("denies unauthorized profiles before provider delegation", async () => {
    const g = gateway(false);
    await expect(collect(g.result.streamStructured(request))).rejects.toThrow(
      /authorized/,
    );
    expect(g.counters().delegated).toBe(0);
    expect(g.counters().authorized).toBe(1);
  });
  it("denies disabled and unknown profiles before authorization/delegation", async () => {
    const g = gateway(true, false);
    await expect(collect(g.result.streamStructured(request))).rejects.toThrow(
      /unavailable/,
    );
    expect(g.counters()).toMatchObject({ delegated: 0, authorized: 0 });
    await expect(
      collect(g.result.streamStructured({ ...request, profileId: "unknown" })),
    ).rejects.toThrow(/unavailable/);
    expect(g.counters()).toMatchObject({ delegated: 0, authorized: 0 });
  });
  it("preserves structured input and maps verified scope through the gateway", async () => {
    const g = gateway(true);
    const port = createGatewayModelPort(g.result, async () => ["model:use"]);
    expect(
      await collect(
        port.stream(
          { tenantId: "t", actorId: "a", productId: "p" },
          { profileId: "local", messages, schema: { type: "object" } },
          new AbortController().signal,
        ),
      ),
    ).toEqual([{ type: "text", text: "{}" }]);
    expect(g.counters()).toMatchObject({
      delegated: 1,
      authorized: 1,
      captured: { context, messages },
    });
  });
});
