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
import type {
  AgentProfile,
  AgentRuntimeAdapter,
} from "@omnitech/agent-runtime-contracts";
import type { AiExecutionGateway } from "@omnitech/ai-contracts";
import { createOpenAiModelAdapter } from "@omnitech/ai-provider-openai";
import {
  type AgentExecutionPort,
  type AiProfile,
  createAiExecutionGateway,
} from "@omnitech/ai-runtime";
import {
  resolveAgentProfiles,
  resolveDefaultLanguageModel,
  withDeclaredLocality,
} from "@omnitech/ai-runtime/config";
import {
  INTERVIEW_ANSWER_PROFILE,
  INTERVIEW_SESSION_DEVICE_PROFILE,
  INTERVIEW_SESSION_FAST_PROFILE,
} from "@omnitech/product-interview/session-worker";
import {
  type AttachmentSource,
  createSessionAgentPort,
  type SessionAgentPortOptions,
} from "./session-agent-port";

type Environment = Readonly<Record<string, string | undefined>>;

const SESSION_MODEL_TARGET = "interview-session-model";

// Agent-runtime session profiles (ADR-0016): tool-less, per-attempt isolated,
// served by the worker's AgentExecutionPort. They exist only when the explicit
// flag below is on; the default gateway keeps `noAgents`.
export const SESSION_AGENT_FLAG = "ACTIVE_SESSION_AGENT_PORT";
export const SESSION_AGENT_CLAUDE_PROFILE = "interview-session-agent-claude";
export const SESSION_AGENT_CODEX_PROFILE = "interview-session-agent-codex";

// Gateway profile id -> the bounded agent profile it runs (never user input).
const SESSION_AGENT_PROFILES = [
  {
    id: SESSION_AGENT_CLAUDE_PROFILE,
    label: "Interview session assistance (Claude Code)",
    runtime: "claude-code",
    agentProfile: "assistant-claude-code",
  },
  {
    id: SESSION_AGENT_CODEX_PROFILE,
    label: "Interview session assistance (Codex)",
    runtime: "codex",
    agentProfile: "assistant-codex",
  },
] as const;

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

// Which agent profile is pinned by the host for the whole worker (ADR-0016: one
// profile for answer and code, no cross-provider fallback). It serves
// screenshot tasks and, for sessions that may use remote processing, the assist
// and coding stages (tool-less; text-only unless a screenshot rides along).
// Device-only sessions keep the direct device model.
// A tool-less structured answer needs turns beyond the model's first reply:
// Claude returns structured output through a synthetic tool call, and the SDK
// rejects a malformed call (observed: every field wrapped in one property, or a
// tool-call template leaking through) and asks again. The assistant profile's
// single turn ends such a run with `error_max_turns` on the first glitch, and
// three turns still lose a screenshot call that glitches repeatedly. With no
// tools the extra turns can only be this structured-output retry; the profile's
// own timeout still bounds the run.
//
// The session's own agent profile therefore DECLARES that bound as its
// maximumTurns (a derived `session-<assistant profile>`; the shared assistant
// profile keeps its single turn for its own callers). A configured bound is
// honoured or refused, never silently raised: ACTIVE_SESSION_AGENT_MAX_TURNS
// below the minimum fails startup naming the minimum.
export const SESSION_AGENT_MIN_TURNS = 6;
export const SESSION_AGENT_TURNS_ENV = "ACTIVE_SESSION_AGENT_MAX_TURNS";

export class SessionGatewayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionGatewayConfigError";
  }
}

function sessionMaximumTurns(env: Environment): number {
  const configured = env[SESSION_AGENT_TURNS_ENV]?.trim();
  if (configured === undefined || configured === "")
    return SESSION_AGENT_MIN_TURNS;
  const turns = Number(configured);
  if (!Number.isInteger(turns) || turns < SESSION_AGENT_MIN_TURNS)
    throw new SessionGatewayConfigError(
      `${SESSION_AGENT_TURNS_ENV} must be an integer of at least ${SESSION_AGENT_MIN_TURNS}: a structured session answer needs the turns of its structured-output retries.`,
    );
  return turns;
}

export const SESSION_VISION_PROFILE_ENV = "ACTIVE_SESSION_AGENT_PROFILE";
const VISION_PROFILES: Readonly<Record<string, string>> = {
  claude: SESSION_AGENT_CLAUDE_PROFILE,
  codex: SESSION_AGENT_CODEX_PROFILE,
};

export type SessionGateway = {
  gateway: AiExecutionGateway;
  profileIds: readonly string[];
  // The pinned agent profile (see above); present only when the agent port is
  // on and the host pinned a provider that is configured. The name is kept from
  // when it served screenshots alone.
  visionProfileId?: string;
  // Present only with the agent port: the startup sweep and the purge hooks for
  // staged screenshots.
  agentStaging?: {
    sweep(): Promise<void>;
    purge(): Promise<void>;
    sweepIdle(): Promise<void>;
  };
};

