// The live coach as a worker loop: it reads the coach's transcript from the
// running Studio, asks Claude Code or Codex what to tell the person, and posts
// the note back as it is written. It talks to Studio as any coach does: over
// its API, with the API token.
//
// Off unless INTERVIEW_COACH names a runtime ("claude" or "codex") and the
// API token is set. An agent runtime starts a process, so it runs here and
// nowhere else (AGENTS.md rule 7).
import {
  type AgentRuntimeAdapter,
  createAgentModelPort,
  createAiEngine,
  type Profile,
} from "@omnitech/ai-engine";
import type { PlatformDatabase } from "@omnitech/database";
import { resolveAgentProfiles } from "@omnitech/platform-runtime/ai-config";
import {
  type CoachPorts,
  createCoach,
  createCoachContext,
} from "@omnitech/product-interview/session-worker";
import { ENGINE_LOG_ENV, engineTrace } from "./engine-trace";
import { abortableSleep, errorName } from "./session-loop";

type Environment = Readonly<Record<string, string | undefined>>;

export const COACH_ENV = "INTERVIEW_COACH";
const COACH_PROFILE = "interview-live-coach";
const COACH_PROVIDER = "interview-coach-agent";
// Which runtime and bounded agent profile each choice is (never user input).
const RUNTIMES = {
  claude: { runtime: "claude-code", agentProfile: "assistant-claude-code" },
  codex: { runtime: "codex", agentProfile: "assistant-codex" },
} as const;

// The Studio API as the coach uses it. [SAFETY] A refusal is reported by its
// status alone: nothing that was said goes into an error or a log line.
export class CoachApiError extends Error {
  constructor(readonly status: number) {
    super(`Studio answered ${status}.`);
    this.name = "CoachApiError";
  }
}

export function coachApi(
  base: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Required<Pick<CoachPorts, "transcript" | "notes" | "plan">> {
  const root = base.replace(/\/$/, "");
  const call = async (path: string, signal: AbortSignal, body?: unknown) => {
    const response = await fetcher(`${root}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
    // An older revision of a note already on show: nothing to do.
    if (response.status === 409) return null;
    if (!response.ok) throw new CoachApiError(response.status);
    return response.json();
  };
  return {
    transcript: {
      since: (after, signal) =>
        call(`/api/v1/coach-transcript?after=${after}`, signal),
    },
    notes: {
      post: async (note, signal, space) => {
        await call(
          space === "replay"
            ? "/api/v1/coach-notes?space=replay"
            : "/api/v1/coach-notes",
          signal,
          note,
        );
      },
    },
    plan: async () =>
      (
        (await call("/api/v1/coach-plan", new AbortController().signal)) as {
          text?: string;
        } | null
      )?.text || undefined,
  };
}

export type CoachLoop = {
  name: string;
  run(signal: AbortSignal): Promise<void>;
};

// Null (no loop) when the coach is off (said by nothing: it is the default) or
// was asked for and cannot run (the reason is logged).
export function coachLoop(
  env: Environment,
  runtimes: Readonly<Record<string, AgentRuntimeAdapter>>,
  log: (line: string) => void,
  // Where a live session's approved context is read from. Absent: the coach
  // works from the conversation alone.
  database?: PlatformDatabase,
): CoachLoop | null {
  const chosen = env[COACH_ENV]?.trim().toLowerCase();
  if (!chosen || chosen === "off") return null;
  const choice = RUNTIMES[chosen as keyof typeof RUNTIMES];
  const token = env["INTERVIEW_API_TOKEN"];
  const agent = choice
    ? resolveAgentProfiles(env).get(choice.agentProfile)
    : undefined;
  const runtime = choice ? runtimes[choice.runtime] : undefined;
  if (!choice) {
    log(`coach disabled: ${COACH_ENV} must be "claude" or "codex"`);
    return null;
  }
  if (!agent || !runtime) {
    log(`coach disabled: the ${choice.runtime} runtime is not available`);
    return null;
  }
  if (!token) {
    log("coach disabled: INTERVIEW_API_TOKEN is not set");
    return null;
  }
  const profile: Profile = {
    id: COACH_PROFILE,
    label: "Live interview coach",
    provider: COACH_PROVIDER,
    kind: "agent",
    model: agent.model,
  };
  return {
    name: "coach",
    run: async (signal) => {
      const kept = engineTrace(env);
      const level = env[ENGINE_LOG_ENV]?.trim();
      const engine = createAiEngine({
        profiles: [profile],
        providers: {
          [COACH_PROVIDER]: createAgentModelPort({
            runtime,
            // A coach only writes: no tool may run, and one turn is its reply.
            profiles: {
              [COACH_PROFILE]: { ...agent, id: `coach-${agent.id}` },
            },
            toolless: true,
          }),
        },
        trace: kept.trace,
        ...(level ? { log: { level: level as "info" } } : {}),
      });
      const coach = createCoach({
        engine,
        profileId: COACH_PROFILE,
        ...coachApi(env["INTERVIEW_API_URL"] ?? "http://127.0.0.1:3000", token),
        ...(database ? { context: createCoachContext(database, engine) } : {}),
        // The coach's transcript belongs to this machine's one Studio, not
        // to a tenant's stored record.
        scope: { tenantId: "local", actorId: "coach" },
      });
      log(`coach listening (${choice.runtime}, ${agent.model})`);
      let failures = 0;
      try {
        while (!signal.aborted) {
          try {
            const worked = await coach.tick(signal);
            failures = 0;
            if (!worked) await abortableSleep(300, signal);
          } catch (error) {
            if (signal.aborted) break;
            failures += 1;
            // Studio not up yet, or a model that did not answer: wait, longer
            // each time, and say so by name only.
            if (failures === 1 || failures % 20 === 0)
              log(`coach error: ${errorName(error)} (consecutive ${failures})`);
            await abortableSleep(
              Math.min(15_000, 500 * 2 ** Math.min(failures - 1, 5)),
              signal,
            );
          }
        }
      } finally {
        await engine.traceSettled().catch(() => undefined);
        await kept.close();
      }
    },
  };
}
