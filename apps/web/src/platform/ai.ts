import {
  type AiEngine,
  createAiEngine,
  createFakeImagePort,
  createImagePort,
  createJobs,
  createLmStudioModels,
  createOpenRouterModels,
  fillWorkflowPrompt,
  type GeneratedImage,
  type ImagePortOptions,
  keepTraceIn,
  type ModelCatalog,
  type ModelInfo,
  type ModelPort,
  modelProvider,
  type Profile,
  type TraceConfig,
} from "@omnitech/ai-engine";
import { getPlatformDatabase } from "@omnitech/database";
import {
  declareLocality,
  resolveAgentProfiles,
  resolveDefaultLanguageModel,
} from "@omnitech/platform-runtime/ai-config";
import {
  AgentPayloadStore,
  agentPayloadSecret,
  PostgresAgentJobRepository,
} from "@omnitech/platform-storage";
import {
  INTERVIEW_ANSWER_PROFILE,
  INTERVIEW_ASSISTANT_PROFILE,
} from "@omnitech/product-interview/backend";
import { AGENT_CATALOG, createAgentJobSource } from "./agent-models";

// The engine's provider names. The configured language model keeps its own id
// (`openai`, `lm-studio`, or AI_PROVIDER_ID) so a record names it.
const ANTHROPIC = "anthropic-api";
const LM_STUDIO_MODELS = "lm-studio-models";
const OPENROUTER_MODELS = "openrouter-models";
const AGENT_JOBS = "agent-jobs";

const isLoopback = (url: string) =>
  /^(localhost|127\.0\.0\.1)$/.test(new URL(url).hostname);

// How much the interview assistant may read and write per turn. A local
// model is loaded with ASSISTANT_CONTEXT_TOKENS (see scripts/local-model.mjs);
// a quarter of the window is kept for output, at about 2.5 characters per
// token for code and JSON. A hosted model has a large window.
export function interviewAssistantBudget(baseUrl?: string) {
  const local = baseUrl !== undefined && isLoopback(baseUrl);
  const contextTokens = Number(
    process.env["ASSISTANT_CONTEXT_TOKENS"] ?? (local ? 65_536 : 131_072),
  );
  const outputTokens = Math.min(8192, Math.floor(contextTokens / 4));
  return {
    contextTokens,
    outputTokens,
    contextCharacters: local
      ? Math.floor((contextTokens - outputTokens) * 2.5)
      : 100_000,
  };
}

/**
 * How the assistant's picker presents the interview assistant's own profile:
 * the configured language model, named by itself with its provider heading
 * the group. Undefined when no language model is configured, because the
 * profile does not exist then.
 */
export function interviewAssistantListing(): Omit<ModelInfo, "id"> | undefined {
  const language = resolveDefaultLanguageModel();
  if (!language) return undefined;
  const local = isLoopback(language.baseUrl);
  return {
    name: language.model,
    shortName: language.model.split("/").at(-1) ?? language.model,
    tags: local ? ["loaded"] : [],
    vision: false,
    reasoning: false,
    tools: true,
    contextWindow: interviewAssistantBudget(language.baseUrl).contextTokens,
    local,
    provider: {
      name: language.label,
      endpoint: new URL(language.baseUrl).host,
      local,
    },
  };
}

// A catalogue as the picker needs it: each model names where it runs, so the
// picker can group them, and a model already offered as a profile is left out.
function listed(
  catalog: ModelCatalog,
  except: readonly string[] = [],
): ModelCatalog {
  return {
    async list(scope) {
      const listing = await catalog.list(scope);
      return {
        ...listing,
        models: listing.models
          .filter((model) => !except.includes(model.id))
          .map((model) =>
            model.provider || !listing.provider
              ? model
              : { ...model, provider: listing.provider },
          ),
      };
    },
  };
}

// The engine keeps no image bytes: the provider's own address is the reference.
const persistImage: ImagePortOptions["persist"] = (image) =>
  Promise.resolve({
    reference: image.url,
    mimeType: image.mimeType ?? "image/png",
    ...(image.width === undefined ? {} : { width: image.width }),
    ...(image.height === undefined ? {} : { height: image.height }),
  });

// The OpenAI images response shape, which Together AI shares.
async function readImageResponse(
  response: Response,
  provider: string,
): Promise<GeneratedImage> {
  if (!response.ok)
    throw new Error(`${provider} returned HTTP ${response.status}.`);
  const body = (await response.json()) as {
    data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
  };
  const image = body.data?.[0];
  if (!image) throw new Error(`${provider} returned no image.`);
  return {
    url: image.url ?? `data:image/png;base64,${image.b64_json ?? ""}`,
    mimeType: "image/png",
    ...(image.revised_prompt === undefined
      ? {}
      : { revisedPrompt: image.revised_prompt }),
  };
}

