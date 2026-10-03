import type {
  AiExecutionGateway,
  AiTargetSummary,
} from "@omnitech/ai-contracts";
import type { ModelRelay } from "@omnitech-assistant/contracts";
import { describe, expect, it, vi } from "vitest";
import { INTERVIEW_ASSISTANT_PROFILE } from "../assistant-profile.js";
import { createAssistantModels } from "./assistant-models.js";

const scope = { tenantId: "t", actorId: "a", productId: "omnitech.interview" };
const target = (id: string, listing = true): AiTargetSummary => ({
  id,
  label: id,
  family: "direct-model",
  kind: "language",
  capabilities: ["structured-chat"],
  ...(listing
    ? {
        listing: {
          id,
          name: id,
          tags: [],
          vision: false,
          reasoning: false,
          local: false,
        },
      }
    : {}),
});

function gateway() {
  const listAvailableTargets = vi.fn(async () => [
    target(INTERVIEW_ASSISTANT_PROFILE),
    target("lm-studio/qwen"),
    target("unlisted", false),
  ]);
  const streamStructured = vi.fn(async function* () {
    yield { type: "text" as const, text: "gateway" };
  });
  return {
    ai: {
      listAvailableTargets,
      streamStructured,
    } as unknown as AiExecutionGateway,
    listAvailableTargets,
    streamStructured,
  };
}

describe("createAssistantModels", () => {
  it("lists the gateway's structured-chat targets, the default first", async () => {
    const g = gateway();
    const { catalog } = createAssistantModels(g.ai, {} as ModelRelay, false);
    const listing = await catalog.list(scope);
    expect(g.listAvailableTargets).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t", userId: "a" }),
      { taskType: "structured-chat" },
    );
    expect(listing.defaultModel).toBe(INTERVIEW_ASSISTANT_PROFILE);
    expect(listing.models.map((model) => model.id)).toEqual([
      INTERVIEW_ASSISTANT_PROFILE,
      "lm-studio/qwen",
    ]);
    expect(listing.models[0]?.tags).toContain("default");
  });

  it("offers the on-device model only when the host enables it", async () => {
    const off = createAssistantModels(gateway().ai, {} as ModelRelay, false);
    const on = createAssistantModels(gateway().ai, {} as ModelRelay, true);
    expect(
      (await off.catalog.list(scope)).models.some(
        ({ id }) => id === "on-device",
      ),
    ).toBe(false);
    expect((await on.catalog.list(scope)).models.at(-1)?.id).toBe("on-device");
  });

  it("uses the configured Claude agent only when it is available", async () => {
    const g = gateway();
    g.listAvailableTargets.mockResolvedValue([
      target(INTERVIEW_ASSISTANT_PROFILE),
      target("agent/claude-code"),
    ]);
    const { catalog } = createAssistantModels(
      g.ai,
      {} as ModelRelay,
      false,
      "agent/claude-code",
    );
    const listing = await catalog.list(scope);
    expect(listing.defaultModel).toBe("agent/claude-code");
    expect(
      listing.models.find(({ id }) => id === "agent/claude-code")?.tags,
    ).toContain("default");
    expect(
      listing.models.find(({ id }) => id === INTERVIEW_ASSISTANT_PROFILE)?.tags,
    ).not.toContain("default");

    g.listAvailableTargets.mockResolvedValue([
      target(INTERVIEW_ASSISTANT_PROFILE),
    ]);
    expect((await catalog.list(scope)).defaultModel).toBe(
      INTERVIEW_ASSISTANT_PROFILE,
    );

    g.listAvailableTargets.mockResolvedValue([
      target(INTERVIEW_ASSISTANT_PROFILE),
      ...Array.from({ length: 63 }, (_, index) => target(`extra-${index}`)),
      target("agent/claude-code"),
    ]);
    const capped = await catalog.list(scope);
    expect(capped.models).toHaveLength(64);
    expect(capped.defaultModel).toBe(INTERVIEW_ASSISTANT_PROFILE);
  });

  it("runs every picked model but the on-device one through the gateway", async () => {
    const g = gateway();
    const { port } = createAssistantModels(g.ai, {} as ModelRelay, false);
    const parts = [];
    for await (const part of port.stream(
      scope,
      { profileId: "lm-studio/qwen", messages: [] },
      new AbortController().signal,
    ))
      parts.push(part);
    expect(parts).toEqual([{ type: "text", text: "gateway" }]);
    expect(g.streamStructured).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: "lm-studio/qwen" }),
    );
  });

  it("refuses the on-device model when the host has it off", async () => {
    const g = gateway();
    const relay = new Proxy({} as ModelRelay, {
      get: () => {
        throw new Error("the relay must not be reached");
      },
    });
    const { port } = createAssistantModels(g.ai, relay, false);
    const turn = async () => {
      for await (const _part of port.stream(
        scope,
        { profileId: "on-device", messages: [] },
        new AbortController().signal,
      ));
    };
    await expect(turn()).rejects.toThrow(
      "The on-device model is not enabled on this host.",
    );
    expect(g.streamStructured).not.toHaveBeenCalled();
  });
});
