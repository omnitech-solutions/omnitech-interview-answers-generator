// Shared by the development launchers so `pnpm dev` and `pnpm assistant:dev`
// start from the same model settings. The settings themselves are resolved by
// @omnitech/ai-sdk (AI_*, OPENAI_*, LM_STUDIO_*); this only fills the gap when
// nothing is configured.

const CONFIGURING = ["AI_MODEL", "OPENAI_MODEL", "OPENAI_API_KEY", "LM_STUDIO_MODEL"];

export const modelConfigured = (env = process.env) =>
  CONFIGURING.some((name) => env[name]?.trim());

/** The origin of LM Studio's server, without the /v1 suffix. */
export const lmStudioOrigin = (env = process.env) =>
  (env.LM_STUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1").replace(/\/v1\/?$/, "");

/** The model LM Studio has loaded, preferring a text model; undefined if none. */
export async function loadedLmStudioModel(env = process.env) {
  try {
    const response = await fetch(`${lmStudioOrigin(env)}/api/v0/models`, {
      signal: AbortSignal.timeout(1500),
    });
    const { data = [] } = await response.json();
    const loaded = data.filter((model) => model.state === "loaded");
    return (
      loaded.find((model) => model.type === "llm") ??
      loaded.find((model) => model.type === "vlm")
    )?.id;
  } catch {
    return undefined;
  }
}

/**
 * Environment to add when no model is configured: LM Studio's loaded model.
 * Any explicit setting wins, so this is empty when one exists.
 */
export async function defaultLocalModelEnvironment(env = process.env) {
  if (modelConfigured(env)) return {};
  const model = await loadedLmStudioModel(env);
  if (!model) return {};
  console.log(
    `[dev] No AI model configured; using LM Studio's loaded model "${model}". Set LM_STUDIO_MODEL, OPENAI_MODEL or AI_BASE_URL and AI_MODEL to choose another.`,
  );
  return { LM_STUDIO_MODEL: model };
}
