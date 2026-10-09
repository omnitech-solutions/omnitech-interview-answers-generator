// The coach's transcript over HTTP: a session or a person adds lines, the
// coach reads what follows its cursor, and a clear (of the transcript or of
// the coach's notes) starts a new epoch. The notes store here is the real one
// over a temporary file; the transcript is the process's own, in memory.
import { rmSync } from "node:fs";
import { coachTranscriptResponseSchema } from "@omnitech/interview-contracts";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const held = vi.hoisted(() => ({ directory: "" }));

vi.mock("esbuild", () => ({ build: vi.fn() }));
vi.mock("./services", () => ({
  answerRepository: {},
  explanationRepository: {},
  codeRunner: {},
  generateInterviewAnswer: vi.fn(),
  generateExplanation: vi.fn(),
  libraryRepository: {},
  libraryService: {},
}));
vi.mock("./coach-notes", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const actual =
    await vi.importActual<typeof import("./coach-notes")>("./coach-notes");
  held.directory = mkdtempSync(join(tmpdir(), "coach-transcript-api-"));
  return {
    ...actual,
    coachNotes: actual.createCoachNotes(
      join(held.directory, "coach-notes.json"),
    ),
  };
});

import { createApi } from "./api";

const TRANSCRIPT = "http://localhost/api/v1/coach-transcript";
const NOTES = "http://localhost/api/v1/coach-notes";
const REPLAY_NOTES = `${NOTES}?space=replay`;
const AT = "2026-10-08T09:00:00.000Z";
const CANARY = "canary words nobody should see quoted";

const app = (signedIn = true) =>
  createApi({
    resolveScope: async () => null,
    verifySession: async () => signedIn,
  });
const send = (
  method: string,
  body?: unknown,
  url = TRANSCRIPT,
  headers: Record<string, string> = {},
  signedIn = true,
) =>
  app(signedIn).request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
type Read = {
  epoch: string;
  cursor: number;
  lines: { seq: number; speaker: string; text: string; at: string }[];
  space?: string;
};
const read = async (response: Response) => (await response.json()) as Read;
const reading = async (after?: string) =>
  read(
    await send(
      "GET",
      undefined,
      after === undefined ? TRANSCRIPT : `${TRANSCRIPT}?after=${after}`,
    ),
  );

