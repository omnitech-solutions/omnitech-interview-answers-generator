import {
  createAiEngine,
  type ModelInfo,
  type ModelPart,
} from "@omnitech/ai-engine";
import type { ModelRelay } from "@omnitech-assistant/contracts";
import { describe, expect, it, vi } from "vitest";
import { INTERVIEW_ASSISTANT_PROFILE } from "../assistant-profile";
import { createAssistantModels } from "./assistant-models";

const scope = { tenantId: "t", actorId: "a", productId: "omnitech.interview" };
const model = (id: string): ModelInfo => ({
  id,
  name: id,
  tags: [],
  vision: false,
  reasoning: false,
  local: false,
});
// How the host presents the assistant's own profile.
const own = {
  name: "Test model",
  tags: [],
  vision: false,
  reasoning: false,
  local: false,
};

// A host's engine: the assistant's own profile, a profile the picker never
// shows, and one catalogue whose models the test names.
function host(
  catalogue: readonly string[] = ["lm-studio/qwen"],
  answer: () => AsyncIterable<ModelPart> = async function* () {
    yield { type: "text", text: "engine" };
  },
) {
  const asked: { profileId: string; permissions?: readonly string[] }[] = [];
  const authorize = vi.fn(
    (_execution: unknown, _profile: { id: string }) => true as true | string,
  );
  const engine = createAiEngine({
    profiles: [
      { id: INTERVIEW_ASSISTANT_PROFILE, provider: "model" },
      { id: "unlisted", provider: "model" },
      { id: "lm-studio", provider: "models", catalog: true },
      { id: "extra", provider: "models", catalog: true },
      { id: "agent", provider: "models", catalog: true },
    ],
    providers: {
      model: { stream: answer },
      models: {
        stream(_scope, input) {
          asked.push({ profileId: input.profileId });
          return answer();
        },
      },
    },
    catalogs: {
      models: { list: async () => ({ models: catalogue.map(model) }) },
    },
    authorize,
  });
  return { engine, asked, authorize };
}
const input = (profileId: string) => ({
  profileId,
  messages: [
    { role: "user" as const, parts: [{ type: "text" as const, text: "Hi" }] },
  ],
});
const read = async (parts: AsyncIterable<unknown>) => {
  const seen: unknown[] = [];
  for await (const part of parts) seen.push(part);
  return seen;
};

