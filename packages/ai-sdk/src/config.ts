import { AiSdkError } from "./errors.js";
import { createAiClient } from "./client.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible.js";
import type { AiEnvironment, AiProvider } from "./types.js";

/**
 * One language-model endpoint as the environment describes it. Everything that
 * talks to a model (the interview API, the platform gateway, the assistant)
 * resolves its settings here, so they cannot drift apart.
 */
export interface ResolvedLanguageModel {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
}

const NOT_CONFIGURED =
  "Configure AI_BASE_URL and AI_MODEL, OPENAI_MODEL, or LM_STUDIO_MODEL.";

/**
 * Every configured endpoint, in precedence order: AI_BASE_URL + AI_MODEL, then
 * OpenAI (OPENAI_MODEL, or just OPENAI_API_KEY with the default model), then
 * LM Studio (LM_STUDIO_MODEL). Empty when nothing is configured.
 */
export function resolveLanguageModels(
  environment: AiEnvironment = process.env,
): ResolvedLanguageModel[] {
  const models: ResolvedLanguageModel[] = [];
  const timeoutMs = Number(environment.AI_TIMEOUT_MS) || 120_000;
  const previousBaseUrl = environment.AI_BASE_URL?.trim();
  const previousModel = environment.AI_MODEL?.trim();

  if (previousBaseUrl && previousModel) {
    const isLmStudio = /localhost|127\.0\.0\.1/.test(previousBaseUrl);
    models.push({
      id:
        environment.AI_PROVIDER_ID?.trim() ||
        (isLmStudio ? "lm-studio" : "openai"),
      label:
        environment.AI_PROVIDER_LABEL?.trim() ||
        (isLmStudio ? "LM Studio" : "OpenAI"),
      baseUrl: previousBaseUrl,
      model: previousModel,
      ...(environment.AI_API_KEY === undefined
        ? {}
        : { apiKey: environment.AI_API_KEY }),
      timeoutMs,
    });
  }

  const openAiModel =
    environment.OPENAI_MODEL?.trim() ||
    (environment.OPENAI_API_KEY?.trim() ? "gpt-5-mini" : "");
  if (openAiModel && !models.some(({ id }) => id === "openai")) {
    models.push({
      id: "openai",
      label: "OpenAI",
      baseUrl:
        environment.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
      model: openAiModel,
      ...(environment.OPENAI_API_KEY === undefined
        ? {}
        : { apiKey: environment.OPENAI_API_KEY }),
      timeoutMs,
    });
  }

  const lmStudioModel = environment.LM_STUDIO_MODEL?.trim();
  if (lmStudioModel && !models.some(({ id }) => id === "lm-studio")) {
    models.push({
      id: "lm-studio",
      label: "LM Studio",
      baseUrl:
        environment.LM_STUDIO_BASE_URL?.trim() || "http://127.0.0.1:1234/v1",
      model: lmStudioModel,
      ...(environment.LM_STUDIO_API_KEY === undefined
        ? {}
        : { apiKey: environment.LM_STUDIO_API_KEY }),
      timeoutMs,
    });
  }

  return models;
}

function pickDefault(
  models: readonly ResolvedLanguageModel[],
  environment: AiEnvironment,
): ResolvedLanguageModel {
  if (models.length === 0)
    throw new AiSdkError("configuration", NOT_CONFIGURED);
  const requested = environment.AI_DEFAULT_PROVIDER_ID?.trim();
  return (requested && models.find(({ id }) => id === requested)) || models[0]!;
}

/** The endpoint used when a caller does not name one. Throws if none is configured. */
export function resolveDefaultLanguageModel(
  environment: AiEnvironment = process.env,
): ResolvedLanguageModel {
  return pickDefault(resolveLanguageModels(environment), environment);
}

export function createAiClientFromEnv(
  environment: AiEnvironment = process.env,
) {
  const models = resolveLanguageModels(environment);
  const providers: AiProvider[] = models.map((model) =>
    createOpenAiCompatibleProvider({
      id: model.id,
      label: model.label,
      baseUrl: model.baseUrl,
      model: model.model,
      ...(model.apiKey === undefined ? {} : { apiKey: model.apiKey }),
      timeoutMs: model.timeoutMs,
    }),
  );
  return createAiClient({
    defaultProviderId: pickDefault(models, environment).id,
    providers,
  });
}
