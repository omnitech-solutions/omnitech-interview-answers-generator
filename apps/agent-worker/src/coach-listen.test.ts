// The listen command, run as an agent runs it by hand: as its own process,
// against a tiny local server standing in for the Studio's coach transcript,
// coach plan and the pen (who may write the notes). The command is a script (top-level await, `process.exit`),
// so it is never imported here. Every line said is invented, and the token is
// a made-up one that only this stand-in knows.
//
// The command keeps where it read to in `.dev-local/coach-listen.json` in the
// repository. Whatever that file held before the suite is put back after it
// (or the file is removed when there was none), so a run leaves no trace.
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const WORKER = fileURLToPath(new URL("..", import.meta.url));
const LOCAL = fileURLToPath(new URL("../../../.dev-local", import.meta.url));
const STATE = fileURLToPath(
  new URL("../../../.dev-local/coach-listen.json", import.meta.url),
);
const TOKEN = "coach-listen-test-token";
const EPOCH = "1a2b3c4d-0000-4000-8000-00000000000e";
const AT = "2026-10-08T09:00:00.000Z";
const FIRST = "So how would you shard the booking table?";
const ANSWER = "I would start with the region as the first key.";
const SECOND = "And how would you roll that change back safely?";

// The Studio's side: what it holds, and what it was asked.
type Held = {
  lines: {
    seq: number;
    speaker: string;
    name?: string;
    text: string;
    at: string;
  }[];
  plan: string;
  // Answers every request with this status instead, when set.
  refuse?: number;
};
const held: Held = { lines: [], plan: "" };
let asked: { method: string; url: string; authorization: string }[] = [];
// Every claim on the pen the stand-in was sent, as its body read.
let claims: unknown[] = [];
// The epoch the stand-in gives the pen under: one holder, so it never rises.
const PEN_EPOCH = 3;
let server: Server;
let base = "";
// An address nothing listens on.
let closed = "";

const line = (seq: number, speaker: string, text: string) => ({
  seq,
  speaker,
  text,
  at: AT,
});

type Ran = { code: number | null; stdout: string; stderr: string };
const listen = (
  args: string[],
  options: { url?: string; timeout?: number } = {},
) =>
  new Promise<Ran>((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", "src/coach-listen.ts", ...args],
      {
        cwd: WORKER,
        timeout: options.timeout ?? 30_000,
        env: {
          ...process.env,
          INTERVIEW_API_URL: options.url ?? base,
          INTERVIEW_API_TOKEN: TOKEN,
        },
      },
      (error, stdout, stderr) => {
        const code = (error as { code?: unknown } | null)?.code;
        resolve({
          code: error ? (typeof code === "number" ? code : null) : 0,
          stdout,
          stderr,
        });
      },
    );
  });

let stateBefore: string | null = null;
let madeLocal = false;

beforeAll(async () => {
  stateBefore = existsSync(STATE) ? readFileSync(STATE, "utf8") : null;
  if (!existsSync(LOCAL)) {
    mkdirSync(LOCAL, { recursive: true });
    madeLocal = true;
  }
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://studio.test");
    asked.push({
      method: request.method ?? "",
      url: request.url ?? "",
      authorization: request.headers.authorization ?? "",
    });
    const answer = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (held.refuse) return answer(held.refuse, { error: { code: "refused" } });
    if (request.headers.authorization !== `Bearer ${TOKEN}`)
      return answer(401, { error: { code: "unauthorized" } });
    if (url.pathname === "/api/v1/coach-writer" && request.method === "POST") {
      let sent = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        sent += chunk;
      });
      request.on("end", () => {
        let body: unknown;
        try {
          body = JSON.parse(sent);
        } catch {
          body = sent;
        }
        claims.push(body);
        const id = (body as { id?: unknown } | null)?.id;
        answer(200, { id: typeof id === "string" ? id : "", epoch: PEN_EPOCH });
      });
      return;
    }
    if (url.pathname === "/api/v1/coach-transcript") {
      const after = Number(url.searchParams.get("after") ?? "0");
      return answer(200, {
        epoch: EPOCH,
        cursor: held.lines.at(-1)?.seq ?? 0,
        lines: held.lines.filter((each) => each.seq > after),
        space: "live",
      });
    }
    if (url.pathname === "/api/v1/coach-plan")
      return answer(200, { text: held.plan });
    return answer(404, { error: { code: "not_found" } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const gone = createServer();
  await new Promise<void>((resolve) => gone.listen(0, "127.0.0.1", resolve));
  closed = `http://127.0.0.1:${(gone.address() as AddressInfo).port}`;
  await new Promise((resolve) => gone.close(resolve));
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
  // No trace: the cursor file is as it was before the suite.
  if (stateBefore === null) rmSync(STATE, { force: true });
  else writeFileSync(STATE, stateBefore);
  if (madeLocal) rmSync(LOCAL, { recursive: true, force: true });
});

