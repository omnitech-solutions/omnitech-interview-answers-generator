// The live coach's worker loop: how it talks to Studio (the API token, the
// cursor, a note's revisions) and when the worker runs it at all.
import type { AgentRuntimeAdapter } from "@omnitech/ai-engine";
import type { PlatformDatabase } from "@omnitech/database";
import { describe, expect, it } from "vitest";
import { COACH_ENV, CoachApiError, coachApi, coachLoop } from "./coach-loop";

const CANARY = "canary words said in the interview";
const TOKEN = "coach-loop-test-token";

type Sent = { url: string; init: RequestInit };
function fakeFetch(answer: (sent: Sent) => Response) {
  const sent: Sent[] = [];
  const fetcher = (async (url: unknown, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    sent.push(call);
    return answer(call);
  }) as typeof fetch;
  return { sent, fetcher };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("the Studio API as the coach uses it", () => {
  it("reads the transcript after its cursor, with the token as a bearer", async () => {
    const read = {
      epoch: "epoch-1",
      cursor: 9,
      lines: [
        {
          seq: 9,
          speaker: "interviewer",
          text: "Why that shard key?",
          at: "2026-10-08T09:00:00.000Z",
        },
      ],
    };
    const { sent, fetcher } = fakeFetch(() => json(read));
    const signal = new AbortController().signal;
    const api = coachApi("http://studio.test:3000", TOKEN, fetcher);

    expect(await api.transcript.since(7, signal)).toEqual(read);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(
      "http://studio.test:3000/api/v1/coach-transcript?after=7",
    );
    expect(sent[0]?.init).toEqual({
      method: "GET",
      headers: { authorization: `Bearer ${TOKEN}` },
      signal,
    });
  });

  it("does not double the slash of a base that ends with one", async () => {
    const { sent, fetcher } = fakeFetch(() =>
      json({ epoch: "e", cursor: 0, lines: [] }),
    );
    await coachApi("http://studio.test:3000/", TOKEN, fetcher).transcript.since(
      0,
      new AbortController().signal,
    );
    expect(sent[0]?.url).toBe(
      "http://studio.test:3000/api/v1/coach-transcript?after=0",
    );
  });

  it("posts a note as JSON, with the token as a bearer", async () => {
    const { sent, fetcher } = fakeFetch(() =>
      json({ revision: 1, notes: [] }, 201),
    );
    const signal = new AbortController().signal;
    const note = {
      title: "Sharding",
      key: "coach-1a2b3c4d-1",
      revision: 2,
      sections: [
        {
          kind: "say" as const,
          lines: [{ segments: [{ text: "By region." }] }],
        },
      ],
    };

    await expect(
      coachApi("http://studio.test:3000", TOKEN, fetcher).notes.post(
        note,
        signal,
      ),
    ).resolves.toBeUndefined();

    expect(sent[0]?.url).toBe("http://studio.test:3000/api/v1/coach-notes");
    expect(sent[0]?.init).toEqual({
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(note),
      signal,
    });
  });

  it("a 409 for a note is not an error: a newer revision is already on show", async () => {
    const { sent, fetcher } = fakeFetch(() =>
      json({ error: { code: "stale_coach_note" } }, 409),
    );
    await expect(
      coachApi("http://studio.test:3000", TOKEN, fetcher).notes.post(
        { title: "Sharding", key: "k", revision: 1 },
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
  });

  it.each([400, 401, 404, 413, 500, 503])(
    "any other refusal (%i) throws CoachApiError carrying the status alone",
    async (status) => {
      const { fetcher } = fakeFetch(() =>
        json(
          { error: { code: "x", message: `the server quoted ${CANARY}` } },
          status,
        ),
      );
      const api = coachApi("http://studio.test:3000", TOKEN, fetcher);
      const signal = new AbortController().signal;
      const failures = [
        await api.notes
          .post({ title: CANARY }, signal)
          .catch((error: unknown) => error),
        await api.transcript.since(3, signal).catch((error: unknown) => error),
      ];
      for (const failure of failures) {
        expect(failure).toBeInstanceOf(CoachApiError);
        const error = failure as CoachApiError;
        expect(error.status).toBe(status);
        expect(error.name).toBe("CoachApiError");
        expect(error.message).toBe(`Studio answered ${status}.`);
        // [SAFETY] Nothing said, and no credential, is in the error.
        const shown = `${error.message} ${error.stack} ${JSON.stringify(error)}`;
        expect(shown).not.toContain("canary");
        expect(shown).not.toContain(TOKEN);
      }
    },
  );

  it("lets a failure to reach Studio through as it is", async () => {
    const down = new TypeError("fetch failed");
    const fetcher = (async () => {
      throw down;
    }) as unknown as typeof fetch;
    await expect(
      coachApi("http://studio.test:3000", TOKEN, fetcher).transcript.since(
        0,
        new AbortController().signal,
      ),
    ).rejects.toBe(down);
  });
});

describe("whether the worker runs the coach", () => {
  const runtime = (id: "codex" | "claude-code"): AgentRuntimeAdapter => ({
    runtime: id,
    capabilities: {
      resume: false,
      structuredOutput: true,
      attachments: true,
      tools: false,
    },
    run: async function* () {},
    resume: async function* () {},
    cancel: async () => {},
  });
  const runtimes = {
    codex: runtime("codex"),
    "claude-code": runtime("claude-code"),
  };
  const loopFor = (
    env: Record<string, string | undefined>,
    having: Readonly<Record<string, AgentRuntimeAdapter>> = runtimes,
    database?: PlatformDatabase,
  ) => {
    const lines: string[] = [];
    const log = (line: string) => {
      lines.push(line);
    };
    return {
      loop:
        database === undefined
          ? coachLoop(env, having, log)
          : coachLoop(env, having, log, database),
      lines,
    };
  };

  it("reads its choice from INTERVIEW_COACH", () => {
    expect(COACH_ENV).toBe("INTERVIEW_COACH");
  });

  it.each([
    ["unset", {}],
    ["empty", { INTERVIEW_COACH: "" }],
    ["blank", { INTERVIEW_COACH: "   " }],
    ["off", { INTERVIEW_COACH: "off" }],
    ["OFF", { INTERVIEW_COACH: " OFF " }],
  ])("is no loop, and says nothing, when the coach is %s", (_name, env) => {
    const { loop, lines } = loopFor({ ...env, INTERVIEW_API_TOKEN: TOKEN });
    expect(loop).toBeNull();
    expect(lines).toEqual([]);
  });

  it.each(["gemini", "claude-code", "on", "true", "toString"])(
    "is no loop, with the reason logged, for the unknown runtime %j",
    (chosen) => {
      const { loop, lines } = loopFor({
        INTERVIEW_COACH: chosen,
        INTERVIEW_API_TOKEN: TOKEN,
      });
      expect(loop).toBeNull();
      expect(lines).toEqual([
        'coach disabled: INTERVIEW_COACH must be "claude" or "codex"',
      ]);
    },
  );

  it.each(["claude", "codex"])(
    "is no loop, with the reason logged, when %s is chosen and the API token is missing",
    (chosen) => {
      for (const token of [undefined, ""]) {
        const { loop, lines } = loopFor({
          INTERVIEW_COACH: chosen,
          INTERVIEW_API_TOKEN: token,
        });
        expect(loop).toBeNull();
        expect(lines).toEqual([
          "coach disabled: INTERVIEW_API_TOKEN is not set",
        ]);
      }
    },
  );

  it("says the value is unknown, and only that, when the token is missing too", () => {
    const { loop, lines } = loopFor({ INTERVIEW_COACH: "gemini" }, {});
    expect(loop).toBeNull();
    expect(lines).toEqual([
      'coach disabled: INTERVIEW_COACH must be "claude" or "codex"',
    ]);
  });

  it.each([
    ["codex", "codex", { "claude-code": runtime("claude-code") }],
    ["claude", "claude-code", { codex: runtime("codex") }],
    ["claude", "claude-code", {}],
    // The choice is not the runtime's own name: "claude" runs claude-code.
    ["claude", "claude-code", { claude: runtime("claude-code") }],
  ] as const)(
    "is no loop, with the runtime named, when %s is chosen and this worker has no %s runtime",
    (chosen, missing, having) => {
      const { loop, lines } = loopFor(
        { INTERVIEW_COACH: chosen, INTERVIEW_API_TOKEN: TOKEN },
        having,
      );
      expect(loop).toBeNull();
      expect(lines).toEqual([
        `coach disabled: the ${missing} runtime is not available`,
      ]);
    },
  );

  it("names the missing runtime, and only that, when the token is missing too", () => {
    const { loop, lines } = loopFor({ INTERVIEW_COACH: "codex" }, {});
    expect(loop).toBeNull();
    expect(lines).toEqual([
      "coach disabled: the codex runtime is not available",
    ]);
  });

  it("never puts the token or the chosen value in a reason it logs", () => {
    const said = [
      loopFor({ INTERVIEW_COACH: TOKEN, INTERVIEW_API_TOKEN: TOKEN }),
      loopFor({ INTERVIEW_COACH: "codex", INTERVIEW_API_TOKEN: TOKEN }, {}),
    ].flatMap((each) => each.lines);
    expect(said).toHaveLength(2);
    expect(said.join(" ")).not.toContain(TOKEN);
  });

  it.each([
    ["claude", "claude"],
    ["codex", "codex"],
    ["Claude, padded", "  Claude "],
    ["CODEX", "CODEX"],
  ])(
    "is a loop named coach when %s is chosen and the token is set",
    (_name, chosen) => {
      const { loop, lines } = loopFor({
        INTERVIEW_COACH: chosen,
        INTERVIEW_API_TOKEN: TOKEN,
      });
      expect(loop).toEqual({ name: "coach", run: expect.any(Function) });
      // Nothing is said, and nothing started, until the loop is run.
      expect(lines).toEqual([]);
    },
  );

  it("takes a database as an optional fourth argument: a loop either way, nothing read until it runs", async () => {
    const touched: PropertyKey[] = [];
    const database = new Proxy(
      {},
      {
        get: (_target, key) => {
          touched.push(key);
          return undefined;
        },
      },
    ) as unknown as PlatformDatabase;
    const env = { INTERVIEW_COACH: "codex", INTERVIEW_API_TOKEN: TOKEN };
    expect(loopFor(env).loop).toEqual({
      name: "coach",
      run: expect.any(Function),
    });
    const { loop, lines } = loopFor(env, runtimes, database);
    expect(loop).toEqual({ name: "coach", run: expect.any(Function) });
    expect(lines).toEqual([]);

    const stopped = new AbortController();
    stopped.abort();
    await loop?.run(stopped.signal);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^coach listening \(codex, \S+\)$/);
    // The record is read for a live session's stretch, never at start.
    expect(touched).toEqual([]);
  });

  it("a database does not turn on a coach that is off or cannot run", () => {
    const database = {} as PlatformDatabase;
    expect(loopFor({ INTERVIEW_API_TOKEN: TOKEN }, runtimes, database)).toEqual(
      { loop: null, lines: [] },
    );
    expect(loopFor({ INTERVIEW_COACH: "codex" }, runtimes, database)).toEqual({
      loop: null,
      lines: ["coach disabled: INTERVIEW_API_TOKEN is not set"],
    });
  });

  it("run on a stopped worker says what it listens with and returns, calling nothing", async () => {
    const { loop, lines } = loopFor({
      INTERVIEW_COACH: "claude",
      INTERVIEW_API_TOKEN: TOKEN,
      CLAUDE_ASSISTANT_MODEL: undefined,
    });
    const stopped = new AbortController();
    stopped.abort();
    await loop?.run(stopped.signal);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^coach listening \(claude-code, \S+\)$/);
    expect(lines.join(" ")).not.toContain(TOKEN);
  });
});
