// The worker's own AiExecutionGateway for the Active Session loop (ADR-0011,
// ADR-0012). It is composed from the same environment model settings as the web
// host (resolveDefaultLanguageModel) but never shared with it: the worker owns
// its gateway, names profiles and never branches on a provider or model.
//
// Locality is DECLARED by the environment (rule:declared-profile-locality), never
// inferred. The fast profile serves permitted-remote sessions and carries the
// model's declared locality; the device profile exists only when that declared
// locality is `device`, so a device-only session can only ever reach a model
// the environment declared to run on this device.
import type { AiExecutionGateway } from "@omnitech/ai-contracts";
import { createOpenAiModelAdapter } from "@omnitech/ai-provider-openai";
import {
  type AgentExecutionPort,
  type AiProfile,
  createAiExecutionGateway,
} from "@omnitech/ai-runtime";
import {
  resolveDefaultLanguageModel,
  withDeclaredLocality,
} from "@omnitech/ai-runtime/config";
import {
  INTERVIEW_SESSION_DEVICE_PROFILE,
  INTERVIEW_SESSION_FAST_PROFILE,
} from "@omnitech/product-interview/session-worker";

type Environment = Readonly<Record<string, string | undefined>>;

const SESSION_MODEL_TARGET = "interview-session-model";

// The session worker never starts agent jobs or images through its gateway.
const noAgents: AgentExecutionPort = {
  async execute() {
    throw new Error("The session gateway runs no agent profiles.");
  },
  async *stream() {
    throw new Error("The session gateway runs no agent profiles.");
  },
  async cancel() {},
  async *resume() {
    throw new Error("The session gateway runs no agent profiles.");
  },
};

// The same output budget the web host gives the interview assistant: a quarter
// of the context window (a local model is loaded with ASSISTANT_CONTEXT_TOKENS).
function outputTokens(env: Environment, baseUrl: string): number {
  const local = /^(localhost|127\.0\.0\.1)$/.test(new URL(baseUrl).hostname);
  const contextTokens =
    Number(env["ASSISTANT_CONTEXT_TOKENS"]) || (local ? 65_536 : 131_072);
  return Math.min(8192, Math.floor(contextTokens / 4));
}

export type SessionGateway = {
  gateway: AiExecutionGateway;
  profileIds: readonly string[];
};

// Null when no language model is configured: the caller disables the session
// loop rather than crashing the worker.
export function createSessionGateway(env: Environment): SessionGateway | null {
  const language = resolveDefaultLanguageModel(env);
  if (!language) return null;
  const adapter = createOpenAiModelAdapter({
    id: SESSION_MODEL_TARGET,
    label: language.label,
    model: language.model,
    baseUrl: language.baseUrl,
    timeoutMs: language.timeoutMs,
    ...(language.apiKey ? { apiKey: language.apiKey } : {}),
    maxOutputTokens: outputTokens(env, language.baseUrl),
    temperature: 0.3,
  });
  const profile = (id: string, label: string): AiProfile =>
    withDeclaredLocality(
      {
        id,
        label,
        family: "direct-model",
        targetId: SESSION_MODEL_TARGET,
        taskTypes: ["structured-generation"],
        enabled: true,
      },
      language.locality,
    );
  const profiles = [
    profile(INTERVIEW_SESSION_FAST_PROFILE, "Interview session assistance"),
    // Only a model declared to run on the device may serve a device-only session.
    ...(language.locality === "device"
      ? [
          profile(
            INTERVIEW_SESSION_DEVICE_PROFILE,
            "Interview session assistance (device)",
          ),
        ]
      : []),
  ];
  return {
    gateway: createAiExecutionGateway({
      profiles,
      models: [adapter],
      images: [],
      agents: noAgents,
      authorize: async (context) =>
        context.permissions.includes("interview.read"),
    }),
    profileIds: profiles.map(({ id }) => id),
  };
}
