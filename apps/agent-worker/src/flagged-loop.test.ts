// A worker loop that follows the behaviour flags: built from the environment
// alone when Settings cannot change anything, and otherwise built from what
// Settings stored (read from the Studio's API with the API token) and built
// again when that changes, with the host's own variables always winning.
import { describe, expect, it } from "vitest";
import { coachLoop } from "./coach-loop";
import { FLAG_POLL_MS, flaggedLoop, readStoredFlags } from "./flagged-loop";

const TOKEN = "worker-flags-token";
const COACH = "INTERVIEW_COACH";
const RETAIN = "INTERVIEW_COACH_RETAIN";
const GROUNDING = "INTERVIEW_COACH_GROUNDING";
const VOICE = "ACTIVE_SESSION_VOICE_ACTIVITY";
type Environment = Readonly<Record<string, string | undefined>>;

// The Studio's answer for what Settings holds (null: never changed).
const answer = (stored: Record<string, string | null>) => ({
  flags: [
    [VOICE, "off"],
    [COACH, "off"],
    [RETAIN, "on"],
    [GROUNDING, "on"],
  ].map(([key, fallback]) => ({
    key,
    value: stored[key as string] ?? fallback,
    source: stored[key as string] ? "setting" : "default",
    stored: stored[key as string] ?? null,
    default: fallback,
  })),
});

// A Studio whose stored flags the test changes, and which can be taken down.
function studio(initial: Record<string, string | null> = {}) {
  const state = {
    stored: initial,
    up: true,
    status: 200,
    body: undefined as unknown,
  };
  const calls: { url: string; authorization: string | null }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (!state.up) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(state.body ?? answer(state.stored)), {
      status: state.status,
    });
  }) as typeof fetch;
  return { state, calls, fetcher };
}

// A sleep the test ends by hand: one `next()` lets the loop ask once more.
function clock() {
  let wake: (() => void) | undefined;
  const waits: number[] = [];
  let asleep: (() => void) | undefined;
  const sleeping = () =>
    new Promise<void>((resolve) => {
      if (wake) resolve();
      else asleep = resolve;
    });
  return {
    waits,
    sleep: (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        waits.push(ms);
        const done = () => {
          wake = undefined;
          resolve();
        };
        wake = done;
        signal.addEventListener("abort", done, { once: true });
        asleep?.();
        asleep = undefined;
      }),
    // Resolves once the loop is waiting for its next look at Settings.
    sleeping,
    async next() {
      await sleeping();
      wake?.();
      await sleeping();
    },
  };
}

// Records every loop built: the environment it was built from, and whether
// it is running, was stopped, or was never a loop (the flag said off).
function builder(
  off: (env: Environment) => boolean = (env) => env[COACH] === "off",
) {
  const built: { env: Environment; state: "running" | "stopped" | "none" }[] =
    [];
  const build = (env: Environment) => {
    const entry: (typeof built)[number] = { env, state: "none" };
    built.push(entry);
    if (off(env)) return null;
    return {
      name: "coach",
      run: (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          entry.state = "running";
          signal.addEventListener(
            "abort",
            () => {
              entry.state = "stopped";
              resolve();
            },
            { once: true },
          );
        }),
    };
  };
  return { built, build };
}

async function following(
  env: Environment,
  stored: Record<string, string | null> = {},
) {
  const server = studio(stored);
  const time = clock();
  const made = builder();
  const lines: string[] = [];
  const loop = flaggedLoop(
    "coach",
    env,
    made.build,
    (line) => lines.push(line),
    {
      fetcher: server.fetcher,
      sleep: time.sleep,
    },
  );
  if (!loop) throw new Error("expected a loop that follows Settings");
  const controller = new AbortController();
  const done = loop.run(controller.signal);
  await time.sleeping();
  return { ...server, ...made, time, lines, loop, controller, done };
}

