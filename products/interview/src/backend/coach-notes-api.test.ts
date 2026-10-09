// The coach notes over HTTP: a coach posts a note, the window reads the list,
// and a revision older than the one held is refused with 409 and changes
// nothing. The store here is the real one over a temporary file, never the
// data directory.
import { rmSync } from "node:fs";
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
  held.directory = mkdtempSync(join(tmpdir(), "coach-notes-api-"));
  return {
    ...actual,
    coachNotes: actual.createCoachNotes(
      join(held.directory, "coach-notes.json"),
    ),
  };
});

import { createApi } from "./api";

const URL = "http://localhost/api/v1/coach-notes";
const app = () =>
  createApi({
    resolveScope: async () => null,
    verifySession: async () => true,
  });
const send = (method: string, body?: unknown) =>
  app().request(URL, {
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
});
