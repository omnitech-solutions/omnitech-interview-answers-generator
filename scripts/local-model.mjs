// Model settings for `pnpm dev`. The settings themselves are resolved by
// @omnitech/ai-sdk (AI_*, OPENAI_*, LM_STUDIO_*); this only fills the gap when
// nothing is configured, and makes sure LM Studio's window fits the assistant.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

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

/** The coding model asked for when none is configured or loaded. */
export const DEFAULT_LM_STUDIO_MODEL = "qwen/qwen3-coder-30b";

/**
 * Environment to add when no model is configured: LM Studio's loaded model,
 * or the default coding model, which LM Studio loads on the first request
 * (and `pnpm dev` loads up front when its CLI is installed). Either way the
 * app always has a model, so starting LM Studio after `pnpm dev` works.
 * Any explicit setting wins, so this is empty when one exists.
 */
export async function defaultLocalModelEnvironment(env = process.env) {
  if (modelConfigured(env)) return {};
  const loaded = await loadedLmStudioModel(env);
  const model = loaded ?? DEFAULT_LM_STUDIO_MODEL;
  console.log(
    loaded
      ? `[dev] No AI model configured; using LM Studio's loaded model "${model}".`
      : `[dev] No AI model configured or loaded; using "${model}" from LM Studio.`,
    "Set LM_STUDIO_MODEL, OPENAI_MODEL or AI_BASE_URL and AI_MODEL to choose another.",
  );
  // A local model reads long briefing material slowly: a pack's research and
  // matrix can take minutes before the reply starts.
  return {
    LM_STUDIO_MODEL: model,
    ...(env.AI_TIMEOUT_MS ? {} : { AI_TIMEOUT_MS: String(LOCAL_TIMEOUT_MS) }),
  };
}

/** How long a local model may take to reply, unless AI_TIMEOUT_MS is set. */
export const LOCAL_TIMEOUT_MS = 600_000;

/**
 * Loads LM Studio's model with a context window big enough for the interview
 * assistant's system prompt, history and a drafted answer (LM Studio defaults
 * to 4-8k tokens). ASSISTANT_CONTEXT_TOKENS and ASSISTANT_MODEL_TTL_SECONDS
 * override the defaults. Returns the window the assistant can rely on.
 */
export async function ensureLmStudioContext(id, env = process.env) {
  const wanted = Number(env.ASSISTANT_CONTEXT_TOKENS ?? 32768);
  const ttl = String(env.ASSISTANT_MODEL_TTL_SECONDS ?? 14400);
  const lms = resolve(env.HOME ?? "", ".lmstudio/bin/lms");
  try {
    const listing = await (
      await fetch(`${lmStudioOrigin(env)}/api/v0/models`, {
        signal: AbortSignal.timeout(3000),
      })
    ).json();
    const loaded = listing.data?.find(
      (item) => item.id === id && item.state === "loaded",
    );
    if (loaded?.loaded_context_length >= wanted)
      return loaded.loaded_context_length;
    if (!existsSync(lms)) {
      console.error(
        `[dev] LM Studio CLI not found at ${lms}; load ${id} with a context of at least ${wanted} tokens yourself.`,
      );
      return loaded?.loaded_context_length;
    }
    console.log(`[dev] Loading ${id} in LM Studio with ${wanted} tokens of context.`);
    if (loaded) execFileSync(lms, ["unload", id], { stdio: "pipe" });
    execFileSync(
      lms,
      ["load", id, "--identifier", id, "--context-length", String(wanted), "--ttl", ttl, "-y"],
      { stdio: "pipe" },
    );
    return wanted;
  } catch (error) {
    console.error(`[dev] Could not prepare ${id} in LM Studio: ${error.message}`);
    return undefined;
  }
}
