import type {
  AiAccessContext,
  AiEvent,
  AiExecutionRequest,
  ImageProviderAdapter,
  ModelProviderAdapter,
} from "@omnitech/ai-contracts";
import { describe, expect, it } from "vitest";
import {
  type AgentExecutionPort,
  type AiProfile,
  createAiExecutionGateway,
} from "./index.js";

const context: AiAccessContext = {
  tenantId: "tenant-1",
  userId: "user-1",
  productId: "omnitech.interview",
  permissions: ["ai.use"],
};

const profiles: AiProfile[] = [
  {
    id: "writer",
    label: "Writer",
    family: "direct-model",
    targetId: "text-provider",
    taskTypes: ["text-generation", "streaming-chat"],
    enabled: true,
  },
  {
    id: "illustrator",
    label: "Illustrator",
    family: "direct-model",
    targetId: "image-provider",
    taskTypes: ["image-generation", "image-editing"],
    enabled: true,
  },
  {
    id: "sketcher",
    label: "Sketcher",
    family: "direct-model",
    targetId: "generate-only-images",
    taskTypes: ["image-editing"],
    enabled: true,
  },
  {
    id: "coach",
    label: "Coach",
    family: "agent-runtime",
    targetId: "codex",
    taskTypes: ["agent-job"],
    enabled: true,
  },
  {
    id: "missing-text",
    label: "Missing text",
    family: "direct-model",
    targetId: "absent-provider",
    taskTypes: ["text-generation", "streaming-chat"],
    enabled: true,
  },
  {
    id: "missing-image",
    label: "Missing image",
    family: "direct-model",
    targetId: "absent-provider",
    taskTypes: ["image-generation"],
    enabled: true,
  },
  {
    id: "restricted",
    label: "Restricted",
    family: "direct-model",
    targetId: "text-provider",
    taskTypes: ["text-generation"],
    enabled: true,
  },
  {
    id: "retired",
    label: "Retired",
    family: "direct-model",
    targetId: "text-provider",
    taskTypes: ["text-generation"],
    enabled: false,
  },
];

const textProvider: ModelProviderAdapter = {
  providerId: "text-provider",
  modelId: "text-model-1",
  capabilities: {
    streaming: true,
    structuredOutput: false,
    tools: false,
    vision: false,
    search: false,
  },
  async execute(request) {
    return {
      executionId: "text-1",
      family: "direct-model",
      targetId: "text-provider",
      result: `echo: ${request.task.prompt}`,
    };
  },
  async *stream(request) {
    yield { type: "text-delta", text: request.task.prompt };
    yield { type: "completed", result: "done" };
  },
};

const image = (operation: string) => ({
  assetReference: `asset:${operation}`,
  mimeType: "image/png",
  providerId: "image-provider",
  modelId: "image-model",
  provenance: { operation },
});

const imageProvider: ImageProviderAdapter = {
  providerId: "image-provider",
  capabilities: { generation: true, editing: true, aspectRatios: ["1:1"] },
  async generate() {
    return image("generate");
  },
  async edit() {
    return image("edit");
  },
};

const generateOnlyImages: ImageProviderAdapter = {
  providerId: "generate-only-images",
  capabilities: { generation: true, editing: false, aspectRatios: ["1:1"] },
  async generate() {
    return { ...image("generate"), providerId: "generate-only-images" };
  },
};

function agentPort() {
  const calls: string[] = [];
  const port: AgentExecutionPort = {
    async execute(request, profile) {
      calls.push(`execute:${profile.id}`);
      return {
        executionId: "job-1",
        family: "agent-runtime",
        targetId: profile.targetId,
        result: request.task.prompt,
      };
    },
    async *stream(_request, profile) {
      calls.push(`stream:${profile.id}`);
      yield { type: "started", executionId: "job-1" };
    },
    async cancel(cancelContext, executionId) {
      calls.push(`cancel:${cancelContext.tenantId}:${executionId}`);
    },
    async *resume(request) {
      calls.push(`resume:${request.executionId}`);
      yield { type: "completed", result: request.input };
    },
  };
  return { port, calls };
}

function gateway() {
  const agents = agentPort();
  return {
    calls: agents.calls,
    gateway: createAiExecutionGateway({
      profiles,
      models: [textProvider],
      images: [imageProvider, generateOnlyImages],
      agents: agents.port,
      authorize: async (_context, profile) => profile.id !== "restricted",
    }),
  };
}

function request(
  profileId: string | undefined,
  type: AiExecutionRequest["task"]["type"],
): AiExecutionRequest {
  return {
    context,
    ...(profileId === undefined ? {} : { profileId }),
    task: { type, prompt: "Explain closures" },
  };
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}