describe("when Settings cannot change anything", () => {
  it("builds the loop once from the environment with no API token, and asks nobody", () => {
    const server = studio({ [COACH]: "codex" });
    const made = builder();
    const env = { [COACH]: "claude" };
    const loop = flaggedLoop("coach", env, made.build, () => undefined, {
      fetcher: server.fetcher,
    });
    expect(loop?.name).toBe("coach");
    expect(made.built.map((entry) => entry.env)).toEqual([env]);
    expect(server.calls).toEqual([]);
  });

  it("is no loop when the environment says off and there is no token, as before", () => {
    const made = builder();
    expect(
      flaggedLoop(
        "coach",
        {},
        () => null,
        () => undefined,
      ),
    ).toBeNull();
    expect(
      flaggedLoop("coach", { [COACH]: "off" }, made.build, () => undefined),
    ).toBeNull();
  });

  it("builds once from the environment when the host set every worker flag, token or not", () => {
    const server = studio({ [COACH]: "off", [RETAIN]: "off" });
    const made = builder();
    const env = {
      INTERVIEW_API_TOKEN: TOKEN,
      [COACH]: "codex",
      [RETAIN]: "on",
      [GROUNDING]: "on",
    };
    const loop = flaggedLoop("coach", env, made.build, () => undefined, {
      fetcher: server.fetcher,
    });
    expect(loop).not.toBeNull();
    expect(made.built).toHaveLength(1);
    expect(made.built[0]?.env).toBe(env);
    expect(server.calls).toEqual([]);
  });
});