const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];

// The one image provider the environment configures: FAL, then a ComfyUI
// workflow, then Together AI, then OpenAI Images; with none, the engine's
// deterministic placeholder. Each is the provider's request shape handed to
// the engine's image port, which checks the model id and the address returned.
function imagePort() {
  const environment = process.env;
  if (environment["FAL_API_KEY"]) {
    const model =
      environment["FAL_IMAGE_MODEL"] ?? "fal-ai/flux-pro/v1.1-ultra";
    return createImagePort({
      id: "fal",
      model,
      aspectRatios: ASPECT_RATIOS,
      async generate(_scope, request, _mode, signal) {
        const response = await fetch(
          `https://fal.run/${request.modelId ?? model}`,
          {
            method: "POST",
            headers: {
              authorization: `Key ${environment["FAL_API_KEY"]}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              prompt: request.prompt,
              aspect_ratio: request.aspectRatio ?? "16:9",
            }),
            signal,
          },
        );
        if (!response.ok)
          throw new Error(`FAL returned HTTP ${response.status}.`);
        const body = (await response.json()) as {
          images?: Array<{
            url: string;
            content_type?: string;
            width?: number;
            height?: number;
          }>;
        };
        const image = body.images?.[0];
        if (!image) throw new Error("FAL returned no image.");
        return {
          url: image.url,
          mimeType: image.content_type ?? "image/png",
          ...(image.width === undefined ? {} : { width: image.width }),
          ...(image.height === undefined ? {} : { height: image.height }),
        };
      },
      persist: persistImage,
    });
  }
  if (environment["COMFYUI_WORKFLOW_JSON"])
    return createImagePort({
      id: "comfyui",
      model: environment["COMFYUI_IMAGE_MODEL"] ?? "comfyui-workflow",
      aspectRatios: ASPECT_RATIOS,
      // ComfyUI runs on this machine and answers with its own address.
      local: true,
      async generate(_scope, request, _mode, signal) {
        const baseUrl = (
          environment["COMFYUI_BASE_URL"] ?? "http://127.0.0.1:8188"
        ).replace(/\/$/, "");
        let workflow: Record<string, unknown>;
        try {
          workflow = JSON.parse(environment["COMFYUI_WORKFLOW_JSON"] ?? "");
        } catch {
          throw new Error("COMFYUI_WORKFLOW_JSON must be valid JSON.");
        }
        const queued = await fetch(`${baseUrl}/prompt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: fillWorkflowPrompt(workflow, request.prompt),
          }),
          signal,
        });
        if (!queued.ok)
          throw new Error(`ComfyUI returned HTTP ${queued.status}.`);
        const { prompt_id: promptId } = (await queued.json()) as {
          prompt_id?: string;
        };
        if (!promptId) throw new Error("ComfyUI returned no prompt id.");
        // The workflow runs in ComfyUI's queue: its history is read once a
        // second, for two minutes, until it shows an output image.
        for (let attempt = 0; attempt < 120; attempt += 1) {
          const history = await fetch(
            `${baseUrl}/history/${encodeURIComponent(promptId)}`,
            { signal },
          );
          if (history.ok) {
            const outputs = (
              (await history.json()) as Record<
                string,
                {
                  outputs?: Record<
                    string,
                    {
                      images?: Array<{
                        filename: string;
                        subfolder?: string;
                        type?: string;
                      }>;
                    }
                  >;
                }
              >
            )[promptId]?.outputs;
            const image = outputs
              ? Object.values(outputs)
                  .flatMap((output) => output.images ?? [])
                  .at(0)
              : undefined;
            if (image) {
              const params = new URLSearchParams({
                filename: image.filename,
                subfolder: image.subfolder ?? "",
                type: image.type ?? "output",
              });
              return {
                url: `${baseUrl}/view?${params.toString()}`,
                mimeType: "image/png",
              };
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        throw new Error("ComfyUI image generation timed out.");
      },
      persist: persistImage,
    });
  if (environment["TOGETHER_AI_API_KEY"]) {
    const model =
      environment["TOGETHER_IMAGE_MODEL"] ??
      "black-forest-labs/FLUX.1-schnell-Free";
    return createImagePort({
      id: "together",
      model,
      aspectRatios: ASPECT_RATIOS,
      async generate(_scope, request, _mode, signal) {
        const response = await fetch(
          "https://api.together.xyz/v1/images/generations",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${environment["TOGETHER_AI_API_KEY"]}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: request.modelId ?? model,
              prompt: request.prompt,
              width: 1024,
              height: 1024,
            }),
            signal,
          },
        );
        return readImageResponse(response, "Together AI");
      },
      persist: persistImage,
    });
  }
  if (environment["OPENAI_API_KEY"]) {
    const model = environment["OPENAI_IMAGE_MODEL"] ?? "gpt-image-1";
    return createImagePort({
      id: "openai-image",
      model,
      aspectRatios: ASPECT_RATIOS,
      async generate(_scope, request, _mode, signal) {
        const baseUrl = (
          environment["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1"
        ).replace(/\/$/, "");
        const response = await fetch(`${baseUrl}/images/generations`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${environment["OPENAI_API_KEY"]}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: request.modelId ?? model,
            prompt: request.prompt,
            size: request.aspectRatio === "16:9" ? "1536x1024" : "1024x1024",
          }),
          signal,
        });
        return readImageResponse(response, "OpenAI Images");
      },
      persist: persistImage,
    });
  }
  return createFakeImagePort(persistImage);
}

