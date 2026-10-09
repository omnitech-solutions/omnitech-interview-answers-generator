// The replay command, run as it is run by hand: as its own process, against
// an invented transcript in a temporary directory. The command is a script
// (top-level await, `process.exit`), so it is never imported here.
//
// It is started with the worker's own `tsx`, as `pnpm coach:replay` starts
// it, and like every suite of this app it reads the interview product as
// built (`@omnitech/product-interview/session-worker`). Timing only: no model
// is called and nothing leaves the process.
//
// By default a replay tells the coach who is speaking, from the recording's
// own timings (a piece begun and not yet ended); `--no-activity` leaves the
// coach with the text alone. Both are run here, over the same files.
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

// An interviewer whose question comes in two phrases: a sentence that reads
// as finished, then a long phrase begun a second later that is not heard as
// text until it ends, five seconds on.
const LATE_FIRST = "We run the booking platform across nine regions.";
const LATE_SECOND =
  "Given that, how would you move the busiest region to a new shard key without taking bookings offline?";
const LATE_TRANSCRIPT = `00:00:02 --> 00:00:05
Speaker 1: ${LATE_FIRST}

00:00:06 --> 00:00:11
Speaker 1: ${LATE_SECOND}

00:00:14 --> 00:00:20
Speaker 2: I would copy the region behind a flag and switch reads first.
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
const REASON =
  "question-finished|pause|speaker-change|answer-check|screen-change";
const ACT = new RegExp(
  `^\\d\\d:\\d\\d:\\d\\d {2}ACT {4}(${REASON}) +\\+\\d+\\.\\ds after "(.*)"$`,
);
// The ACT lines of a run, as [reason, what was quoted].
const acts = (ran: Ran) =>
  ran.stdout.split("\n").flatMap((line) => {
    const found = ACT.exec(line);
    return found ? [[found[1] as string, found[2] as string] as const] : [];
  });
// The calls made again, as the AGAIN lines tell of them.
const agains = (ran: Ran) =>
  ran.stdout
    .split("\n")
    .filter((line) => /^\d\d:\d\d:\d\d {2}AGAIN {2}/.test(line));
// The summary line: how many actions, and each reason beside its count.
const summary = (ran: Ran) => {
  const found =
    /^(\d+) actions in (\d+\.\d) minutes \(one every (\d+) s\): (.+)\.$/m.exec(
      ran.stdout,
    );
  return {
    actions: Number(found?.[1]),
    minutes: Number(found?.[2]),
    every: Number(found?.[3]),
    counts: Object.fromEntries(
      (found?.[4] ?? "").split(", ").map((each) => {
        const [count, reason] = each.split(" ");
        return [reason, Number(count)];
      }),
    ) as Record<string, number>,
  };
};
const pieces = (ran: Ran) =>
  Number(/^Replaying .*: (\d+) pieces\./m.exec(ran.stdout)?.[1]);

// Every run the suite reads, made once and side by side: each is a process.
const runs = {} as Record<
  | "speakers"
  | "timing"
  | "noActivity"
  | "late"
  | "lateNoActivity"
  | "leaveOut"
  | "hideMe"
  | "stretch"
  | "noFile"
  | "nobody"
  | "atOnce"
  | "slow"
  | "plan"
  | "missing"
  | "missingPlan"
  | "retained",
  Ran
>;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "coach-replay-"));
  file = join(directory, "practice-round.txt");
  await writeFile(file, TRANSCRIPT);
  const late = join(directory, "late-phrase.txt");
  await writeFile(late, LATE_TRANSCRIPT);
  const plan = join(directory, "plan.txt");
  await writeFile(
    plan,
    "mode: system-design\nA booking system for a clinic.\n",
  );
  const made = await Promise.all([
    replay(file, "--speakers"),
    replay(file, ...CAST, "--timing"),
    replay(file, ...CAST, "--timing", "--no-activity"),
    replay(late, ...CAST, "--timing"),
    // The flag is named before the file, and is not taken for it.
    replay("--no-activity", late, ...CAST, "--timing"),
    replay(file, ...CAST, "--leave-out", "Speaker 3,Unknown", "--timing"),
    replay(file, ...CAST, "--hide-me", "--timing"),
    replay(file, ...CAST, "--from", "00:00:41", "--to", "00:00:59", "--timing"),
    replay("--timing"),
    replay(file, "--leave-out", "Speaker 1,Speaker 2,Speaker 3,Unknown"),
    replay(file, ...CAST, "--timing", "--latency", "0"),
    replay(file, ...CAST, "--timing", "--latency", "9"),
    // The plan's file is named before the transcript's.
    replay("--plan", plan, file, ...CAST, "--timing"),
    replay(join(directory, "no-such-file.txt"), ...CAST, "--timing"),
    replay(
      file,
      ...CAST,
      "--timing",
      "--plan",
      join(directory, "no-such-plan.txt"),
    ),
    replay(file, ...CAST, "--timing", "--retain"),
  ]);
  const names = Object.keys({
    speakers: 0,
    timing: 0,
    noActivity: 0,
    late: 0,
    lateNoActivity: 0,
    leaveOut: 0,
    hideMe: 0,
    stretch: 0,
    noFile: 0,
    nobody: 0,
    atOnce: 0,
    slow: 0,
    plan: 0,
    missing: 0,
    missingPlan: 0,
    retained: 0,
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
    // The opening sentence is not acted on as a pause: by the recording's
    // timings its speaker has begun the question that follows.
    expect(ran.stdout).toContain(
      "\n5 actions in 1.3 minutes (one every 15 s): 3 question-finished, 1 answer-check, 1 recall, 1 pause.\n",
    );
    expect(ran.stdout).toMatch(
      /^From the end of the interviewer's turn to acting: median \d+\.\d s\.$/m,
    );
    // The brief: a finished question is acted on in under 1.5 s.
    for (const line of ran.stdout.split("\n"))
      if (/ACT {4}question-finished/.test(line))
        expect(Number(/\+(\d+\.\d)s after/.exec(line)?.[1])).toBeLessThan(1.5);
  });

  it("lists every act in the order it was made, a turn answered again as another act", () => {
    expect(acts(runs.timing)).toEqual([
      [
        "question-finished",
        "Thanks for joining us today, Marisol. So how would you shard the booking table?",
      ],
      [
        "answer-check",
        expect.stringMatching(/^I would start with the region .*…$/),
      ],
      ["question-finished", "Tell me about a time you led a migration."],
      [
        "pause",
        "Tell me about a time you led a migration. The projector in room nine needs a new bulb today.",
      ],
      [
        "question-finished",
        "And what would you do about hot regions, and how would you roll that back safely?",
      ],
    ]);
  });

  it.each([
    "timing",
    "noActivity",
    "late",
    "lateNoActivity",
    "leaveOut",
    "hideMe",
    "stretch",
    "atOnce",
    "slow",
  ] as const)(
    "the summary of the %s run counts each act it printed, once, and each call made again",
    (name) => {
      const ran = runs[name];
      const { actions, minutes, every, counts } = summary(ran);
      const acted = acts(ran);
      expect(actions).toBe(acted.length);
      const { recall = 0, ...reasons } = counts;
      expect(recall).toBe(agains(ran).length);
      // Each reason beside the count is the ACT lines of that reason.
      for (const [reason, count] of Object.entries(reasons))
        expect(acted.filter(([each]) => each === reason)).toHaveLength(count);
      expect(Object.values(reasons).reduce((sum, each) => sum + each, 0)).toBe(
        actions,
      );
      // "One every N s" is worked from the acts.
      expect(
        Math.abs(every - (minutes * 60) / Math.max(1, actions)),
      ).toBeLessThan(4);
    },
  );

  it("tells of a call made again when the interviewer's side goes on while it runs, as an unnamed speaker's sentence does", () => {
    // Speaker 3 has no part, so is unknown, and a sentence from an unknown
    // speaker is read as the interviewer's: it joins the question before it.
    // The absent model takes 4 s, so the call for the question is still
    // running when that sentence is heard, and is made again with both.
    const lines = runs.timing.stdout.split("\n");
    const at = lines.findIndex((line) =>
      line.endsWith('after "Tell me about a time you led a migration."'),
    );
    expect(lines[at + 1]).toMatch(
      /^00:00:49 {2}AGAIN {2}the interviewer went on: the call is made again with the whole turn$/,
    );
    expect(lines[at + 2]).toMatch(
      /^00:00:51 {2}ACT {4}pause +\+\d\.\ds after "Tell me about a time you led a migration\. The projector in room nine needs a new bulb today\."$/,
    );
    // The one call made again: Speaker 3 began a second after the question
    // was acted on, so nothing said they were speaking when the call began.
    expect(agains(runs.timing)).toHaveLength(1);
  });

  describe("who is speaking, from the recording's timings", () => {
    const OPENING = "Thanks for joining us today, Marisol.";
    const at = (line: string | undefined) => {
      const found = /^(\d\d):(\d\d):(\d\d) /.exec(line ?? "");
      return found
        ? Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3])
        : Number.NaN;
    };
    const lineOf = (ran: Ran, ending: string) =>
      ran.stdout.split("\n").find((line) => line.endsWith(ending));

    it("is told by default: the opening sentence is not acted on while its speaker is already asking the question", () => {
      expect(runs.timing.code).toBe(0);
      expect(acts(runs.timing).map(([, quoted]) => quoted)).not.toContain(
        OPENING,
      );
      expect(acts(runs.timing)[0]).toEqual([
        "question-finished",
        `${OPENING} So how would you shard the booking table?`,
      ]);
    });

    it("--no-activity leaves the coach the text alone: the opening sentence is acted on as a pause, and the call made again when the question lands", () => {
      const ran = runs.noActivity;
      expect(ran.code).toBe(0);
      expect(ran.stderr).toBe("");
      expect(acts(ran)).toEqual([
        ["pause", OPENING],
        [
          "question-finished",
          `${OPENING} So how would you shard the booking table?`,
        ],
        [
          "answer-check",
          expect.stringMatching(/^I would start with the region .*…$/),
        ],
        ["question-finished", "Tell me about a time you led a migration."],
        [
          "pause",
          "Tell me about a time you led a migration. The projector in room nine needs a new bulb today.",
        ],
        [
          "question-finished",
          "And what would you do about hot regions, and how would you roll that back safely?",
        ],
      ]);
      expect(agains(ran)).toHaveLength(2);
      expect(ran.stdout).toContain(
        "\n6 actions in 1.3 minutes (one every 13 s): 2 pause, 2 recall, 3 question-finished, 1 answer-check.\n",
      );
    });

    it("the two runs replay the same pieces and differ in that one act and its call made again", () => {
      expect(pieces(runs.noActivity)).toBe(pieces(runs.timing));
      expect(acts(runs.noActivity).slice(1)).toEqual(acts(runs.timing));
      expect(agains(runs.noActivity).slice(1)).toEqual(agains(runs.timing));
    });

    it("a long phrase that arrives late: with activity the half-said turn is never acted on and no call is made again", () => {
      const ran = runs.late;
      expect(ran.code).toBe(0);
      expect(ran.stderr).toBe("");
      expect(ran.stdout).toMatch(
        /^Replaying 00:00:05 to 00:00:20: 3 pieces\. Speaker 1 = interviewer, Speaker 2 = me\.$/m,
      );
      expect(agains(ran)).toEqual([]);
      expect(ran.stdout).not.toContain("AGAIN");
      expect(summary(ran).counts).not.toHaveProperty("recall");
      // One act, on the whole turn, once its second phrase had been heard.
      // (The turn is quoted cut short, so its start is what is compared.)
      expect(acts(ran)).toEqual([
        [
          "question-finished",
          expect.stringMatching(
            /^We run the booking platform across nine regions\. Given that, how would you move .*…$/,
          ),
        ],
      ]);
      expect(acts(ran).some(([, quoted]) => quoted === LATE_FIRST)).toBe(false);
      const acted = ran.stdout
        .split("\n")
        .find((line) => / ACT {4}question-finished/.test(line));
      // The phrase ends at 00:00:11; a finished question is acted on at once.
      expect(at(acted)).toBeGreaterThanOrEqual(11);
      expect(at(acted)).toBeLessThanOrEqual(12);
      expect(Number(/\+(\d+\.\d)s after/.exec(acted ?? "")?.[1])).toBeLessThan(
        1.5,
      );
      expect(summary(ran)).toMatchObject({
        actions: 1,
        counts: { "question-finished": 1 },
      });
    });

    it("the same file with --no-activity: the first sentence is acted on mid-phrase, and the call is made again when the phrase lands", () => {
      const ran = runs.lateNoActivity;
      expect(ran.code).toBe(0);
      expect(ran.stderr).toBe("");
      expect(pieces(ran)).toBe(pieces(runs.late));
      const lines = ran.stdout.split("\n");
      // Acted on the partial turn, while its speaker was still talking.
      const partial = lineOf(ran, `after "${LATE_FIRST}"`);
      expect(partial).toMatch(/^00:00:0[78] {2}ACT {4}pause +\+2\.\ds after /);
      expect(lines[lines.indexOf(partial as string) + 1]).toMatch(
        /^00:00:11 {2}AGAIN {2}the interviewer went on: the call is made again with the whole turn$/,
      );
      expect(agains(ran)).toHaveLength(1);
      expect(acts(ran).map(([reason]) => reason)).toEqual([
        "pause",
        "question-finished",
      ]);
      expect(acts(ran)[0]).toEqual(["pause", LATE_FIRST]);
      expect(acts(ran)[1]?.[1]).toMatch(
        /^We run the booking platform across nine regions\. Given that, /,
      );
      expect(summary(ran)).toMatchObject({
        actions: 2,
        counts: { pause: 1, recall: 1, "question-finished": 1 },
      });
    });

    it("either way the whole turn is acted on at the same moment: activity removes the early act, it does not delay the right one", () => {
      const whole = (ran: Ran) =>
        ran.stdout
          .split("\n")
          .find((line) => / ACT {4}question-finished/.test(line));
      expect(whole(runs.late)).toBe(whole(runs.lateNoActivity));
    });
  });

  it("--latency says how long the absent model takes: at 0 no call is still running to be made again, and the same acts are made", () => {
    const ran = runs.atOnce;
    expect(ran.code).toBe(0);
    expect(agains(ran)).toEqual([]);
    expect(summary(ran).counts).not.toHaveProperty("recall");
    expect(acts(ran)).toEqual(acts(runs.timing));
    // The default is 4 s; a slower model is caught out by the same turns.
    expect(agains(runs.slow)).toHaveLength(agains(runs.timing).length);
    expect(runs.slow.stdout).toBe(runs.timing.stdout);
  });

  it("--retain keeps one session of the model and changes nothing of when the coach acts or why", () => {
    const ran = runs.retained;
    expect(ran.code).toBe(0);
    expect(acts(ran)).toEqual(acts(runs.timing));
    expect(agains(ran)).toEqual(agains(runs.timing));
    expect(summary(ran)).toEqual(summary(runs.timing));
    expect(ran.stdout).toBe(runs.timing.stdout);
  });

  it("--plan names the plan's file, which is never taken for the transcript", () => {
    const ran = runs.plan;
    expect(ran.code).toBe(0);
    expect(ran.stderr).toBe("");
    expect(ran.stdout).toMatch(
      /^Replaying 00:00:06 to 00:01:20: 12 pieces\. Speaker 1 = interviewer, Speaker 2 = me\.$/m,
    );
    // The kind of round changes what is written, not when the coach acts.
    expect(acts(ran)).toEqual(acts(runs.timing));
  });

  it("exits 1 and names the file when the transcript cannot be read", () => {
    const { code, stdout, stderr } = runs.missing;
    expect(code).toBe(1);
    expect(stderr).toBe(
      `That file could not be read: ${join(directory, "no-such-file.txt")}\n`,
    );
    expect(stdout).toBe("");
  });

  it("exits 1 when the plan's file cannot be read, acting on nothing", () => {
    const { code, stdout } = runs.missingPlan;
    expect(code).toBe(1);
    expect(stdout).not.toContain("ACT");
  });

  // DEFECT, minor (coach-replay.ts:341-343): the plan's file is read with no
  // guard, so a wrong path ends the run with Node's own stack trace
  // ("Error: ENOENT … at readFileSync") instead of the plain line a missing
  // transcript gets. Remove `.fails` when it says which file could not be read.
  it("DEFECT: a plan that cannot be read is said plainly, without a stack trace", () => {
    const { stderr } = runs.missingPlan;
    expect(stderr).toContain("could not be read");
    expect(stderr).not.toContain("at readFileSync");
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
