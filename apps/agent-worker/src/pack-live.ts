// The live profiles of the context pack's benchmark (`pnpm pack:bench --live`):
// one real profile, in an engine of its own.
//
// [DOMAIN] Each run builds its own engine around ONE profile, with a store of
// its own in this process's memory, so runs side by side share nothing: not a
// model session, not a pack. It is here, in the agent worker, because this is
// where an agent runtime may be started (rule 7) and where the engine and the
// worker's own environment rules resolve; the script only asks for a profile.
import {
  type AiEngine,
  agentRuntime,
  createAgentModelPort,
  createAiEngine,
  createLmStudioModels,
  createOpenRouterModels,
  type ModelCatalog,
  type ModelPort,
  type Profile,
} from "@omnitech/ai-engine";
import { resolveAgentProfiles } from "@omnitech/platform-runtime/ai-config";
import {
  AGENT_WINDOW,
  createMemoryPreparedStore,
} from "@omnitech/platform-runtime/ai-packs";
import { agentEnvironment } from "./main";

const SCOPE = {
  tenantId: "00000000-0000-4000-8000-0000000000b1",
  actorId: "00000000-0000-4000-8000-0000000000b2",
  productId: "omnitech.interview",
};

export const LIVE_PROFILES = [
  "agent/claude-code",
  "agent/codex",
  "openrouter",
  "lm-studio",
] as const;
// Free routes come and go: these were listed free on 2026-10-10 (the public
// catalogue, https://openrouter.ai/api/v1/models, ids ending ":free").
const OPENROUTER_FREE = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];
const LM_STUDIO_MODEL = "qwen/qwen2.5-coder-14b";
export async function liveEngine(
  asked: string,
  // For an agent runtime: another model of the same runtime ("haiku",
  // "sonnet"), and how many turns one call may take (each lookup of a pack
  // offered as tools is a turn).
  agentOptions: { model?: string; maximumTurns?: number } = {},
): Promise<{
  engine: AiEngine;
  profile: string;
  onDevice: boolean;
  close(): Promise<void>;
}> {
  const store = createMemoryPreparedStore();
  const log = { level: "silent" as const };
  const build = (
    profile: Profile,
    port: ModelPort,
    catalog?: ModelCatalog,
  ): AiEngine =>
    createAiEngine({
      profiles: [profile],
      providers: { [profile.provider]: port },
      ...(catalog ? { catalogs: { [profile.provider]: catalog } } : {}),
      prepared: store,
      log,
    });
  if (asked === "agent/claude-code" || asked === "agent/codex") {
    const chosen = asked === "agent/codex" ? "codex" : "claude-code";
    const agent = resolveAgentProfiles(process.env).get(`assistant-${chosen}`);
    if (!agent) throw new Error(`${chosen} has no profile on this machine.`);
    const runtime = agentRuntime({
      runtime: chosen,
      environment: agentEnvironment(process.env, chosen),
    });
    const id = `pack-${chosen}`;
    return {
      engine: build(
        {
          id,
          provider: "agent",
          kind: "agent",
          model: agentOptions.model ?? agent.model,
          // Claude Code and Codex read a whole source in one call.
          window: AGENT_WINDOW,
        },
        createAgentModelPort({
          runtime,
          profiles: {
            [id]: {
              ...agent,
              id: `pack-bench-${agent.id}`,
              ...(agentOptions.model ? { model: agentOptions.model } : {}),
              ...(agentOptions.maximumTurns
                ? { maximumTurns: agentOptions.maximumTurns }
                : {}),
            },
          },
          toolless: true,
        }),
      ),
      profile: id,
      onDevice: false,
      close: async () => undefined,
    };
  }
  if (asked === "openrouter" || asked.startsWith("openrouter/")) {
    const apiKey = process.env["OPENROUTER_API_KEY"]?.trim();
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set.");
    const source = createOpenRouterModels({ apiKey, maxOutputTokens: 4096 });
    const engine = build(
      // No window: each model's is what OpenRouter lists for it.
      { id: "openrouter", provider: "openrouter", catalog: true },
      source.port,
      source.catalog,
    );
    const named = asked.startsWith("openrouter/")
      ? [asked.slice("openrouter/".length)]
      : (
          process.env["PACK_BENCH_OPENROUTER_MODELS"]?.split(",") ??
          OPENROUTER_FREE
        )
          .map((each) => each.trim())
          .filter(Boolean);
    // [DOMAIN] A free model comes and goes: the run takes the first of the
    // list that answers one small structured question, and records which.
    for (const model of named) {
      const profile = `openrouter/${model}`;
      const probe = await engine.generate(
        {
          profileId: profile,
          messages: [
            {
              role: "user",
              parts: [
                { type: "text", text: 'Return the JSON object {"ok": true}.' },
              ],
            },
          ],
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["ok"],
            properties: { ok: { type: "boolean" } },
          },
        },
        {
          scope: SCOPE,
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (probe.ok)
        return {
          engine,
          profile,
          onDevice: false,
          close: async () => undefined,
        };
      console.error(
        `openrouter: ${model} did not answer (${probe.failure.code})`,
      );
    }
    throw new Error("No OpenRouter model of the list answered.");
  }
  if (asked === "lm-studio" || asked.startsWith("lm-studio/")) {
    const model = asked.startsWith("lm-studio/")
      ? asked.slice("lm-studio/".length)
      : (process.env["PACK_BENCH_LM_STUDIO_MODEL"] ?? LM_STUDIO_MODEL);
    const source = createLmStudioModels({
      baseURL: process.env["LM_STUDIO_BASE_URL"] ?? "http://127.0.0.1:1234/v1",
      maxOutputTokens: 2048,
      timeoutMs: 600_000,
      // The benchmark never unloads what the person has loaded.
      unloadOthers: false,
    });
    return {
      engine: build(
        // No window: the model's is what LM Studio reports it was loaded with.
        {
          id: "lm-studio",
          provider: "lm-studio",
          catalog: true,
          locality: "device",
        },
        source.port,
        source.catalog,
      ),
      profile: `lm-studio/${model}`,
      onDevice: true,
      close: async () => undefined,
    };
  }
  throw new Error(
    `Unknown profile "${asked}". One of: ${LIVE_PROFILES.join(", ")}, openrouter/<model>, lm-studio/<model>.`,
  );
}
