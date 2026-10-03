import type { ModelProviderAdapter } from "@omnitech/ai-contracts";
import { describe, expect, it } from "vitest";
import { type AiProfile, createAiExecutionGateway } from "./index.js";

const context = {
  tenantId: "t",
  userId: "a",
  productId: "p",
  permissions: ["model:use"],
};
const messages = [
  { role: "user" as const, parts: [{ type: "text" as const, text: "Q" }] },
];
const capabilities = {
  streaming: true,
  structuredOutput: true,
  tools: true,
  vision: false,
  search: false,
};
const model = (id: string) => ({
  id,
  name: id.split("/").at(-1) ?? id,
  tags: [],
  vision: false,
  reasoning: false,
  local: true,
});

function gateway(options: { listing?: () => Promise<readonly unknown[]> }) {
  const streamed: string[] = [];
  const agentStreamed: string[] = [];
  const catalog: ModelProviderAdapter = {
    providerId: "lm-studio-catalog",
    capabilities,
    listModels: async () =>
      (await (options.listing?.() ??
        Promise.resolve([
          model("lm-studio/qwen"),
          model("lm-studio/gemma"),
        ]))) as never,
    async execute() {
      throw new Error("unused");
    },
    async *stream() {},
    async *streamStructured(request) {
      streamed.push(request.profileId);
      yield { type: "text", text: "{}" };
    },
  };
  const profiles: AiProfile[] = [
    {
      id: "document-fast",
      label: "Fast",
      family: "direct-model",
      targetId: "lm-studio-catalog",
      taskTypes: ["text-generation"],
      enabled: true,
    },
    {
      id: "assistant",
      label: "Assistant",
      family: "direct-model",
      targetId: "lm-studio-catalog",
      taskTypes: ["structured-chat"],
      enabled: true,
      listing: {
        name: "Default",
        tags: [],
        vision: false,
        reasoning: false,
        local: true,
      },
    },
    {
      id: "lm-studio",
      label: "LM Studio",
      family: "direct-model",
      targetId: "lm-studio-catalog",
      taskTypes: ["structured-chat"],
      enabled: true,
      catalog: true,
    },
    {
      id: "agent/codex",
      label: "Codex",
      family: "agent-runtime",
      targetId: "codex",
      taskTypes: ["structured-chat"],
      enabled: true,
    },
  ];
  const result = createAiExecutionGateway({
    profiles,
    models: [catalog],
    images: [],
    agents: {
      async execute() {
        throw new Error("unused");
      },
      async *stream() {},
      async *streamStructured(request) {
        agentStreamed.push(request.profileId);
        yield { type: "text", text: "agent" };
      },
      async cancel() {},
      async *resume() {},
    },
    authorize: async () => true,
  });
  return { result, streamed, agentStreamed };
}

async function collect(source: AsyncIterable<unknown>) {
  const out = [];
  for await (const part of source) out.push(part);
  return out;
}

describe("catalog targets", () => {
  it("expand into one target per listed model for a task filter", async () => {
    const targets = await gateway({}).result.listAvailableTargets(context, {
      taskType: "structured-chat",
    });
    expect(targets.map((target) => target.id)).toEqual([
      "assistant",
      "lm-studio/qwen",
      "lm-studio/gemma",
      "agent/codex",
    ]);
    expect(targets[0]?.listing).toMatchObject({
      id: "assistant",
      name: "Default",
    });
    expect(targets[1]).toMatchObject({
      label: "qwen",
      modelId: "qwen",
      listing: model("lm-studio/qwen"),
    });
  });

  it("are left out of an unfiltered listing", async () => {
    const targets = await gateway({}).result.listAvailableTargets(context);
    expect(targets.map((target) => target.id)).toEqual([
      "document-fast",
      "assistant",
      "agent/codex",
    ]);
  });

  it("skip a catalog whose listing fails", async () => {
    const targets = await gateway({
      listing: () => Promise.reject(new Error("down")),
    }).result.listAvailableTargets(context, { taskType: "structured-chat" });
    expect(targets.map((target) => target.id)).toEqual([
      "assistant",
      "agent/codex",
    ]);
  });

  it("stream a listed model through its catalog adapter", async () => {
    const g = gateway({});
    await collect(
      g.result.streamStructured({
        context,
        profileId: "lm-studio/qwen",
        messages,
      }),
    );
    expect(g.streamed).toEqual(["lm-studio/qwen"]);
  });

  it("refuse a model the catalog does not list", async () => {
    const g = gateway({});
    await expect(
      collect(
        g.result.streamStructured({
          context,
          profileId: "lm-studio/paid-model",
          messages,
        }),
      ),
    ).rejects.toThrow(/unavailable/);
    expect(g.streamed).toEqual([]);
  });
});

describe("agent structured chat", () => {
  it("delegates an agent-runtime profile to the agent port", async () => {
    const g = gateway({});
    expect(
      await collect(
        g.result.streamStructured({
          context,
          profileId: "agent/codex",
          messages,
        }),
      ),
    ).toEqual([{ type: "text", text: "agent" }]);
    expect(g.agentStreamed).toEqual(["agent/codex"]);
  });
});
