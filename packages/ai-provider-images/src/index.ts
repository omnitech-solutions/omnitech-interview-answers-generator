import type {
  AiExecutionRequest,
  ImageProviderAdapter,
  ImageResult,
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
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("Image providers must return an HTTP(S) URL.");
  }
  if (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1"
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
    const payload = await options.generate(request, mode);
    if (options.id !== "comfyui" && options.id !== "fake-image") {
      assertSafeProviderUrl(payload.url);
    }
    const asset = await options.persist(payload);
    return {
      assetReference: asset.reference,
      mimeType: asset.mimeType,
      providerId: options.id,
      modelId: options.model,
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
