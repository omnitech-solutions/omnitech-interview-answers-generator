// The coach notes over HTTP: a coach posts a note, the window reads the list,
// and a revision older than the one held is refused with 409 and changes
// nothing. The store here is the real one over a temporary file, never the
// data directory.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const held = vi.hoisted(() => ({
  directory: "",
  // The pen the routes use: the real one, made anew for each test over a
  // clock the test holds.
  nowMs: 0,
  writers: undefined as
    | ReturnType<typeof import("./coach-writer").createCoachWriters>
    | undefined,
  renew: () => {},
}));

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
  held.directory = mkdtempSync(join(tmpdir(), "coach-notes-api-"));
  return {
    ...actual,
    coachNotes: actual.createCoachNotes(
      join(held.directory, "coach-notes.json"),
    ),
  };
});
vi.mock("./coach-writer", async () => {
  const actual =
    await vi.importActual<typeof import("./coach-writer")>("./coach-writer");
  type Writers = ReturnType<typeof actual.createCoachWriters>;
  held.renew = () => {
    held.nowMs = Date.parse("2026-10-09T09:00:00.000Z");
    held.writers = actual.createCoachWriters(() => held.nowMs);
  };
  held.renew();
  const pen = () => held.writers as Writers;
  return {
    ...actual,
    coachWriters: {
      claim: (...args: Parameters<Writers["claim"]>) => pen().claim(...args),
      accepts: (...args: Parameters<Writers["accepts"]>) =>
        pen().accepts(...args),
      release: (...args: Parameters<Writers["release"]>) =>
        pen().release(...args),
      current: () => pen().current(),
    } satisfies Writers,
  };
});

import { createApi } from "./api";

const URL = "http://localhost/api/v1/coach-notes";
const app = () =>
  createApi({
    resolveScope: async () => null,
    verifySession: async () => true,
  });
const REPLAY = `${URL}?space=replay`;
const send = (method: string, body?: unknown, url = URL) =>
  app().request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
type Listed = {
  revision: number;
  notes: { id: string; title: string; revision: number; status: string }[];
};
const listed = async (response: Response) => (await response.json()) as Listed;
const say = (text: string) => ({
  kind: "say",
  lines: [{ segments: [{ text }] }],
});

