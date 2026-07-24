import { AiSdkError } from "./errors.js";
import { createAiClient } from "./client.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible.js";
import type { AiEnvironment } from "./types.js";

export function createAiClientFromEnv(
  environment: AiEnvironment = process.env,
) {
  const baseUrl = environment.AI_BASE_URL?.trim();
  const model = environment.AI_MODEL?.trim();

  if (!baseUrl || !model) {
    throw new AiSdkError(
      "configuration",
      "AI_BASE_URL and AI_MODEL must be configured.",
    );
  }

  const id = environment.AI_PROVIDER_ID?.trim() || "default";
  const provider = createOpenAiCompatibleProvider({
    id,
    label: environment.AI_PROVIDER_LABEL?.trim() || "Default",
    baseUrl,
    model,
    ...(environment.AI_API_KEY === undefined
      ? {}
      : { apiKey: environment.AI_API_KEY }),
    timeoutMs: Number(environment.AI_TIMEOUT_MS) || 120_000,
  });

  return createAiClient({ defaultProviderId: id, providers: [provider] });
}