describe("the coach transcript API", () => {
  const originalToken = process.env["INTERVIEW_API_TOKEN"];
  beforeEach(async () => {
    delete process.env["INTERVIEW_API_TOKEN"];
    await send("DELETE");
  });
  afterEach(() => {
    if (originalToken === undefined) delete process.env["INTERVIEW_API_TOKEN"];
    else process.env["INTERVIEW_API_TOKEN"] = originalToken;
  });
  afterAll(() => rmSync(held.directory, { recursive: true, force: true }));

  it("reads an empty transcript at cursor 0 under an epoch", async () => {
    const response = await send("GET");
    expect(response.status).toBe(200);
    const body = await read(response);
    // Nothing was attached yet in this process: it is the live space.
    expect(body).toEqual({
      epoch: expect.any(String),
      cursor: 0,
      lines: [],
      space: "live",
    });
    expect(coachTranscriptResponseSchema.safeParse(body).success).toBe(true);
  });

  it("takes lines with 201 and the new cursor, and gives them back numbered, in order", async () => {
    const posted = await send("POST", {
      lines: [
        { speaker: "interviewer", text: "  How did the rollout go?  ", at: AT },
        { text: "It went in three stages.", at: AT },
      ],
    });
    expect(posted.status).toBe(201);
    const added = await read(posted);
    // The answer is the cursor alone: what was said is not echoed.
    // Lines attached over HTTP come from no session: they are a replay.
    expect(added).toEqual({
      epoch: expect.any(String),
      cursor: 2,
      lines: [],
      space: "replay",
    });
    const body = await reading();
    expect(body).toEqual({
      epoch: added.epoch,
      cursor: 2,
      lines: [
        {
          seq: 1,
          speaker: "interviewer",
          text: "How did the rollout go?",
          at: AT,
        },
        {
          seq: 2,
          speaker: "unknown",
          text: "It went in three stages.",
          at: AT,
        },
      ],
      space: "replay",
    });
    expect(coachTranscriptResponseSchema.safeParse(body).success).toBe(true);
  });

  it("stamps a line with no time, and keeps numbering across posts", async () => {
    await send("POST", { lines: [{ text: "one" }] });
    const second = await read(await send("POST", { lines: [{ text: "two" }] }));
    expect(second.cursor).toBe(2);
    const body = await reading();
    expect(body.lines.map((line) => line.seq)).toEqual([1, 2]);
    for (const line of body.lines)
      expect(new Date(line.at).toISOString()).toBe(line.at);
  });

  it("reads what follows `?after=`, and everything for a cursor that is not a positive whole number", async () => {
    await send("POST", {
      lines: ["one", "two", "three"].map((text) => ({ text, at: AT })),
    });
    expect((await reading("1")).lines.map((line) => line.text)).toEqual([
      "two",
      "three",
    ]);
    expect(await reading("3")).toMatchObject({ cursor: 3, lines: [] });
    expect(await reading("9")).toMatchObject({ cursor: 3, lines: [] });
    for (const after of ["0", "-2", "1.5", "abc", ""])
      expect((await reading(after)).lines, `after=${after}`).toHaveLength(3);
  });

  it.each([
    ["no lines", { lines: [] }, ["lines"]],
    ["no body fields", {}, ["lines"]],
    [
      "a blank line",
      { lines: [{ text: "ok" }, { text: "   " }] },
      ["lines.1.text"],
    ],
    [
      "a speaker it does not know",
      { lines: [{ speaker: "Speaker 1", text: CANARY }] },
      ["lines.0.speaker"],
    ],
    [
      "a time that is not a date-time",
      { lines: [{ text: CANARY, at: "00:01:12" }] },
      ["lines.0.at"],
    ],
    [
      "a line longer than 4,000 characters",
      { lines: [{ text: `${CANARY}${"a".repeat(4_000)}` }] },
      ["lines.0.text"],
    ],
    [
      "a field it does not know",
      { lines: [{ text: CANARY, seq: 7 }], epoch: "mine" },
      ["lines.0", ""],
    ],
  ])(
    "refuses %s with 400 invalid_coach_transcript and the paths at fault, never the words",
    async (_name, body, paths) => {
      const before = await reading();
      const refused = await send("POST", body);
      expect(refused.status).toBe(400);
      const answer = (await refused.json()) as {
        error: { code: string; message: string; issues: string[] };
      };
      expect(answer.error).toEqual({
        code: "invalid_coach_transcript",
        message: "The transcript is invalid.",
        issues: paths,
        requestId: expect.any(String),
      });
      expect(JSON.stringify(answer)).not.toContain("canary");
      expect(await reading()).toEqual(before);
    },
  );

  it("names at most 20 paths for a transcript with many lines at fault", async () => {
    const refused = await send("POST", {
      lines: Array.from({ length: 30 }, () => ({ text: "" })),
    });
    expect(refused.status).toBe(400);
    const answer = (await refused.json()) as { error: { issues: string[] } };
    expect(answer.error.issues).toHaveLength(20);
    expect(answer.error.issues[0]).toBe("lines.0.text");
  });

  it("refuses a body that is not JSON with 400, adding nothing", async () => {
    const refused = await app().request(TRANSCRIPT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(refused.status).toBe(400);
    expect((await reading()).lines).toEqual([]);
  });

  it("a clear empties the transcript, starts a new epoch and numbers from 1 again", async () => {
    await send("POST", { lines: [{ text: "before" }, { text: "the clear" }] });
    const before = await reading();
    const cleared = await send("DELETE");
    expect(cleared.status).toBe(200);
    const body = await read(cleared);
    expect(body).toEqual({
      epoch: expect.any(String),
      cursor: 0,
      lines: [],
      space: "replay",
    });
    expect(body.epoch).not.toBe(before.epoch);
    expect(await reading()).toEqual(body);
    expect(
      (await read(await send("POST", { lines: [{ text: "after" }] }))).cursor,
    ).toBe(1);
  });

  it("clearing the person's own notes leaves an attached transcript alone: it is a replay's", async () => {
    await send("POST", { lines: [{ text: "something that was said" }] });
    await send("POST", { title: "A note", key: "q-1" }, NOTES);
    const before = await reading();
    expect(before.lines).toHaveLength(1);

    const cleared = await send("DELETE", undefined, NOTES);

    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { notes: unknown[] }).notes).toEqual([]);
    // Only the conversation those notes were written from goes with them.
    const after = await reading();
    expect(after.epoch).toBe(before.epoch);
    expect(after.lines).toHaveLength(1);
    expect(after.space).toBe("replay");
  });

  it("clearing a replay's notes clears the transcript too, and leaves the person's own notes on show", async () => {
    await send("POST", { lines: [{ text: "something that was said" }] });
    await send("POST", { title: "The person's own", key: "q-1" }, NOTES);
    await send("POST", { title: "Of the replay", key: "q-1" }, REPLAY_NOTES);
    const before = await reading();

    const cleared = await send("DELETE", undefined, REPLAY_NOTES);

    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { notes: unknown[] }).notes).toEqual([]);
    const after = await reading();
    expect(after).toMatchObject({ cursor: 0, lines: [] });
    expect(after.epoch).not.toBe(before.epoch);
    const own = (await (await send("GET", undefined, NOTES)).json()) as {
      notes: { title: string }[];
    };
    expect(own.notes.map((note) => note.title)).toEqual(["The person's own"]);
    await send("DELETE", undefined, NOTES);
  });

  it("clearing the transcript leaves the coach's notes on show", async () => {
    await send("POST", { title: "A note", key: "q-1" }, NOTES);
    await send("DELETE");
    const notes = (await (await send("GET", undefined, NOTES)).json()) as {
      notes: { title: string }[];
    };
    expect(notes.notes.map((note) => note.title)).toEqual(["A note"]);
  });

  describe("access", () => {
    it.each(["GET", "POST", "DELETE"])(
      "refuses %s with the fixed 401 when nobody is signed in and no token is configured",
      async (method) => {
        const refused = await send(
          method,
          method === "POST" ? { lines: [{ text: CANARY }] } : undefined,
          TRANSCRIPT,
          {},
          false,
        );
        expect(refused.status).toBe(401);
        expect(
          ((await refused.json()) as { error: { code: string } }).error.code,
        ).toBe("unauthorized");
        expect((await reading()).lines).toEqual([]);
      },
    );

    it("takes the configured API token as a bearer (the coach in the worker), and refuses a wrong one", async () => {
      process.env["INTERVIEW_API_TOKEN"] = "coach-test-token";
      const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
      const posted = await send(
        "POST",
        { lines: [{ text: "heard" }] },
        TRANSCRIPT,
        bearer("coach-test-token"),
        false,
      );
      expect(posted.status).toBe(201);
      const got = await send(
        "GET",
        undefined,
        `${TRANSCRIPT}?after=0`,
        bearer("coach-test-token"),
        false,
      );
      expect((await read(got)).lines.map((line) => line.text)).toEqual([
        "heard",
      ]);
      expect(
        (
          await send(
            "GET",
            undefined,
            TRANSCRIPT,
            bearer("another-token"),
            false,
          )
        ).status,
      ).toBe(401);
    });
  });
});