// [SAFETY] Every interaction is recorded when the host names a database for
// the engine's own tables, without content unless AI_ENGINE_CAPTURE=full
// (rule 8: prompts and outputs are never kept by default).
function traceConfig(): TraceConfig | undefined {
  const url = process.env["AI_ENGINE_DATABASE_URL"]?.trim();
  if (!url) return undefined;
  return {
    sink: keepTraceIn(url),
    capture: process.env["AI_ENGINE_CAPTURE"] === "full" ? "full" : "metadata",
  };
}

/**
 * The one engine every AI interaction of the web host goes through: its
 * profiles, the providers behind them, the model catalogues, the image
 * provider, agent jobs and the trace, all read from the environment once.
 */
export function createPlatformAiEngine(): AiEngine {
  const providers: Record<string, ModelPort> = {};
  const catalogs: Record<string, ModelCatalog> = {};
  const profiles: Profile[] = [];

  // The same model settings the interview API and the assistant use. With
  // nothing configured there is no language profile at all.
  const language = resolveDefaultLanguageModel();
  const budget = interviewAssistantBudget(language?.baseUrl);
  const anthropicKey = process.env["ANTHROPIC_API_KEY"];
  // A call that is not streamed to a person is tried again when the provider
  // is busy or still loading its model.
  const retry = { attempts: 2, backoffMs: 2000 };
  const capabilities = ["structured", "tools", "vision"] as const;

  if (anthropicKey) {
    const model = process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-5-5";
    providers[ANTHROPIC] = modelProvider({
      kind: "anthropic",
      apiKey: anthropicKey,
      timeoutMs: 120_000,
      resolveProfile: () => ({ modelId: model, maxOutputTokens: 4096 }),
    });
  }
  if (language) {
    // Output per profile: an assistant turn is sized to the context window
    // at a low temperature for factual answers and code; a generated answer
    // carries code, tests and the full guide; a document gets the quarter of
    // the window kept for output.
    const sizing: Record<
      string,
      { maxOutputTokens: number; temperature?: number }
    > = {
      [INTERVIEW_ASSISTANT_PROFILE]: {
        maxOutputTokens: budget.outputTokens,
        temperature: 0.3,
      },
      [INTERVIEW_ANSWER_PROFILE]: {
        maxOutputTokens: Math.min(12_000, Math.floor(budget.contextTokens / 4)),
        temperature: 0.2,
      },
    };
    const options = {
      resolveProfile: (profileId: string) => ({
        modelId: language.model,
        ...(sizing[profileId] ?? {
          maxOutputTokens: Math.floor(budget.contextTokens / 4),
        }),
      }),
    };
    // [SAFETY] Without a key the endpoint must be this machine's: the
    // anonymous port refuses any address that is not loopback.
    providers[language.id] = language.apiKey
      ? modelProvider({
          kind: "openai",
          ...options,
          apiKey: language.apiKey,
          baseUrl: language.baseUrl,
          timeoutMs: language.timeoutMs,
        })
      : modelProvider({
          kind: "lm-studio",
          ...options,
          baseURL: language.baseUrl,
          timeoutMs: language.timeoutMs,
        });
  }
  const languageProfile = language
    ? {
        provider: language.id,
        model: language.model,
        locality: language.locality,
        timeoutMs: Math.min(language.timeoutMs, 3_600_000),
        capabilities,
      }
    : undefined;

  if (languageProfile)
    profiles.push({
      ...languageProfile,
      id: "document-fast",
      label: "Fast",
      retry,
    });
  // The hosted Anthropic model when there is one, and it is always remote.
  if (anthropicKey)
    profiles.push({
      id: "document-quality",
      label: "High quality",
      provider: ANTHROPIC,
      model: process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-5-5",
      locality: "remote",
      timeoutMs: 120_000,
      capabilities,
      retry,
    });
  else if (languageProfile)
    profiles.push({
      ...languageProfile,
      id: "document-quality",
      label: "High quality",
      retry,
    });
  if (languageProfile)
    profiles.push({
      ...languageProfile,
      id: INTERVIEW_ASSISTANT_PROFILE,
      label: "Interview assistant",
    });

  // The assistant's picker also offers LM Studio's installed models and
  // OpenRouter's free ones, each sized to the assistant's context budget.
  const pickerSizing = {
    minContextTokens: budget.contextTokens,
    maxOutputTokens: budget.outputTokens,
    temperature: 0.3,
  };
  const localDefault =
    language && isLoopback(language.baseUrl) ? language.model : undefined;
  const lmStudioUrl = localDefault
    ? language?.baseUrl
    : process.env["LM_STUDIO_MODEL"]
      ? (process.env["LM_STUDIO_BASE_URL"] ?? "http://127.0.0.1:1234/v1")
      : undefined;
  if (lmStudioUrl) {
    const source = createLmStudioModels({
      ...pickerSizing,
      baseURL: lmStudioUrl,
      timeoutMs: language?.timeoutMs ?? 600_000,
      // Briefing packs run on the configured model; switching the assistant
      // never unloads it, and the picker offers it once, as the assistant.
      keepLoaded: [
        ...(localDefault ? [localDefault] : []),
        ...(process.env["LM_STUDIO_MODEL"]
          ? [process.env["LM_STUDIO_MODEL"]]
          : []),
      ],
    });
    providers[LM_STUDIO_MODELS] = source.port;
    catalogs[LM_STUDIO_MODELS] = listed(
      source.catalog,
      localDefault ? [`lm-studio/${localDefault}`] : [],
    );
    profiles.push({
      id: "lm-studio",
      label: "LM Studio",
      provider: LM_STUDIO_MODELS,
      catalog: true,
      // Declared by the environment, never inferred (rule:declared-profile-
      // locality): the configured model's own declaration, else LM Studio's.
      locality:
        localDefault && language
          ? language.locality
          : declareLocality(process.env["LM_STUDIO_LOCALITY"], lmStudioUrl),
    });
  }
  const openRouterKey = process.env["OPENROUTER_API_KEY"]?.trim();
  if (openRouterKey) {
    const source = createOpenRouterModels({
      ...pickerSizing,
      apiKey: openRouterKey,
    });
    providers[OPENROUTER_MODELS] = source.port;
    catalogs[OPENROUTER_MODELS] = listed(source.catalog);
    profiles.push({
      id: "openrouter",
      label: "OpenRouter · free",
      provider: OPENROUTER_MODELS,
      catalog: true,
    });
  }

  // Claude Code and Codex through their CLI logins, as jobs the agent worker
  // runs. Without a payload secret a prompt cannot be kept for the worker,
  // so there are no agents and no jobs.
  const secret = agentPayloadSecret(process.env);
  const jobs = secret
    ? createJobs({
        repository: new PostgresAgentJobRepository(getPlatformDatabase()),
        pollMs: 100,
      })
    : undefined;
  if (secret && jobs) {
    const payloads = new AgentPayloadStore(getPlatformDatabase(), secret);
    const agents = createAgentJobSource({
      jobs,
      profiles: resolveAgentProfiles(),
      savePrompt: (tenantId, prompt) => payloads.save(tenantId, prompt),
    });
    providers[AGENT_JOBS] = agents.port;
    catalogs[AGENT_JOBS] = agents.catalog;
    profiles.push({
      id: AGENT_CATALOG,
      label: "Agents",
      provider: AGENT_JOBS,
      kind: "agent",
      catalog: true,
    });
  }

  if (languageProfile)
    profiles.push({
      ...languageProfile,
      id: INTERVIEW_ANSWER_PROFILE,
      label: "Interview answers",
      retry,
    });

  const images = imagePort();
  profiles.push({
    id: "image-balanced",
    label: "Balanced",
    provider: images.providerId,
  });

  const trace = traceConfig();
  return createAiEngine({
    profiles,
    providers,
    catalogs,
    images: { [images.providerId]: images },
    ...(jobs ? { jobs } : {}),
    ...(trace ? { trace } : {}),
    // [SAFETY] Only a member holding a product's read permission may use a
    // profile; the caller's permissions travel on the execution.
    authorize: (execution) =>
      execution.permissions?.includes("presentation.read") ||
      execution.permissions?.includes("interview.read")
        ? true
        : "The member holds no product permission for AI",
  });
}
