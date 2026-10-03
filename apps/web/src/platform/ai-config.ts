/**
 * One language-model endpoint as the environment describes it. Everything that
 * talks to a model (the platform gateway, the interview API, the assistant)
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

export type LanguageModelEnvironment = Readonly<
  Record<string, string | undefined>
>;

/**
 * Every configured endpoint, in precedence order: AI_BASE_URL + AI_MODEL, then
 * OpenAI (OPENAI_MODEL, or just OPENAI_API_KEY with the default model), then
 * LM Studio (LM_STUDIO_MODEL). Empty when nothing is configured.
 */
export function resolveLanguageModels(
  environment: LanguageModelEnvironment = process.env,
): ResolvedLanguageModel[] {
  const models: ResolvedLanguageModel[] = [];
  const timeoutMs = Number(environment["AI_TIMEOUT_MS"]) || 120_000;

  // AI_BASE_URL + AI_MODEL name any OpenAI-compatible endpoint; a loopback
  // address is LM Studio unless AI_PROVIDER_ID says otherwise.
  const baseUrl = environment["AI_BASE_URL"]?.trim();
  const model = environment["AI_MODEL"]?.trim();
  if (baseUrl && model) {
    const isLmStudio = /localhost|127\.0\.0\.1/.test(baseUrl);
    models.push({
      id:
        environment["AI_PROVIDER_ID"]?.trim() ||
        (isLmStudio ? "lm-studio" : "openai"),
      label:
        environment["AI_PROVIDER_LABEL"]?.trim() ||
        (isLmStudio ? "LM Studio" : "OpenAI"),
      baseUrl,
      model,
      ...withApiKey(environment["AI_API_KEY"]),
      timeoutMs,
    });
  }

  // OpenAI: an API key alone selects the default hosted model.
  const openAiModel =
    environment["OPENAI_MODEL"]?.trim() ||
    (environment["OPENAI_API_KEY"]?.trim() ? "gpt-5-mini" : "");
  if (openAiModel && !models.some(({ id }) => id === "openai")) {
    models.push({
      id: "openai",
      label: "OpenAI",
      baseUrl:
        environment["OPENAI_BASE_URL"]?.trim() || "https://api.openai.com/v1",
      model: openAiModel,
      ...withApiKey(environment["OPENAI_API_KEY"]),
      timeoutMs,
    });
  }

  // LM Studio on this machine.
  const lmStudioModel = environment["LM_STUDIO_MODEL"]?.trim();
  if (lmStudioModel && !models.some(({ id }) => id === "lm-studio")) {
    models.push({
      id: "lm-studio",
      label: "LM Studio",
      baseUrl:
        environment["LM_STUDIO_BASE_URL"]?.trim() || "http://127.0.0.1:1234/v1",
      model: lmStudioModel,
      ...withApiKey(environment["LM_STUDIO_API_KEY"]),
      timeoutMs,
    });
  }

  return models;
}

/**
 * The endpoint used when a caller does not name one: AI_DEFAULT_PROVIDER_ID
 * when it matches a configured endpoint, otherwise the first. Null when no
 * model is configured, so each caller decides what "not configured" means.
 */
export function resolveDefaultLanguageModel(
  environment: LanguageModelEnvironment = process.env,
): ResolvedLanguageModel | null {
  const models = resolveLanguageModels(environment);
  const requested = environment["AI_DEFAULT_PROVIDER_ID"]?.trim();
  return (
    (requested && models.find(({ id }) => id === requested)) ||
    models[0] ||
    null
  );
}

function withApiKey(apiKey: string | undefined) {
  return apiKey === undefined ? {} : { apiKey };
}