// The runs follow one another: each begins where the last one read to.
describe("pnpm coach:listen", () => {
  it("prints the moment as one JSON line and exits 0 once a finished question has been heard", async () => {
    held.lines = [line(1, "interviewer", FIRST)];
    held.plan = "Land the ledger migration story.";
    asked = [];
    claims = [];

    const ran = await listen(["--reset"]);

    expect(ran.stderr).toBe("");
    expect(ran.code).toBe(0);
    expect(ran.stdout.endsWith("\n")).toBe(true);
    expect(ran.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(ran.stdout)).toEqual({
      reason: "question-finished",
      about: "interviewer",
      turn: FIRST,
      new: [{ speaker: "interviewer", text: FIRST }],
      before: [],
      plan: "Land the ledger migration story.",
      key: "agent-1a2b3c4d-1",
    });
    // [DOMAIN] Before it reads a word it takes the pen: a person who runs
    // this has put an agent in charge, so the built-in coach stands down.
    expect(asked[0]).toEqual({
      method: "POST",
      url: "/api/v1/coach-writer",
      authorization: `Bearer ${TOKEN}`,
    });
    // It read the Studio as a coach does: from its cursor, with the token.
    expect(asked[1]).toEqual({
      method: "GET",
      url: "/api/v1/coach-transcript?after=0",
      authorization: `Bearer ${TOKEN}`,
    });
    expect(asked.at(-1)?.url).toBe("/api/v1/coach-plan");
    expect(new Set(asked.map((each) => each.authorization))).toEqual(
      new Set([`Bearer ${TOKEN}`]),
    );
    // The claim is the one thing it writes: everything after it is a read.
    expect(asked.slice(1).map((each) => each.method)).toEqual(
      asked.slice(1).map(() => "GET"),
    );
    // It waited for the pause after the question before saying so.
    expect(
      asked.filter((each) => each.url.includes("coach-transcript")).length,
    ).toBeGreaterThan(1);
    // Where it read to is kept for the next listen: ids and times, no words.
    const kept = JSON.parse(readFileSync(STATE, "utf8"));
    expect(kept).toEqual({
      epoch: EPOCH,
      readTo: 1,
      actedAtMs: expect.any(Number),
    });
    expect(readFileSync(STATE, "utf8")).not.toContain("shard");
  }, 60_000);

  it("took the pen as the desktop agent, by takeover, for three minutes: once, for a listen this short", () => {
    // The run above: what its one claim asked for.
    expect(claims).toEqual([
      { id: "desktop-agent", takeover: true, leaseSeconds: 180 },
    ]);
  });

  it("keeps the pen when it exits with a moment: the agent writes its note next, so nothing gives it up", () => {
    expect(asked.filter((each) => each.method === "DELETE")).toEqual([]);
    expect(
      asked.filter((each) => each.url.startsWith("/api/v1/coach-writer")),
    ).toHaveLength(1);
  });

  it("the next listen begins after what was coached: the new lines, the turn to answer, and what came before", async () => {
    held.lines = [
      line(1, "interviewer", FIRST),
      line(2, "candidate", ANSWER),
      line(3, "interviewer", SECOND),
    ];
    // No plan is set.
    held.plan = "";
    asked = [];
    claims = [];

    const ran = await listen([]);

    expect(ran.stderr).toBe("");
    expect(ran.code).toBe(0);
    const moment = JSON.parse(ran.stdout);
    expect(moment).toEqual({
      reason: "question-finished",
      about: "interviewer",
      turn: SECOND,
      new: [
        { speaker: "candidate", text: ANSWER },
        { speaker: "interviewer", text: SECOND },
      ],
      before: [{ speaker: "interviewer", text: FIRST }],
      key: "agent-1a2b3c4d-2",
    });
    expect(moment).not.toHaveProperty("plan");
    expect(JSON.parse(readFileSync(STATE, "utf8"))).toMatchObject({
      epoch: EPOCH,
      readTo: 3,
    });
    // Every listen takes the pen anew, the same way, before it reads.
    expect(claims).toEqual([
      { id: "desktop-agent", takeover: true, leaseSeconds: 180 },
    ]);
    expect(asked[0]?.url).toBe("/api/v1/coach-writer");
  }, 60_000);

  it("prints nothing while there is nothing new to coach", async () => {
    asked = [];
    claims = [];
    // Stopped by the test: left alone it waits ten minutes, then exits 2.
    // Long enough for the script to start and ask twice on a busy machine.
    const ran = await listen([], { timeout: 9_000 });
    expect(ran.code).toBeNull();
    expect(ran.stdout).toBe("");
    expect(asked.length).toBeGreaterThan(1);
    // It holds the pen while it waits, on the one claim: a claim of three
    // minutes is renewed every thirty seconds, not on every look.
    expect(claims).toEqual([
      { id: "desktop-agent", takeover: true, leaseSeconds: 180 },
    ]);
    expect(
      asked.filter((each) => each.url.includes("coach-transcript")).length,
    ).toBeGreaterThan(1);
    expect(JSON.parse(readFileSync(STATE, "utf8"))).toMatchObject({
      readTo: 3,
    });
  }, 60_000);

  it("--reset forgets where it had read to: the whole conversation is new again", async () => {
    const ran = await listen(["--reset"]);
    expect(ran.code).toBe(0);
    const moment = JSON.parse(ran.stdout);
    // The first question was answered by the candidate: that turn is acted on.
    expect(moment).toMatchObject({
      reason: "speaker-change",
      about: "interviewer",
      turn: FIRST,
      before: [],
      key: "agent-1a2b3c4d-1",
    });
    expect(moment.new[0]).toEqual({ speaker: "interviewer", text: FIRST });
  }, 60_000);

  it("exits 1 with a message, and no moment, when the Studio cannot be reached", async () => {
    const before = readFileSync(STATE, "utf8");
    const ran = await listen(["--reset"], { url: closed });
    expect(ran.code).toBe(1);
    expect(ran.stdout).toBe("");
    expect(ran.stderr).toMatch(
      /^The Studio could not be reached \(\w+\)\. Is it running\?\n$/,
    );
    // Nothing was coached, so where it read to is as it was.
    expect(readFileSync(STATE, "utf8")).toBe(before);
  }, 60_000);

  it("exits 1 the same way when the Studio refuses it, saying nothing of what was said", async () => {
    held.refuse = 503;
    asked = [];
    try {
      const ran = await listen(["--reset"]);
      expect(ran.code).toBe(1);
      expect(ran.stdout).toBe("");
      expect(ran.stderr).toBe(
        "The Studio could not be reached (CoachApiError). Is it running?\n",
      );
      // The claim is what was refused: without the pen it reads nothing.
      expect(asked.map((each) => [each.method, each.url])).toEqual([
        ["POST", "/api/v1/coach-writer"],
      ]);
    } finally {
      delete held.refuse;
    }
  }, 60_000);
  it("in a panel, gives each line the interviewer its source named, and no name where the source gave none", async () => {
    const earlier = held.lines;
    const HANDOVER = "I'm going to hand over to Ravi now.";
    const THANKS = "Thank you, Dana, that was a helpful overview of the team.";
    held.lines = [
      { ...line(1, "interviewer", HANDOVER), name: "Dana" },
      line(2, "candidate", THANKS),
      { ...line(3, "interviewer", SECOND), name: "Ravi" },
    ];
    held.plan = "panel: Dana (hiring manager), Ravi (staff engineer)";
    try {
      const first = await listen(["--reset"]);
      expect(first.stderr).toBe("");
      expect(first.code).toBe(0);
      expect(JSON.parse(first.stdout)).toEqual({
        reason: "speaker-change",
        about: "interviewer",
        turn: HANDOVER,
        new: [{ speaker: "interviewer", name: "Dana", text: HANDOVER }],
        before: [],
        // The plan, with its roster line, is given as it was written.
        plan: held.plan,
        key: "agent-1a2b3c4d-1",
      });
      const second = await listen([]);
      expect(second.code).toBe(0);
      expect(JSON.parse(second.stdout)).toEqual({
        reason: "question-finished",
        about: "interviewer",
        turn: SECOND,
        new: [
          { speaker: "candidate", text: THANKS },
          { speaker: "interviewer", name: "Ravi", text: SECOND },
        ],
        before: [{ speaker: "interviewer", name: "Dana", text: HANDOVER }],
        plan: held.plan,
        key: "agent-1a2b3c4d-2",
      });
    } finally {
      held.lines = earlier;
      held.plan = "";
    }
  }, 60_000);
});
