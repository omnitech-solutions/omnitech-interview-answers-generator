import {
  type AiAccessContext,
  type AiExecutionRequest,
  AiPolicyRefusedError,
  type AiProcessingPolicy,
  type ImageProviderAdapter,
  type ModelProviderAdapter,
} from "@omnitech/ai-contracts";
import { describe, expect, it } from "vitest";
import {
  type AgentExecutionPort,
  type AiLocality,
  type AiProfile,
  createAiExecutionGateway,
} from "./index";

const context: AiAccessContext = {
  tenantId: "tenant-1",
  userId: "user-1",
  productId: "omnitech.interview",
  permissions: ["ai.use"],
};

// Spies count every call that reaches an adapter or the agent port.
function spies() {
  const calls: string[] = [];
  const model: ModelProviderAdapter = {
    providerId: "model",
    modelId: "m",
    capabilities: {
      streaming: true,
      structuredOutput: true,
      tools: false,
      vision: false,
      search: false,
    },
    async listModels() {
      calls.push("model.listModels");
      return [{ id: "catalog/one", name: "One" } as never];
    },
    async execute() {
      calls.push("model.execute");
      return {
        executionId: "e",
        family: "direct-model",
        targetId: "model",
        result: "ok",
      };
    },
    async *stream() {
      calls.push("model.stream");
      yield { type: "completed", result: "ok" };
    },
    async *streamStructured() {
      calls.push("model.streamStructured");
      yield { type: "text-delta", text: "ok" } as never;
    },
  };
  const image: ImageProviderAdapter = {
    providerId: "image",
    capabilities: { generation: true, editing: true, aspectRatios: [] },
    async generate() {
      calls.push("image.generate");
      return {
        assetReference: "a",
        mimeType: "image/png",
        providerId: "image",
        modelId: "i",
        provenance: {},
      };
    },
    async edit() {
      calls.push("image.edit");
      return {
        assetReference: "a",
        mimeType: "image/png",
        providerId: "image",
        modelId: "i",
        provenance: {},
      };
    },
  };
  const agents: AgentExecutionPort = {
    async execute() {
      calls.push("agent.execute");
      return {
        executionId: "j",
        family: "agent-runtime",
        targetId: "codex",
        result: "ok",
      };
    },
    async *stream() {
      calls.push("agent.stream");
      yield { type: "started", executionId: "j" };
    },
    async cancel() {
      calls.push("agent.cancel");
    },
    async *resume() {
      calls.push("agent.resume");
      yield { type: "completed", result: "ok" };
    },
    async *streamStructured() {
      calls.push("agent.streamStructured");
      yield { type: "text-delta", text: "ok" } as never;
    },
  };
  return { calls, model, image, agents };
}

const direct = (
  id: string,
  locality: AiLocality | undefined,
  taskTypes: string[] = [
    "text-generation",
    "streaming-chat",
    "structured-chat",
  ],
): AiProfile => ({
  id,
  label: id,
  family: "direct-model",
  targetId: "model",
  taskTypes,
  enabled: true,
  ...(locality === undefined ? {} : { locality }),
});

function build(profiles: AiProfile[]) {
  const s = spies();
  const gateway = createAiExecutionGateway({
    profiles,
    models: [s.model],
    images: [s.image],
    agents: s.agents,
    authorize: async () => true,
  });
  return { ...s, gateway };
}

const request = (
  profileId: string,
  type: AiExecutionRequest["task"]["type"],
  processingPolicy?: AiProcessingPolicy,
): AiExecutionRequest => ({
  context,
  profileId,
  task: { type, prompt: "secret question" },
  ...(processingPolicy === undefined ? {} : { processingPolicy }),
});

async function drain(source: AsyncIterable<unknown>) {
  for await (const _ of source);
}

const structured = (
  profileId: string,
  processingPolicy?: AiProcessingPolicy,
) => ({
  context,
  profileId,
  messages: [],
  schema: { type: "object" },
  ...(processingPolicy === undefined ? {} : { processingPolicy }),
});