describe("the coach notes API", () => {
  const originalToken = process.env["INTERVIEW_API_TOKEN"];
  beforeEach(async () => {
    delete process.env["INTERVIEW_API_TOKEN"];
    await send("DELETE");
    await send("DELETE", undefined, REPLAY);
  });
  afterEach(() => {
    if (originalToken === undefined) delete process.env["INTERVIEW_API_TOKEN"];
    else process.env["INTERVIEW_API_TOKEN"] = originalToken;
  });
  afterAll(() => rmSync(held.directory, { recursive: true, force: true }));

  it("takes a structured note with 201 and lists it, each piece given its default role", async () => {
    const posted = await send("POST", {
      title: "Consistency",
      kind: "technical",
      key: "q-1",
      sections: [say("Start from the outbox")],
    });
    expect(posted.status).toBe(201);
    const body = await listed(posted);
    expect(body.notes).toEqual([
      expect.objectContaining({
        title: "Consistency",
        kind: "technical",
        key: "q-1",
        revision: 1,
        status: "ready",
        sections: [
          {
            kind: "say",
            lines: [
              { segments: [{ text: "Start from the outbox", role: "spoken" }] },
            ],
          },
        ],
      }),
    ]);
    const read = await send("GET");
    expect(read.status).toBe(200);
    expect(await listed(read)).toEqual(body);
  });

  it.each([
    ["an older revision", 2, { revision: 1 }],
    ["the same revision again", 2, { revision: 2 }],
    [
      "an older revision still being prepared",
      2,
      { revision: 1, status: "pending" },
    ],
  ])(
    "refuses %s of a note it holds with 409 stale_coach_note, and changes nothing",
    async (_name, heldRevision, late) => {
      await send("POST", {
        title: "Consistency",
        key: "q-1",
        revision: heldRevision,
        sections: [say("The newer answer")],
      });
      const before = await listed(await send("GET"));
      const refused = await send("POST", {
        title: "Private words of a late answer",
        key: "q-1",
        sections: [say("The slow, older answer")],
        ...late,
      });
      expect(refused.status).toBe(409);
      const body = (await refused.json()) as {
        error: { code: string; message: string; requestId: string };
      };
      expect(body.error).toEqual({
        code: "stale_coach_note",
        message: "A newer revision of this note is already held.",
        requestId: expect.any(String),
      });
      // The refusal quotes nothing of the note.
      expect(JSON.stringify(body)).not.toContain("late answer");
      expect(await listed(await send("GET"))).toEqual(before);
    },
  );

  it("a newer revision takes the note's place with 201: one note, the same id", async () => {
    const first = await listed(
      await send("POST", { title: "Consistency", key: "q-1" }),
    );
    const pending = await send("POST", {
      title: "Consistency",
      key: "q-1",
      revision: 2,
      status: "pending",
    });
    expect(pending.status).toBe(201);
    expect((await listed(pending)).notes).toEqual([
      expect.objectContaining({ revision: 2, status: "pending" }),
    ]);
    const ready = await send("POST", {
      title: "Consistency, revised",
      key: "q-1",
      revision: 2,
      sections: [say("Two")],
    });
    expect(ready.status).toBe(201);
    const after = await listed(ready);
    expect(after.notes).toEqual([
      expect.objectContaining({
        id: first.notes[0]?.id,
        title: "Consistency, revised",
        revision: 2,
        status: "ready",
      }),
    ]);
    expect(after.revision).toBe(first.revision + 2);
  });

  it("the same content with no key is another note, never stale", async () => {
    await send("POST", { title: "Consistency" });
    const again = await send("POST", { title: "Consistency" });
    expect(again.status).toBe(201);
    expect((await listed(again)).notes).toHaveLength(2);
  });

  it.each([
    ["an earlier kind", { title: "T", kind: "steer" }, ["kind"]],
    [
      "a section of labelled points",
      { title: "T", sections: [{ label: "Say", points: ["Lead"] }] },
      ["sections.0.kind", "sections.0.lines", "sections.0"],
    ],
    [
      "a line longer than a sentence",
      {
        title: "T",
        sections: [
          {
            kind: "say",
            lines: [
              {
                segments: [
                  { text: "a".repeat(120) },
                  { text: "b".repeat(121) },
                ],
              },
            ],
          },
        ],
      },
      ["sections.0.lines.0"],
    ],
    [
      "a revision below 1",
      { title: "T", key: "q-1", revision: 0 },
      ["revision"],
    ],
    ["a steer", { title: "T", steer: { issue: "Reads only" } }, [""]],
  ])(
    "refuses %s with 400 and the paths at fault, never the note's text",
    async (_name, note, paths) => {
      const refused = await send("POST", note);
      expect(refused.status).toBe(400);
      const body = (await refused.json()) as {
        error: { code: string; issues: string[] };
      };
      expect(body.error.code).toBe("invalid_coach_note");
      expect(body.error.issues).toEqual(paths);
      expect((await listed(await send("GET"))).notes).toEqual([]);
    },
  );

  it("answers a reader that names the revision it already shows with 204 and no body; any other revision is answered the notes", async () => {
    const posted = await listed(
      await send("POST", {
        title: "Consistency",
        key: "q-1",
        sections: [say("Start from the outbox")],
      }),
    );
    const at = (revision: string) =>
      app().request(`${URL}?revision=${revision}`);
    const current = await at(String(posted.revision));
    expect(current.status).toBe(204);
    expect(await current.text()).toBe("");
    // A stale revision, one ahead, and one that is no number: the notes.
    for (const revision of [
      String(posted.revision - 1),
      String(posted.revision + 1),
      "",
      "latest",
      `${posted.revision}.0`,
    ]) {
      const stale = await at(revision);
      expect(stale.status).toBe(200);
      expect(await listed(stale)).toEqual(posted);
    }
    // Once a note changes, the revision that was current is stale.
    const next = await listed(
      await send("POST", {
        title: "Consistency",
        key: "q-1",
        revision: 2,
        sections: [say("Then the idempotent consumer")],
      }),
    );
    expect(next.revision).toBeGreaterThan(posted.revision);
    const stale = await at(String(posted.revision));
    expect(stale.status).toBe(200);
    expect(await listed(stale)).toEqual(next);
    expect((await at(String(next.revision))).status).toBe(204);
  });

  it("clears every note", async () => {
    await send("POST", { title: "Consistency", key: "q-1", revision: 4 });
    const cleared = await send("DELETE");
    expect(cleared.status).toBe(200);
    expect((await listed(cleared)).notes).toEqual([]);
    // A cleared key is free again: its first revision is not stale.
    expect((await send("POST", { title: "Again", key: "q-1" })).status).toBe(
      201,
    );
  });

  describe("the notes of a replay (?space=replay)", () => {
    const file = () => join(held.directory, "coach-notes.json");
    const onDisk = () =>
      existsSync(file()) ? readFileSync(file(), "utf8") : null;

    it("are taken and listed apart: the person's own are neither shown nor changed", async () => {
      await send("POST", {
        title: "The person's own",
        key: "q-1",
        sections: [say("Start from the outbox")],
      });
      const own = await listed(await send("GET"));
      const kept = onDisk();
      expect(kept).toContain("The person's own");

      const posted = await send(
        "POST",
        { title: "Of the replay", key: "q-1", sections: [say("A trial")] },
        REPLAY,
      );
      expect(posted.status).toBe(201);
      expect((await listed(posted)).notes.map((note) => note.title)).toEqual([
        "Of the replay",
      ]);
      expect(
        (await listed(await send("GET", undefined, REPLAY))).notes.map(
          (note) => note.title,
        ),
      ).toEqual(["Of the replay"]);
      // The person's own: the same notes, the same revision, the same file.
      expect(await listed(await send("GET"))).toEqual(own);
      expect(onDisk()).toBe(kept);
      expect(kept).not.toContain("Of the replay");
    });

    it("the person's own notes never reach the replay's", async () => {
      await send("POST", { title: "The person's own", key: "q-1" });
      expect(
        (await listed(await send("GET", undefined, REPLAY))).notes,
      ).toEqual([]);
    });

    it("are cleared alone: the person's own stay, on show and on disk", async () => {
      await send("POST", { title: "The person's own", key: "q-1" });
      await send("POST", { title: "Of the replay" }, REPLAY);
      const own = await listed(await send("GET"));
      const kept = onDisk();
      const cleared = await send("DELETE", undefined, REPLAY);
      expect(cleared.status).toBe(200);
      expect((await listed(cleared)).notes).toEqual([]);
      expect(
        (await listed(await send("GET", undefined, REPLAY))).notes,
      ).toEqual([]);
      expect(await listed(await send("GET"))).toEqual(own);
      expect(onDisk()).toBe(kept);
    });

    it("clearing the person's own leaves the replay's", async () => {
      await send("POST", { title: "Of the replay" }, REPLAY);
      await send("DELETE");
      expect(
        (await listed(await send("GET", undefined, REPLAY))).notes.map(
          (note) => note.title,
        ),
      ).toEqual(["Of the replay"]);
    });

    it("refuse an older revision with 409 by the replay's own keys, and an invalid note with 400", async () => {
      await send("POST", { title: "Own", key: "q-1", revision: 5 });
      // The same key at a lower revision is new to the replay.
      expect(
        (
          await send(
            "POST",
            { title: "Replay", key: "q-1", revision: 2 },
            REPLAY,
          )
        ).status,
      ).toBe(201);
      const stale = await send(
        "POST",
        { title: "Replay", key: "q-1", revision: 1 },
        REPLAY,
      );
      expect(stale.status).toBe(409);
      expect(
        ((await stale.json()) as { error: { code: string } }).error.code,
      ).toBe("stale_coach_note");
      expect((await send("POST", { title: "" }, REPLAY)).status).toBe(400);
    });

    it("answer 204 to a reader that names the replay's revision, which is not the person's", async () => {
      const replay = await listed(
        await send("POST", { title: "Of the replay" }, REPLAY),
      );
      const current = await app().request(
        `${REPLAY}&revision=${replay.revision}`,
      );
      expect(current.status).toBe(204);
      const own = await listed(await send("GET"));
      expect(own.notes).toEqual([]);
    });

    it.each(["live", "", "REPLAY", "other"])(
      "any other space (%j) is the person's own",
      async (space) => {
        await send("POST", { title: "Own" }, `${URL}?space=${space}`);
        expect(
          (await listed(await send("GET"))).notes.map((note) => note.title),
        ).toEqual(["Own"]);
        expect(
          (await listed(await send("GET", undefined, REPLAY))).notes,
        ).toEqual([]);
      },
    );
  });
});

