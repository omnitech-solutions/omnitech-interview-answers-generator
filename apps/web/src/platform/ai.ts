import type {
  AiEvent,
  AiExecution,
  AiExecutionRequest,
  AiResumeRequest,
} from "@omnitech/ai-contracts";
import { createAnthropicModelAdapter } from "@omnitech/ai-provider-anthropic";
import {
  createComfyUiImageProvider,
  createFakeImageProvider,
  createFalImageProvider,
  createOpenAiImageProvider,
  createTogetherImageProvider,
} from "@omnitech/ai-provider-images";
import {
  createOpenAiCatalogAdapter,
  createOpenAiModelAdapter,
} from "@omnitech/ai-provider-openai";
import {
  INTERVIEW_ANSWER_PROFILE,
  INTERVIEW_ASSISTANT_PROFILE,
} from "@omnitech/product-interview/backend";
import {
  type AgentExecutionPort,
  type AiProfile,
  createAiExecutionGateway,
} from "@omnitech/ai-runtime";
import {
  AgentPayloadStore,
  PostgresAgentJobRepository,
} from "@omnitech/platform-storage";
import { getPlatformDatabase } from "@omnitech/database";
import { resolveAgentProfiles, resolveDefaultLanguageModel } from "./ai-config";
import { agentAssistantProfiles, streamAgentTurn } from "./agent-models";
import { createLocalModelAdapter } from "./local-model";

function createAgentPort(): AgentExecutionPort {
  const database = getPlatformDatabase();
  const repository = new PostgresAgentJobRepository(database);
  const secret =
    process.env["AGENT_PAYLOAD_SECRET"] ??
    process.env["CONNECTED_ACCOUNT_SECRET"];

  async function create(
    request: AiExecutionRequest,
    profile: AiProfile,
  ): Promise<AiExecution> {
    if (!secret) throw new Error("AGENT_PAYLOAD_SECRET is not configured.");
    // [SAFETY] The job runs under the central agent profile of the same id.
    const agentProfile = resolveAgentProfiles().get(profile.id);
    if (!agentProfile) throw new Error("The agent profile is not configured.");
    const payloads = new AgentPayloadStore(database, secret);
    const promptReference = await payloads.save(
      request.context.tenantId,
      request.task.prompt,
    );
    const job = await repository.create({
      tenantId: request.context.tenantId,
      userId: request.context.userId,
      productId: request.context.productId,
      promptReference,
      profile: agentProfile,
    });
    return {
      executionId: job.id,
      family: "agent-runtime",
      targetId: profile.targetId,
      result: { jobId: job.id, status: job.status },
    };
  }

  return {
    execute: create,
    async *stream(
      request: AiExecutionRequest,
      profile: AiProfile,
    ): AsyncIterable<AiEvent> {
      const execution = await create(request, profile);
      yield { type: "started", executionId: execution.executionId };
      yield { type: "completed", result: execution.result };
    },
    async cancel(executionId) {
      const tenantId = await repository.tenantOf(executionId);
      if (tenantId) await repository.requestCancellation(tenantId, executionId);
    },
    async *resume(_request: AiResumeRequest): AsyncIterable<AiEvent> {
      throw new Error("Resume requires an existing agent session job.");
    },
    // Assistant turns on Claude Code or Codex, as jobs the worker runs.
    streamStructured(request, profile) {
      if (!secret) throw new Error("AGENT_PAYLOAD_SECRET is not configured.");
      return streamAgentTurn(database, secret, request, profile);
    },
  };
}

function persistImage(payload: {
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
}) {
  return Promise.resolve({
    reference: payload.url,
    mimeType: payload.mimeType ?? "image/png",
    ...(payload.width === undefined ? {} : { width: payload.width }),
    ...(payload.height === undefined ? {} : { height: payload.height }),
  });
}

