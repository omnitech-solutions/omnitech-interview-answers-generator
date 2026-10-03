import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentProfile } from "@omnitech/agent-runtime-contracts";
import type { AiLocality, AiProfile } from "./index.js";

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
  // Declared by AI_LOCALITY, OPENAI_LOCALITY or LM_STUDIO_LOCALITY; never
  // inferred from the URL (rule:declared-profile-locality).
  locality: AiLocality;
}

const LOCALITIES: readonly AiLocality[] = [
  "device",
  "private-network",
  "remote",
];
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The locality an endpoint declares: a missing or unknown value is remote,
 * and a `device` declaration whose base URL does not resolve to loopback is
 * downgraded to remote. The URL only ever lowers trust, never grants it.
 */
export function declareLocality(
  declared: string | undefined,
  baseUrl: string,
): AiLocality {
  const value = LOCALITIES.find((locality) => locality === declared?.trim());
  if (value !== "device") return value ?? "remote";
  try {
    return LOOPBACK_HOSTS.has(new URL(baseUrl).hostname) ? "device" : "remote";
  } catch {
    return "remote";
  }
}

/** A copy of an AiProfile definition carrying its declared locality. */
export function withDeclaredLocality<T extends AiProfile>(
  profile: T,
  locality: AiLocality,
): T {
  return { ...profile, locality };
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
      locality: declareLocality(environment["AI_LOCALITY"], baseUrl),
    });
  }

  // OpenAI: an API key alone selects the default hosted model.
  const openAiModel =
    environment["OPENAI_MODEL"]?.trim() ||
    (environment["OPENAI_API_KEY"]?.trim() ? "gpt-5-mini" : "");
  if (openAiModel && !models.some(({ id }) => id === "openai")) {
    const openAiBaseUrl =
      environment["OPENAI_BASE_URL"]?.trim() || "https://api.openai.com/v1";
    models.push({
      id: "openai",
      label: "OpenAI",
      baseUrl: openAiBaseUrl,
      model: openAiModel,
      ...withApiKey(environment["OPENAI_API_KEY"]),
      timeoutMs,
      locality: declareLocality(environment["OPENAI_LOCALITY"], openAiBaseUrl),
    });
  }

  // LM Studio on this machine.
  const lmStudioModel = environment["LM_STUDIO_MODEL"]?.trim();
  if (lmStudioModel && !models.some(({ id }) => id === "lm-studio")) {
    const lmStudioBaseUrl =
      environment["LM_STUDIO_BASE_URL"]?.trim() || "http://127.0.0.1:1234/v1";
    models.push({
      id: "lm-studio",
      label: "LM Studio",
      baseUrl: lmStudioBaseUrl,
      model: lmStudioModel,
      ...withApiKey(environment["LM_STUDIO_API_KEY"]),
      timeoutMs,
      locality: declareLocality(
        environment["LM_STUDIO_LOCALITY"],
        lmStudioBaseUrl,
      ),
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

// The `model = "…"` line of ~/.codex/config.toml, if there is one.
function codexConfiguredModel(environment: LanguageModelEnvironment) {
  try {
    const config = readFileSync(
      join(
        environment["CODEX_HOME"] ?? join(homedir(), ".codex"),
        "config.toml",
      ),
      "utf8",
    );
    return /^\s*model\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  } catch {
    return undefined;
  }
}

// Shared bounds: read-only, never asking for approval, no extra directories
// and no web search. No user input reaches a profile (ADR-0007 Decision 4).
const BOUNDED = {
  fallbackModels: [],
  tools: [],
  sandbox: "read-only",
  approvalPolicy: "never",
  additionalDirectories: [],
  webSearch: false,
} as const;

/**
 * Every agent profile Codex and Claude Code jobs run under, defined once
 * here: typed, versioned and bounded. Consumers name a profile by id; the
 * environment chooses only model names. Bump a profile's version when its
 * bounds change, so job snapshots show which revision they ran.
 */
export function resolveAgentProfiles(
  environment: LanguageModelEnvironment = process.env,
): ReadonlyMap<string, AgentProfile> {
  const documentModel =
    environment["CLAUDE_DOCUMENT_MODEL"] ?? "claude-opus-4-6";
  const profiles: AgentProfile[] = [
    {
      ...BOUNDED,
      id: "coding-fast",
      version: 1,
      runtime: "codex",
      model: environment["CODEX_FAST_MODEL"] ?? "gpt-5.3-codex",
      effort: "low",
      sessionPersistence: false,
      maximumTurns: 1,
      timeoutMs: 120_000,
      maximumOutputBytes: 2_000_000,
    },
    {
      ...BOUNDED,
      id: "coding-quality",
      version: 1,
      runtime: "codex",
      model: environment["CODEX_QUALITY_MODEL"] ?? "gpt-5.3-codex",
      effort: "high",
      tools: ["read"],
      sessionPersistence: true,
      maximumTurns: 2,
      timeoutMs: 300_000,
      maximumOutputBytes: 4_000_000,
    },
    {
      ...BOUNDED,
      id: "document-quality",
      version: 1,
      runtime: "claude-code",
      model: documentModel,
      fallbackModels: environment["CLAUDE_FALLBACK_MODEL"]
        ? [environment["CLAUDE_FALLBACK_MODEL"]]
        : [],
      effort: "high",
      sessionPersistence: false,
      maximumTurns: 2,
      maximumBudgetUsd: 5,
      timeoutMs: 300_000,
      maximumOutputBytes: 4_000_000,
    },
    {
      ...BOUNDED,
      id: "presentation-editor",
      version: 1,
      runtime: "claude-code",
      model: documentModel,
      effort: "high",
      sessionPersistence: true,
      maximumTurns: 3,
      maximumBudgetUsd: 8,
      timeoutMs: 300_000,
      maximumOutputBytes: 4_000_000,
      outputSchema: {
        type: "object",
        required: ["sourceXml"],
        properties: { sourceXml: { type: "string" } },
      },
    },
    // Assistant turns: one short, tool-less reply. Sonnet answers coaching
    // questions well and much faster than Opus.
    {
      ...BOUNDED,
      id: "assistant-claude-code",
      version: 1,
      runtime: "claude-code",
      model: environment["CLAUDE_ASSISTANT_MODEL"] ?? "sonnet",
      effort: "medium",
      sessionPersistence: false,
      maximumTurns: 1,
      timeoutMs: 300_000,
      maximumOutputBytes: 1_000_000,
    },
    // The model the person's Codex CLI uses: a ChatGPT sign-in accepts only
    // some models, and the CLI's own choice is one it accepts. Codex thinks
    // less and answers sooner at low effort.
    {
      ...BOUNDED,
      id: "assistant-codex",
      version: 1,
      runtime: "codex",
      model:
        environment["CODEX_ASSISTANT_MODEL"] ??
        codexConfiguredModel(environment) ??
        "gpt-5.3-codex",
      effort: "low",
      sessionPersistence: false,
      maximumTurns: 1,
      timeoutMs: 300_000,
      maximumOutputBytes: 1_000_000,
    },
  ];
  return new Map(profiles.map((profile) => [profile.id, profile]));
}
