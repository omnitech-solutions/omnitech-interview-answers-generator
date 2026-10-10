import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));

const originalArgv = process.argv;
const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.resetModules();
  vi.mocked(readFileSync).mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("INTERVIEW_API_URL", "http://127.0.0.1:3000/");
  vi.stubEnv("INTERVIEW_API_TOKEN", randomUUID());
});

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("coach API", () => {
  it("uses the environment token, trims the address slash and preserves raw note JSON", async () => {
    const { coachApi } = await import("./coach-api.mjs");
    const raw = '{ "title": "Note", "points": [] }';
    fetchMock.mockResolvedValue(reply({ notes: [], revision: 1 }));
    await expect(coachApi("POST", "/api/v1/coach-notes", raw)).resolves.toEqual(
      { notes: [], revision: 1 },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/v1/coach-notes",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env["INTERVIEW_API_TOKEN"]}`,
          "content-type": "application/json",
        },
        body: raw,
      },
    );
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("uses the trimmed local token when no environment token is given", async () => {
    vi.stubEnv("INTERVIEW_API_TOKEN", "");
    const token = randomUUID();
    vi.mocked(readFileSync).mockReturnValue(` ${token}\n`);
    fetchMock.mockResolvedValue(reply({ text: "" }));
    const { coachApi } = await import("./coach-api.mjs");
    await coachApi("GET", "/api/v1/coach-plan");
    expect(readFileSync).toHaveBeenCalledWith(expect.any(URL), "utf8");
    expect(String(vi.mocked(readFileSync).mock.calls[0]?.[0])).toMatch(
      /\.dev-local\/api-token$/,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });
  });

  it("preserves the empty-token fallback and lets the server refuse it", async () => {
    vi.stubEnv("INTERVIEW_API_TOKEN", "");
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("not found");
    });
    fetchMock.mockResolvedValue(
      reply({ error: { code: "unauthorized" } }, 401),
    );
    const { coachApi } = await import("./coach-api.mjs");
    await expect(coachApi("GET", "/api/v1/coach-plan")).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
      message: "Studio answered 401: the plan was not accepted",
    });
    expect(fetchMock.mock.calls[0]?.[1].headers.authorization).toBe("Bearer ");
  });

  it("keeps the server refusal message and note details while carrying status and code", async () => {
    fetchMock.mockResolvedValue(
      reply(
        {
          error: {
            code: "invalid",
            message: "Invalid note",
            details: ["title", "points"],
          },
        },
        400,
      ),
    );
    const { coachApi } = await import("./coach-api.mjs");
    await expect(
      coachApi("POST", "/api/v1/coach-notes", {}),
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid",
      message: "Studio answered 400: Invalid note (title, points)",
    });
  });

  it("keeps the transcript fallback for a non-JSON refusal", async () => {
    fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));
    const { coachApi } = await import("./coach-api.mjs");
    await expect(
      coachApi("POST", "/api/v1/coach-transcript", { lines: [] }),
    ).rejects.toMatchObject({
      status: 503,
      message: "Studio answered 503: the transcript was not accepted",
    });
  });
});

describe("coach script contracts", () => {
  it("keeps the note script's success output", async () => {
    process.argv = [
      process.execPath,
      "coach-note.mjs",
      '{ "title": "Note", "points": [] }',
    ];
    fetchMock.mockResolvedValue(
      reply({ notes: [{ title: "Note" }], revision: 7 }),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await import("./coach-note.mjs");
    expect(log).toHaveBeenCalledWith("1 notes (revision 7)");
    expect(fetchMock.mock.calls[0]?.[1].body).toBe(process.argv[2]);
  });

  it("keeps the plan show output and sends no request body", async () => {
    process.argv = [process.execPath, "coach-plan.mjs", "--show"];
    fetchMock.mockResolvedValue(reply({ text: "" }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await import("./coach-plan.mjs");
    expect(log).toHaveBeenCalledWith("(no plan)");
    expect(fetchMock.mock.calls[0]?.[1].method).toBe("GET");
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("keeps transcript panel roles, first repeated value, and all-at-once output", async () => {
    process.argv = [
      process.execPath,
      "coach-transcript.mjs",
      "--interviewer",
      "Priya,Tom",
      "call.txt",
      "--candidate",
      "Me",
      "--candidate",
      "Other",
      "--all",
    ];
    vi.mocked(readFileSync).mockReturnValue(
      "00:00:01 --> 00:00:01\nPriya: First question\n00:00:02 --> 00:00:02\nMe: Answer\n",
    );
    fetchMock.mockResolvedValue(reply({}));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await import("./coach-transcript.mjs");
    const { lines } = JSON.parse(fetchMock.mock.calls[0]?.[1].body);
    expect(lines).toMatchObject([
      { speaker: "interviewer", name: "Priya", text: "First question" },
      { speaker: "candidate", text: "Answer" },
    ]);
    expect(log).toHaveBeenCalledWith("2 lines given to the coach.");
  });

  it.each([
    ["note", () => import("./coach-note.mjs")],
    ["plan", () => import("./coach-plan.mjs")],
    ["transcript", () => import("./coach-transcript.mjs")],
  ])(
    "refuses an unknown %s flag before fetching or reading a file",
    async (_name, load) => {
      process.argv = [process.execPath, "coach-script.mjs", "--cleer"];
      // The script says the mistake in one line and ends with status 2.
      const said = vi.spyOn(console, "error").mockImplementation(() => {});
      const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });
      await expect(load()).rejects.toThrow("exit");
      expect(exit).toHaveBeenCalledWith(2);
      expect(said.mock.calls[0]?.[0]).toContain("Unknown option '--cleer'");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(readFileSync).not.toHaveBeenCalled();
    },
  );
});
