import { AiSdkError } from "./errors.js";
import type {
  AiClient,
  AiGenerateInput,
  AiObjectInput,
  AiProvider,
  CreateAiClientOptions,
} from "./types.js";

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new AiSdkError(
      "invalid_output",
      "The model did not return a JSON object.",
    );
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new AiSdkError(
      "invalid_output",
      "The model returned invalid JSON.",
      error,
    );
  }
}

export function createAiClient(options: CreateAiClientOptions): AiClient {
  if (options.providers.length === 0) {
    throw new AiSdkError(
      "configuration",
      "At least one AI provider is required.",
    );
  }

  const providers = new Map<string, AiProvider>(
    options.providers.map((provider) => [provider.summary.id, provider]),
  );
  const defaultProviderId =
    options.defaultProviderId ?? options.providers[0]?.summary.id;

  if (!defaultProviderId || !providers.has(defaultProviderId)) {
    throw new AiSdkError(
      "configuration",
      `Default provider "${defaultProviderId ?? ""}" is not configured.`,
    );
  }
  const resolvedDefaultProviderId = defaultProviderId;

  function resolveProvider(providerId?: string): AiProvider {
    const selectedId = providerId ?? resolvedDefaultProviderId;
    const provider = providers.get(selectedId);

    if (!provider) {
      throw new AiSdkError(
        "unknown_provider",
        `AI provider "${selectedId}" is not configured.`,
      );
    }

    return provider;
  }

  return {
    listProviders: () =>
      [...providers.values()].map((provider) => provider.summary),
    getDefaultProviderId: () => resolvedDefaultProviderId,
    generateText: (input) =>
      resolveProvider(input.providerId).generateText(input),
    async generateObject<T>(input: AiObjectInput<T>) {
      const result = await resolveProvider(input.providerId).generateText({
        ...input,
        system: [
          input.system,
          "Return exactly one JSON object. Do not wrap it in Markdown.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
      const parsed = input.schema.safeParse(extractJson(result.text));

      if (!parsed.success) {
        throw new AiSdkError(
          "invalid_output",
          `The model output did not match the requested schema: ${parsed.error.message}`,
        );
      }

      return { ...result, object: parsed.data };
    },
    streamText(input: AiGenerateInput) {
      const provider = resolveProvider(input.providerId);
      if (!provider.streamText) {
        throw new AiSdkError(
          "configuration",
          `AI provider "${provider.summary.id}" does not support streaming.`,
        );
      }
      return provider.streamText(input);
    },
  };
}