describe("device-only locality", () => {
  const refusedProfiles: Array<[string, AiLocality | undefined]> = [
    ["remote", "remote"],
    ["undeclared", undefined],
    ["private-network", "private-network"],
    ["unknown declaration", "elsewhere" as AiLocality],
  ];

  it.each(refusedProfiles)(
    "refuses a %s profile on every method with zero adapter calls",
    async (_name, locality) => {
      const { gateway, calls } = build([direct("p", locality)]);
      const refused = (promise: Promise<unknown>) =>
        expect(promise).rejects.toBeInstanceOf(AiPolicyRefusedError);

      await refused(
        gateway.execute(request("p", "text-generation", "device-only")),
      );
      await refused(
        drain(gateway.stream(request("p", "streaming-chat", "device-only"))),
      );
      await refused(
        drain(gateway.streamStructured(structured("p", "device-only"))),
      );

      expect(calls).toEqual([]);
    },
  );

  it("refuses image profiles and agent jobs, never reaching their ports", async () => {
    const { gateway, calls } = build([
      {
        ...direct("pic", "remote", ["image-generation", "image-editing"]),
        targetId: "image",
      },
      {
        ...direct("pic-local", "remote", ["image-generation"]),
        targetId: "image",
      },
      {
        id: "job",
        label: "Job",
        family: "agent-runtime",
        targetId: "codex",
        taskTypes: ["agent-job", "structured-chat"],
        enabled: true,
        // An agent profile is never device, even if misdeclared.
        locality: "device",
      },
    ]);

    await expect(
      gateway.execute(request("pic", "image-editing", "device-only")),
    ).rejects.toMatchObject({ code: "policy-refused", retryable: false });
    await expect(
      gateway.execute(request("pic-local", "image-generation", "device-only")),
    ).rejects.toBeInstanceOf(AiPolicyRefusedError);
    await expect(
      gateway.execute(request("job", "agent-job", "device-only")),
    ).rejects.toBeInstanceOf(AiPolicyRefusedError);
    await expect(
      drain(gateway.stream(request("job", "agent-job", "device-only"))),
    ).rejects.toBeInstanceOf(AiPolicyRefusedError);
    await expect(
      drain(gateway.streamStructured(structured("job", "device-only"))),
    ).rejects.toBeInstanceOf(AiPolicyRefusedError);
    await expect(
      drain(
        gateway.resume({
          context,
          executionId: "j",
          input: "more",
          processingPolicy: "device-only",
        }),
      ),
    ).rejects.toBeInstanceOf(AiPolicyRefusedError);

    expect(calls).toEqual([]);
  });

  it("refusal names ids only, never content", async () => {
    const { gateway } = build([direct("p", "remote")]);

    const error = await gateway
      .execute(request("p", "text-generation", "device-only"))
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ profileId: "p", policy: "device-only" });
    expect(JSON.stringify(error) + String(error)).not.toContain(
      "secret question",
    );
  });

  it("runs a device profile and cancel stays allowed", async () => {
    const { gateway, calls } = build([direct("p", "device")]);

    await gateway.execute(request("p", "text-generation", "device-only"));
    await drain(gateway.stream(request("p", "streaming-chat", "device-only")));
    await drain(gateway.streamStructured(structured("p", "device-only")));
    await gateway.cancel(context, "j");

    expect(calls).toEqual([
      "model.execute",
      "model.stream",
      "model.streamStructured",
      "agent.cancel",
    ]);
  });

  it("permitted-remote and no policy admit all three localities", async () => {
    const { gateway, calls } = build([
      direct("a", "device"),
      direct("b", "private-network"),
      direct("c", "remote"),
      direct("d", undefined),
    ]);

    for (const id of ["a", "b", "c", "d"]) {
      await gateway.execute(request(id, "text-generation", "permitted-remote"));
      await gateway.execute(request(id, "text-generation"));
    }

    expect(calls).toHaveLength(8);
  });

  it("treats an unrecognised policy as device-only (fails closed)", async () => {
    const { gateway, calls } = build([direct("p", "remote")]);

    await expect(
      gateway.execute(request("p", "text-generation", "elsewhere" as never)),
    ).rejects.toBeInstanceOf(AiPolicyRefusedError);
    expect(calls).toEqual([]);
  });

  it("refuses again just before dispatch when the resolved profile's locality changes", async () => {
    // The first read (resolution) says device; every later read says remote.
    let reads = 0;
    const flipping: AiProfile = {
      ...direct("flip", undefined),
      get locality(): AiLocality {
        reads += 1;
        return reads === 1 ? "device" : "remote";
      },
    };
    const { gateway, calls } = build([flipping]);

    await expect(
      gateway.execute(request("flip", "text-generation", "device-only")),
    ).rejects.toBeInstanceOf(AiPolicyRefusedError);
    expect(reads).toBe(2);

    reads = 0;
    await expect(
      drain(gateway.stream(request("flip", "streaming-chat", "device-only"))),
    ).rejects.toBeInstanceOf(AiPolicyRefusedError);
    expect(reads).toBe(2);

    reads = 0;
    await expect(
      drain(gateway.streamStructured(structured("flip", "device-only"))),
    ).rejects.toBeInstanceOf(AiPolicyRefusedError);
    expect(reads).toBe(2);

    expect(calls).toEqual([]);
  });

  it("lists only device profiles in device-only mode, without calling a remote catalog", async () => {
    const { gateway, calls } = build([
      direct("device", "device"),
      direct("remote", "remote"),
      direct("none", undefined),
      { ...direct("catalog", "remote"), catalog: true },
    ]);

    const targets = await gateway.listAvailableTargets(context, {
      taskType: "text-generation",
      processingPolicy: "device-only",
    });

    expect(targets.map((target) => target.id)).toEqual(["device"]);
    expect(calls).toEqual([]);
  });

  it("lists a device catalog and re-checks locality before listing its models", async () => {
    let reads = 0;
    const flipping: AiProfile = {
      ...direct("catalog", undefined),
      catalog: true,
      get locality(): AiLocality {
        reads += 1;
        return reads === 1 ? "device" : "remote";
      },
    };
    const first = build([{ ...direct("catalog", "device"), catalog: true }]);
    const flipped = build([flipping]);
    const filter = {
      taskType: "text-generation",
      processingPolicy: "device-only",
    } as const;

    expect(
      (await first.gateway.listAvailableTargets(context, filter)).map(
        (t) => t.id,
      ),
    ).toEqual(["catalog/one"]);
    expect(first.calls).toEqual(["model.listModels"]);
    expect(await flipped.gateway.listAvailableTargets(context, filter)).toEqual(
      [],
    );
    expect(flipped.calls).toEqual([]);
  });
});
