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
    expect(body).toEqual({ epoch: expect.any(String), cursor: 0, lines: [] });
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
    expect(added).toEqual({ epoch: expect.any(String), cursor: 2, lines: [] });
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
    expect(body).toEqual({ epoch: expect.any(String), cursor: 0, lines: [] });
    expect(body.epoch).not.toBe(before.epoch);
    expect(await reading()).toEqual(body);
    expect(
      (await read(await send("POST", { lines: [{ text: "after" }] }))).cursor,
    ).toBe(1);
  });

  it("clearing the coach's notes clears the transcript the coach read to write them", async () => {
    await send("POST", { lines: [{ text: "something that was said" }] });
    await send("POST", { title: "A note", key: "q-1" }, NOTES);
    const before = await reading();
    expect(before.lines).toHaveLength(1);

    const cleared = await send("DELETE", undefined, NOTES);

    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { notes: unknown[] }).notes).toEqual([]);
    const after = await reading();
    expect(after).toEqual({ epoch: expect.any(String), cursor: 0, lines: [] });
    expect(after.epoch).not.toBe(before.epoch);
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