export type SessionGatewayOptions = {
  // The worker's agent runtime adapters, used only when the flag is on.
  runtimes?: Readonly<Record<string, AgentRuntimeAdapter>>;
  attachmentSource?: AttachmentSource;
  stillPermitted?: SessionAgentPortOptions["stillPermitted"];
  isBackground?: SessionAgentPortOptions["isBackground"];
};

function createAgentPort(
  env: Environment,
  runtimes: Readonly<Record<string, AgentRuntimeAdapter>>,
  options: SessionGatewayOptions,
) {
  const agentProfiles = resolveAgentProfiles(env);
  const maximumTurns = sessionMaximumTurns(env);
  const mapped = new Map<string, AgentProfile>();
  const profiles: AiProfile[] = [];
  for (const entry of SESSION_AGENT_PROFILES) {
    const agent = agentProfiles.get(entry.agentProfile);
    if (!agent || !runtimes[entry.runtime]) continue;
    mapped.set(entry.id, {
      ...agent,
      id: `session-${agent.id}`,
      maximumTurns,
    });
    profiles.push({
      id: entry.id,
      label: entry.label,
      family: "agent-runtime",
      targetId: entry.runtime,
      taskTypes: ["structured-generation"],
      enabled: true,
    });
  }
  const port = createSessionAgentPort({
    runtimes,
    profiles: mapped,
    ...(env["ACTIVE_SESSION_AGENT_STAGING_DIR"]
      ? { stagingBase: env["ACTIVE_SESSION_AGENT_STAGING_DIR"] }
      : {}),
    ...(options.attachmentSource
      ? { attachmentSource: options.attachmentSource }
      : {}),
    ...(options.stillPermitted
      ? { stillPermitted: options.stillPermitted }
      : {}),
    ...(options.isBackground ? { isBackground: options.isBackground } : {}),
  });
  return { port, profiles };
}

// Null when nothing can serve a session: neither a direct language model nor the
// agent port. The agent runner (Claude Code) is a complete gateway on its own, so
// a host with no LM Studio or API endpoint still runs sessions through it.
export function createSessionGateway(
  env: Environment,
  options: SessionGatewayOptions = {},
): SessionGateway | null {
  const language = resolveDefaultLanguageModel(env);
  // Ships disabled: only an explicit flag and supplied runtimes select the
  // worker's agent port; otherwise `noAgents` stays.
  const agentPort =
    env[SESSION_AGENT_FLAG] === "on" && options.runtimes
      ? createAgentPort(env, options.runtimes, options)
      : undefined;
  if (!language && !agentPort) return null;
  const adapter = language
    ? createOpenAiModelAdapter({
        id: SESSION_MODEL_TARGET,
        label: language.label,
        model: language.model,
        baseUrl: language.baseUrl,
        timeoutMs: language.timeoutMs,
        ...(language.apiKey ? { apiKey: language.apiKey } : {}),
        maxOutputTokens: outputTokens(env, language.baseUrl),
        temperature: 0.3,
      })
    : undefined;
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
      language?.locality ?? "remote",
    );
  // The direct-model profiles exist only when a direct model does.
  const profiles: AiProfile[] = language
    ? [
        profile(INTERVIEW_SESSION_FAST_PROFILE, "Interview session assistance"),
        // The coding path's solution calls. Coding inference has no device
        // implementation (rule:unlisted-stage-refused): the profile is always
        // declared remote, so the gateway itself refuses it for a device-only
        // request even when the model runs on this device.
        withDeclaredLocality(
          profile(INTERVIEW_ANSWER_PROFILE, "Interview session code solutions"),
          "remote",
        ),
        // Only a model declared to run on the device may serve a device-only session.
        ...(language.locality === "device"
          ? [
              profile(
                INTERVIEW_SESSION_DEVICE_PROFILE,
                "Interview session assistance (device)",
              ),
            ]
          : []),
      ]
    : [];
  if (agentPort) profiles.push(...agentPort.profiles);
  const pinned = VISION_PROFILES[env[SESSION_VISION_PROFILE_ENV] ?? ""];
  const visionProfileId =
    pinned && agentPort?.profiles.some((entry) => entry.id === pinned)
      ? pinned
      : undefined;
  return {
    ...(visionProfileId ? { visionProfileId } : {}),
    ...(agentPort
      ? {
          agentStaging: {
            sweep: agentPort.port.sweep,
            purge: agentPort.port.purge,
            sweepIdle: agentPort.port.sweepIdle,
          },
        }
      : {}),
    gateway: createAiExecutionGateway({
      profiles,
      models: adapter ? [adapter] : [],
      images: [],
      agents: agentPort?.port ?? noAgents,
      authorize: async (context) =>
        context.permissions.includes("interview.read"),
    }),
    profileIds: profiles.map(({ id }) => id),
  };
}