describe("the coach activity API (who is speaking)", () => {
  const ACTIVITY = "http://localhost/api/v1/coach-activity";
  const originalToken = process.env["INTERVIEW_API_TOKEN"];
  beforeEach(async () => {
    delete process.env["INTERVIEW_API_TOKEN"];
    await send("DELETE");
  });
  afterEach(() => {
    vi.useRealTimers();
    if (originalToken === undefined) delete process.env["INTERVIEW_API_TOKEN"];
    else process.env["INTERVIEW_API_TOKEN"] = originalToken;
  });
  const speaking = async () =>
    ((await (await send("GET")).json()) as { speaking?: string[] }).speaking;
  const report = (speaker: string, on: boolean) =>
    send("POST", { speaker, speaking: on }, ACTIVITY);

  it("a transcript nobody reported activity for does not say who is speaking", async () => {
    expect(await (await send("GET")).json()).not.toHaveProperty("speaking");
  });

  it("takes a report with 204 and no body, and the transcript then says who is speaking", async () => {
    const taken = await report("interviewer", true);
    expect(taken.status).toBe(204);
    expect(await taken.text()).toBe("");
    expect(await speaking()).toEqual(["interviewer"]);
    const body = await (await send("GET")).json();
    expect(coachTranscriptResponseSchema.safeParse(body).success).toBe(true);
    expect((await report("candidate", true)).status).toBe(204);
    expect(new Set(await speaking())).toEqual(
      new Set(["interviewer", "candidate"]),
    );
  });

  it("a speaker who stopped is no longer named; the list is then empty, not absent", async () => {
    await report("interviewer", true);
    expect((await report("interviewer", false)).status).toBe(204);
    expect(await speaking()).toEqual([]);
  });

  it("adds no line and starts no new conversation", async () => {
    const before = await reading();
    await report("interviewer", true);
    const after = await reading();
    expect(after.epoch).toBe(before.epoch);
    expect(after.cursor).toBe(before.cursor);
    expect(after.lines).toEqual([]);
  });

  it("a speaking not reported again lapses after 5 s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T10:15:00.000Z"));
    await report("interviewer", true);
    vi.setSystemTime(new Date("2026-10-09T10:15:05.000Z"));
    expect(await speaking()).toEqual(["interviewer"]);
    vi.setSystemTime(new Date("2026-10-09T10:15:05.001Z"));
    expect(await speaking()).toEqual([]);
  });

  it("is forgotten when the transcript is cleared", async () => {
    await report("interviewer", true);
    const cleared = await send("DELETE");
    expect(await cleared.json()).not.toHaveProperty("speaking");
    expect(await speaking()).toBeUndefined();
  });

  it.each<[string, unknown]>([
    ["no speaker", { speaking: true }],
    ["no state", { speaker: "interviewer" }],
    ["a label that is not a speaker", { speaker: CANARY, speaking: true }],
    ["a state that is not a boolean", { speaker: "candidate", speaking: 1 }],
    [
      "a field it does not know",
      { speaker: "candidate", speaking: true, note: CANARY },
    ],
    ["a list", [{ speaker: "candidate", speaking: true }]],
    ["nothing", null],
  ])(
    "refuses %s with 400 invalid_coach_activity, quoting nothing, and nothing is then known",
    async (_name, body) => {
      const refused = await send("POST", body, ACTIVITY);
      expect(refused.status).toBe(400);
      const text = await refused.text();
      expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe(
        "invalid_coach_activity",
      );
      expect(text).not.toContain("canary");
      expect(await speaking()).toBeUndefined();
    },
  );

  it("refuses a body that is not JSON with 400", async () => {
    const refused = await app().request(ACTIVITY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(refused.status).toBe(400);
    expect(
      ((await refused.json()) as { error: { code: string } }).error.code,
    ).toBe("invalid_request");
    expect(await speaking()).toBeUndefined();
  });

  it("refuses it with the fixed 401 when nobody is signed in, and nothing is then known", async () => {
    const refused = await send(
      "POST",
      { speaker: "interviewer", speaking: true },
      ACTIVITY,
      {},
      false,
    );
    expect(refused.status).toBe(401);
    expect(await speaking()).toBeUndefined();
  });
});

