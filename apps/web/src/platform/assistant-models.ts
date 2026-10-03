import type { AiExecutionGateway } from "@omnitech/ai-contracts";
import { createGatewayModelPort } from "@omnitech/ai-runtime";
import { INTERVIEW_ASSISTANT_PROFILE } from "@omnitech/product-interview/backend";
import {
  createLmStudioModels,
  createModelRouter,
  createOpenRouterModels,
  type ModelSource,
} from "@omnitech-assistant/providers";
import type { ModelRelay } from "@omnitech-assistant/contracts";
import { createRelayModelSource } from "@omnitech-assistant/server";
import { createAgentModels } from "./agent-models";
import { interviewAssistantBudget } from "./ai";
import type { ResolvedLanguageModel } from "./ai-config";

const PERMISSIONS = ["interview.read", "interview.write"] as const;
const isLoopback = (url: string) =>
  /^(localhost|127\.0\.0\.1)$/.test(new URL(url).hostname);

/**
 * The models the interview assistant offers in its picker, and the port that
 * runs whichever one a turn asks for. The configured default model comes
 * first; LM Studio's installed models and OpenRouter's free models follow when
 * they are set up. [SAFETY] Every model must fit the assistant's context
 * budget, so switching never overflows a smaller window.
 */
export function createAssistantModels(
  ai: AiExecutionGateway,
  language: ResolvedLanguageModel | null,
  relay: ModelRelay,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ModelSource {
  const budget = interviewAssistantBudget(language?.baseUrl);
  const sizing = {
    minContextTokens: budget.contextTokens,
    maxOutputTokens: budget.outputTokens,
    temperature: 0.3,
  };
  const lmStudioUrl =
    language && isLoopback(language.baseUrl)
      ? language.baseUrl
      : environment["LM_STUDIO_MODEL"]
        ? (environment["LM_STUDIO_BASE_URL"] ?? "http://127.0.0.1:1234/v1")
        : undefined;
  const sources: ModelSource[] = [];

  // The configured model, through the platform gateway: always offered, and
  // the default, so a turn that names no other model still runs.
  const localDefault =
    language && isLoopback(language.baseUrl) ? language.model : undefined;
  sources.push({
    catalog: {
      list: async () => ({
        models: [
          {
            id: INTERVIEW_ASSISTANT_PROFILE,
            name: language?.model ?? "Draft model",
            // The picker names the model itself; the provider heads its group.
            shortName: language?.model.split("/").at(-1) ?? "Default",
            tags: localDefault ? ["default", "loaded"] : ["default"],
            vision: false,
            reasoning: false,
            tools: true,
            contextWindow: budget.contextTokens,
            local: localDefault !== undefined,
            // Grouped with LM Studio's own listing when it runs there.
            provider: {
              name: language?.label ?? "Draft model",
              ...(language ? { endpoint: new URL(language.baseUrl).host } : {}),
              local: localDefault !== undefined,
            },
          },
        ],
        defaultModel: INTERVIEW_ASSISTANT_PROFILE,
      }),
    },
    port: createGatewayModelPort(ai, async () => PERMISSIONS),
  });
  if (lmStudioUrl) {
    const lmStudio = createLmStudioModels({
      ...sizing,
      baseURL: lmStudioUrl,
      timeoutMs: language?.timeoutMs ?? 600_000,
      // Briefing packs run on the configured model; switching the
      // assistant never unloads it.
      keepLoaded: [
        ...(localDefault ? [localDefault] : []),
        ...(environment["LM_STUDIO_MODEL"]
          ? [environment["LM_STUDIO_MODEL"]]
          : []),
      ],
    });
    // The default model is already offered above; LM Studio lists the rest.
    sources.push({
      port: lmStudio.port,
      catalog: {
        list: async (scope) => {
          const listing = await lmStudio.catalog.list(scope);
          const { defaultModel: _default, ...rest } = listing;
          return {
            ...rest,
            models: listing.models.filter(
              (model) => model.id !== `lm-studio/${localDefault}`,
            ),
          };
        },
      },
    });
  }
  const openRouterKey = environment["OPENROUTER_API_KEY"]?.trim();
  if (openRouterKey)
    sources.push(createOpenRouterModels({ ...sizing, apiKey: openRouterKey }));
  // Claude Code and Codex through their CLI logins, run by the agent worker.
  const agentSecret =
    environment["AGENT_PAYLOAD_SECRET"] ??
    environment["CONNECTED_ACCOUNT_SECRET"];
  if (agentSecret) sources.push(createAgentModels(agentSecret));
  // The on-device (WebGPU) model runs in the person's browser: the server
  // relays each model call to the open tab. Offered only when a model is
  // pinned; the panel hides it in browsers without WebGPU.
  if (environment["NEXT_PUBLIC_ON_DEVICE_MODEL_SHA256"])
    sources.push(
      createRelayModelSource({
        relay,
        models: [
          {
            id: "on-device",
            name: "Qwen3 4B (on this device)",
            shortName: "On this device",
            description:
              "Runs in this browser on your graphics card; nothing is sent to a model provider. The first message downloads the model (about 2 GB).",
            tags: ["on-device"],
            strengths: ["privacy", "short questions"],
            provider: { name: "This device", local: true },
            vision: false,
            reasoning: false,
            contextWindow: 8_192,
            local: true,
          },
        ],
      }),
    );
  return createModelRouter(sources);
}