describe("who may write the coach's notes (the pen, over HTTP)", () => {
  const WRITER = "http://localhost/api/v1/coach-writer";
  const TRANSCRIPT = "http://localhost/api/v1/coach-transcript";
  const CANARY = "canary words nobody should see quoted";
  const originalToken = process.env["INTERVIEW_API_TOKEN"];
  beforeEach(async () => {
    delete process.env["INTERVIEW_API_TOKEN"];
    held.renew();
    await send("DELETE");
    await send("DELETE", undefined, REPLAY);
    await send("DELETE", undefined, TRANSCRIPT);
  });
  afterEach(() => {
    if (originalToken === undefined) delete process.env["INTERVIEW_API_TOKEN"];
    else process.env["INTERVIEW_API_TOKEN"] = originalToken;
  });

  type Claim = { id: string; epoch: number };
  const claim = (body: unknown) => send("POST", body, WRITER);
  const claimed = async (body: unknown) =>
    (await (await claim(body)).json()) as Claim;
  const release = (id?: string) =>
    send(
      "DELETE",
      undefined,
      id === undefined ? WRITER : `${WRITER}?id=${encodeURIComponent(id)}`,
    );
  const code = async (response: Response) =>
    ((await response.json()) as { error: { code: string } }).error.code;
  const epochNow = async () =>
    (
      (await (await send("GET", undefined, TRANSCRIPT)).json()) as {
        epoch: string;
      }
    ).epoch;
  const note = (
    body: unknown,
    headers: Record<string, string> = {},
    url = URL,
  ) =>
    app().request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const titles = async (url = URL) =>
    (await listed(await send("GET", undefined, url))).notes.map(
      (each) => each.title,
    );
  const signed = (held: Claim) => ({
    "x-coach-writer": `${held.id}:${held.epoch}`,
  });

  describe("claiming it", () => {
    it("gives the pen to the first coach that asks: 200 with its id and an epoch, and nothing else", async () => {
      const given = await claim({ id: "worker-coach" });
      expect(given.status).toBe(200);
      expect(await given.json()).toEqual({
        id: "worker-coach",
        epoch: expect.any(Number),
      });
    });

    it("a renewal is answered the same claim", async () => {
      const first = await claimed({ id: "worker-coach" });
      held.nowMs += 5_000;
      const again = await claim({ id: "worker-coach" });
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(first);
    });

    it("refuses another coach's plain claim with 409 coach_held while the pen is held", async () => {
      const first = await claimed({ id: "worker-coach" });
      for (const body of [
        { id: "desktop-agent" },
        { id: "desktop-agent", takeover: false },
        // Only `true` is a takeover.
        { id: "desktop-agent", takeover: "true" },
        { id: "desktop-agent", takeover: 1 },
      ]) {
        const refused = await claim(body);
        expect(refused.status).toBe(409);
        expect(await code(refused)).toBe("coach_held");
      }
      // The holder still holds it.
      expect(await claimed({ id: "worker-coach" })).toEqual(first);
    });

    it("the refusal names neither coach", async () => {
      await claim({ id: "worker-coach" });
      const text = await (await claim({ id: "desktop-agent" })).text();
      expect(text).not.toContain("worker-coach");
      expect(text).not.toContain("desktop-agent");
    });

    it("gives it to a takeover under a higher epoch, and the coach it was taken from is then refused", async () => {
      const first = await claimed({ id: "worker-coach" });
      const taken = await claim({ id: "desktop-agent", takeover: true });
      expect(taken.status).toBe(200);
      const now = (await taken.json()) as Claim;
      expect(now.id).toBe("desktop-agent");
      expect(now.epoch).toBeGreaterThan(first.epoch);
      expect((await claim({ id: "worker-coach" })).status).toBe(409);
    });

    it("a claim lapses after 15 s unless renewed: another coach's plain claim is then given the pen", async () => {
      await claim({ id: "worker-coach" });
      held.nowMs += 14_999;
      expect((await claim({ id: "desktop-agent" })).status).toBe(409);
      held.nowMs += 1;
      expect((await claim({ id: "desktop-agent" })).status).toBe(200);
    });

    it("leaseSeconds is how long the claim stands, in seconds", async () => {
      await claim({ id: "desktop-agent", takeover: true, leaseSeconds: 180 });
      held.nowMs += 179_999;
      expect((await claim({ id: "worker-coach" })).status).toBe(409);
      held.nowMs += 1;
      expect((await claim({ id: "worker-coach" })).status).toBe(200);
    });

    it("leaseSeconds is 5 minutes at most, and a second at least", async () => {
      await claim({ id: "desktop-agent", leaseSeconds: 86_400 });
      held.nowMs += 5 * 60_000 - 1;
      expect((await claim({ id: "worker-coach" })).status).toBe(409);
      held.nowMs += 1;
      expect((await claim({ id: "worker-coach" })).status).toBe(200);
      held.renew();
      await claim({ id: "desktop-agent", leaseSeconds: 0 });
      held.nowMs += 999;
      expect((await claim({ id: "worker-coach" })).status).toBe(409);
      held.nowMs += 1;
      expect((await claim({ id: "worker-coach" })).status).toBe(200);
    });

    it("a leaseSeconds that is not a number is the default 15 s", async () => {
      await claim({ id: "desktop-agent", leaseSeconds: "180" });
      held.nowMs += 15_000;
      expect((await claim({ id: "worker-coach" })).status).toBe(200);
    });

    it.each<[string, unknown]>([
      ["no id", {}],
      ["an empty id", { id: "" }],
      ["an id that is a number", { id: 48213 }],
      ["an id with a space", { id: "worker coach" }],
      ["an id with a colon", { id: "worker:1" }],
      ["an id with a slash", { id: "worker/coach" }],
      ["an id of sixty-five characters", { id: "a".repeat(65) }],
      ["an id that quotes something", { id: CANARY, takeover: true }],
      ["a body that is null", null],
      ["a body that is a list", ["worker-coach"]],
    ])(
      "refuses %s with 400 invalid_coach_writer, quoting nothing, and the pen stays free",
      async (_name, body) => {
        const refused = await claim(body);
        expect(refused.status).toBe(400);
        const text = await refused.text();
        expect(
          (JSON.parse(text) as { error: { code: string } }).error.code,
        ).toBe("invalid_coach_writer");
        expect(text).not.toContain("canary");
        expect((await claim({ id: "worker-coach" })).status).toBe(200);
      },
    );

    it("takes an id of sixty-four letters, digits, dots, dashes and underscores", async () => {
      const id = `coach-48213.worker_${"a".repeat(45)}`;
      expect(id).toHaveLength(64);
      expect(await claimed({ id })).toMatchObject({ id });
    });

    it("refuses a body that is not JSON with 400, and the pen stays free", async () => {
      const refused = await app().request(WRITER, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      });
      expect(refused.status).toBe(400);
      expect(await code(refused)).toBe("invalid_request");
      expect((await claim({ id: "worker-coach" })).status).toBe(200);
    });
  });

  describe("giving it up", () => {
    it("answers 204 with no body, and another coach's plain claim is then given the pen", async () => {
      const first = await claimed({ id: "worker-coach" });
      const freed = await release("worker-coach");
      expect(freed.status).toBe(204);
      expect(await freed.text()).toBe("");
      const next = await claimed({ id: "desktop-agent" });
      expect(next.epoch).toBeGreaterThan(first.epoch);
    });

    it.each(["desktop-agent", "", undefined])(
      "answers 204 to a coach that does not hold it (%j), and the holder still holds it",
      async (other) => {
        await claim({ id: "worker-coach" });
        expect((await release(other)).status).toBe(204);
        expect((await claim({ id: "desktop-agent" })).status).toBe(409);
      },
    );
  });

  describe("a note that names its writer", () => {
    it("is taken from the coach that holds the pen", async () => {
      const mine = await claimed({ id: "worker-coach" });
      const posted = await note({ title: "From the holder" }, signed(mine));
      expect(posted.status).toBe(201);
      expect(await titles()).toEqual(["From the holder"]);
    });

    it("is refused 409 stale_writer from a coach that was taken over from, and nothing is put on show", async () => {
      const first = await claimed({ id: "worker-coach" });
      const taken = await claimed({ id: "desktop-agent", takeover: true });
      const refused = await note({ title: CANARY }, signed(first));
      expect(refused.status).toBe(409);
      const text = await refused.text();
      expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe(
        "stale_writer",
      );
      expect(text).not.toContain("canary");
      expect(await titles()).toEqual([]);
      // The coach that took over writes.
      expect(
        (await note({ title: "From the agent" }, signed(taken))).status,
      ).toBe(201);
      expect(await titles()).toEqual(["From the agent"]);
    });

    it("a refused revision leaves the note already on show as it was", async () => {
      const first = await claimed({ id: "worker-coach" });
      await note({ title: "First", key: "q-1", revision: 1 }, signed(first));
      await claim({ id: "desktop-agent", takeover: true });
      const refused = await note(
        { title: "Second", key: "q-1", revision: 2 },
        signed(first),
      );
      expect(await code(refused)).toBe("stale_writer");
      expect(await titles()).toEqual(["First"]);
    });

    it.each<[string, (held: Claim) => string]>([
      ["another epoch under its own name", (h) => `${h.id}:${h.epoch + 1}`],
      ["its epoch under another name", (h) => `desktop-agent:${h.epoch}`],
      ["a name alone", (h) => h.id],
      ["an epoch that is not a number", (h) => `${h.id}:first`],
      ["nothing at all", () => ""],
      ["something that is no claim", () => "let me in"],
    ])(
      "is refused 409 stale_writer when the header is %s",
      async (_name, header) => {
        const mine = await claimed({ id: "worker-coach" });
        const refused = await note(
          { title: "Not taken" },
          { "x-coach-writer": header(mine) },
        );
        expect(refused.status).toBe(409);
        expect(await code(refused)).toBe("stale_writer");
        expect(await titles()).toEqual([]);
      },
    );

    it("is taken from the last holder once the pen is free (its lease lapsed, or it gave the pen up), until another coach holds it", async () => {
      const mine = await claimed({ id: "worker-coach" });
      held.nowMs += 15_000;
      expect(
        (await note({ title: "After lapsing" }, signed(mine))).status,
      ).toBe(201);
      const again = await claimed({ id: "worker-coach" });
      await release("worker-coach");
      expect(
        (await note({ title: "After release" }, signed(again))).status,
      ).toBe(201);
      await claim({ id: "desktop-agent" });
      expect(await code(await note({ title: "Too late" }, signed(again)))).toBe(
        "stale_writer",
      );
      // Newest first, as the window lists them.
      expect(await titles()).toEqual(["After release", "After lapsing"]);
    });

    it("is checked the same way for a replay's notes", async () => {
      const first = await claimed({ id: "worker-coach" });
      const taken = await claimed({ id: "desktop-agent", takeover: true });
      const refused = await note({ title: "Stale" }, signed(first), REPLAY);
      expect(refused.status).toBe(409);
      expect(await code(refused)).toBe("stale_writer");
      expect(
        (await note({ title: "Current" }, signed(taken), REPLAY)).status,
      ).toBe(201);
      expect(await titles(REPLAY)).toEqual(["Current"]);
      expect(await titles()).toEqual([]);
    });

    it("an invalid note is still answered 400 first, whoever wrote it", async () => {
      const first = await claimed({ id: "worker-coach" });
      await claim({ id: "desktop-agent", takeover: true });
      const refused = await note({ kind: "steer" }, signed(first));
      expect(refused.status).toBe(400);
      expect(await code(refused)).toBe("invalid_coach_note");
    });
  });

  describe("a note that names its conversation", () => {
    it("is taken when it is the transcript's current epoch", async () => {
      const posted = await note(
        { title: "About this call" },
        { "x-coach-conversation": await epochNow() },
      );
      expect(posted.status).toBe(201);
      expect(await titles()).toEqual(["About this call"]);
    });

    it("is refused 409 stale_conversation once the transcript was cleared, and nothing is put on show", async () => {
      const before = await epochNow();
      await send("DELETE", undefined, TRANSCRIPT);
      const refused = await note(
        { title: CANARY },
        { "x-coach-conversation": before },
      );
      expect(refused.status).toBe(409);
      const text = await refused.text();
      expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe(
        "stale_conversation",
      );
      expect(text).not.toContain("canary");
      expect(await titles()).toEqual([]);
      // The same note written from the conversation in hand is taken.
      expect(
        (
          await note(
            { title: "About the new call" },
            { "x-coach-conversation": await epochNow() },
          )
        ).status,
      ).toBe(201);
    });

    it.each(["", "another-epoch", "replay"])(
      "is refused 409 stale_conversation for an epoch that is not the transcript's (%j)",
      async (epoch) => {
        const refused = await note(
          { title: "Not taken" },
          { "x-coach-conversation": epoch },
        );
        expect(refused.status).toBe(409);
        expect(await code(refused)).toBe("stale_conversation");
        expect(await titles()).toEqual([]);
      },
    );

    it("is checked the same way for a replay's notes", async () => {
      await send("POST", { lines: [{ text: "attached" }] }, TRANSCRIPT);
      const epoch = await epochNow();
      expect(
        (
          await note(
            { title: "Of the replay" },
            { "x-coach-conversation": epoch },
            REPLAY,
          )
        ).status,
      ).toBe(201);
      await send("DELETE", undefined, TRANSCRIPT);
      expect(
        await code(
          await note(
            { title: "Too late" },
            { "x-coach-conversation": epoch },
            REPLAY,
          ),
        ),
      ).toBe("stale_conversation");
      expect(await titles(REPLAY)).toEqual(["Of the replay"]);
    });
  });

  describe("a note that names both, as the worker's coach does", () => {
    it("is taken when both are current", async () => {
      const mine = await claimed({ id: "worker-coach" });
      const posted = await note(
        { title: "Both current" },
        { ...signed(mine), "x-coach-conversation": await epochNow() },
      );
      expect(posted.status).toBe(201);
    });

    it("is refused as a stale writer first when neither is current", async () => {
      const first = await claimed({ id: "worker-coach" });
      const before = await epochNow();
      await claim({ id: "desktop-agent", takeover: true });
      await send("DELETE", undefined, TRANSCRIPT);
      const refused = await note(
        { title: "Neither" },
        { ...signed(first), "x-coach-conversation": before },
      );
      expect(refused.status).toBe(409);
      expect(await code(refused)).toBe("stale_writer");
    });

    it("is refused for a conversation that is over even from the coach that holds the pen", async () => {
      const mine = await claimed({ id: "worker-coach" });
      const before = await epochNow();
      await send("DELETE", undefined, TRANSCRIPT);
      const refused = await note(
        { title: "Old call" },
        { ...signed(mine), "x-coach-conversation": before },
      );
      expect(await code(refused)).toBe("stale_conversation");
      expect(await titles()).toEqual([]);
    });
  });

  describe("a note that names neither (a person, a script)", () => {
    it("is always taken: while a coach holds the pen, after a takeover, and after the transcript was cleared", async () => {
      await claim({ id: "worker-coach" });
      expect((await note({ title: "While held" })).status).toBe(201);
      await claim({ id: "desktop-agent", takeover: true });
      expect((await note({ title: "After a takeover" })).status).toBe(201);
      await send("DELETE", undefined, TRANSCRIPT);
      expect((await note({ title: "After a clear" })).status).toBe(201);
      expect((await note({ title: "A replay's" }, {}, REPLAY)).status).toBe(
        201,
      );
      expect(await titles()).toEqual([
        "After a clear",
        "After a takeover",
        "While held",
      ]);
    });

    it("an older revision of it is still refused as a stale note, by its own code", async () => {
      await note({ title: "Newer", key: "q-1", revision: 2 });
      const refused = await note({ title: "Older", key: "q-1", revision: 1 });
      expect(refused.status).toBe(409);
      expect(await code(refused)).not.toMatch(
        /stale_writer|stale_conversation/,
      );
    });
  });

  describe("access", () => {
    const anonymous = () =>
      createApi({
        resolveScope: async () => null,
        verifySession: async () => false,
      });

    it("nobody claims the pen, or makes its holder give it up, without being signed in", async () => {
      const refused = await anonymous().request(WRITER, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "desktop-agent", takeover: true }),
      });
      expect(refused.status).toBe(401);
      expect(await code(refused)).toBe("unauthorized");
      await claim({ id: "worker-coach" });
      expect(
        (
          await anonymous().request(`${WRITER}?id=worker-coach`, {
            method: "DELETE",
          })
        ).status,
      ).toBe(401);
      // The holder still holds it.
      expect((await claim({ id: "desktop-agent" })).status).toBe(409);
    });

    it("takes the configured API token as a bearer, as the coach in the worker sends it", async () => {
      process.env["INTERVIEW_API_TOKEN"] = "coach-pen-test-token";
      const given = await anonymous().request(WRITER, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer coach-pen-test-token",
        },
        body: JSON.stringify({ id: "worker-coach" }),
      });
      expect(given.status).toBe(200);
      expect(
        (
          await anonymous().request(WRITER, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer another-token",
            },
            body: JSON.stringify({ id: "desktop-agent", takeover: true }),
          })
        ).status,
      ).toBe(401);
    });
  });
});

