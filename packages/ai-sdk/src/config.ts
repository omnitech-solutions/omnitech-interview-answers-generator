import { AiSdkError } from "./errors.js";
import { createAiClient } from "./client.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible.js";
import type { AiEnvironment, AiProvider } from "./types.js";

export function createAiClientFromEnv(
  environment: AiEnvironment = process.env,
) {
  const providers: AiProvider[] = [];
  const timeoutMs = Number(environment.AI_TIMEOUT_MS) || 120_000;
  const legacyBaseUrl = environment.AI_BASE_URL?.trim();
  const legacyModel = environment.AI_MODEL?.trim();

  if (legacyBaseUrl && legacyModel) {
    const isLmStudio = /localhost|127\.0\.0\.1/.test(legacyBaseUrl);
    providers.push(
      createOpenAiCompatibleProvider({
        id:
          environment.AI_PROVIDER_ID?.trim() ||
          (isLmStudio ? "lm-studio" : "openai"),
        label:
          environment.AI_PROVIDER_LABEL?.trim() ||
          (isLmStudio ? "LM Studio" : "OpenAI"),
        baseUrl: legacyBaseUrl,
        model: legacyModel,
        ...(environment.AI_API_KEY === undefined
          ? {}
          : { apiKey: environment.AI_API_KEY }),
        timeoutMs,
      }),
    );
  }

  const openAiModel = environment.OPENAI_MODEL?.trim();
  if (
    openAiModel &&
    !providers.some(({ summary }) => summary.id === "openai")
  ) {
    providers.push(
      createOpenAiCompatibleProvider({
        id: "openai",
        label: "OpenAI",
        baseUrl:
          environment.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
        model: openAiModel,
        ...(environment.OPENAI_API_KEY === undefined
          ? {}
          : { apiKey: environment.OPENAI_API_KEY }),
        timeoutMs,
      }),
    );
  }

  const lmStudioModel = environment.LM_STUDIO_MODEL?.trim();
  if (
    lmStudioModel &&
    !providers.some(({ summary }) => summary.id === "lm-studio")
  ) {
    providers.push(
      createOpenAiCompatibleProvider({
        id: "lm-studio",
        label: "LM Studio",
        baseUrl:
          environment.LM_STUDIO_BASE_URL?.trim() || "http://127.0.0.1:1234/v1",
        model: lmStudioModel,
        ...(environment.LM_STUDIO_API_KEY === undefined
          ? {}
          : { apiKey: environment.LM_STUDIO_API_KEY }),
        timeoutMs,
      }),
    );
  }

  if (providers.length === 0) {
    throw new AiSdkError(
      "configuration",
      "Configure AI_BASE_URL and AI_MODEL, OPENAI_MODEL, or LM_STUDIO_MODEL.",
    );
  }

  const requestedDefault = environment.AI_DEFAULT_PROVIDER_ID?.trim();
  return createAiClient({
    defaultProviderId:
      requestedDefault &&
      providers.some(({ summary }) => summary.id === requestedDefault)
        ? requestedDefault
        : providers[0]!.summary.id,
    providers,
  });
}
