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
import { createOpenAiModelAdapter } from "@omnitech/ai-provider-openai";
import { AiSdkError, resolveDefaultLanguageModel } from "@omnitech/ai-sdk";
import {
  type AgentExecutionPort,
  type AiProfile,
  createAiExecutionGateway,
} from "@omnitech/ai-runtime";
import {
  AgentPayloadStore,
  getPlatformDatabase,
  PostgresAgentJobRepository,
} from "@omnitech/platform-storage";
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
    const runtime =
      profile.targetId === "claude-code" ? "claude-code" : "codex";
    const payloads = new AgentPayloadStore(database, secret);
    const promptReference = await payloads.save(
      request.context.tenantId,
      request.task.prompt,
    );
    const model =
      runtime === "codex"
        ? (process.env["CODEX_QUALITY_MODEL"] ?? "gpt-5.3-codex")
        : (process.env["CLAUDE_DOCUMENT_MODEL"] ?? "claude-opus-4-6");
    const job = await repository.create({
      tenantId: request.context.tenantId,
      userId: request.context.userId,
      productId: request.context.productId,
      promptReference,
      profile: {
        id: profile.id,
        runtime,
        model,
        fallbackModels: [],
        effort: "high",
        tools: [],
        sandbox: "read-only",
        approvalPolicy: "never",
        sessionPersistence: true,
        maximumTurns: 3,
        timeoutMs: 300_000,
        maximumOutputBytes: 4_000_000,
        additionalDirectories: [],
        webSearch: false,
      },
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
      const job = await database.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM ai.agent_jobs WHERE id = $1`,
        [executionId],
      );
      const tenantId = job.rows[0]?.tenant_id;
      if (tenantId) await repository.requestCancellation(tenantId, executionId);
    },
    async *resume(_request: AiResumeRequest): AsyncIterable<AiEvent> {
      throw new Error("Resume requires an existing agent session job.");
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

export function createPlatformAiGateway() {
  const modelAdapters = [];
  // The same model settings the interview API and the assistant use.
  const language = (() => {
    try {
      return resolveDefaultLanguageModel();
    } catch (error) {
      // Nothing configured: the gateway falls back to the local draft model.
      if (error instanceof AiSdkError && error.code === "configuration")
        return null;
      throw error;
    }
  })();
  const languageTargetId = language?.id ?? "local";
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
    );
  } else {
    modelAdapters.push(createLocalModelAdapter());
  }
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
    workflows: [],
    agents: createAgentPort(),
    authorize: async (context) =>
      context.permissions.includes("presentation.read") ||
      context.permissions.includes("interview.read"),
  });
}
