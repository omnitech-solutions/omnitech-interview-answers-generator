// The worker's own AI engine for the Active Session loop (ADR-0011, ADR-0012,
// ADR-0037). It is composed from the same environment model settings as the
// web host (resolveDefaultLanguageModel) but never shared with it: the worker
// owns its engine, names profiles and never branches on a provider or model.
//
// Locality is DECLARED by the environment (rule:declared-profile-locality), never
// inferred. The fast profile serves permitted-remote sessions and carries the
// model's declared locality; the device profile exists only when that declared
// locality is `device`, so a device-only session can only ever reach a model
// the environment declared to run on this device. The engine itself refuses a
// profile that does not run on the device for a device-only call, twice.

import type {
  AgentProfile,
  AgentRuntimeAdapter,
  TraceConfig,
} from "@omnitech/ai-engine";
import {
  type AiEngine,
  createAiEngine,
  type ModelPort,
  modelProvider,
  type Profile,
} from "@omnitech/ai-engine";
import {
  resolveAgentProfiles,
  resolveDefaultLanguageModel,
} from "@omnitech/platform-runtime/ai-config";
import {
  type AnsweredBy,
  INTERVIEW_ANSWER_PROFILE,
  INTERVIEW_SESSION_DEVICE_PROFILE,
  INTERVIEW_SESSION_FAST_PROFILE,
} from "@omnitech/product-interview/session-worker";
import { ENGINE_LOG_ENV, engineTrace } from "./engine-trace";
import {
  type AttachmentSource,
  createSessionAgentPort,
  type SessionAgentPortOptions,
} from "./session-agent-port";

type Environment = Readonly<Record<string, string | undefined>>;

const SESSION_MODEL_PROVIDER = "interview-session-model";
const SESSION_AGENT_PROVIDER = "interview-session-agent";

// Agent-runtime session profiles (ADR-0016): tool-less, per-attempt isolated,
// served by the worker's own agent provider. They exist only when the explicit
// flag below is on.
export const SESSION_AGENT_FLAG = "ACTIVE_SESSION_AGENT_PORT";
export const SESSION_AGENT_CLAUDE_PROFILE = "interview-session-agent-claude";
export const SESSION_AGENT_CODEX_PROFILE = "interview-session-agent-codex";

// Engine profile id -> the bounded agent profile it runs (never user input).
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

export class SessionEngineConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionEngineConfigError";
  }
}

function sessionMaximumTurns(env: Environment): number {
  const configured = env[SESSION_AGENT_TURNS_ENV]?.trim();
  if (configured === undefined || configured === "")
    return SESSION_AGENT_MIN_TURNS;
  const turns = Number(configured);
  if (!Number.isInteger(turns) || turns < SESSION_AGENT_MIN_TURNS)
    throw new SessionEngineConfigError(
      `${SESSION_AGENT_TURNS_ENV} must be an integer of at least ${SESSION_AGENT_MIN_TURNS}: a structured session answer needs the turns of its structured-output retries.`,
    );
  return turns;
}

export const SESSION_VISION_PROFILE_ENV = "ACTIVE_SESSION_AGENT_PROFILE";
const VISION_PROFILES: Readonly<Record<string, string>> = {
  claude: SESSION_AGENT_CLAUDE_PROFILE,
  codex: SESSION_AGENT_CODEX_PROFILE,
};

export type SessionEngine = {
  engine: AiEngine;
  profileIds: readonly string[];
  // Which runtime and model an agent profile is, for display with an answer.
  // A direct model has no such display.
  answeredBy(profileId: string): AnsweredBy | undefined;
  // The pinned agent profile (see above); present only when the agent provider
  // is on and the host pinned a provider that is configured. The name is kept
  // from when it served screenshots alone.
  visionProfileId?: string;
  // Present only with the agent provider: the startup sweep and the purge
  // hooks for staged screenshots.
  agentStaging?: {
    sweep(): Promise<void>;
    purge(): Promise<void>;
    sweepIdle(): Promise<void>;
  };
  // Ends what the engine opened: the connection its runs are kept through.
  close(): Promise<void>;
};

export type SessionEngineOptions = {
  // The worker's agent runtime adapters, used only when the flag is on.
  runtimes?: Readonly<Record<string, AgentRuntimeAdapter>>;
  attachmentSource?: AttachmentSource;
  stillPermitted?: SessionAgentPortOptions["stillPermitted"];
  isBackground?: SessionAgentPortOptions["isBackground"];
  // Where the engine's own lines go at start-up (ids only).
  log?: (line: string) => void;
  // Test seam: where runs are kept, in place of what the environment names.
  trace?: TraceConfig;
};