describe("the coach notes API: who asked", () => {
  const originalToken = process.env["INTERVIEW_API_TOKEN"];
  beforeEach(async () => {
    delete process.env["INTERVIEW_API_TOKEN"];
    await send("DELETE");
    await send("DELETE", undefined, REPLAY);
  });
  afterEach(() => {
    if (originalToken === undefined) delete process.env["INTERVIEW_API_TOKEN"];
    else process.env["INTERVIEW_API_TOKEN"] = originalToken;
  });
  type Asked = { notes: { title: string; from?: string }[] };

  it("takes a note that says who asked and lists it with the name, in either space", async () => {
    for (const url of [URL, REPLAY]) {
      const posted = await send(
        "POST",
        {
          title: "Charged once",
          from: " Marcus ",
          sections: [say("I key the ledger.")],
        },
        url,
      );
      expect(posted.status).toBe(201);
      const body = (await (await send("GET", undefined, url)).json()) as Asked;
      expect(body.notes.map((note) => note.from)).toEqual(["Marcus"]);
    }
  });

  it("lists a note that named nobody without the field", async () => {
    await send("POST", { title: "Sharding", sections: [say("By region.")] });
    const body = (await (await send("GET")).json()) as Asked;
    expect(body.notes).toHaveLength(1);
    expect("from" in (body.notes[0] ?? {})).toBe(false);
  });

  it.each([
    ["a sentence with a colon", "Marcus: the staff engineer"],
    ["two lines", "Marcus\nTom"],
    ["nothing", ""],
    ["a list", ["Marcus"]],
  ])("refuses %s as who asked, and keeps no note", async (_what, from) => {
    const response = await send("POST", {
      title: "Charged once",
      from,
      sections: [say("I key the ledger.")],
    });
    expect(response.status).toBe(400);
    expect(((await (await send("GET")).json()) as Asked).notes).toEqual([]);
  });
});