describe("following what Settings stored", () => {
  const env = {
    INTERVIEW_API_TOKEN: TOKEN,
    INTERVIEW_API_URL: "http://studio.test:3000/",
  };

  it("asks the Studio's API with the API token, every five seconds", async () => {
    const run = await following(env, { [COACH]: "claude" });
    expect(FLAG_POLL_MS).toBe(5_000);
    expect(run.calls).toEqual([
      {
        url: "http://studio.test:3000/api/v1/behaviour-flags",
        authorization: `Bearer ${TOKEN}`,
      },
    ]);
    expect(run.time.waits).toEqual([5_000]);
    run.controller.abort();
    await run.done;
  });

  it("builds the loop from the stored flags, with the rest of the environment as it was", async () => {
    const run = await following(env, { [COACH]: "codex", [RETAIN]: "off" });
    expect(run.built).toEqual([
      {
        env: { ...env, [COACH]: "codex", [RETAIN]: "off", [GROUNDING]: "on" },
        state: "running",
      },
    ]);
    expect(run.lines).toEqual([]);
    run.controller.abort();
    await run.done;
    expect(run.built[0]?.state).toBe("stopped");
  });

  it("builds from the defaults when nothing is stored: no coach, one session kept", async () => {
    const run = await following(env);
    expect(run.built).toEqual([
      {
        env: { ...env, [COACH]: "off", [RETAIN]: "on", [GROUNDING]: "on" },
        state: "none",
      },
    ]);
    run.controller.abort();
    await run.done;
  });

  it("uses the host's default for the coach until Settings says otherwise", async () => {
    const run = await following({ ...env, INTERVIEW_COACH_DEFAULT: "claude" });
    expect(run.built[0]?.env[COACH]).toBe("claude");
    run.state.stored = { [COACH]: "off" };
    await run.time.next();
    expect(run.built.map((entry) => [entry.env[COACH], entry.state])).toEqual([
      ["claude", "stopped"],
      ["off", "none"],
    ]);
    run.controller.abort();
    await run.done;
  });

  it("picks a change up on its next look: the running loop is stopped, then one is built from the new flags", async () => {
    const run = await following(env, { [COACH]: "claude" });
    run.state.stored = { [COACH]: "codex" };
    await run.time.next();
    expect(run.built.map((entry) => [entry.env[COACH], entry.state])).toEqual([
      ["claude", "stopped"],
      ["codex", "running"],
    ]);
    expect(run.lines).toEqual([
      `coach: settings changed (${COACH}=codex ${RETAIN}=on ${GROUNDING}=on)`,
    ]);
    run.state.stored = { [COACH]: "codex", [RETAIN]: "off" };
    await run.time.next();
    expect(run.built.map((entry) => [entry.env[RETAIN], entry.state])).toEqual([
      ["on", "stopped"],
      ["on", "stopped"],
      ["off", "running"],
    ]);
    run.controller.abort();
    await run.done;
  });

  it("starts a coach that was off, and stops one that is switched off", async () => {
    const run = await following(env, { [COACH]: "off" });
    expect(run.built.map((entry) => entry.state)).toEqual(["none"]);
    run.state.stored = { [COACH]: "claude" };
    await run.time.next();
    expect(run.built.map((entry) => entry.state)).toEqual(["none", "running"]);
    run.state.stored = { [COACH]: "off" };
    await run.time.next();
    expect(run.built.map((entry) => entry.state)).toEqual([
      "none",
      "stopped",
      "none",
    ]);
    run.controller.abort();
    await run.done;
  });

  it("builds nothing again while Settings holds the same flags", async () => {
    const run = await following(env, { [COACH]: "claude" });
    await run.time.next();
    await run.time.next();
    // A flag of the other process changing is not this loop's concern.
    run.state.stored = { [COACH]: "claude", [VOICE]: "on" };
    await run.time.next();
    expect(run.built).toHaveLength(1);
    expect(run.built[0]?.state).toBe("running");
    expect(run.calls).toHaveLength(4);
    expect(run.lines).toEqual([]);
    run.controller.abort();
    await run.done;
  });

  it("starts nothing until Settings has been read once, then starts", async () => {
    const server = studio({ [COACH]: "claude" });
    server.state.up = false;
    const time = clock();
    const made = builder();
    const loop = flaggedLoop("coach", env, made.build, () => undefined, {
      fetcher: server.fetcher,
      sleep: time.sleep,
    });
    const controller = new AbortController();
    const done = loop?.run(controller.signal);
    await time.sleeping();
    await time.next();
    expect(made.built).toEqual([]);
    server.state.up = true;
    await time.next();
    expect(made.built.map((entry) => entry.state)).toEqual(["running"]);
    controller.abort();
    await done;
  });

  it.each([
    [
      "is down",
      (state: ReturnType<typeof studio>["state"]) => {
        state.up = false;
      },
    ],
    [
      "refuses the token",
      (state: ReturnType<typeof studio>["state"]) => {
        state.status = 401;
      },
    ],
    [
      "answers something else",
      (state: ReturnType<typeof studio>["state"]) => {
        state.body = { flags: "none" };
      },
    ],
  ])("keeps the loop it has while the Studio %s", async (_name, breakIt) => {
    const run = await following(env, { [COACH]: "claude" });
    breakIt(run.state);
    run.state.stored = { [COACH]: "off" };
    await run.time.next();
    await run.time.next();
    expect(run.built.map((entry) => entry.state)).toEqual(["running"]);
    run.controller.abort();
    await run.done;
  });

  it("leaves a flag the host set alone and follows the other", async () => {
    const run = await following(
      { ...env, [COACH]: "claude" },
      { [COACH]: "off", [RETAIN]: "off" },
    );
    expect(run.built[0]?.env).toMatchObject({
      [COACH]: "claude",
      [RETAIN]: "off",
    });
    run.state.stored = { [COACH]: "codex", [RETAIN]: "off" };
    await run.time.next();
    expect(run.built).toHaveLength(1);
    run.state.stored = { [COACH]: "codex", [RETAIN]: "on" };
    await run.time.next();
    expect(
      run.built.map((entry) => [entry.env[COACH], entry.env[RETAIN]]),
    ).toEqual([
      ["claude", "off"],
      ["claude", "on"],
    ]);
    run.controller.abort();
    await run.done;
  });

  it("passes a host value the flag does not know through to the loop untouched", async () => {
    const server = studio({ [COACH]: "claude" });
    const time = clock();
    const made = builder(() => true);
    const loop = flaggedLoop(
      "coach",
      { ...env, [COACH]: "gemini" },
      made.build,
      () => undefined,
      { fetcher: server.fetcher, sleep: time.sleep },
    );
    const controller = new AbortController();
    const done = loop?.run(controller.signal);
    await time.sleeping();
    expect(made.built[0]?.env[COACH]).toBe("gemini");
    controller.abort();
    await done;
  });

  it("says a loop that failed by its error's name only, and fails when the worker stops", async () => {
    const server = studio({ [COACH]: "claude" });
    const time = clock();
    const lines: string[] = [];
    const loop = flaggedLoop(
      "coach",
      env,
      () => ({
        name: "coach",
        run: async () => {
          throw new RangeError("canary-question-text");
        },
      }),
      (line) => lines.push(line),
      { fetcher: server.fetcher, sleep: time.sleep },
    );
    const controller = new AbortController();
    const done = loop?.run(controller.signal).catch((error: Error) => error);
    await time.sleeping();
    controller.abort();
    expect(await done).toBeInstanceOf(RangeError);
    expect(lines).toEqual(["coach loop failed: RangeError"]);
    expect(lines.join("\n")).not.toContain("canary");
  });
});