async function readImageResponse(response: Response, provider: string) {
  if (!response.ok) throw new Error(`${provider} returned ${response.status}.`);
  const body = (await response.json()) as {
    data?: Array<{
      url?: string;
      b64_json?: string;
      revised_prompt?: string;
    }>;
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

const INTERVIEW_ASSISTANT_TARGET = "interview-assistant-model";
const LM_STUDIO_CATALOG_TARGET = "lm-studio-models";
const OPENROUTER_CATALOG_TARGET = "openrouter-models";
const isLoopback = (url: string) =>
  /^(localhost|127\.0\.0\.1)$/.test(new URL(url).hostname);
const INTERVIEW_ANSWER_TARGET = "interview-answer-model";

// How much the interview assistant may read and write per turn. A local
// model is loaded with ASSISTANT_CONTEXT_TOKENS (see scripts/local-model.mjs);
// a quarter of the window is kept for output, at about 2.5 characters per
// token for code and JSON. A hosted model has a large window.
export function interviewAssistantBudget(baseUrl?: string) {
  const local =
    baseUrl !== undefined &&
    /^(localhost|127\.0\.0\.1)$/.test(new URL(baseUrl).hostname);
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

export function createPlatformAiGateway() {
  const modelAdapters = [];
  // The same model settings the interview API and the assistant use.
  // Nothing configured: the gateway falls back to the local draft model.
  const language = resolveDefaultLanguageModel();
  const languageTargetId = language?.id ?? "local";
  const assistantBudget = interviewAssistantBudget(language?.baseUrl);
  if (language) {
    modelAdapters.push(
      createOpenAiModelAdapter({
        id: language.id,
        label: language.label,
        model: language.model,
        baseUrl: language.baseUrl,
        timeoutMs: language.timeoutMs,
        ...(language.apiKey ? { apiKey: language.apiKey } : {}),
      }),
      // The interview assistant's turns: output sized to the model's context
      // window, and low enough temperature for factual answers and code.
      createOpenAiModelAdapter({
        id: INTERVIEW_ASSISTANT_TARGET,
        label: language.label,
        model: language.model,
        baseUrl: language.baseUrl,
        timeoutMs: language.timeoutMs,
        ...(language.apiKey ? { apiKey: language.apiKey } : {}),
        maxOutputTokens: assistantBudget.outputTokens,
        temperature: 0.3,
      }),
      // Generated answers carry code, tests and the full guide: a larger
      // output budget, still within a quarter of the context window.
      createOpenAiModelAdapter({
        id: INTERVIEW_ANSWER_TARGET,
        label: language.label,
        model: language.model,
        baseUrl: language.baseUrl,
        timeoutMs: language.timeoutMs,
        ...(language.apiKey ? { apiKey: language.apiKey } : {}),
        maxOutputTokens: Math.min(
          12_000,
          Math.floor(assistantBudget.contextTokens / 4),
        ),
        temperature: 0.2,
      }),
    );
  } else {
    modelAdapters.push(createLocalModelAdapter());
  }
  // The assistant's picker also offers LM Studio's installed models and
  // OpenRouter's free ones, each sized to the assistant's context budget.
  const pickerSizing = {
    minContextTokens: assistantBudget.contextTokens,
    maxOutputTokens: assistantBudget.outputTokens,
    temperature: 0.3,
  };
  const localDefault =
    language && isLoopback(language.baseUrl) ? language.model : undefined;
  const lmStudioUrl = localDefault
    ? language?.baseUrl
    : process.env["LM_STUDIO_MODEL"]
      ? (process.env["LM_STUDIO_BASE_URL"] ?? "http://127.0.0.1:1234/v1")
      : undefined;
  if (lmStudioUrl)
    modelAdapters.push(
      createOpenAiCatalogAdapter({
        ...pickerSizing,
        id: LM_STUDIO_CATALOG_TARGET,
        catalog: "lm-studio",
        baseUrl: lmStudioUrl,
        timeoutMs: language?.timeoutMs ?? 600_000,
        // Briefing packs run on the configured model; switching the
        // assistant never unloads it, and the picker offers it once.
        keepLoaded: [
          ...(localDefault ? [localDefault] : []),
          ...(process.env["LM_STUDIO_MODEL"]
            ? [process.env["LM_STUDIO_MODEL"]]
            : []),
        ],
        exclude: localDefault ? [localDefault] : [],
      }),
    );
  const openRouterKey = process.env["OPENROUTER_API_KEY"]?.trim();
  if (openRouterKey)
    modelAdapters.push(
      createOpenAiCatalogAdapter({
        ...pickerSizing,
        id: OPENROUTER_CATALOG_TARGET,
        catalog: "openrouter-free",
        apiKey: openRouterKey,
      }),
    );
  if (process.env["ANTHROPIC_API_KEY"]) {
    modelAdapters.push(
      createAnthropicModelAdapter({
        apiKey: process.env["ANTHROPIC_API_KEY"],
        model: process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-4-6",
      }),
    );
  }

  const imageAdapter = process.env["FAL_API_KEY"]
    ? createFalImageProvider({
        model: process.env["FAL_IMAGE_MODEL"] ?? "fal-ai/flux-pro/v1.1-ultra",
        aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
        async generate(request) {
          const response = await fetch(
            `https://fal.run/${
              request.task.image?.modelId ??
              process.env["FAL_IMAGE_MODEL"] ??
              "fal-ai/flux-pro/v1.1-ultra"
            }`,
            {
              method: "POST",
              headers: {
                authorization: `Key ${process.env["FAL_API_KEY"]}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                prompt: request.task.prompt,
                aspect_ratio: request.task.image?.aspectRatio ?? "16:9",
              }),
              ...(request.signal === undefined
                ? {}
                : { signal: request.signal }),
            },
          );
          if (!response.ok) throw new Error(`FAL returned ${response.status}.`);
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
      })
    : process.env["COMFYUI_WORKFLOW_JSON"]
      ? createComfyUiImageProvider({
          model: process.env["COMFYUI_IMAGE_MODEL"] ?? "comfyui-workflow",
          aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
          async generate(request) {
            const baseUrl = (
              process.env["COMFYUI_BASE_URL"] ?? "http://127.0.0.1:8188"
            ).replace(/\/$/, "");
            let workflow: Record<string, unknown>;
            try {
              workflow = JSON.parse(process.env["COMFYUI_WORKFLOW_JSON"] ?? "");
            } catch {
              throw new Error("COMFYUI_WORKFLOW_JSON must be valid JSON.");
            }
            const prepared = JSON.parse(
              JSON.stringify(workflow).replaceAll(
                "{{prompt}}",
                request.task.prompt,
              ),
            ) as Record<string, unknown>;
            const queued = await fetch(`${baseUrl}/prompt`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ prompt: prepared }),
              ...(request.signal === undefined
                ? {}
                : { signal: request.signal }),
            });
            if (!queued.ok)
              throw new Error(`ComfyUI returned ${queued.status}.`);
            const queuedBody = (await queued.json()) as { prompt_id?: string };
            if (!queuedBody.prompt_id) {
              throw new Error("ComfyUI returned no prompt id.");
            }
            for (let attempt = 0; attempt < 120; attempt += 1) {
              const historyResponse = await fetch(
                `${baseUrl}/history/${encodeURIComponent(queuedBody.prompt_id)}`,
                request.signal === undefined ? {} : { signal: request.signal },
              );
              if (historyResponse.ok) {
                const history = (await historyResponse.json()) as Record<
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
                >;
                const outputs = history[queuedBody.prompt_id]?.outputs;
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
        })
      : process.env["TOGETHER_AI_API_KEY"]
        ? createTogetherImageProvider({
            model:
              process.env["TOGETHER_IMAGE_MODEL"] ??
              "black-forest-labs/FLUX.1-schnell-Free",
            aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
            async generate(request) {
              const response = await fetch(
                "https://api.together.xyz/v1/images/generations",
                {
                  method: "POST",
                  headers: {
                    authorization: `Bearer ${process.env["TOGETHER_AI_API_KEY"]}`,
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({
                    model:
                      request.task.image?.modelId ??
                      process.env["TOGETHER_IMAGE_MODEL"] ??
                      "black-forest-labs/FLUX.1-schnell-Free",
                    prompt: request.task.prompt,
                    width: request.task.image?.width ?? 1024,
                    height: request.task.image?.height ?? 1024,
                  }),
                  ...(request.signal === undefined
                    ? {}
                    : { signal: request.signal }),
                },
              );
              return readImageResponse(response, "Together AI");
            },
            persist: persistImage,
          })
        : process.env["OPENAI_API_KEY"]
          ? createOpenAiImageProvider({
              model: process.env["OPENAI_IMAGE_MODEL"] ?? "gpt-image-1",
              aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
              async generate(request) {
                const baseUrl = (
                  process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1"
                ).replace(/\/$/, "");
                const response = await fetch(`${baseUrl}/images/generations`, {
                  method: "POST",
                  headers: {
                    authorization: `Bearer ${process.env["OPENAI_API_KEY"]}`,
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({
                    model:
                      request.task.image?.modelId ??
                      process.env["OPENAI_IMAGE_MODEL"] ??
                      "gpt-image-1",
                    prompt: request.task.prompt,
                    size:
                      request.task.image?.aspectRatio === "16:9"
                        ? "1536x1024"
                        : "1024x1024",
                  }),
                  ...(request.signal === undefined
                    ? {}
                    : { signal: request.signal }),
                });
                return readImageResponse(response, "OpenAI Images");
              },
              persist: persistImage,
            })
          : createFakeImageProvider((payload) =>
              persistImage({
                url: payload.url,
                ...(payload.mimeType === undefined
                  ? {}
                  : { mimeType: payload.mimeType }),
              }),
            );

  const profiles: AiProfile[] = [
    {
      id: "document-fast",
      label:
        languageTargetId === "local" ? "Local draft (no AI service)" : "Fast",
      family: "direct-model",
      targetId: languageTargetId,
      taskTypes: ["text-generation", "structured-generation", "streaming-chat"],
      enabled: true,
    },
    {
      id: "document-quality",
      label:
        languageTargetId === "local"
          ? "Local draft (no AI service)"
          : "High quality",
      family: "direct-model",
      targetId: process.env["ANTHROPIC_API_KEY"]
        ? "anthropic"
        : languageTargetId,
      taskTypes: ["text-generation", "structured-generation", "streaming-chat"],
      enabled: true,
    },
    {
      id: INTERVIEW_ASSISTANT_PROFILE,
      label: "Interview assistant",
      family: "direct-model",
      targetId: language ? INTERVIEW_ASSISTANT_TARGET : languageTargetId,
      taskTypes: ["structured-chat", "structured-generation"],
      enabled: true,
      // The picker names the model itself; the provider heads its group.
      listing: {
        name: language?.model ?? "Draft model",
        shortName: language?.model.split("/").at(-1) ?? "Default",
        tags: localDefault ? ["loaded"] : [],
        vision: false,
        reasoning: false,
        tools: true,
        contextWindow: assistantBudget.contextTokens,
        local: localDefault !== undefined,
        provider: {
          name: language?.label ?? "Draft model",
          ...(language ? { endpoint: new URL(language.baseUrl).host } : {}),
          local: localDefault !== undefined,
        },
      },
    },
    // Model catalogs: each lists models as `<profile id>/<model>`.
    ...(lmStudioUrl
      ? [
          {
            id: "lm-studio",
            label: "LM Studio",
            family: "direct-model" as const,
            targetId: LM_STUDIO_CATALOG_TARGET,
            taskTypes: ["structured-chat"],
            enabled: true,
            catalog: true,
          },
        ]
      : []),
    ...(openRouterKey
      ? [
          {
            id: "openrouter",
            label: "OpenRouter · free",
            family: "direct-model" as const,
            targetId: OPENROUTER_CATALOG_TARGET,
            taskTypes: ["structured-chat"],
            enabled: true,
            catalog: true,
          },
        ]
      : []),
    // Claude Code and Codex through their CLI logins, run by the agent worker.
    ...((process.env["AGENT_PAYLOAD_SECRET"] ??
    process.env["CONNECTED_ACCOUNT_SECRET"])
      ? agentAssistantProfiles()
      : []),
    {
      id: INTERVIEW_ANSWER_PROFILE,
      label: "Interview answers",
      family: "direct-model",
      targetId: language ? INTERVIEW_ANSWER_TARGET : languageTargetId,
      taskTypes: ["structured-generation"],
      enabled: true,
    },
    {
      id: "image-balanced",
      label: "Balanced",
      family: "direct-model",
      targetId: imageAdapter.providerId,
      taskTypes: ["image-generation", "image-editing"],
      enabled: true,
    },
    {
      id: "presentation-editor",
      label: "Presentation editor",
      family: "agent-runtime",
      targetId: "claude-code",
      taskTypes: ["agent-job"],
      enabled: true,
    },
  ];

  return createAiExecutionGateway({
    profiles,
    models: modelAdapters,
    images: [imageAdapter],
    agents: createAgentPort(),
    authorize: async (context) =>
      context.permissions.includes("presentation.read") ||
      context.permissions.includes("interview.read"),
  });
}