function createAgentProvider(
  env: Environment,
  runtimes: Readonly<Record<string, AgentRuntimeAdapter>>,
  options: SessionEngineOptions,
) {
  const agentProfiles = resolveAgentProfiles(env);
  const maximumTurns = sessionMaximumTurns(env);
  const mapped = new Map<string, AgentProfile>();
  const profiles: Profile[] = [];
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
      provider: SESSION_AGENT_PROVIDER,
      kind: "agent",
      model: agent.model,
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
  return { port, profiles, mapped };
}

// Null when nothing can serve a session: neither a direct language model nor the
// agent provider. The agent runner (Claude Code) is a complete engine on its
// own, so a host with no LM Studio or API endpoint still runs sessions through it.
export function createSessionEngine(
  env: Environment,
  options: SessionEngineOptions = {},
): SessionEngine | null {
  const language = resolveDefaultLanguageModel(env);
  // Ships disabled: only an explicit flag and supplied runtimes select the
  // worker's agent provider.
  const agents =
    env[SESSION_AGENT_FLAG] === "on" && options.runtimes
      ? createAgentProvider(env, options.runtimes, options)
      : undefined;
  if (!language && !agents) return null;

  const providers: Record<string, ModelPort> = {};
  const profiles: Profile[] = [];
  if (language) {
    // [GUARD] A model that is not on this machine needs a key. Without one the
    // model is unusable, and the worker says so at start-up instead of
    // sending calls that can only be refused.
    if (
      !language.apiKey &&
      !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(
        new URL(language.baseUrl).hostname,
      )
    )
      throw new SessionEngineConfigError(
        "The configured language model is not on this machine and has no API key.",
      );
    const maxOutputTokens = outputTokens(env, language.baseUrl);
    const sized = {
      resolveProfile: () => ({
        modelId: language.model,
        maxOutputTokens,
        temperature: 0.3,
      }),
    };
    // Without a key the endpoint is this machine's own (checked above): the
    // anonymous port refuses any address that is not loopback.
    providers[SESSION_MODEL_PROVIDER] = language.apiKey
      ? modelProvider({
          kind: "openai",
          ...sized,
          apiKey: language.apiKey,
          baseUrl: language.baseUrl,
          timeoutMs: language.timeoutMs,
        })
      : modelProvider({
          kind: "lm-studio",
          ...sized,
          baseURL: language.baseUrl,
          timeoutMs: language.timeoutMs,
        });
    const direct = (
      id: string,
      label: string,
      locality: Profile["locality"],
    ): Profile => ({
      id,
      label,
      provider: SESSION_MODEL_PROVIDER,
      kind: "model",
      model: language.model,
      timeoutMs: language.timeoutMs,
      ...(locality ? { locality } : {}),
    });
    profiles.push(
      direct(
        INTERVIEW_SESSION_FAST_PROFILE,
        "Interview session assistance",
        language.locality,
      ),
      // The coding path's solution calls. Coding inference has no device
      // implementation (rule:unlisted-stage-refused): the profile is always
      // declared remote, so the engine itself refuses it for a device-only
      // call even when the model runs on this device.
      direct(
        INTERVIEW_ANSWER_PROFILE,
        "Interview session code solutions",
        "remote",
      ),
      // Only a model declared to run on the device may serve a device-only session.
      ...(language.locality === "device"
        ? [
            direct(
              INTERVIEW_SESSION_DEVICE_PROFILE,
              "Interview session assistance (device)",
              "device",
            ),
          ]
        : []),
    );
  }
  if (agents) {
    providers[SESSION_AGENT_PROVIDER] = agents.port;
    profiles.push(...agents.profiles);
  }

  const pinned = VISION_PROFILES[env[SESSION_VISION_PROFILE_ENV] ?? ""];
  const visionProfileId =
    pinned && agents?.profiles.some((entry) => entry.id === pinned)
      ? pinned
      : undefined;

  // [DOMAIN] Every call the loop makes is kept as a step of a run when the
  // host names a database for them; with none, the engine still times, logs
  // and exports each one, and keeps nothing.
  const kept = options.trace
    ? { trace: options.trace, close: async () => undefined }
    : engineTrace(env, options.log);
  const level = env[ENGINE_LOG_ENV]?.trim();

  const engine = createAiEngine({
    profiles,
    providers,
    authorize: (execution) =>
      execution.permissions?.includes("interview.read")
        ? true
        : "The caller may not use interview profiles.",
    trace: kept.trace,
    ...(level ? { log: { level: level as "info" } } : {}),
  });

  return {
    engine,
    profileIds: profiles.map(({ id }) => id),
    answeredBy(profileId) {
      const agent = agents?.mapped.get(profileId);
      return agent ? { runtime: agent.runtime, model: agent.model } : undefined;
    },
    ...(visionProfileId ? { visionProfileId } : {}),
    ...(agents
      ? {
          agentStaging: {
            sweep: agents.port.sweep,
            purge: agents.port.purge,
            sweepIdle: agents.port.sweepIdle,
          },
        }
      : {}),
    close: async () => {
      await engine.traceSettled().catch(() => undefined);
      await kept.close();
    },
  };
}