describe("the real coach, built from what Settings stored", () => {
  const env = { INTERVIEW_API_TOKEN: TOKEN };
  const withCoach = async (
    stored: Record<string, string | null>,
    extra: Environment = {},
  ) => {
    const server = studio(stored);
    const time = clock();
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const loop = flaggedLoop(
      "coach",
      { ...env, ...extra },
      (flagged) => coachLoop(flagged, {}, log),
      log,
      { fetcher: server.fetcher, sleep: time.sleep },
    );
    const controller = new AbortController();
    const done = loop?.run(controller.signal);
    await time.sleeping();
    return { server, time, lines, controller, done };
  };

  it("is asked for the runtime Settings names (none is installed here, and it says which)", async () => {
    const run = await withCoach({ [COACH]: "codex" });
    expect(run.lines).toEqual([
      "coach disabled: the codex runtime is not available",
    ]);
    run.server.state.stored = { [COACH]: "claude" };
    await run.time.next();
    expect(run.lines.slice(1)).toEqual([
      `coach: settings changed (${COACH}=claude ${RETAIN}=on ${GROUNDING}=on)`,
      "coach disabled: the claude-code runtime is not available",
    ]);
    run.controller.abort();
    await run.done;
  });

  it("says nothing and runs nothing while Settings says off", async () => {
    const run = await withCoach({ [COACH]: "off" });
    expect(run.lines).toEqual([]);
    run.controller.abort();
    await run.done;
  });

  it("still hears the host's own word for a runtime it does not know", async () => {
    const run = await withCoach({ [COACH]: "claude" }, { [COACH]: "gemini" });
    expect(run.lines).toEqual([
      'coach disabled: INTERVIEW_COACH must be "claude" or "codex"',
    ]);
    run.controller.abort();
    await run.done;
  });
});

describe("reading what Settings stored", () => {
  it("is the stored flags by name, and nothing for a flag never changed", async () => {
    const server = studio({ [COACH]: "codex", [VOICE]: "on" });
    expect(
      await readStoredFlags({ INTERVIEW_API_TOKEN: TOKEN }, server.fetcher),
    ).toEqual({ [COACH]: "codex", [VOICE]: "on" });
    expect(server.calls[0]?.url).toBe(
      "http://127.0.0.1:3000/api/v1/behaviour-flags",
    );
  });

  it("is unknown when the Studio is down, refuses, or answers something else", async () => {
    const server = studio({ [COACH]: "codex" });
    const env = { INTERVIEW_API_TOKEN: TOKEN };
    server.state.up = false;
    expect(await readStoredFlags(env, server.fetcher)).toBeUndefined();
    server.state.up = true;
    server.state.status = 500;
    expect(await readStoredFlags(env, server.fetcher)).toBeUndefined();
    server.state.status = 200;
    server.state.body = "<html>";
    expect(await readStoredFlags(env, server.fetcher)).toBeUndefined();
  });
});
