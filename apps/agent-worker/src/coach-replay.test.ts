// The replay command, run as it is run by hand: as its own process, against
// an invented transcript in a temporary directory. The command is a script
// (top-level await, `process.exit`), so it is never imported here.
//
// It is started with the worker's own `tsx`, as `pnpm coach:replay` starts
// it, and like every suite of this app it reads the interview product as
// built (`@omnitech/product-interview/session-worker`). Timing only: no model
// is called and nothing leaves the process.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const WORKER = fileURLToPath(new URL("..", import.meta.url));

// Eighty seconds, three questions. Speaker 1 asks, Speaker 2 answers (the
// first answer is long enough for the coach to look at it), Speaker 3 is
// somebody else in the room, and the recorder could not name one "Yeah".
const TRANSCRIPT = `00:00:02 --> 00:00:06
Speaker 1: Thanks for joining us today, Marisol.

00:00:07 --> 00:00:11
Speaker 1: So how would you shard the booking table?

00:00:11 --> 00:00:12
Unknown: Yeah

00:00:14 --> 00:00:20
Speaker 2: I would start with the region as the first key because nearly all traffic stays inside one region and every query already carries it.

00:00:21 --> 00:00:27
Speaker 2: Then inside each region I would split by tenant so the three largest tenants never share a shard with the small ones.

00:00:28 --> 00:00:36
Speaker 2: Every booking keeps its tenant and region in the key, reads stay on one shard, and reports run from a separate replica overnight.

00:00:42 --> 00:00:46
Speaker 1: Tell me about a time you led a migration.

00:00:47 --> 00:00:49
Speaker 3: The projector in room nine needs a new bulb today.

00:00:52 --> 00:00:58
Speaker 2: At my last company we moved the ledger to a new store with no downtime.

00:01:02 --> 00:01:06
Speaker 1: And what would you do about hot regions,

00:01:07 --> 00:01:11
Speaker 1: and how would you roll that back safely?

00:01:14 --> 00:01:20
Speaker 2: I would add a second level of keys and keep the old path live.
`;

type Ran = { code: number; stdout: string; stderr: string };
let directory = "";
let file = "";

const replay = (...args: string[]) =>
  new Promise<Ran>((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", "src/coach-replay.ts", ...args],
      { cwd: WORKER, timeout: 50_000 },
      (error, stdout, stderr) => {
        const code = (error as { code?: unknown } | null)?.code;
        resolve({
          code: error ? (typeof code === "number" ? code : -1) : 0,
          stdout,
          stderr,
        });
      },
    );
  });

const CAST = ["--interviewer", "Speaker 1", "--me", "Speaker 2"];
const REASON = "question-finished|pause|speaker-change|answer-check";
const ACT = new RegExp(
  `^\\d\\d:\\d\\d:\\d\\d {2}ACT {4}(${REASON}) +\\+\\d+\\.\\ds after "(.*)"$`,
);
// The ACT lines of a run, as [reason, what was quoted].
const acts = (ran: Ran) =>
  ran.stdout.split("\n").flatMap((line) => {
    const found = ACT.exec(line);
    return found ? [[found[1] as string, found[2] as string] as const] : [];
  });
const pieces = (ran: Ran) =>
  Number(/^Replaying .*: (\d+) pieces\./m.exec(ran.stdout)?.[1]);

// Every run the suite reads, made once and side by side: each is a process.
const runs = {} as Record<
  | "speakers"
  | "timing"
  | "leaveOut"
  | "hideMe"
  | "stretch"
  | "noFile"
  | "nobody",
  Ran