describe("AI execution gateway", () => {
  it("executes a text task on the profile's model provider", async () => {
    const execution = await gateway().gateway.execute(
      request("writer", "text-generation"),
    );

    expect(execution).toMatchObject({
      targetId: "text-provider",
      result: "echo: Explain closures",
    });
  });

  it("generates and edits images through the image provider", async () => {
    const { gateway: ai } = gateway();

    const generated = await ai.execute(
      request("illustrator", "image-generation"),
    );
    const edited = await ai.execute(request("illustrator", "image-editing"));
    // A provider without editing falls back to generation.
    const fallback = await ai.execute(request("sketcher", "image-editing"));

    expect(generated).toMatchObject({
      family: "direct-model",
      targetId: "image-provider",
      result: { assetReference: "asset:generate" },
    });
    expect(generated.executionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(edited.result).toMatchObject({ assetReference: "asset:edit" });
    expect(fallback).toMatchObject({
      targetId: "generate-only-images",
      result: { assetReference: "asset:generate" },
    });
  });

  it("delegates agent profiles to the agent execution port", async () => {
    const { gateway: ai, calls } = gateway();

    const execution = await ai.execute(request("coach", "agent-job"));
    const events = await collect(ai.stream(request("coach", "agent-job")));
    await ai.cancel(context, "job-1");
    const resumed = await collect(
      ai.resume({ context, executionId: "job-1", input: "continue" }),
    );

    expect(execution).toMatchObject({
      family: "agent-runtime",
      targetId: "codex",
    });
    expect(events).toEqual([{ type: "started", executionId: "job-1" }]);
    expect(resumed).toEqual([{ type: "completed", result: "continue" }]);
    expect(calls).toEqual([
      "execute:coach",
      "stream:coach",
      "cancel:tenant-1:job-1",
      "resume:job-1",
    ]);
  });

  it("streams a model profile's events", async () => {
    const events = await collect(
      gateway().gateway.stream(request("writer", "streaming-chat")),
    );

    expect(events).toEqual<AiEvent[]>([
      { type: "text-delta", text: "Explain closures" },
      { type: "completed", result: "done" },
    ]);
  });

  it("refuses unknown, disabled, mismatched and unauthorized profiles", async () => {
    const { gateway: ai } = gateway();
    const unavailable =
      "The requested AI profile is unavailable for this task.";

    await expect(
      ai.execute(request(undefined, "text-generation")),
    ).rejects.toThrow(unavailable);
    await expect(
      ai.execute(request("retired", "text-generation")),
    ).rejects.toThrow(unavailable);
    await expect(
      ai.execute(request("writer", "image-generation")),
    ).rejects.toThrow(unavailable);
    await expect(
      ai.execute(request("restricted", "text-generation")),
    ).rejects.toThrow(
      "The current tenant is not authorized for this AI profile.",
    );
  });

  it("reports a profile whose provider is not configured", async () => {
    const { gateway: ai } = gateway();

    await expect(
      ai.execute(request("missing-text", "text-generation")),
    ).rejects.toThrow("The configured model provider is unavailable.");
    await expect(
      ai.execute(request("missing-image", "image-generation")),
    ).rejects.toThrow("The configured image provider is unavailable.");
    await expect(
      collect(ai.stream(request("missing-text", "streaming-chat"))),
    ).rejects.toThrow("The configured target cannot stream this task.");
  });

  it("lists only enabled, authorized targets with their kind and model", async () => {
    const targets = await gateway().gateway.listAvailableTargets(context);

    expect(targets.map((target) => target.id)).toEqual([
      "writer",
      "illustrator",
      "sketcher",
      "coach",
      "missing-text",
      "missing-image",
    ]);
    expect(targets[0]).toEqual({
      id: "writer",
      label: "Writer",
      modelId: "text-model-1",
      family: "direct-model",
      kind: "language",
      capabilities: ["text-generation", "streaming-chat"],
    });
    expect(targets[1]).toMatchObject({ kind: "image" });
    expect(targets[1]).not.toHaveProperty("modelId");
  });

  it("refuses structured chat on an agent profile or a provider without it", async () => {
    const ai = createAiExecutionGateway({
      profiles: [
        { ...profiles[3]!, taskTypes: ["structured-chat"] },
        { ...profiles[0]!, taskTypes: ["structured-chat"] },
      ],
      models: [textProvider],
      images: [],
      agents: agentPort().port,
      authorize: async () => true,
    });
    const chat = (profileId: string) =>
      collect(
        ai.streamStructured({
          context,
          profileId,
          messages: [],
          schema: { type: "object" },
        }),
      );

    await expect(chat("coach")).rejects.toThrow(
      "The profile cannot execute structured chat.",
    );
    await expect(chat("writer")).rejects.toThrow(
      "The configured provider cannot stream structured chat.",
    );
  });
});