describe("createAssistantModels", () => {
  it("lists the assistant's own profile first, then the catalogues' models", async () => {
    const h = host();
    const { catalog } = createAssistantModels(
      h.engine,
      {} as ModelRelay,
      false,
      own,
    );
    const listing = await catalog.list(scope);
    // The member's permissions reach the host's authorisation.
    expect(h.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        scope,
        permissions: expect.arrayContaining(["interview.read"]),
      }),
      expect.anything(),
    );
    expect(listing.defaultModel).toBe(INTERVIEW_ASSISTANT_PROFILE);
    expect(listing.models.map((model) => model.id)).toEqual([
      INTERVIEW_ASSISTANT_PROFILE,
      "lm-studio/qwen",
    ]);
    expect(listing.models[0]).toMatchObject({ name: "Test model" });
    expect(listing.models[0]?.tags).toContain("default");
  });

  it("offers the assistant's own profile only when the host describes it and the member may use it", async () => {
    const undescribed = createAssistantModels(
      host().engine,
      {} as ModelRelay,
      false,
    );
    expect(
      (await undescribed.catalog.list(scope)).models.map(({ id }) => id),
    ).toEqual(["lm-studio/qwen"]);

    const h = host();
    h.authorize.mockImplementation((_execution, profile) =>
      profile.id === INTERVIEW_ASSISTANT_PROFILE ? "refused" : true,
    );
    const refused = createAssistantModels(
      h.engine,
      {} as ModelRelay,
      false,
      own,
    );
    expect(
      (await refused.catalog.list(scope)).models.map(({ id }) => id),
    ).toEqual(["lm-studio/qwen"]);
  });

  it("offers the on-device model only when the host enables it", async () => {
    const off = createAssistantModels(
      host().engine,
      {} as ModelRelay,
      false,
      own,
    );
    const on = createAssistantModels(
      host().engine,
      {} as ModelRelay,
      true,
      own,
    );
    expect(
      (await off.catalog.list(scope)).models.some(
        ({ id }) => id === "on-device",
      ),
    ).toBe(false);
    expect((await on.catalog.list(scope)).models.at(-1)?.id).toBe("on-device");
  });

  it("uses the configured Claude agent only when it is available", async () => {
    const withAgent = createAssistantModels(
      host(["agent/claude-code"]).engine,
      {} as ModelRelay,
      false,
      own,
      "agent/claude-code",
    );
    const listing = await withAgent.catalog.list(scope);
    expect(listing.defaultModel).toBe("agent/claude-code");
    expect(
      listing.models.find(({ id }) => id === "agent/claude-code")?.tags,
    ).toContain("default");
    expect(
      listing.models.find(({ id }) => id === INTERVIEW_ASSISTANT_PROFILE)?.tags,
    ).not.toContain("default");

    const without = createAssistantModels(
      host([]).engine,
      {} as ModelRelay,
      false,
      own,
      "agent/claude-code",
    );
    expect((await without.catalog.list(scope)).defaultModel).toBe(
      INTERVIEW_ASSISTANT_PROFILE,
    );

    // The preferred model falls past the picker's cap.
    const crowded = createAssistantModels(
      host([
        ...Array.from({ length: 63 }, (_, index) => `extra/${index}`),
        "agent/claude-code",
      ]).engine,
      {} as ModelRelay,
      false,
      own,
      "agent/claude-code",
    );
    const capped = await crowded.catalog.list(scope);
    expect(capped.models).toHaveLength(64);
    expect(capped.defaultModel).toBe(INTERVIEW_ASSISTANT_PROFILE);
  });

  it("runs every picked model but the on-device one on the engine, as the member", async () => {
    const h = host(["lm-studio/qwen"], async function* () {
      yield { type: "text", text: "engine" };
      // The engine's own parts are not the assistant's.
      yield { type: "response", id: "r1", model: "qwen" };
    });
    const { port } = createAssistantModels(h.engine, {} as ModelRelay, false);
    expect(
      await read(
        port.stream(
          scope,
          input("lm-studio/qwen"),
          new AbortController().signal,
        ),
      ),
    ).toEqual([{ type: "text", text: "engine" }]);
    expect(h.asked).toEqual([{ profileId: "lm-studio/qwen" }]);
    expect(h.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        scope,
        permissions: expect.arrayContaining(["interview.read"]),
      }),
      expect.objectContaining({ id: "lm-studio" }),
    );
  });

  it("fails a turn the engine fails, naming the failure's code and nothing the provider said", async () => {
    const h = host(["lm-studio/qwen"], async function* () {
      yield* [] as ModelPart[];
      throw new Error("provider said: the prompt was 'secret question'");
    });
    const { port } = createAssistantModels(h.engine, {} as ModelRelay, false);
    const turn = read(
      port.stream(scope, input("lm-studio/qwen"), new AbortController().signal),
    );
    await expect(turn).rejects.toThrow("The model call failed: unavailable");
    await expect(turn).rejects.not.toThrow(/secret question/);
  });

  it("ends a stopped turn with the reason it was stopped", async () => {
    const stop = new AbortController();
    const h = host(["lm-studio/qwen"], async function* () {
      yield { type: "text", text: "partial" };
      stop.abort(new Error("stopped by the member"));
      yield { type: "text", text: "never read" };
    });
    const { port } = createAssistantModels(h.engine, {} as ModelRelay, false);
    await expect(
      read(port.stream(scope, input("lm-studio/qwen"), stop.signal)),
    ).rejects.toThrow("stopped by the member");
  });

  it("refuses the on-device model when the host has it off", async () => {
    const h = host();
    const relay = new Proxy({} as ModelRelay, {
      get: () => {
        throw new Error("the relay must not be reached");
      },
    });
    const { port } = createAssistantModels(h.engine, relay, false);
    await expect(
      read(
        port.stream(scope, input("on-device"), new AbortController().signal),
      ),
    ).rejects.toThrow("The on-device model is not enabled on this host.");
    expect(h.asked).toEqual([]);
  });
});
