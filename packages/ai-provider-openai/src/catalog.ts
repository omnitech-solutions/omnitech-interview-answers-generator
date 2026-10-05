import type {
  AiAccessContext,
  ModelProviderAdapter,
} from "@omnitech/ai-contracts";
import {
  createLmStudioModels,
  createOpenRouterModels,
} from "@omnitech-assistant/providers";

export interface OpenAiCatalogAdapterOptions {
  // The gateway target this adapter serves.
  id: string;
  // Which OpenAI-compatible endpoint's model listing to offer.
  catalog: "lm-studio" | "openrouter-free";
  baseUrl?: string;
  // Required for OpenRouter.
  apiKey?: string;
  timeoutMs?: number;
  // Models with a smaller context window are not offered.
  minContextTokens?: number;
  maxOutputTokens?: number;
  temperature?: number;
  // LM Studio model keys never unloaded when a pick is loaded.
  keepLoaded?: readonly string[];
  // Model keys not offered, such as one already offered as a profile.
  exclude?: readonly string[];
  fetch?: typeof fetch;
  cacheMs?: number;
}

const PREFIX = { "lm-studio": "lm-studio/", "openrouter-free": "openrouter/" };

const scopeOf = (context: AiAccessContext) => ({
  tenantId: context.tenantId,
  actorId: context.userId,
  productId: context.productId,
});

/**
 * One OpenAI-compatible endpoint that offers many models: LM Studio's
 * installed models or OpenRouter's free ones. The listing, loading and
 * free-model guard stay inside this adapter; the gateway sees model ids
 * (`lm-studio/<key>`, `openrouter/<id>`) and structured chat.
 */
export function createOpenAiCatalogAdapter(
  options: OpenAiCatalogAdapterOptions,
): ModelProviderAdapter {
  const sizing = {
    ...(options.minContextTokens === undefined
      ? {}
      : { minContextTokens: options.minContextTokens }),
    ...(options.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: options.maxOutputTokens }),
    ...(options.temperature === undefined
      ? {}
      : { temperature: options.temperature }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.cacheMs === undefined ? {} : { cacheMs: options.cacheMs }),
    ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }),
  };
  const source =
    options.catalog === "lm-studio"
      ? createLmStudioModels({
          ...sizing,
          ...(options.keepLoaded ? { keepLoaded: options.keepLoaded } : {}),
        })
      : createOpenRouterModels({ ...sizing, apiKey: options.apiKey ?? "" });
  const excluded = new Set(
    (options.exclude ?? []).map((key) => `${PREFIX[options.catalog]}${key}`),
  );

  return {
    providerId: options.id,
    capabilities: {
      streaming: true,
      structuredOutput: true,
      tools: true,
      vision: false,
      search: false,
    },
    async listModels(context) {
      const listing = await source.catalog.list(scopeOf(context));
      // Each model carries its endpoint, so a picker can group them.
      return listing.models
        .filter((model) => !excluded.has(model.id))
        .map((model) =>
          model.provider || !listing.provider
            ? model
            : { ...model, provider: listing.provider },
        );
    },
    streamStructured(request) {
      return source.port.stream(
        scopeOf(request.context),
        request,
        request.signal ?? new AbortController().signal,
      );
    },
    async execute() {
      throw new Error("Catalog targets serve structured chat only.");
    },
    async *stream() {
      throw new Error("Catalog targets serve structured chat only.");
    },
  };
}
