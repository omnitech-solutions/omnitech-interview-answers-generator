// The live coach's worker loop: how it talks to Studio (the API token, the
// cursor, a note's revisions, the pen it claims before it writes, the ledger
// it keeps there) and when the worker runs it at all. Nothing here reaches a
// network: the Studio is a stand-in for `fetch`.
import type { AgentRuntimeAdapter } from "@omnitech/ai-engine";
import type { PlatformDatabase } from "@omnitech/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COACH_ENV,
  CoachApiError,
  CoachStoodDown,
  coachApi,
  coachLoop,
} from "./coach-loop";

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

  it("posts a replay's note to the replay's notes, and any other to the person's own", async () => {
    const { sent, fetcher } = fakeFetch(() =>
      json({ revision: 1, notes: [] }, 201),
    );
    const signal = new AbortController().signal;
    const api = coachApi("http://studio.test:3000", TOKEN, fetcher);
    const note = { title: "Sharding", key: "coach-1a2b3c4d-1", revision: 1 };

    await api.notes.post(note, signal, "replay");
    await api.notes.post(note, signal, "live");
    await api.notes.post(note, signal);

    expect(sent.map((each) => each.url)).toEqual([
      "http://studio.test:3000/api/v1/coach-notes?space=replay",
      "http://studio.test:3000/api/v1/coach-notes",
      "http://studio.test:3000/api/v1/coach-notes",
    ]);
    // The same note, the same token, wherever it goes.
    for (const each of sent)
      expect(each.init).toEqual({
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(note),
        signal,
      });
  });

  it("a 409 for a replay's note is not an error either, and a refusal is", async () => {
    const signal = new AbortController().signal;
    const note = { title: "Sharding", key: "coach-1a2b3c4d-1", revision: 1 };
    await expect(
      coachApi(
        "http://studio.test:3000",
        TOKEN,
        fakeFetch(() => json({ error: { code: "stale_coach_note" } }, 409))
          .fetcher,
      ).notes.post(note, signal, "replay"),
    ).resolves.toBeUndefined();
    await expect(
      coachApi(
        "http://studio.test:3000",
        TOKEN,
        fakeFetch(() => json({ error: { message: CANARY } }, 400)).fetcher,
      ).notes.post(note, signal, "replay"),
    ).rejects.toMatchObject({ name: "CoachApiError", status: 400 });
  });

  it("reads the plan for the call, and none when it is empty", async () => {
    const { sent, fetcher } = fakeFetch(() =>
      json({ text: "mode: coding\nFix the booking service." }),
    );
    const api = coachApi("http://studio.test:3000", TOKEN, fetcher);
    expect(await api.plan()).toBe("mode: coding\nFix the booking service.");
    expect(sent[0]?.url).toBe("http://studio.test:3000/api/v1/coach-plan");
    expect(sent[0]?.init).toMatchObject({
      method: "GET",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    for (const body of [{ text: "" }, {}])
      expect(
        await coachApi(
          "http://studio.test:3000",
          TOKEN,
          fakeFetch(() => json(body)).fetcher,
        ).plan(),
      ).toBeUndefined();
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

const STUDIO = "http://studio.test:3000";
const empty = (status: number) => new Response(null, { status });
const headersOf = (sent: Sent | undefined) =>
  (sent?.init.headers ?? {}) as Record<string, string>;
const NOTE = { title: "Sharding", key: "coach-1a2b3c4d-1", revision: 1 };
const isNote = (sent: Sent) =>
  sent.init.method === "POST" && sent.url.includes("/api/v1/coach-notes");

describe("the pen, as the coach asks the Studio for it", () => {
  it("claims it with a POST naming this coach, with the token as a bearer, and says it holds it", async () => {
    const { sent, fetcher } = fakeFetch(() =>
      json({ id: "worker-coach", epoch: 4 }),
    );
    const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
    expect(await api.claim()).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${STUDIO}/api/v1/coach-writer`);
    expect(sent[0]?.init).toMatchObject({
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ id: "worker-coach" }),
    });
  });

  it("names itself by its process when it is given no name", async () => {
    const { sent, fetcher } = fakeFetch(() =>
      json({ id: `coach-${process.pid}`, epoch: 1 }),
    );
    await coachApi(STUDIO, TOKEN, fetcher).claim();
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
      id: `coach-${process.pid}`,
    });
  });

  it("asks for a takeover and a lease when told to, and for neither otherwise", async () => {
    const { sent, fetcher } = fakeFetch(() =>
      json({ id: "desktop-agent", epoch: 2 }),
    );
    const api = coachApi(STUDIO, TOKEN, fetcher, "desktop-agent");
    await api.claim({ takeover: true, leaseSeconds: 180 });
    await api.claim({});
    expect(sent.map((each) => JSON.parse(String(each.init.body)))).toEqual([
      { id: "desktop-agent", takeover: true, leaseSeconds: 180 },
      { id: "desktop-agent" },
    ]);
  });

  it("says it does not hold it when another coach does (409 coach_held), without throwing", async () => {
    const { fetcher } = fakeFetch(() =>
      json({ error: { code: "coach_held" } }, 409),
    );
    await expect(
      coachApi(STUDIO, TOKEN, fetcher, "worker-coach").claim(),
    ).resolves.toBe(false);
  });

  it.each([400, 401, 500, 503])(
    "any other refusal of a claim (%i) throws CoachApiError carrying the status alone",
    async (status) => {
      const { fetcher } = fakeFetch(() =>
        json({ error: { code: "x", message: CANARY } }, status),
      );
      const failure = await coachApi(STUDIO, TOKEN, fetcher, "worker-coach")
        .claim()
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(CoachApiError);
      expect((failure as CoachApiError).status).toBe(status);
      expect(`${(failure as Error).message}`).not.toContain("canary");
    },
  );

  it("lets a failure to reach Studio through as it is", async () => {
    const down = new TypeError("fetch failed");
    const fetcher = (async () => {
      throw down;
    }) as unknown as typeof fetch;
    await expect(
      coachApi(STUDIO, TOKEN, fetcher, "worker-coach").claim(),
    ).rejects.toBe(down);
  });

  it("gives it up with a DELETE naming this coach, with the token as a bearer", async () => {
    const { sent, fetcher } = fakeFetch(() => empty(204));
    await expect(
      coachApi(STUDIO, TOKEN, fetcher, "worker-coach").release(),
    ).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${STUDIO}/api/v1/coach-writer?id=worker-coach`);
    expect(sent[0]?.init).toEqual({
      method: "DELETE",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it("giving it up never throws: not when the Studio is gone, nor when it refuses", async () => {
    const gone = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(
      coachApi(STUDIO, TOKEN, gone, "worker-coach").release(),
    ).resolves.toBeUndefined();
    await expect(
      coachApi(
        STUDIO,
        TOKEN,
        fakeFetch(() => json({ error: { code: "unauthorized" } }, 401)).fetcher,
        "worker-coach",
      ).release(),
    ).resolves.toBeUndefined();
  });
});

describe("a note, as a coach that claims the pen posts it", () => {
  // A Studio that gives the pen under rising epochs and takes every note.
  function studio(
    answer: (sent: Sent) => Response | undefined = () => undefined,
  ) {
    let epoch = 0;
    return fakeFetch((sent) => {
      const given = answer(sent);
      if (given) return given;
      if (sent.url.endsWith("/api/v1/coach-writer")) {
        epoch += 1;
        return json({ id: "worker-coach", epoch });
      }
      return json({ revision: 1, notes: [] }, 201);
    });
  }
  const signal = new AbortController().signal;

  it("names neither a writer nor a conversation before it has claimed and when told of none", async () => {
    const { sent, fetcher } = studio();
    await coachApi(STUDIO, TOKEN, fetcher, "worker-coach").notes.post(
      NOTE,
      signal,
    );
    expect(headersOf(sent[0])).toEqual({
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    });
  });

  it("names the conversation it was written from whenever it is told of one", async () => {
    const { sent, fetcher } = studio();
    await coachApi(STUDIO, TOKEN, fetcher, "worker-coach").notes.post(
      NOTE,
      signal,
      "live",
      "epoch-of-this-call",
    );
    expect(headersOf(sent[0])).toEqual({
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-coach-conversation": "epoch-of-this-call",
    });
  });

  it("names its claim and its conversation on every note once it has claimed, the note itself unchanged", async () => {
    const { sent, fetcher } = studio();
    const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
    await api.claim();
    await api.notes.post(NOTE, signal, "live", "epoch-of-this-call");
    await api.notes.post(
      { ...NOTE, revision: 2 },
      signal,
      "replay",
      "epoch-of-this-call",
    );
    const notes = sent.filter(isNote);
    expect(notes.map((each) => each.url)).toEqual([
      `${STUDIO}/api/v1/coach-notes`,
      `${STUDIO}/api/v1/coach-notes?space=replay`,
    ]);
    for (const each of notes)
      expect(headersOf(each)).toEqual({
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "x-coach-writer": "worker-coach:1",
        "x-coach-conversation": "epoch-of-this-call",
      });
    expect(notes.map((each) => each.init.body)).toEqual([
      JSON.stringify(NOTE),
      JSON.stringify({ ...NOTE, revision: 2 }),
    ]);
    expect(notes[0]?.init.signal).toBe(signal);
  });

  it("names the claim it was last given: a renewal under another epoch is the one named", async () => {
    const { sent, fetcher } = studio();
    const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
    await api.claim();
    await api.claim();
    await api.notes.post(NOTE, signal);
    expect(headersOf(sent.find(isNote))["x-coach-writer"]).toBe(
      "worker-coach:2",
    );
  });

  it("names its claim on nothing but its notes: not on a read of the transcript, the plan or the ledger", async () => {
    const { sent, fetcher } = fakeFetch((each) =>
      each.url.endsWith("/api/v1/coach-writer")
        ? json({ id: "worker-coach", epoch: 1 })
        : json({ epoch: "e", cursor: 0, lines: [], text: "" }),
    );
    const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
    await api.claim();
    await api.transcript.since(0, signal);
    await api.plan();
    await api.ledger.load("e");
    for (const each of sent.slice(1)) {
      expect(headersOf(each)).not.toHaveProperty("x-coach-writer");
      expect(headersOf(each)).not.toHaveProperty("x-coach-conversation");
    }
  });

  it("throws CoachStoodDown when the Studio refuses it as a stale writer, saying nothing of the note", async () => {
    const { fetcher } = studio((sent) =>
      isNote(sent)
        ? json({ error: { code: "stale_writer", message: CANARY } }, 409)
        : undefined,
    );
    const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
    await api.claim();
    const failure = await api.notes
      .post({ title: CANARY }, signal, "live", "epoch-of-this-call")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CoachStoodDown);
    expect(failure).not.toBeInstanceOf(CoachApiError);
    const error = failure as CoachStoodDown;
    expect(error.name).toBe("CoachStoodDown");
    expect(error.message).toBe("Another coach holds the notes.");
    const shown = `${error.message} ${error.stack} ${JSON.stringify(error)}`;
    expect(shown).not.toContain("canary");
    expect(shown).not.toContain(TOKEN);
  });

  it("is stood down for a replay's note too", async () => {
    const { fetcher } = studio((sent) =>
      isNote(sent) ? json({ error: { code: "stale_writer" } }, 409) : undefined,
    );
    const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
    await api.claim();
    await expect(api.notes.post(NOTE, signal, "replay")).rejects.toBeInstanceOf(
      CoachStoodDown,
    );
  });

  it("writes again under its new claim once it has claimed the pen back", async () => {
    let refuse = true;
    const { sent, fetcher } = studio((each) =>
      isNote(each) && refuse
        ? json({ error: { code: "stale_writer" } }, 409)
        : undefined,
    );
    const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
    await api.claim();
    await expect(api.notes.post(NOTE, signal)).rejects.toBeInstanceOf(
      CoachStoodDown,
    );
    refuse = false;
    expect(await api.claim()).toBe(true);
    await expect(api.notes.post(NOTE, signal)).resolves.toBeUndefined();
    expect(headersOf(sent.filter(isNote).at(-1))["x-coach-writer"]).toBe(
      "worker-coach:2",
    );
  });

  it.each<[string, () => Response]>([
    [
      "an older revision of a note already on show",
      () => json({ error: { code: "stale_coach_note" } }, 409),
    ],
    [
      "a conversation that is over",
      () => json({ error: { code: "stale_conversation" } }, 409),
    ],
    ["a pen that is held", () => json({ error: { code: "coach_held" } }, 409)],
    ["a 409 that names no code", () => json({ error: {} }, 409)],
    [
      "a 409 that is not JSON",
      () => new Response("<html>Conflict</html>", { status: 409 }),
    ],
    ["a 409 with no body", () => empty(409)],
  ])(
    "%s is nothing to do: no error, and it still holds its claim",
    async (_name, refusal) => {
      let refuse = true;
      const { sent, fetcher } = studio((each) =>
        isNote(each) && refuse ? refusal() : undefined,
      );
      const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
      await api.claim();
      await expect(
        api.notes.post(NOTE, signal, "live", "epoch-of-this-call"),
      ).resolves.toBeUndefined();
      refuse = false;
      await api.notes.post({ ...NOTE, revision: 2 }, signal);
      expect(headersOf(sent.filter(isNote).at(-1))["x-coach-writer"]).toBe(
        "worker-coach:1",
      );
    },
  );

  // A coach that has lost the pen (a claim refused, a note refused as a stale
  // writer's, a release) writes nothing until it has claimed it again: its
  // next note is refused here, as CoachStoodDown, and the Studio never
  // hears of it. The call it has in hand runs beside the loop and is not
  // stopped, so without this it would post every later revision of its note
  // on top of the coach that replaced it.
  const lost: [
    string,
    (refuse: () => void, api: ReturnType<typeof coachApi>) => Promise<unknown>,
  ][] = [
    [
      "its renewal was refused because another coach took the pen",
      async (refuse, api) => {
        refuse();
        expect(await api.claim()).toBe(false);
      },
    ],
    [
      "a note of its was refused as a stale writer's",
      async (refuse, api) => {
        refuse();
        await expect(api.notes.post(NOTE, signal)).rejects.toBeInstanceOf(
          CoachStoodDown,
        );
      },
    ],
    ["it gave the pen up", async (_refuse, api) => api.release()],
  ];
  // The Studio as it answers once another coach has the pen: a claim is
  // refused, a named writer that is stale is refused, and a note that names
  // no writer is taken.
  const replaceable = () => {
    const state = { taken: false };
    const at = studio((each) => {
      if (!state.taken) return undefined;
      if (each.url.endsWith("/api/v1/coach-writer"))
        return json({ error: { code: "coach_held" } }, 409);
      if (isNote(each) && "x-coach-writer" in headersOf(each))
        return json({ error: { code: "stale_writer" } }, 409);
      return undefined;
    });
    return { ...at, state };
  };
  describe.each(lost)("once %s", (_name, lose) => {
    it("its next note is refused as CoachStoodDown without the Studio being asked, live or a replay's, however often", async () => {
      const { sent, fetcher, state } = replaceable();
      const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
      await api.claim();
      await api.notes.post(NOTE, signal, "live", "epoch-of-this-call");
      await lose(() => {
        state.taken = true;
      }, api);
      const before = sent.length;
      // The call still in hand posts the next revisions of its note.
      for (const space of ["live", "replay", "live"] as const) {
        const failure = await api.notes
          .post({ ...NOTE, revision: 2 }, signal, space, "epoch-of-this-call")
          .catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(CoachStoodDown);
        expect(failure).not.toBeInstanceOf(CoachApiError);
      }
      expect(sent.slice(before)).toEqual([]);
    });

    it("no note of its ever reaches the Studio unsigned", async () => {
      const { sent, fetcher, state } = replaceable();
      const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
      await api.claim();
      await api.notes.post(NOTE, signal);
      await lose(() => {
        state.taken = true;
      }, api);
      await api.notes.post(NOTE, signal).catch(() => undefined);
      // Still refused: asking again does not let a note through either.
      await api.claim().catch(() => undefined);
      await api.notes.post(NOTE, signal).catch(() => undefined);
      const signed = sent
        .filter(isNote)
        .map((each) => headersOf(each)["x-coach-writer"]);
      expect(signed.length).toBeGreaterThan(0);
      for (const each of signed) expect(each).toMatch(/^worker-coach:\d+$/);
    });

    it("it still reads the transcript, the plan and the ledger: only its notes are held back", async () => {
      const { fetcher, state } = replaceable();
      const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
      await api.claim();
      await lose(() => {
        state.taken = true;
      }, api);
      await expect(api.transcript.since(0, signal)).resolves.toBeDefined();
      await expect(api.plan()).resolves.toBeUndefined();
      await expect(api.ledger.load("e")).resolves.toBeUndefined();
    });

    it("it writes again once a later claim succeeds, under that claim, and not before", async () => {
      const { sent, fetcher, state } = replaceable();
      const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
      await api.claim();
      await lose(() => {
        state.taken = true;
      }, api);
      // Asked again while another coach holds it: refused, and silent.
      state.taken = true;
      expect(await api.claim()).toBe(false);
      await expect(api.notes.post(NOTE, signal)).rejects.toBeInstanceOf(
        CoachStoodDown,
      );
      state.taken = false;
      expect(await api.claim()).toBe(true);
      const before = sent.length;
      await expect(
        api.notes.post({ ...NOTE, revision: 2 }, signal),
      ).resolves.toBeUndefined();
      expect(sent.slice(before).filter(isNote)).toHaveLength(1);
      expect(headersOf(sent.at(-1))["x-coach-writer"]).toBe("worker-coach:2");
    });
  });

  it("a coach that was replaced and does not know it yet still signs its note with the claim it held: the Studio can refuse it", async () => {
    const { sent, fetcher, state } = replaceable();
    const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
    await api.claim();
    state.taken = true;
    await expect(
      api.notes.post(NOTE, signal, "live", "epoch-of-this-call"),
    ).rejects.toBeInstanceOf(CoachStoodDown);
    expect(headersOf(sent.at(-1))).toEqual({
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-coach-writer": "worker-coach:1",
      "x-coach-conversation": "epoch-of-this-call",
    });
  });

  it("a coach that asked for the pen and never got it posts nothing at all", async () => {
    const { sent, fetcher, state } = replaceable();
    state.taken = true;
    const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
    expect(await api.claim()).toBe(false);
    await expect(api.notes.post(NOTE, signal)).rejects.toBeInstanceOf(
      CoachStoodDown,
    );
    expect(sent.filter(isNote)).toEqual([]);
  });

  it.each([500, 503])(
    "a renewal the Studio could not answer (%i) is not a pen lost: the next note is posted under the claim still held",
    async (status) => {
      let broken = false;
      const { sent, fetcher } = studio((each) =>
        broken && each.url.endsWith("/api/v1/coach-writer")
          ? json({ error: { code: "x" } }, status)
          : undefined,
      );
      const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
      await api.claim();
      broken = true;
      await expect(api.claim()).rejects.toBeInstanceOf(CoachApiError);
      await expect(api.notes.post(NOTE, signal)).resolves.toBeUndefined();
      expect(headersOf(sent.at(-1))["x-coach-writer"]).toBe("worker-coach:1");
    },
  );

  it("a renewal that could not be answered does not let a coach that had lost the pen write again", async () => {
    let broken = false;
    const { sent, fetcher, state } = replaceable();
    const api = coachApi(
      STUDIO,
      TOKEN,
      (async (url: RequestInfo | URL, init?: RequestInit) => {
        if (broken) throw new TypeError("fetch failed");
        return fetcher(url, init);
      }) as typeof fetch,
      "worker-coach",
    );
    await api.claim();
    state.taken = true;
    expect(await api.claim()).toBe(false);
    broken = true;
    await expect(api.claim()).rejects.toBeInstanceOf(TypeError);
    broken = false;
    const before = sent.length;
    await expect(api.notes.post(NOTE, signal)).rejects.toBeInstanceOf(
      CoachStoodDown,
    );
    expect(sent).toHaveLength(before);
  });
});

describe("the ledger, as the coach keeps it in the Studio", () => {
  const LEDGER = {
    version: 1 as const,
    epoch: "1a2b3c4d-0000-4000-8000-00000000000e",
    readTo: 4,
    given: [],
    log: ["They care about rollback."],
    cautions: [],
    design: { edges: [] },
    revisions: [["coach-1a2b3c4d-1", 2]] as [string, number][],
    looks: 0,
    nudged: false,
  };

  it("loads it by the conversation's epoch, with the token as a bearer", async () => {
    const { sent, fetcher } = fakeFetch(() => json({ ledger: LEDGER }));
    const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
    expect(await api.ledger.load(LEDGER.epoch)).toEqual(LEDGER);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(
      `${STUDIO}/api/v1/coach-ledger?epoch=${LEDGER.epoch}`,
    );
    expect(sent[0]?.init).toMatchObject({
      method: "GET",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(sent[0]?.init).not.toHaveProperty("body");
  });

  it("writes the epoch into the address safely", async () => {
    const { sent, fetcher } = fakeFetch(() => empty(204));
    await coachApi(STUDIO, TOKEN, fetcher).ledger.load("an epoch&id=x #1");
    expect(sent[0]?.url).toBe(
      `${STUDIO}/api/v1/coach-ledger?epoch=an%20epoch%26id%3Dx%20%231`,
    );
  });

  it.each<[string, () => Response]>([
    ["none is kept (204)", () => empty(204)],
    ["the answer holds no ledger", () => json({})],
  ])("loads nothing when %s", async (_name, answer) => {
    const { fetcher } = fakeFetch(answer);
    await expect(
      coachApi(STUDIO, TOKEN, fetcher).ledger.load(LEDGER.epoch),
    ).resolves.toBeUndefined();
  });

  it.each([401, 500, 503])(
    "a refusal to load (%i) throws CoachApiError, which the coach reads as no ledger",
    async (status) => {
      const { fetcher } = fakeFetch(() =>
        json({ error: { code: "x", message: CANARY } }, status),
      );
      await expect(
        coachApi(STUDIO, TOKEN, fetcher).ledger.load(LEDGER.epoch),
      ).rejects.toMatchObject({ name: "CoachApiError", status });
    },
  );

  it("saves it with a PUT of `{ ledger }` as JSON, with the token as a bearer", async () => {
    const { sent, fetcher } = fakeFetch(() => empty(204));
    await expect(
      coachApi(STUDIO, TOKEN, fetcher, "worker-coach").ledger.save(LEDGER),
    ).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`${STUDIO}/api/v1/coach-ledger`);
    expect(sent[0]?.init).toEqual({
      method: "PUT",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ledger: LEDGER }),
    });
  });

  it("a ledger of a conversation that is over (409) is not an error: there is nothing to keep", async () => {
    const { fetcher } = fakeFetch(() =>
      json({ error: { code: "stale_conversation" } }, 409),
    );
    await expect(
      coachApi(STUDIO, TOKEN, fetcher).ledger.save(LEDGER),
    ).resolves.toBeUndefined();
  });

  it.each([400, 401, 413, 500])(
    "any other refusal to save (%i) throws CoachApiError carrying the status alone",
    async (status) => {
      const { fetcher } = fakeFetch(() =>
        json({ error: { code: "x", message: CANARY } }, status),
      );
      const failure = await coachApi(STUDIO, TOKEN, fetcher)
        .ledger.save(LEDGER)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(CoachApiError);
      expect((failure as CoachApiError).status).toBe(status);
      expect((failure as Error).message).not.toContain("canary");
    },
  );

  it("names no writer when it keeps its ledger, even once it has claimed", async () => {
    const { sent, fetcher } = fakeFetch((each) =>
      each.url.endsWith("/api/v1/coach-writer")
        ? json({ id: "worker-coach", epoch: 1 })
        : empty(204),
    );
    const api = coachApi(STUDIO, TOKEN, fetcher, "worker-coach");
    await api.claim();
    await api.ledger.save(LEDGER);
    expect(headersOf(sent.at(-1))).not.toHaveProperty("x-coach-writer");
  });
});

describe("the loop and the pen", () => {
  const PATH = (sent: Sent) => new URL(sent.url).pathname;
  // The Studio as the loop meets it: a pen that is free or held by another
  // coach, an empty transcript, no plan and no ledger.
  function studio() {
    const state = { heldByAnother: false, epoch: 0 };
    const sent: (Sent & { atMs: number })[] = [];
    vi.stubGlobal("fetch", (async (url: unknown, init?: RequestInit) => {
      const call = { url: String(url), init: init ?? {}, atMs: Date.now() };
      sent.push(call);
      const path = PATH(call);
      const method = call.init.method ?? "GET";
      if (path === "/api/v1/coach-writer" && method === "POST") {
        if (state.heldByAnother)
          return json({ error: { code: "coach_held" } }, 409);
        state.epoch += 1;
        return json({ id: `coach-${process.pid}`, epoch: state.epoch });
      }
      if (path === "/api/v1/coach-writer" && method === "DELETE")
        return empty(204);
      if (path === "/api/v1/coach-transcript")
        return json({ epoch: "epoch-1", cursor: 0, lines: [], space: "live" });
      if (path === "/api/v1/coach-plan") return json({ text: "" });
      if (path === "/api/v1/coach-ledger") return empty(204);
      return json({ error: { code: "not_found" } }, 404);
    }) as typeof fetch);
    const of = (path: string, method = "GET") =>
      sent.filter(
        (each) => PATH(each) === path && (each.init.method ?? "GET") === method,
      );
    return {
      state,
      sent,
      claims: () => of("/api/v1/coach-writer", "POST"),
      releases: () => of("/api/v1/coach-writer", "DELETE"),
      reads: () => of("/api/v1/coach-transcript"),
      notes: () => of("/api/v1/coach-notes", "POST"),
    };
  }
  const adapter = (id: "codex" | "claude-code"): AgentRuntimeAdapter => ({
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
  function running() {
    const lines: string[] = [];
    const stop = new AbortController();
    const loop = coachLoop(
      {
        INTERVIEW_COACH: "codex",
        INTERVIEW_API_TOKEN: TOKEN,
        INTERVIEW_API_URL: STUDIO,
      },
      { codex: adapter("codex") },
      (line) => {
        lines.push(line);
      },
    );
    const done = (loop as NonNullable<typeof loop>).run(stop.signal);
    return {
      lines,
      // What the loop said after "coach listening (…)".
      said: () => lines.slice(1),
      async stop() {
        stop.abort();
        await vi.advanceTimersByTimeAsync(2_000);
        await done;
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T09:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("claims the pen before it reads anything, as itself and without a takeover, and says it is writing", async () => {
    const at = studio();
    const coach = running();
    await vi.advanceTimersByTimeAsync(100);
    expect(PATH(at.sent[0] as Sent)).toBe("/api/v1/coach-writer");
    expect(at.sent[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(at.sent[0]?.init.body))).toEqual({
      id: `coach-${process.pid}`,
    });
    expect(headersOf(at.sent[0])["authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(at.reads().length).toBeGreaterThan(0);
    expect(coach.lines[0]).toMatch(/^coach listening \(codex, \S+\)$/);
    expect(coach.said()).toEqual(["coach writing: it holds the notes"]);
    await coach.stop();
  });

  it("renews its claim every 5 s while it listens, well inside the 15 s a claim stands, and says so once", async () => {
    const at = studio();
    const coach = running();
    await vi.advanceTimersByTimeAsync(31_000);
    const times = at.claims().map((each) => each.atMs);
    expect(times.length).toBeGreaterThanOrEqual(5);
    expect(times.length).toBeLessThanOrEqual(7);
    for (let each = 1; each < times.length; each += 1) {
      const gap = (times[each] as number) - (times[each - 1] as number);
      expect(gap).toBeGreaterThan(5_000);
      // Never so late that the claim would have lapsed.
      expect(gap).toBeLessThan(7_000);
    }
    // It went on reading the transcript between renewals.
    expect(at.reads().length).toBeGreaterThan(50);
    expect(coach.said()).toEqual(["coach writing: it holds the notes"]);
    await coach.stop();
  });

  it("stands by when another coach takes the pen: it says so once, reads and writes nothing, and goes on asking", async () => {
    const at = studio();
    const coach = running();
    await vi.advanceTimersByTimeAsync(1_000);
    at.state.heldByAnother = true;
    await vi.advanceTimersByTimeAsync(7_000);
    expect(coach.said()).toEqual([
      "coach writing: it holds the notes",
      "coach standing by: another coach holds the notes",
    ]);
    const reads = at.reads().length;
    const claims = at.claims().length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(at.reads()).toHaveLength(reads);
    expect(at.notes()).toEqual([]);
    // Still asking, at about the same pace, and saying nothing more.
    expect(at.claims().length - claims).toBeGreaterThanOrEqual(4);
    expect(at.claims().length - claims).toBeLessThanOrEqual(6);
    expect(coach.said()).toHaveLength(2);
    await coach.stop();
  });

  it("takes up again when the pen comes free: it says it is writing, and reads the transcript again", async () => {
    const at = studio();
    const coach = running();
    await vi.advanceTimersByTimeAsync(1_000);
    at.state.heldByAnother = true;
    await vi.advanceTimersByTimeAsync(20_000);
    const reads = at.reads().length;
    at.state.heldByAnother = false;
    await vi.advanceTimersByTimeAsync(8_000);
    expect(coach.said()).toEqual([
      "coach writing: it holds the notes",
      "coach standing by: another coach holds the notes",
      "coach writing: it holds the notes",
    ]);
    expect(at.reads().length).toBeGreaterThan(reads);
    await coach.stop();
  });

  it("a coach that starts while another holds the pen reads and writes nothing until it is given it", async () => {
    const at = studio();
    at.state.heldByAnother = true;
    const coach = running();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(at.claims().length).toBeGreaterThanOrEqual(3);
    expect(at.reads()).toEqual([]);
    expect(at.notes()).toEqual([]);
    at.state.heldByAnother = false;
    await vi.advanceTimersByTimeAsync(8_000);
    expect(coach.said().at(-1)).toBe("coach writing: it holds the notes");
    expect(at.reads().length).toBeGreaterThan(0);
    await coach.stop();
  });

  // A coach started while another already holds the pen (the worker
  // restarted during a call a desktop agent is coaching) is refused from its
  // first claim: it says so, once, instead of listening in silence.
  it("a coach that starts while another holds the pen says it is standing by, on its first refused claim and once", async () => {
    const at = studio();
    at.state.heldByAnother = true;
    const coach = running();
    await vi.advanceTimersByTimeAsync(100);
    expect(at.claims()).toHaveLength(1);
    expect(coach.lines).toEqual([
      expect.stringMatching(/^coach listening \(codex, \S+\)$/),
      "coach standing by: another coach holds the notes",
    ]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(at.claims().length).toBeGreaterThanOrEqual(3);
    expect(coach.said()).toEqual([
      "coach standing by: another coach holds the notes",
    ]);
    // Given the pen, it says it is writing.
    at.state.heldByAnother = false;
    await vi.advanceTimersByTimeAsync(8_000);
    expect(coach.said()).toEqual([
      "coach standing by: another coach holds the notes",
      "coach writing: it holds the notes",
    ]);
    await coach.stop();
  });

  it("gives the pen up when the worker stops, as its last word to the Studio", async () => {
    const at = studio();
    const coach = running();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(at.releases()).toEqual([]);
    await coach.stop();
    expect(at.releases()).toHaveLength(1);
    expect(at.sent.at(-1)?.url).toBe(
      `${STUDIO}/api/v1/coach-writer?id=coach-${process.pid}`,
    );
    expect(at.sent.at(-1)?.init).toEqual({
      method: "DELETE",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it("gives it up when it stops while standing by too", async () => {
    const at = studio();
    at.state.heldByAnother = true;
    const coach = running();
    await vi.advanceTimersByTimeAsync(3_000);
    await coach.stop();
    expect(at.releases()).toHaveLength(1);
  });

  it("a Studio that is not up yet is an error said by name, and the pen is asked for again when it is", async () => {
    const at = studio();
    const up = globalThis.fetch;
    let down = true;
    vi.stubGlobal("fetch", (async (url: unknown, init?: RequestInit) => {
      if (down) throw new TypeError("fetch failed");
      return up(url as string, init);
    }) as typeof fetch);
    const coach = running();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(coach.said()).toEqual(["coach error: TypeError (consecutive 1)"]);
    down = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(coach.said().at(-1)).toBe("coach writing: it holds the notes");
    expect(at.reads().length).toBeGreaterThan(0);
    expect(coach.lines.join(" ")).not.toContain(TOKEN);
    await coach.stop();
  });
});

describe("one session of the runtime for the call (INTERVIEW_COACH_RETAIN)", () => {
  const QUESTION = "How would you shard the booking table?";
  const HOT = "And how would you handle one region running hot?";
  const REPLY =
    "KIND: technical\nSAME: no\nASK: Sharding\nSAY: I would shard by **region** first.";
  // The worker's coach from end to end: a Studio that holds a conversation
  // (synthetic), and a runtime that answers every call with one note and
  // says which session it answered in.
  async function coached(
    env: Record<string, string>,
    // How many of the coach's first notes the Studio refuses as a stale
    // writer's.
    refused = 0,
    // Whether the runtime keeps a conversation's session between calls.
    holding = false,
  ) {
    let refusals = refused;
    let granted = 0;
    const sent: { path: string; atMs: number; writer?: string }[] = [];
    const lines: string[] = [];
    const said = [
      {
        seq: 1,
        speaker: "interviewer",
        text: QUESTION,
        at: new Date().toISOString(),
      },
    ];
    vi.stubGlobal("fetch", (async (url: unknown, init?: RequestInit) => {
      const at = new URL(String(url));
      const writer = (init?.headers as Record<string, string> | undefined)?.[
        "x-coach-writer"
      ];
      sent.push({
        path: at.pathname,
        atMs: Date.now(),
        ...(writer ? { writer } : {}),
      });
      if (at.pathname === "/api/v1/coach-writer") {
        granted += 1;
        return json({ id: "worker", epoch: granted });
      }
      if (at.pathname === "/api/v1/coach-transcript") {
        const after = Number(at.searchParams.get("after") ?? 0);
        return json({
          epoch: "epoch-1",
          cursor: said.length,
          space: "live",
          lines: said.filter((line) => line.seq > after),
        });
      }
      if (at.pathname === "/api/v1/coach-plan") return json({ text: "" });
      if (at.pathname === "/api/v1/coach-ledger") return empty(204);
      if (refusals > 0) {
        refusals -= 1;
        return json({ error: { code: "stale_writer" } }, 409);
      }
      return json({ revision: 1, notes: [] }, 201);
    }) as typeof fetch);
    const calls: {
      how: "run" | "resume";
      request: string;
      prompt: string;
      system: string;
    }[] = [];
    const held = new Set<string>();
    const answer = (how: "run" | "resume") =>
      async function* (request: {
        prompt?: string;
        conversation?: string;
        systemPrompt?: string;
      }) {
        if (request.conversation) held.add(request.conversation);
        calls.push({
          how,
          request: JSON.stringify(request, (key, value) =>
            key === "signal" || key === "systemPrompt" ? undefined : value,
          ),
          prompt: request.prompt ?? "",
          system: request.systemPrompt ?? "",
        });
        yield { type: "started", sessionId: "runtime-session-1" };
        yield { type: "text-delta", text: REPLY };
        yield {
          type: "completed",
          result: { sessionId: "runtime-session-1", output: REPLY },
        };
      };
    const stop = new AbortController();
    const loop = coachLoop(
      {
        INTERVIEW_COACH: "codex",
        INTERVIEW_API_TOKEN: TOKEN,
        INTERVIEW_API_URL: STUDIO,
        ...env,
      },
      {
        codex: {
          runtime: "codex",
          capabilities: {
            resume: true,
            structuredOutput: true,
            attachments: true,
            tools: false,
          },
          run: answer("run"),
          resume: answer("resume"),
          cancel: async () => {},
          ...(holding
            ? {
                holds: (id: string) => held.has(id),
                endConversation: async (id: string) => {
                  held.delete(id);
                },
              }
            : {}),
        } as unknown as AgentRuntimeAdapter,
      },
      (line) => {
        lines.push(line);
      },
    );
    const done = (loop as NonNullable<typeof loop>).run(stop.signal);
    // The runtime's working directory is made on the real disk: time passes
    // in steps, each after what was waiting on the disk has had its turn.
    const pass = async (ms: number) => {
      for (let step = 0; step < ms / 250; step += 1) {
        for (let turn = 0; turn < 3; turn += 1)
          await new Promise((resolve) => setImmediate(resolve));
        await vi.advanceTimersByTimeAsync(250);
      }
    };
    const notes = () =>
      sent.filter((each) => each.path === "/api/v1/coach-notes").length;
    // Time passes until the runtime has answered `count` calls and a note
    // has come of the last (a minute of it at most).
    const answered = async (count: number, posted: number) => {
      for (
        let step = 0;
        step < 240 && (calls.length < count || notes() < posted);
        step += 1
      )
        await pass(250);
      await pass(3_000);
    };
    await answered(1 + refused, 1 + refused);
    const before = notes();
    // Long enough that the next question is another turn.
    await pass(30_000);
    said.push({
      seq: 2,
      speaker: "interviewer",
      text: HOT,
      at: new Date().toISOString(),
    });
    await answered(2 + refused, before + 1);
    stop.abort();
    await pass(2_000);
    await done;
    return Object.assign(calls, { sent, lines });
  }
  const worded = (prompt: string) =>
    prompt.split("\n").filter((line) => line.trim() !== "");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-09T09:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("`off` puts every call to the runtime afresh, with the whole prompt as one message", async () => {
    const calls = await coached({ INTERVIEW_COACH_RETAIN: "off" });
    expect(calls.map((call) => call.how)).toEqual(["run", "run"]);
    expect(worded(calls[1]?.prompt ?? "")).toEqual([
      "NOTES YOU HAVE ALREADY GIVEN (oldest first):",
      "- [technical] Sharding: I would shard by region first.",
      "THE CONVERSATION SO FAR:",
      `INTERVIEWER: ${QUESTION}`,
      "NEW LINES (decide on these):",
      `INTERVIEWER: ${HOT}`,
      expect.stringMatching(/^WHY NOW: /),
    ]);
  });

  it.each<[string, Record<string, string>]>([
    ["by default", {}],
    ["when said to be on", { INTERVIEW_COACH_RETAIN: "on" }],
  ])(
    "%s the runtime is given the background and the turn as two messages, which say what the one would",
    async (_name, env) => {
      const [kept, plain] = [
        await coached(env),
        await coached({ INTERVIEW_COACH_RETAIN: "off" }),
      ];
      expect(kept).toHaveLength(2);
      for (const at of [0, 1]) {
        // Two messages are put to the runtime with a gap between them that
        // the one prompt does not have: the words are the same.
        expect(kept[at]?.prompt).not.toBe(plain[at]?.prompt);
        expect(
          worded(kept[at]?.prompt ?? "").map((line) =>
            line.replace(/^WHY NOW: .*/, "WHY NOW"),
          ),
        ).toEqual(
          worded(plain[at]?.prompt ?? "").map((line) =>
            line.replace(/^WHY NOW: .*/, "WHY NOW"),
          ),
        );
      }
    },
  );

  it("a coach whose note is refused as a stale writer's asks for the pen again at once, says no error, and writes under its new claim", async () => {
    const { sent, lines } = await coached({}, 1);
    const notes = sent.filter((each) => each.path === "/api/v1/coach-notes");
    const claims = sent.filter((each) => each.path === "/api/v1/coach-writer");
    // The refused note named the claim it was written under.
    expect(notes[0]?.writer).toBe("worker:1");
    // The pen is asked for again well before the 5 s a renewal waits.
    const again = claims.find(
      (each) => each.atMs >= (notes[0] as { atMs: number }).atMs,
    );
    expect(again).toBeDefined();
    expect(
      (again as { atMs: number }).atMs - (notes[0] as { atMs: number }).atMs,
    ).toBeLessThan(1_000);
    expect(lines.filter((line) => line.startsWith("coach error"))).toEqual([]);
    expect(lines.slice(1, 3)).toEqual([
      "coach writing: it holds the notes",
      "coach writing: it holds the notes",
    ]);
    // What it writes next is under the claim it was then given.
    expect(notes.length).toBeGreaterThan(1);
    for (const each of notes.slice(1))
      expect(each.writer).toMatch(/^worker:([2-9]|\d\d+)$/);
  });

  // The engine asks the runtime whether it still holds the conversation
  // (`holds`), not whether it can resume a session by id: a runtime that
  // holds one is sent only what is new.
  it("with retention on, a runtime that holds the conversation is sent only the new lines on the second call", async () => {
    const calls = await coached({ INTERVIEW_COACH_RETAIN: "on" }, 0, true);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.prompt).toContain(QUESTION);
    expect(worded(calls[1]?.prompt ?? "")).toEqual([
      "NEW LINES (decide on these):",
      `INTERVIEWER: ${HOT}`,
      expect.stringMatching(/^WHY NOW: /),
    ]);
  });

  it("with retention off, a runtime that could hold a conversation is never asked to", async () => {
    const calls = await coached({ INTERVIEW_COACH_RETAIN: " OFF " }, 0, true);
    expect(calls[1]?.prompt).toContain(QUESTION);
    expect(calls[1]?.request).not.toContain("conversation");
  });

  // INTERVIEW_COACH_GROUNDING: what a note may claim. On unless turned off.
  it.each<[string, Record<string, string>, boolean]>([
    ["by default", {}, true],
    ["when said to be on", { INTERVIEW_COACH_GROUNDING: "on" }, true],
    ["when turned off", { INTERVIEW_COACH_GROUNDING: " Off " }, false],
  ])(
    "%s the coach is asked under the grounding rules, or as it was before",
    async (_name, env, strict) => {
      const calls = await coached(env);
      // The runtime is given the standing instructions with its prompt.
      const asked = calls[0]?.system || calls[0]?.prompt || "";
      expect(asked.includes("Never say or imply that they have NOT")).toBe(
        strict,
      );
      expect(asked.includes("Without a pointer you may only use")).toBe(
        !strict,
      );
    },
  );
});

describe("whether the worker runs the coach", () => {
  // A loop that is run gives the pen up when it ends: that goes to a
  // stand-in, never to whatever listens on the Studio's port.
  let reached: Sent[] = [];
  beforeEach(() => {
    reached = [];
    vi.stubGlobal("fetch", (async (url: unknown, init?: RequestInit) => {
      reached.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 204 });
    }) as typeof fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("run on a stopped worker says what it listens with and returns: it claims nothing, reads nothing, and only gives up the pen", async () => {
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
    expect(reached.map((each) => [each.init.method, each.url])).toEqual([
      [
        "DELETE",
        `http://127.0.0.1:3000/api/v1/coach-writer?id=coach-${process.pid}`,
      ],
    ]);
  });
});
