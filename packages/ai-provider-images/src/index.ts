import {
  type AiExecutionRequest,
  type ImageProviderAdapter,
  type ImageResult,
  isSafeImageModelId,
} from "@omnitech/ai-contracts";

export interface GeneratedImagePayload {
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
  revisedPrompt?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface DurableImageAsset {
  reference: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface ImageAdapterOptions {
  id: "fal" | "together" | "comfyui" | "openai-image" | "fake-image" | string;
  model: string;
  aspectRatios: readonly string[];
  supportsEditing?: boolean;
  generate(
    request: AiExecutionRequest,
    mode: "generate" | "edit",
  ): Promise<GeneratedImagePayload>;
  persist(payload: GeneratedImagePayload): Promise<DurableImageAsset>;
}

function assertSafeProviderUrl(value: string): void {
  if (/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
    return;
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("Image providers must return an HTTP(S) URL.");
  }
  if (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]"
  ) {
    throw new Error("Remote image providers cannot return loopback URLs.");
  }
}

export function createImageProviderAdapter(
  options: ImageAdapterOptions,
): ImageProviderAdapter {
  const run = async (
    request: AiExecutionRequest,
    mode: "generate" | "edit",
  ): Promise<ImageResult> => {
    // [SAFETY] A caller-chosen model id reaches provider URLs and bodies: it
    // must be a plain catalog name before any transport sees it.
    const requestedModel = request.task.image?.modelId;
    if (requestedModel !== undefined && !isSafeImageModelId(requestedModel)) {
      throw new Error("The image model id is not allowed.");
    }
    const payload = await options.generate(request, mode);
    if (options.id !== "comfyui" && options.id !== "fake-image") {
      assertSafeProviderUrl(payload.url);
    }
    const asset = await options.persist(payload);
    return {
      assetReference: asset.reference,
      mimeType: asset.mimeType,
      providerId: options.id,
      modelId: request.task.image?.modelId ?? options.model,
      provenance: payload.metadata ?? {},
      ...(asset.width === undefined ? {} : { width: asset.width }),
      ...(asset.height === undefined ? {} : { height: asset.height }),
      ...(payload.revisedPrompt === undefined
        ? {}
        : { revisedPrompt: payload.revisedPrompt }),
    };
  };

  const adapter: ImageProviderAdapter = {
    providerId: options.id,
    capabilities: {
      generation: true,
      editing: options.supportsEditing ?? false,
      aspectRatios: options.aspectRatios,
    },
    generate: (request) => run(request, "generate"),
  };
  if (options.supportsEditing) {
    adapter.edit = (request) => run(request, "edit");
  }
  return adapter;
}

// Puts the prompt into every string value of a parsed ComfyUI workflow. The
// walk works on the object, never on serialised JSON text, so quotes,
// backslashes and braces in the prompt stay data and cannot reshape the graph.
export function fillWorkflowPrompt(workflow: unknown, prompt: string): unknown {
  if (typeof workflow === "string")
    return workflow.replaceAll("{{prompt}}", () => prompt);
  if (Array.isArray(workflow))
    return workflow.map((item) => fillWorkflowPrompt(item, prompt));
  if (workflow !== null && typeof workflow === "object")
    return Object.fromEntries(
      Object.entries(workflow).map(([key, value]) => [
        key,
        fillWorkflowPrompt(value, prompt),
      ]),
    );
  return workflow;
}

export type NamedImageProviderOptions = Omit<ImageAdapterOptions, "id">;

export const createFalImageProvider = (options: NamedImageProviderOptions) =>
  createImageProviderAdapter({ ...options, id: "fal" });

export const createTogetherImageProvider = (
  options: NamedImageProviderOptions,
) => createImageProviderAdapter({ ...options, id: "together" });

export const createComfyUiImageProvider = (
  options: NamedImageProviderOptions,
) => createImageProviderAdapter({ ...options, id: "comfyui" });

export const createOpenAiImageProvider = (options: NamedImageProviderOptions) =>
  createImageProviderAdapter({ ...options, id: "openai-image" });

export function createFakeImageProvider(
  persist: ImageAdapterOptions["persist"],
): ImageProviderAdapter {
  return createImageProviderAdapter({
    id: "fake-image",
    model: "deterministic",
    aspectRatios: ["1:1", "16:9", "9:16"],
    supportsEditing: true,
    async generate(request, mode) {
      const label = `${mode}:${request.task.prompt}`
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .slice(0, 200);
      const encoded = encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#312e81"/><stop offset="1" stop-color="#0f766e"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="64" y="480" fill="white" font-family="sans-serif" font-size="42">${label}</text></svg>`,
      );
      return {
        url: `data:image/svg+xml,${encoded}`,
        mimeType: "image/svg+xml",
        width: 1024,
        height: 1024,
        metadata: { deterministic: true },
      };
    },
    persist,
  });
}