>;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "coach-replay-"));
  file = join(directory, "practice-round.txt");
  await writeFile(file, TRANSCRIPT);
  const made = await Promise.all([
    replay(file, "--speakers"),
    replay(file, ...CAST, "--timing"),
    replay(file, ...CAST, "--leave-out", "Speaker 3,Unknown", "--timing"),
    replay(file, ...CAST, "--hide-me", "--timing"),
    replay(file, ...CAST, "--from", "00:00:41", "--to", "00:00:59", "--timing"),
    replay("--timing"),
    replay(file, "--leave-out", "Speaker 1,Speaker 2,Speaker 3,Unknown"),
  ]);
  const names = Object.keys({
    speakers: 0,
    timing: 0,
    leaveOut: 0,
    hideMe: 0,
    stretch: 0,
    noFile: 0,
    nobody: 0,
  } satisfies Record<keyof typeof runs, 0>) as (keyof typeof runs)[];
  names.forEach((name, at) => {
    runs[name] = made[at] as Ran;
  });
}, 120_000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("pnpm coach:replay", () => {
  it("--speakers lists each label with how much it said, the most talkative first, and replays nothing", () => {
    const { code, stdout } = runs.speakers;
    expect(code).toBe(0);
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe(`${file}: 00:00:02 to 00:01:20`);
    expect(
      lines.slice(1).map((line) => {
        const found =
          /^ {2}(.+?) +(\d+) words in +(\d+) pieces {3}"(.*)"$/.exec(line);
        return [found?.[1], Number(found?.[2]), Number(found?.[3])];
      }),
    ).toEqual([
      ["Speaker 2", 98, 5],
      ["Speaker 1", 39, 5],
      ["Speaker 3", 10, 1],
      ["Unknown", 1, 1],
    ]);
    // A first sentence of some length, to tell who each is; none for a "Yeah".
    expect(lines[2]).toContain('"Thanks for joining us today, Marisol."');
    expect(lines[4]).toMatch(/""$/);
    expect(stdout).not.toContain("ACT");
    expect(stdout).not.toContain("Replaying");
  });

  it("--timing prints when the coach would act and why, then what it came to", () => {
    const ran = runs.timing;
    expect(ran.code).toBe(0);
    expect(ran.stdout).toMatch(
      /^Replaying 00:00:06 to 00:01:20: 12 pieces\. Speaker 1 = interviewer, Speaker 2 = me\.$/m,
    );
    const acted = acts(ran);
    // Every question is acted on at its end, whole.
    expect(acted).toContainEqual([
      "question-finished",
      expect.stringMatching(/So how would you shard the booking table\?$/),
    ]);
    expect(acted).toContainEqual([
      "question-finished",
      expect.stringMatching(/^Tell me about a time you led a migration\./),
    ]);
    expect(acted).toContainEqual([
      "question-finished",
      "And what would you do about hot regions, and how would you roll that back safely?",
    ]);
    // No action on the half of the two-part question.
    expect(
      acted.some(([, quoted]) => quoted.endsWith("about hot regions,")),
    ).toBe(false);
    // The long first answer is looked at once.
    expect(acted.filter(([reason]) => reason === "answer-check")).toEqual([
      [
        "answer-check",
        expect.stringContaining("I would start with the region"),
      ],
    ]);
    // Timing only: no model, so no note is ever written.
    expect(ran.stdout).not.toMatch(/^\d\d:\d\d:\d\d {2}NOTE/m);
    expect(ran.stdout).not.toContain("notes,");

    expect(ran.stdout).toMatch(
      /^\d+ actions in 1\.\d minutes \(one every \d+ s\): (\d+ [a-z-]+(, )?)+\.$/m,
    );
    expect(ran.stdout).toMatch(
      /^From the end of the interviewer's turn to acting: median \d+\.\d s\.$/m,
    );
    // The brief: a finished question is acted on in under 1.5 s.
    for (const line of ran.stdout.split("\n"))
      if (/ACT {4}question-finished/.test(line))
        expect(Number(/\+(\d+\.\d)s after/.exec(line)?.[1])).toBeLessThan(1.5);
  });

  // DEFECT (coach-replay.ts:288 `acted.set(event.key, …)` and :416): what
  // was acted on is kept by its note's key, so a call made again (and a
  // sentence added to a turn already answered) replaces the action before it.
  // The summary then counts fewer "actions" than the ACT lines above it and
  // than the reasons it lists beside the count ("3 actions …: 1 pause,
  // 2 recall, 4 question-finished"), and "one every N s" is worked from that.
  it("DEFECT: the summary counts the actions it printed", () => {
    const { stdout } = runs.timing;
    const counted = Number(/^(\d+) actions in /m.exec(stdout)?.[1]);
    expect(counted).toBe(acts(runs.timing).length);
  });

  it("tells of a call made again when the interviewer's side goes on, as an unnamed speaker's sentence does", () => {
    // Speaker 3 has no part, so is unknown, and a sentence from an unknown
    // speaker is read as the interviewer's: it joins the question before it.
    expect(runs.timing.stdout).toMatch(/^\d\d:\d\d:\d\d {2}AGAIN {2}/m);
    expect(acts(runs.timing)).toContainEqual([
      "question-finished",
      "Tell me about a time you led a migration. The projector in room nine needs a new bulb today.",
    ]);
  });

  it("--leave-out removes a speaker from what the coach hears", () => {
    const ran = runs.leaveOut;
    expect(ran.code).toBe(0);
    expect(pieces(ran)).toBe(pieces(runs.timing) - 2);
    expect(ran.stdout).toContain("Speaker 3 = leave-out, Unknown = leave-out.");
    expect(ran.stdout).not.toContain("projector");
    expect(acts(ran)).toContainEqual([
      "question-finished",
      "Tell me about a time you led a migration.",
    ]);
    // The other speakers are heard as before.
    expect(
      acts(ran).filter(([reason]) => reason === "answer-check"),
    ).toHaveLength(1);
  });

  it("--hide-me leaves the coached person's own lines out: nothing of the answers is replayed", () => {
    const ran = runs.hideMe;
    expect(ran.code).toBe(0);
    // Speaker 2's five pieces are gone; the replay ends on the last question.
    expect(pieces(ran)).toBe(pieces(runs.timing) - 5);
    expect(ran.stdout).toMatch(/^Replaying 00:00:06 to 00:01:11: 7 pieces\./m);
    const acted = acts(ran);
    expect(acted.length).toBeGreaterThanOrEqual(3);
    // With no answer heard there is no answer to look at, and no turn is
    // ended by the other side speaking.
    expect(
      acted.filter(
        ([reason]) => reason === "answer-check" || reason === "speaker-change",
      ),
    ).toEqual([]);
    expect(ran.stdout).not.toContain("I would start with the region");
    expect(acted).toContainEqual([
      "question-finished",
      "And what would you do about hot regions, and how would you roll that back safely?",
    ]);
  });

  it("--from and --to replay a stretch of the file's clock", () => {
    const ran = runs.stretch;
    expect(ran.code).toBe(0);
    expect(ran.stdout).toMatch(/^Replaying 00:00:46 to 00:00:58: 3 pieces\./m);
    expect(ran.stdout).not.toContain("shard the booking table");
    expect(ran.stdout).not.toContain("hot regions");
    expect(acts(ran)[0]).toEqual([
      "question-finished",
      "Tell me about a time you led a migration.",
    ]);
  });

  it("exits 1 and says what to give when no file is named", () => {
    const { code, stdout, stderr } = runs.noFile;
    expect(code).toBe(1);
    expect(stderr).toContain("Give the transcript file.");
    expect(stdout).toBe("");
  });

  it("exits 1 when nothing is left to replay", () => {
    const { code, stdout, stderr } = runs.nobody;
    expect(code).toBe(1);
    expect(stderr).toContain("Nothing is left to replay");
    expect(stdout).not.toContain("ACT");
  });
});
