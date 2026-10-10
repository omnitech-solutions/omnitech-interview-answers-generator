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
  type CoachLedger,
  type CoachPorts,
  createCoach,
  createCoachContext,
} from "@omnitech/product-interview/session-worker";
import { engineTrace, workerEngineLog } from "./engine-trace";
import { abortableSleep, errorName } from "./session-loop";

type Environment = Readonly<Record<string, string | undefined>>;

export const COACH_ENV = "INTERVIEW_COACH";
const COACH_PROFILE = "interview-live-coach";
const COACH_PROVIDER = "interview-coach-agent";
// How often the coach renews its claim on the notes (a claim stands 15 s).
const CLAIM_EVERY_MS = 5_000;
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

// The Studio refused a note because another coach holds the pen: this coach
// stands down until it can claim it again.
export class CoachStoodDown extends Error {
  constructor() {
    super("Another coach holds the notes.");
    this.name = "CoachStoodDown";
  }
}

export type CoachApi = Required<
  Pick<CoachPorts, "transcript" | "notes" | "plan" | "ledger">
> & {
  // Claims (or renews) the pen for this coach. False when another holds it.
  claim(options?: {
    takeover?: boolean;
    leaseSeconds?: number;
  }): Promise<boolean>;
  release(): Promise<void>;
};

export function coachApi(
  base: string,
  token: string,
  fetcher: typeof fetch = fetch,
  // How this coach names itself when it claims the pen.
  writerId = `coach-${process.pid}`,
): CoachApi {
  const root = base.replace(/\/$/, "");
  // The claim this coach last held, named on every note it posts.
  // [SAFETY] It is never forgotten on losing the pen: a note from a coach
  // that was replaced must still say whose it is, so the Studio refuses it.
  // A coach that asked for the pen and never got it posts nothing at all.
  let claimed: { id: string; epoch: number } | undefined;
  let refused = false;
  const call = async (
    path: string,
    signal: AbortSignal,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetcher(`${root}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
    if (response.status === 409) {
      const code = (
        (await response.json().catch(() => null)) as {
          error?: { code?: string };
        } | null
      )?.error?.code;
      if (code === "stale_writer") {
        refused = true;
        throw new CoachStoodDown();
      }
      // An older revision of a note already on show, a conversation that is
      // over, or a pen that is held: nothing to do.
      return null;
    }
    if (!response.ok) throw new CoachApiError(response.status);
    return response.status === 204 ? null : response.json();
  };
  return {
    async claim(options = {}) {
      const held = (await call(
        "/api/v1/coach-writer",
        new AbortController().signal,
        { id: writerId, ...options },
      )) as { id: string; epoch: number } | null;
      if (held) claimed = held;
      refused = held === null;
      return held !== null;
    },
    async release() {
      refused = true;
      await fetcher(`${root}/api/v1/coach-writer?id=${writerId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    },
    ledger: {
      load: async (epoch) =>
        (
          (await call(
            `/api/v1/coach-ledger?epoch=${encodeURIComponent(epoch)}`,
            new AbortController().signal,
          )) as { ledger?: CoachLedger } | null
        )?.ledger,
      save: async (ledger) => {
        const response = await fetcher(`${root}/api/v1/coach-ledger`, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ledger }),
        });
        // A conversation that is over has no ledger to keep.
        if (!response.ok && response.status !== 409)
          throw new CoachApiError(response.status);
      },
    },
    transcript: {
      since: (after, signal) =>
        call(`/api/v1/coach-transcript?after=${after}`, signal),
    },
    notes: {
      post: async (note, signal, space, conversation) => {
        if (refused) throw new CoachStoodDown();
        await call(
          space === "replay"
            ? "/api/v1/coach-notes?space=replay"
            : "/api/v1/coach-notes",
          signal,
          note,
          {
            ...(claimed
              ? { "x-coach-writer": `${claimed.id}:${claimed.epoch}` }
              : {}),
            ...(conversation ? { "x-coach-conversation": conversation } : {}),
          },
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
        log: workerEngineLog(env),
      });
      const studio = coachApi(
        env["INTERVIEW_API_URL"] ?? "http://127.0.0.1:3000",
        token,
      );
      const coach = createCoach(
        {
          engine,
          profileId: COACH_PROFILE,
          ...studio,
          ...(database
            ? { context: createCoachContext(database, engine) }
            : {}),
          // The coach's transcript belongs to this machine's one Studio, not
          // to a tenant's stored record.
          scope: { tenantId: "local", actorId: "coach" },
        },
        {
          // One session of the runtime for the call, unless the host says not.
          retain:
            (env["INTERVIEW_COACH_RETAIN"] ?? "").trim().toLowerCase() !==
            "off",
        },
      );
      log(`coach listening (${choice.runtime}, ${agent.model})`);
      let failures = 0;
      // Not yet known: the first answer is said either way.
      let writing: boolean | undefined;
      let claimedAtMs = 0;
      try {
        while (!signal.aborted) {
          try {
            // [DOMAIN] One coach at a time. The pen is claimed, and renewed
            // every few seconds; while another coach holds it (a desktop
            // agent a person put in charge) this one writes nothing.
            if (Date.now() - claimedAtMs > CLAIM_EVERY_MS) {
              const holds = await studio.claim();
              claimedAtMs = Date.now();
              if (holds !== writing)
                log(
                  holds
                    ? "coach writing: it holds the notes"
                    : "coach standing by: another coach holds the notes",
                );
              writing = holds;
            }
            if (!writing) {
              await abortableSleep(1_000, signal);
              continue;
            }
            const worked = await coach.tick(signal);
            failures = 0;
            if (!worked) await abortableSleep(300, signal);
          } catch (error) {
            if (signal.aborted) break;
            if (error instanceof CoachStoodDown) {
              // Replaced mid-note: back to asking for the pen.
              claimedAtMs = 0;
              writing = false;
              continue;
            }
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
        await studio.release();
        await engine.traceSettled().catch(() => undefined);
        await kept.close();
      }
    },
  };
}
