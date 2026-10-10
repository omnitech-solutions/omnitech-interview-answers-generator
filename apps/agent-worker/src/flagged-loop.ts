// A worker loop that follows the behaviour flags (BEHAVIOUR_FLAGS in the
// interview contracts): the loop is built from the environment its flags
// resolve to (the host's variable, else what Settings stored, else the
// default), and built again when a stored flag changes, so a change in
// Settings needs no restart of the worker.
//
// The worker learns what Settings stored the way its coach already reaches the
// Studio: the Studio's API, with the API token. Nothing new is opened.
//
// [SAFETY] A log line here names a flag's source of change only by the flags'
// own closed values; nothing read from the Studio is content.
import {
  BEHAVIOUR_FLAGS,
  behaviourFlagsResponseSchema,
  resolveBehaviourFlag,
  type StoredBehaviourFlags,
  storedBehaviourFlags,
  withBehaviourFlags,
} from "@omnitech/product-interview/session-worker";
import { abortableSleep, errorName } from "./session-loop";

type Environment = Readonly<Record<string, string | undefined>>;
type Loop = { name: string; run(signal: AbortSignal): Promise<void> };

// How often the worker asks the Studio what Settings holds.
export const FLAG_POLL_MS = 5_000;

const WORKER_FLAGS = BEHAVIOUR_FLAGS.filter(
  (flag) => flag.process === "agent-worker",
);

/** What Settings stored, from the Studio; undefined when it cannot be read. */
export async function readStoredFlags(
  env: Environment,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<StoredBehaviourFlags | undefined> {
  const root = (env["INTERVIEW_API_URL"] ?? "http://127.0.0.1:3000").replace(
    /\/$/,
    "",
  );
  try {
    const response = await fetcher(`${root}/api/v1/behaviour-flags`, {
      headers: { authorization: `Bearer ${env["INTERVIEW_API_TOKEN"] ?? ""}` },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return undefined;
    const parsed = behaviourFlagsResponseSchema.safeParse(
      await response.json(),
    );
    return parsed.success ? storedBehaviourFlags(parsed.data) : undefined;
  } catch {
    // The Studio is not up yet, or is restarting: asked again next time.
    return undefined;
  }
}

/**
 * The loop `build` makes, kept in step with the worker's flags.
 *
 * With no API token there is no way to read Settings, and with every worker
 * flag set by the host there is nothing Settings could change: the loop is
 * then built once from the environment, exactly as before.
 */
export function flaggedLoop(
  name: string,
  env: Environment,
  build: (env: Environment) => Loop | null,
  log: (line: string) => void,
  options: {
    fetcher?: typeof fetch;
    pollMs?: number;
    sleep?: typeof abortableSleep;
  } = {},
): Loop | null {
  const pinned = WORKER_FLAGS.every(
    (flag) => resolveBehaviourFlag(env, flag.env).source === "environment",
  );
  if (!env["INTERVIEW_API_TOKEN"] || pinned) return build(env);
  const { fetcher = fetch, pollMs = FLAG_POLL_MS } = options;
  const sleep = options.sleep ?? abortableSleep;
  return {
    name,
    run: async (signal) => {
      let running:
        | { flags: string; stop: AbortController; done: Promise<void> }
        | undefined;
      let failure: unknown;
      const stop = async () => {
        running?.stop.abort();
        await running?.done;
        running = undefined;
      };
      try {
        while (!signal.aborted) {
          // Until Settings has been read once nothing is started: a coach
          // switched off in Settings must not run for the first few seconds.
          const stored = await readStoredFlags(env, fetcher, signal);
          if (stored !== undefined && !signal.aborted) {
            const flagged = withBehaviourFlags(env, stored, "agent-worker");
            const flags = WORKER_FLAGS.map(
              (flag) => `${flag.env}=${flagged[flag.env] ?? ""}`,
            ).join(" ");
            if (flags !== running?.flags) {
              if (running) log(`${name}: settings changed (${flags})`);
              await stop();
              const loop = build(flagged);
              const controller = new AbortController();
              running = {
                flags,
                stop: controller,
                done: loop
                  ? loop.run(controller.signal).catch((error: unknown) => {
                      // Said by name only; the next change builds it again.
                      log(`${name} loop failed: ${errorName(error)}`);
                      failure = error;
                    })
                  : Promise.resolve(),
              };
            }
          }
          await sleep(pollMs, signal);
        }
      } finally {
        await stop();
      }
      if (failure !== undefined) throw failure;
    },
  };
}