describe("the coach ledger API", () => {
  const LEDGER = "http://localhost/api/v1/coach-ledger";
  const originalToken = process.env["INTERVIEW_API_TOKEN"];
  beforeEach(async () => {
    delete process.env["INTERVIEW_API_TOKEN"];
    await send("DELETE");
  });
  afterEach(() => {
    if (originalToken === undefined) delete process.env["INTERVIEW_API_TOKEN"];
    else process.env["INTERVIEW_API_TOKEN"] = originalToken;
  });
  const epochNow = async () => (await reading()).epoch;
  const kept = (epoch: string, readTo = 4) => ({
    version: 1,
    epoch,
    readTo,
    given: [{ kind: "technical", ask: "Sharding the booking table" }],
    log: ["They care about rollback."],
    cautions: [],
    design: { edges: [] },
    revisions: [["coach-1a2b3c4d-1", 2]],
    looks: 1,
    nudged: false,
  });
  const load = (epoch?: string) =>
    send(
      "GET",
      undefined,
      epoch === undefined
        ? LEDGER
        : `${LEDGER}?epoch=${encodeURIComponent(epoch)}`,
    );
  const save = (ledger: unknown) => send("PUT", { ledger }, LEDGER);

  it("answers 204 with no body while no ledger is kept for the conversation", async () => {
    const none = await load(await epochNow());
    expect(none.status).toBe(204);
    expect(await none.text()).toBe("");
  });

  it("keeps a ledger with 204 and gives it back as it was kept, under `ledger`", async () => {
    const epoch = await epochNow();
    const saved = await save(kept(epoch));
    expect(saved.status).toBe(204);
    expect(await saved.text()).toBe("");
    const got = await load(epoch);
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({ ledger: kept(epoch) });
  });

  it("the latest kept takes the last one's place", async () => {
    const epoch = await epochNow();
    await save(kept(epoch, 4));
    await save(kept(epoch, 9));
    expect(await (await load(epoch)).json()).toEqual({
      ledger: kept(epoch, 9),
    });
  });

  it("is read by the conversation's epoch only: another epoch, or none, is answered 204", async () => {
    const epoch = await epochNow();
    await save(kept(epoch));
    for (const other of [
      "another-epoch",
      "",
      undefined,
      epoch.toUpperCase(),
      `${epoch} `,
    ])
      expect((await load(other)).status).toBe(204);
  });

  it("refuses a ledger of another conversation with 409 stale_conversation, keeping nothing", async () => {
    const epoch = await epochNow();
    const refused = await save(kept("a-conversation-that-is-over"));
    expect(refused.status).toBe(409);
    expect(
      ((await refused.json()) as { error: { code: string } }).error.code,
    ).toBe("stale_conversation");
    expect((await load(epoch)).status).toBe(204);
    expect((await load("a-conversation-that-is-over")).status).toBe(204);
  });

  it("a refused ledger leaves the one already kept as it was", async () => {
    const epoch = await epochNow();
    await save(kept(epoch));
    expect((await save(kept("another-epoch", 99))).status).toBe(409);
    expect(await (await load(epoch)).json()).toEqual({ ledger: kept(epoch) });
  });

  it("goes with the conversation: a cleared transcript holds none, and takes none for the one that is over", async () => {
    const before = await epochNow();
    await save(kept(before));
    await send("DELETE");
    const after = await epochNow();
    expect(after).not.toBe(before);
    expect((await load(before)).status).toBe(204);
    expect((await load(after)).status).toBe(204);
    // The coach that was still writing about the old one is told so.
    expect((await save(kept(before))).status).toBe(409);
    expect((await save(kept(after))).status).toBe(204);
  });

  it("goes when a replay's notes are cleared, which clears its transcript too", async () => {
    await send("POST", { lines: [{ text: "attached", at: AT }] });
    const epoch = await epochNow();
    await save(kept(epoch));
    await send("DELETE", undefined, REPLAY_NOTES);
    expect((await load(epoch)).status).toBe(204);
    expect((await load(await epochNow())).status).toBe(204);
  });

  it("outlives lines being added to the same conversation", async () => {
    await send("POST", { lines: [{ text: "attached", at: AT }] });
    const epoch = await epochNow();
    await save(kept(epoch));
    await send("POST", { lines: [{ text: "more", at: AT }] });
    expect((await load(epoch)).status).toBe(200);
  });

  it.each<[string, unknown]>([
    ["no ledger", {}],
    ["a ledger that is null", { ledger: null }],
    ["a ledger that is a string", { ledger: CANARY }],
    ["a ledger that is a list", { ledger: [{ epoch: "e" }] }],
    ["a ledger with no epoch", { ledger: { version: 1, readTo: 2 } }],
    ["an epoch that is a number", { ledger: { epoch: 7, note: CANARY } }],
    ["an epoch that is null", { ledger: { epoch: null } }],
    ["a body that is null", null],
    ["a body that is a list", [{ ledger: { epoch: "e" } }]],
  ])(
    "refuses %s with 400 invalid_coach_ledger, quoting nothing, keeping nothing",
    async (_name, body) => {
      const epoch = await epochNow();
      const refused = await send("PUT", body, LEDGER);
      expect(refused.status).toBe(400);
      const text = await refused.text();
      expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe(
        "invalid_coach_ledger",
      );
      expect(text).not.toContain("canary");
      expect((await load(epoch)).status).toBe(204);
    },
  );

  it("refuses a body that is not JSON with 400, keeping nothing", async () => {
    const epoch = await epochNow();
    const refused = await app().request(LEDGER, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(refused.status).toBe(400);
    expect((await load(epoch)).status).toBe(204);
  });

  it("holds a ledger of 256 KB at most: a larger one is refused with 413 and not kept", async () => {
    const epoch = await epochNow();
    const large = await save({ ...kept(epoch), log: ["a".repeat(257 * 1024)] });
    expect(large.status).toBe(413);
    expect(
      ((await large.json()) as { error: { code: string } }).error.code,
    ).toBe("payload_too_large");
    expect((await load(epoch)).status).toBe(204);
    // One well under it is kept.
    expect(
      (await save({ ...kept(epoch), log: ["a".repeat(200 * 1024)] })).status,
    ).toBe(204);
  });

  it("is never on a reading of the transcript", async () => {
    const epoch = await epochNow();
    await save(kept(epoch));
    expect(await (await send("GET")).json()).not.toHaveProperty("ledger");
  });

  it.each(["GET", "PUT"])(
    "refuses %s with the fixed 401 when nobody is signed in, keeping and telling nothing",
    async (method) => {
      const epoch = await epochNow();
      if (method === "GET") await save(kept(epoch));
      const refused = await send(
        method,
        method === "PUT" ? { ledger: kept(epoch) } : undefined,
        method === "GET" ? `${LEDGER}?epoch=${epoch}` : LEDGER,
        {},
        false,
      );
      expect(refused.status).toBe(401);
      expect(await refused.text()).not.toContain("Sharding");
      if (method === "PUT") expect((await load(epoch)).status).toBe(204);
    },
  );
});
