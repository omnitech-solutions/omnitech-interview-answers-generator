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
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

// A panel: three interviewers and the person coached. Two start at once, one
// gives way, the other asks; then a handover and a second question.
const PANEL_TRANSCRIPT = `00:00:02 --> 00:00:05
Dana: Can I ask about, um, how you work with product when

00:00:04 --> 00:00:06
Ravi: And what about idempotency, if a

00:00:07 --> 00:00:08
Ravi: Sorry, go ahead, Dana.

00:00:09 --> 00:00:11
Dana: No, no, you go, mine is a longer one.

00:00:12 --> 00:00:17
Ravi: If a broker double-clicks submit, how do you make sure they are only charged once?

00:00:19 --> 00:00:25
Marisol: I key the ledger by correlation id, so the second request finds the first and does nothing.

00:00:27 --> 00:00:30
Ravi: Great. I'm going to hand over to Ines now.

00:00:31 --> 00:00:36
Ines: Thanks, Ravi. What notice period do you have?

00:00:38 --> 00:00:41
Marisol: Four weeks from the day I sign.
`;
const PANEL_CAST = ["--interviewer", "Dana,Ravi,Ines", "--me", "Marisol"];
const PANEL_EXPECTED = {
  questions: [
    {
      id: "charged-once",
      from: "Ravi",
      completeWhenSaid: "only charged once",
      about: ["idempotency", "go ahead"],
    },
    { id: "notice", from: "Ines", completeWhenSaid: "notice period" },
    { id: "nobody-said-who", completeWhenSaid: "notice period" },
  ],
  quiet: [{ id: "handover", said: "hand over to Ines" }],
};
type Kept = {
  benchmark: string;
  runtime: string;
  names: boolean;
  askers: { of: number; right: number; wrong: number; unnamed: number };
  questions: {
    id: string;
    askedBy: string | null;
    notedFrom: string | null;
    answeredWhole: boolean;
    prematureActs: number;
    toActS: number | null;
  }[];
  quiet: { id: string; acts: number }[];
};
const keptIn = async (folder: string) => {
  const files = await readdir(folder);
  expect(files).toHaveLength(1);
  return {
    file: files[0] as string,
    result: JSON.parse(
      await readFile(join(folder, files[0] as string), "utf8"),
    ) as Kept,
  };
};

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
  | "retained"
  | "panel"
  | "panelNoNames"
  | "panelOneInterviewer",
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
  const panel = join(directory, "panel-practice.txt");
  await writeFile(panel, PANEL_TRANSCRIPT);
  const expected = join(directory, "panel-practice.expected.json");
  await writeFile(expected, JSON.stringify(PANEL_EXPECTED));
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
    replay(
      panel,
      ...PANEL_CAST,
      "--timing",
      "--expect",
      expected,
      "--results",
      join(directory, "named"),
    ),
    replay(
      panel,
      ...PANEL_CAST,
      "--no-names",
      "--timing",
      "--expect",
      expected,
      "--results",
      join(directory, "unnamed"),
    ),
    // One label as the interviewer, the other two left as they are.
    replay(panel, "--interviewer", "Ravi", "--me", "Marisol", "--timing"),
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
    panel: 0,
    panelNoNames: 0,
    panelOneInterviewer: 0,
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

describe("pnpm coach:replay on a panel", () => {
  const body = (ran: Ran) =>
    ran.stdout
      .split("\n")
      .filter(
        (line) =>
          !line.startsWith("Replaying ") && !/^BENCHMARK /.test(line.trim()),
      );

  it("tells the coach which interviewer speaks when more than one label is the interviewer, and says so", () => {
    const ran = runs.panel;
    expect(ran.code).toBe(0);
    expect(ran.stderr).toBe("");
    expect(ran.stdout).toMatch(
      /^Replaying 00:00:05 to 00:00:41: 9 pieces\. Dana = interviewer, Ravi = interviewer, Ines = interviewer, Marisol = me\. The coach is told who speaks: Dana, Ravi, Ines\.$/m,
    );
  });

  it("--no-names replays the same call with nobody named, as a live call is heard, and says so", () => {
    const ran = runs.panelNoNames;
    expect(ran.code).toBe(0);
    expect(ran.stdout).toMatch(
      /Marisol = me\. The coach is not told which interviewer speaks\.$/m,
    );
    expect(pieces(ran)).toBe(pieces(runs.panel));
  });

  it("acts at the same moments, for the same reasons, on the same words, named or not", () => {
    expect(acts(runs.panel).length).toBeGreaterThanOrEqual(2);
    expect(acts(runs.panelNoNames)).toEqual(acts(runs.panel));
    expect(agains(runs.panelNoNames)).toEqual(agains(runs.panel));
    expect(summary(runs.panelNoNames)).toEqual(summary(runs.panel));
    expect(body(runs.panelNoNames)).toEqual(body(runs.panel));
  });

  it("waits out two panelists starting at once and acts once, on the whole of what was asked", async () => {
    const first = acts(runs.panel)[0];
    expect(first?.[0]).toBe("question-finished");
    // The turn quoted (cut to fit the line) begins where the first of them did.
    expect(first?.[1]).toMatch(/^Can I ask about, um, .* idempotency/);
    expect(
      acts(runs.panel).filter(([, turn]) => turn.includes("idempotency")),
    ).toHaveLength(1);
    const { result } = await keptIn(join(directory, "named"));
    expect(result.questions[0]).toMatchObject({
      id: "charged-once",
      answeredWhole: true,
      prematureActs: 0,
    });
    expect(result.quiet).toEqual([{ id: "handover", acts: 0, notesShown: 0 }]);
  });

  it("names nobody when one label is the interviewer: a two-person replay says nothing of names", () => {
    const ran = runs.panelOneInterviewer;
    expect(ran.code).toBe(0);
    expect(ran.stdout).toMatch(
      /^Replaying .*: 9 pieces\. Ravi = interviewer, Marisol = me\.$/m,
    );
    expect(runs.timing.stdout).not.toContain("told");
  });

  it("keeps a benchmark's result with who asked each question, and no score for who was named when no model wrote notes", async () => {
    const { file: name, result } = await keptIn(join(directory, "named"));
    expect(name).toMatch(/^panel-practice-timing-.*\.json$/);
    expect(result.benchmark).toBe("panel-practice");
    expect(result.names).toBe(true);
    expect(result.askers).toEqual({ of: 0, right: 0, wrong: 0, unnamed: 0 });
    expect(
      result.questions.map((question) => [
        question.id,
        question.askedBy,
        question.notedFrom,
        question.answeredWhole,
      ]),
    ).toEqual([
      ["charged-once", "Ravi", null, true],
      ["notice", "Ines", null, true],
      ["nobody-said-who", null, null, true],
    ]);
    expect(runs.panel.stdout).not.toContain("who asked");
    expect(runs.panel.stdout).not.toContain("the note says");
  });

  it("scores a stretch of a call on the questions said in it: one asked outside the stretch is neither unanswered nor counted", async () => {
    // The first eighteen seconds hold the first question and not the second.
    const stretch = await replay(
      join(directory, "panel-practice.txt"),
      ...PANEL_CAST,
      "--timing",
      "--expect",
      join(directory, "panel-practice.expected.json"),
      "--from",
      "00:00:01",
      "--to",
      "00:00:18",
      "--results",
      join(directory, "stretched"),
    );
    expect(stretch.code).toBe(0);
    expect(stretch.stdout).toContain(
      "1 of 3 expected questions are said in this stretch; the others are not scored.",
    );
    const { result } = await keptIn(join(directory, "stretched"));
    expect(
      result.questions.map((question) => [question.id, question.answeredWhole]),
    ).toEqual([["charged-once", true]]);
    expect(stretch.stdout).toContain(
      "IN SHORT: 1 of 1 questions acted on whole",
    );
    // The whole call is scored on every question, as it always was.
    expect(runs.panel.stdout).not.toContain("are said in this stretch");
    expect(
      (await keptIn(join(directory, "named"))).result.questions,
    ).toHaveLength(3);
  });

  it("keeps a run without names as a benchmark of its own, so it is never compared with a named one", async () => {
    const named = await keptIn(join(directory, "named"));
    const unnamed = await keptIn(join(directory, "unnamed"));
    expect(unnamed.file).toMatch(/^panel-practice-unnamed-timing-.*\.json$/);
    expect(unnamed.result.benchmark).toBe("panel-practice-unnamed");
    expect(unnamed.result.names).toBe(false);
    expect(runs.panelNoNames.stdout).toContain(
      "BENCHMARK panel-practice-unnamed on timing",
    );
    expect(runs.panel.stdout).toContain("BENCHMARK panel-practice on timing");
    // The decisions scored are the same.
    const scored = (kept: Kept) =>
      kept.questions.map(({ id, answeredWhole, prematureActs, toActS }) => ({
        id,
        answeredWhole,
        prematureActs,
        toActS,
      }));
    expect(scored(unnamed.result)).toEqual(scored(named.result));
    expect(unnamed.result.quiet).toEqual(named.result.quiet);
  });
});

// Another mechanism may say when a turn is over (a framework's endpointing,
// for a comparison): the replay gives it its signals and tells the coach
// "still speaking" for as long as it says a speaker is not done.
describe("pnpm coach:replay with another end-of-turn mechanism", () => {
  const module = (body: string) => {
    const path = join(
      directory,
      `endpoint-${Math.random().toString(36).slice(2)}.mjs`,
    );
    writeFileSync(path, body);
    return path;
  };
  const interviewerActs = (ran: Ran) =>
    acts(ran).filter(([reason]) => reason !== "answer-check");

  it("an endpoint that never lets the interviewer's turn end keeps the coach from acting on it", async () => {
    const never = module(
      `export default () => ({ apply() {}, ready: role => role !== "interviewer" });`,
    );
    const held = await replay(file, ...CAST, "--timing", "--endpoint", never);
    const plain = await replay(file, ...CAST, "--timing");
    expect(held.code).toBe(0);
    expect(interviewerActs(plain).length).toBeGreaterThan(0);
    expect(interviewerActs(held)).toEqual([]);
  });

  it("the endpoint is given every signal once, none before its time, and is closed at the end", async () => {
    const log = join(directory, "endpoint-log.json");
    const recorder = module(
      `import { writeFileSync } from "node:fs";
       const seen = []; let early = 0;
       export default ({ kind }) => ({
         identity: { kind },
         apply(events, nowMs) { for (const e of events) { if (e.atMs > nowMs) early += 1; seen.push(e); } },
         ready: () => true,
         close() { writeFileSync(${JSON.stringify(log)}, JSON.stringify({ kind, early, seen })); },
       });`,
    );
    const ran = await replay(
      file,
      ...CAST,
      "--timing",
      "--signals",
      "vad",
      "--endpoint",
      recorder,
      "--endpoint-kind",
      "probe",
    );
    expect(ran.code).toBe(0);
    const kept = JSON.parse(readFileSync(log, "utf8")) as {
      kind: string;
      early: number;
      seen: {
        type: string;
        role: string;
        active?: boolean;
        atMs: number;
        speechAtMs?: number;
        endMs?: number;
        id?: string;
      }[];
    };
    expect(kept.kind).toBe("probe");
    expect(kept.early).toBe(0);
    const texts = kept.seen.filter((each) => each.type === "transcript");
    expect(new Set(texts.map((each) => each.id)).size).toBe(texts.length);
    expect(texts.length).toBeGreaterThan(0);
    // As a detector tells it: text 300 ms after the words, a start 150 ms and
    // a stop 500 ms after they happened.
    for (const text of texts)
      expect(text.atMs - (text.endMs as number)).toBe(300);
    const voice = kept.seen.filter((each) => each.type === "activity");
    expect(voice.length).toBeGreaterThan(0);
    for (const each of voice)
      expect(each.atMs - (each.speechAtMs as number)).toBe(
        each.active ? 150 : 500,
      );
    // Starts and stops pair up for each speaker.
    for (const role of ["interviewer", "candidate"])
      expect(
        voice.filter((each) => each.role === role && each.active).length,
      ).toBe(voice.filter((each) => each.role === role && !each.active).length);
  });

  it("with --endpoint-owns the coach acts as soon as the endpoint says the turn is over", async () => {
    // Ready one second after the interviewer's last text arrived.
    const afterOneSecond = module(
      `let last = -Infinity;
       export default () => ({
         apply(events) { for (const e of events) if (e.type === "transcript" && e.role === "interviewer") last = e.atMs; },
         ready: (role, nowMs) => role !== "interviewer" || nowMs - last >= 1000,
       });`,
    );
    const late = join(directory, "owned-late-phrase.txt");
    writeFileSync(late, LATE_TRANSCRIPT);
    const owned = await replay(
      late,
      ...CAST,
      "--timing",
      "--endpoint",
      afterOneSecond,
      "--endpoint-owns",
    );
    expect(owned.code).toBe(0);
    const waits = owned.stdout.split("\n").flatMap((line) => {
      const found = /ACT {4}(?:pause|question-finished) +\+(\d+\.\d)s/.exec(
        line,
      );
      return found ? [Number(found[1])] : [];
    });
    // The coach's own 2.5 s wait after a statement is gone: the endpoint's
    // second is all that is waited, after the statement and after the question.
    expect(waits).toEqual([1, 1]);
  });
});

// A replay given the person's material: the coach draws its facts from the
// context pack as the live coach does, a scripted note-writer stands in for
// the model, and what each note SAYS is scored (coach-notes-score.ts). No
// model is called: `--runtime scripted` steps the file's clock by hand.
describe("pnpm coach:replay with the person's material", () => {
  const REPOSITORY = join(WORKER, "..", "..");
  // Paths as they are typed from the repository's root, though the command
  // runs in this package's folder.
  const KESTREL =
    "products/interview/fixtures/context-pack/kestrel-freight-pay";
  const CALLS = "apps/agent-worker/fixtures/calls";
  const kestrel = (name: string) =>
    JSON.parse(readFileSync(join(REPOSITORY, KESTREL, name), "utf8"));
  const MATERIAL = [
    "--matrix",
    `${KESTREL}/matrix.json`,
    "--brief",
    `${KESTREL}/employer-brief.json`,
    "--application",
    `${KESTREL}/stages.json`,
    "--stage",
    "2",
  ];
  const companies: string[] = kestrel("matrix.json").roles.map(
    (role: { company: string }) => role.company,
  );

  type NoteScore = {
    evidence: {
      accepted: number;
      wrong: number;
      other: number;
      inferred: number;
      sources: string[];
      offeredAccepted: number;
      offeredOther: number;
      offered: boolean | null;
    };
    invented: { figures: number; employers: number };
    right: boolean | null;
  };
  type Scored = {
    benchmark: string;
    runtime: string;
    guarded: boolean;
    withinS: number;
    material: {
      pack: boolean;
      application: boolean;
      preferences: boolean;
      kept: boolean;
      stage: number | null;
    };
    totals: {
      rightEvidence: { right: number; of: number };
      wrongEmployer: number;
      invented: number;
      inTime: { right: number; of: number };
    };
    questions: {
      id: string;
      scenario: string;
      optional: boolean;
      askedBy: string | null;
      notedFrom: string | null;
      askerRight?: boolean | null;
      answeredWhole: boolean;
      questionToFirstLineS: number | null;
      acted: boolean;
      inTime: boolean | null;
      factsGiven: number;
      note: NoteScore | null;
    }[];
  };
  const scoredIn = async (folder: string) => {
    const files = await readdir(folder);
    expect(files).toHaveLength(1);
    const text = await readFile(join(folder, files[0] as string), "utf8");
    return {
      file: files[0] as string,
      text,
      result: JSON.parse(text) as Scored,
    };
  };
  const totalsLine = (ran: Ran) =>
    ran.stdout.trimEnd().split("\n").at(-1)?.trim() ?? "";
  const question = (result: Scored, id: string) =>
    result.questions.find(
      (each) => each.id === id,
    ) as Scored["questions"][number];

  // Every string a person's own files hold that is somebody's words: the
  // lines of the call, who spoke, the prose of the material, the plan.
  const prose = (value: unknown): string[] =>
    typeof value === "string"
      ? value.includes(" ") && value.length >= 8
        ? [value]
        : []
      : Array.isArray(value)
        ? value.flatMap(prose)
        : value && typeof value === "object"
          ? Object.values(value).flatMap(prose)
          : [];
  const PLAN =
    "Lead with the ledger story from Larchmont Pay.\npanel: Dana (product), Ravi (payments), Ines (people)\n";
  const PRIVATE_EXPECTED = {
    questions: [
      {
        id: "q1",
        from: "Ravi",
        scenario: "two panelists start at once",
        completeWhenSaid: "only charged once",
        about: ["idempotency", "go ahead"],
        evidence: companies,
      },
      {
        id: "q2",
        from: "Ines",
        completeWhenSaid: "notice period",
        nothing: true,
      },
    ],
    quiet: [{ id: "k1", said: "hand over to Ines" }],
  };

  const ran = {} as Record<
    | "scripted"
    | "scriptedAgain"
    | "scored"
    | "own"
    | "ownTraced"
    | "kept"
    | "half"
    | "noSuchStage"
    | "stageAlone"
    | "noTextFile"
    | "notAPack"
    | "resultsInside",
    Ran
  >;
  let own = "";

  beforeAll(async () => {
    own = await mkdtemp(join(tmpdir(), "coach-replay-own-"));
    // A person's own files, outside the repository: the call, its plan, what
    // is expected, and the material, with each stage transcript's words in a
    // file of its own beside the application.
    await writeFile(join(own, "call.txt"), PANEL_TRANSCRIPT);
    await writeFile(join(own, "plan.md"), PLAN);
    await writeFile(
      join(own, "call.expected.json"),
      JSON.stringify(PRIVATE_EXPECTED),
    );
    await writeFile(
      join(own, "matrix.json"),
      JSON.stringify(kestrel("matrix.json")),
    );
    await writeFile(
      join(own, "brief.json"),
      // As an application row holds it.
      JSON.stringify({
        employer_brief: JSON.stringify(kestrel("employer-brief.json")),
      }),
    );
    const stages = kestrel("stages.json") as {
      stages: { transcripts: Record<string, unknown>[] }[];
    };
    let texts = 0;
    const withFiles = (missing: boolean) => ({
      ...stages,
      stages: stages.stages.map((stage) => ({
        ...stage,
        transcripts: stage.transcripts.map(
          ({ text, sha256: _sha256, ...transcript }) => {
            texts += 1;
            const name = missing ? "gone.txt" : `said-${texts}.txt`;
            if (!missing) writeFileSync(join(own, name), String(text));
            return { ...transcript, textFile: name };
          },
        ),
      })),
    });
    await writeFile(
      join(own, "application.json"),
      JSON.stringify(withFiles(false)),
    );
    expect(texts).toBeGreaterThan(0);
    await writeFile(
      join(own, "application-gone.json"),
      JSON.stringify(withFiles(true)),
    );
    // A pack of another recipe: nothing of it stands, and the coach reads the
    // material as it is (kept.ts).
    await writeFile(
      join(own, "kept.json"),
      JSON.stringify({
        prepared: {
          recipe: { id: "another-recipe", version: "0" },
          sources: [],
          records: [],
          rejected: [],
        },
      }),
    );
    await writeFile(
      join(own, "not-a-pack.json"),
      JSON.stringify({ scores: 3 }),
    );
    // The panel fixture's own expectations, with whose evidence four of its
    // questions want: every employer, an employer the matrix does not have,
    // and nothing at all (said both ways).
    const expected = JSON.parse(
      readFileSync(
        join(REPOSITORY, CALLS, "panel-round", "expected.json"),
        "utf8",
      ),
    ) as { questions: Record<string, unknown>[] };
    const wants: Record<string, object> = {
      "charged-once": { evidence: companies },
      "slowest-carrier": { evidence: ["No Such Employer"] },
      salary: { nothing: true },
      "rate-limiting": { evidence: [] },
    };
    await writeFile(
      join(own, "panel-evidence.expected.json"),
      JSON.stringify({
        ...expected,
        questions: expected.questions.map((each) => ({
          ...each,
          ...(wants[each["id"] as string] ?? {}),
        })),
      }),
    );
    const OWN = [
      "--transcript",
      join(own, "call.txt"),
      ...PANEL_CAST,
      "--plan",
      join(own, "plan.md"),
      "--expect",
      join(own, "call.expected.json"),
      "--matrix",
      join(own, "matrix.json"),
      "--brief",
      join(own, "brief.json"),
    ];
    const made = await Promise.all([
      replay(
        "--bench",
        "panel-round",
        "--runtime",
        "scripted",
        ...MATERIAL,
        "--results",
        join(own, "scripted"),
      ),
      replay(
        "--bench",
        "panel-round",
        "--runtime",
        "scripted",
        ...MATERIAL,
        "--results",
        join(own, "scripted-again"),
      ),
      replay(
        "--bench",
        "panel-round",
        "--runtime",
        "scripted",
        ...MATERIAL,
        "--expect",
        join(own, "panel-evidence.expected.json"),
        "--results",
        join(own, "scored"),
      ),
      replay(
        ...OWN,
        "--application",
        join(own, "application.json"),
        "--stage",
        "2",
        "--runtime",
        "scripted",
        "--within",
        "3",
        "--results",
        join(own, "own"),
      ),
      replay(
        ...OWN,
        "--application",
        join(own, "application.json"),
        "--stage",
        "2",
        "--runtime",
        "scripted",
        "--trace",
        "--results",
        join(own, "own-traced"),
      ),
      // Every path from the repository's root but the kept pack's.
      replay(
        "--transcript",
        `${CALLS}/screening-services/transcript.txt`,
        "--expect",
        `${CALLS}/screening-services/expected.json`,
        ...CAST,
        "--matrix",
        `${KESTREL}/matrix.json`,
        "--brief",
        `${KESTREL}/employer-brief.json`,
        "--preferences",
        `${KESTREL}/preferences.txt`,
        "--kept",
        join(own, "kept.json"),
        "--runtime",
        "scripted",
        "--results",
        join(own, "kept"),
      ),
      replay(file, ...CAST, "--timing", "--matrix", join(own, "matrix.json")),
      replay(
        ...OWN,
        "--application",
        join(own, "application.json"),
        "--stage",
        "9",
        "--runtime",
        "scripted",
      ),
      replay(...OWN, "--stage", "2", "--runtime", "scripted"),
      replay(
        ...OWN,
        "--application",
        join(own, "application-gone.json"),
        "--runtime",
        "scripted",
      ),
      replay(
        ...OWN,
        "--kept",
        join(own, "not-a-pack.json"),
        "--runtime",
        "scripted",
      ),
      replay(
        ...OWN,
        "--runtime",
        "scripted",
        "--results",
        join(WORKER, "fixtures", "kept-here"),
      ),
    ]);
    const names = Object.keys({
      scripted: 0,
      scriptedAgain: 0,
      scored: 0,
      own: 0,
      ownTraced: 0,
      kept: 0,
      half: 0,
      noSuchStage: 0,
      stageAlone: 0,
      noTextFile: 0,
      notAPack: 0,
      resultsInside: 0,
    } satisfies Record<keyof typeof ran, 0>) as (keyof typeof ran)[];
    names.forEach((name, at) => {
      ran[name] = made[at] as Ran;
    });
  }, 120_000);

  afterAll(async () => {
    if (own) await rm(own, { recursive: true, force: true });
  });

  describe("--runtime scripted on the panel fixture with the Kestrel material", () => {
    it("writes a note for each question with no model, each built on a fact the coach was given", async () => {
      const run = ran.scripted;
      expect(run.code).toBe(0);
      expect(run.stderr).toBe("");
      expect(run.stdout).toContain(
        "Notes by a script (no model): each cites the first fact of a role the coach was given.",
      );
      expect(run.stdout).toMatch(
        /^\d\d:\d\d:\d\d {2}NOTE {3}first line \+\d+\.\ds after acting/m,
      );
      // A fixture of the repository: the notes are printed as they always were.
      expect(run.stdout).toMatch(/^ {3}say {6}From the record: \*\*.+\*\*✓$/m);
      const { file: name, result } = await scoredIn(join(own, "scripted"));
      expect(name).toMatch(/^panel-round\+pack-scripted-.*\.json$/);
      expect(result).toMatchObject({
        benchmark: "panel-round+pack",
        runtime: "scripted",
        guarded: false,
        withinS: 10,
        material: {
          pack: true,
          application: true,
          preferences: false,
          kept: false,
          stage: 2,
        },
      });
      const noted = result.questions.filter(
        (each) => each.questionToFirstLineS !== null,
      );
      expect(noted.length).toBeGreaterThanOrEqual(13);
      for (const each of noted) {
        // The pack gave the coach facts, and the note's one claim is verified
        // against a role of the matrix: the coach's own verifier says so.
        expect(each.factsGiven).toBeGreaterThan(0);
        expect(each.note?.evidence.sources).toHaveLength(1);
        const role = /^\/roles\/(\d+)(\/[\w-]+)*$/.exec(
          each.note?.evidence.sources[0] ?? "",
        )?.[1];
        expect(Number(role)).toBeLessThan(companies.length);
        expect(each.note?.evidence.inferred).toBe(0);
        // A claim copied from a given fact invents nothing.
        expect(each.note?.invented).toEqual({ figures: 0, employers: 0 });
        // The fixture's own expected file names nobody's evidence.
        expect(each.note?.right).toBeNull();
        expect(each.note?.evidence.offered).toBeNull();
      }
    });

    it("says of each question whether it was acted on and whether its note's first line came in time", async () => {
      const { result } = await scoredIn(join(own, "scripted"));
      for (const each of result.questions) {
        expect(each.acted).toBe(each.answeredWhole);
        expect(each.inTime).toBe(
          each.questionToFirstLineS !== null && each.questionToFirstLineS <= 10,
        );
      }
      const asked = result.questions.filter((each) => !each.optional);
      expect(asked).toHaveLength(13);
      expect(result.totals.inTime).toEqual({
        right: asked.filter((each) => each.inTime).length,
        of: 13,
      });
      // The absent model takes 4 s of the file's clock: every note is in time.
      expect(result.totals.inTime.right).toBe(13);
      expect(result.totals.rightEvidence).toEqual({ right: 0, of: 0 });
    });

    it("prints a row for each question and the totals on the last line", () => {
      const lines = ran.scripted.stdout.split("\n");
      const head = lines.findIndex((line) =>
        /^ {2}question +acted +first s +in time +evidence +wrong +inferred +own +unbacked +offered +invented +right +grounded$/.test(
          line,
        ),
      );
      expect(head).toBeGreaterThan(0);
      expect(lines[head + 1]).toMatch(
        /^ {2}service-or-monolith +yes +\d+(\.\d)? +yes +- +- +0 +0 +0 +- +0 +- +-$/,
      );
      expect(lines[head + 2]).toMatch(/^ {4}verified against \/roles\/\d+/);
      expect(totalsLine(ran.scripted)).toBe(
        "TOTALS: right evidence 0 of 0, grounded 0 of 0, offered 0 of 0, inference only 0, wrong employer 0, two employers 0, invented 0, in time 13 of 13",
      );
    });

    it("is the same run every time: the file's clock is stepped, nothing waits on a model", async () => {
      expect(ran.scriptedAgain.code).toBe(0);
      expect(ran.scriptedAgain.stdout).toBe(ran.scripted.stdout);
      const first = await scoredIn(join(own, "scripted"));
      const again = await scoredIn(join(own, "scripted-again"));
      expect(again.result.questions).toEqual(first.result.questions);
      expect(again.result.totals).toEqual(first.result.totals);
    });
  });

  describe("scored against expected evidence", () => {
    it("counts a note right when its verified claim is an accepted employer's, and wrong when it is another's", async () => {
      expect(ran.scored.code).toBe(0);
      const { result } = await scoredIn(join(own, "scored"));
      const right = question(result, "charged-once").note as NoteScore;
      expect(right).toMatchObject({
        right: true,
        evidence: { accepted: 1, wrong: 0, offered: true },
      });
      expect(right.evidence.offeredAccepted).toBeGreaterThan(0);
      expect(right.evidence.offeredOther).toBe(0);
      // An employer the matrix does not have: the pack could never offer it,
      // and the note that cites another is told apart from one that ignored it.
      const wrong = question(result, "slowest-carrier").note as NoteScore;
      expect(wrong).toMatchObject({
        right: false,
        evidence: { accepted: 0, wrong: 1, offered: false, offeredAccepted: 0 },
      });
      expect(wrong.evidence.offeredOther).toBeGreaterThan(0);
    });

    it("counts any employer cited as wrong where the material has nothing, said either way", async () => {
      const { result } = await scoredIn(join(own, "scored"));
      for (const id of ["salary", "rate-limiting"])
        expect(question(result, id).note).toMatchObject({
          right: false,
          evidence: { accepted: 0, wrong: 1, offered: null },
        });
    });

    it("leaves a question with no expectation unjudged, and totals the rest on the last line", async () => {
      const { result } = await scoredIn(join(own, "scored"));
      expect(question(result, "data-ownership").note?.right).toBeNull();
      expect(result.totals).toEqual({
        rightEvidence: { right: 1, of: 4 },
        grounded: { right: 1, of: 4 },
        inferenceOnly: 0,
        // Two of the four name an employer; the pack offered one of them.
        offered: { right: 1, of: 2 },
        wrongEmployer: 3,
        mixed: 0,
        invented: 0,
        inTime: { right: 13, of: 13 },
      });
      expect(totalsLine(ran.scored)).toBe(
        "TOTALS: right evidence 1 of 4, grounded 1 of 4, offered 1 of 2, inference only 0, wrong employer 3, two employers 0, invented 0, in time 13 of 13",
      );
    });

    it("gives the coach the same facts whatever is expected of the note: the same claims, verified against the same places", async () => {
      const plain = await scoredIn(join(own, "scripted"));
      const scored = await scoredIn(join(own, "scored"));
      expect(
        scored.result.questions.map((each) => [
          each.id,
          each.factsGiven,
          each.note?.evidence.sources,
        ]),
      ).toEqual(
        plain.result.questions.map((each) => [
          each.id,
          each.factsGiven,
          each.note?.evidence.sources,
        ]),
      );
    });
  });

  // [SAFETY] A person's own call and material are never copied into what is
  // printed or kept: ids, pointers, counts, clock times and scores only.
  describe("on files outside the repository", () => {
    const words = () => [
      // The lines of the call, and who spoke them.
      ...PANEL_TRANSCRIPT.split("\n").flatMap((line) => {
        const said = /^([A-Z][a-z]+): (.+)$/.exec(line);
        return said ? [said[2] as string] : [];
      }),
      ...["Dana", "Ravi", "Ines", "Marisol"],
      // The person's record, the employer's brief and the application.
      ...companies,
      kestrel("matrix.json").candidate.name as string,
      ...prose(kestrel("matrix.json")),
      ...prose(kestrel("employer-brief.json")),
      ...prose(kestrel("stages.json")),
      ...PLAN.trim().split("\n"),
      ...prose(PRIVATE_EXPECTED),
    ];

    it("replays it, scores it and keeps the result where it was asked to", async () => {
      const run = ran.own;
      expect(run.code).toBe(0);
      expect(run.stderr).toBe("");
      const { file: name, result } = await scoredIn(join(own, "own"));
      expect(name).toMatch(/^call\+pack-scripted-.*\.json$/);
      expect(result).toMatchObject({
        benchmark: "call+pack",
        guarded: true,
        withinS: 3,
        material: { pack: true, application: true, kept: false, stage: 2 },
      });
      // Every employer of the matrix is accepted for the first; the material
      // has nothing for the second, and the scripted writer cites a role.
      expect(
        result.questions.map((each) => [each.id, each.acted, each.note?.right]),
      ).toEqual([
        ["q1", true, true],
        ["q2", true, false],
      ]);
      // Four seconds of model on top of the wait to act is not within three.
      expect(result.totals).toEqual({
        rightEvidence: { right: 1, of: 2 },
        grounded: { right: 1, of: 2 },
        inferenceOnly: 0,
        offered: { right: 1, of: 1 },
        wrongEmployer: 1,
        mixed: 0,
        invented: 0,
        inTime: { right: 0, of: 2 },
      });
      expect(totalsLine(run)).toBe(
        "TOTALS: right evidence 1 of 2, grounded 1 of 2, offered 1 of 1, inference only 0, wrong employer 1, two employers 0, invented 0, in time 0 of 2",
      );
    });

    it("writes no word of the transcript, the plan or the material into the result file", async () => {
      const { text, result } = await scoredIn(join(own, "own"));
      const held = words();
      expect(held.length).toBeGreaterThan(300);
      for (const each of held) expect(text).not.toContain(each);
      // Who asked is kept as right or wrong, never as a name; the scenario
      // the expected file describes is not kept.
      for (const each of result.questions) {
        expect(each.askedBy).toBeNull();
        expect(each.notedFrom).toBeNull();
        expect(each.scenario).toBe("");
      }
      // (The scripted writer names nobody, and two panelists spoke in each
      // turn, so there is no asker to have got right.)
      expect(result.questions.map((each) => each.askerRight)).toEqual([
        null,
        null,
      ]);
      // Every string it holds is an id, a pointer, a time or a name of the
      // run: nothing else is text at all.
      const strings = (value: unknown): string[] =>
        typeof value === "string"
          ? [value]
          : value && typeof value === "object"
            ? Object.values(value).flatMap(strings)
            : [];
      for (const each of strings(result))
        expect(each).toMatch(
          /^(|call\+pack|scripted|ideal|strict|words|q[12]|k1|[0-9a-f]{7,40}|unknown|\d{4}-\d\d-\d\dT[\d:.]+Z|\/roles\/\d+(\/[\w-]+)*)$/,
        );
    });

    it("prints no word of them either: where a turn is, how long a note is, and the scores", () => {
      const { stdout } = ran.own;
      for (const each of words()) expect(stdout).not.toContain(each);
      expect(stdout).toMatch(
        /^Replaying 00:00:05 to 00:00:41: 9 pieces\. 3 interviewer, 1 me\. The coach is told who speaks: 3 interviewers\.$/m,
      );
      expect(stdout).toMatch(
        /^\d\d:\d\d:\d\d {2}ACT {4}question-finished +\+\d+\.\ds after lines \d+ to \d+ \(\d+ words\)$/m,
      );
      expect(stdout).not.toMatch(/ after "/);
      expect(stdout).toMatch(
        /^\d\d:\d\d:\d\d {2}direct-answer: 1 lines, 1 claims verified, 0 inferred {2}\/roles\/\d+/m,
      );
      expect(stdout).not.toContain("From the record");
      expect(stdout).toMatch(/^ {4}who asked: the note names nobody$/m);
      expect(stdout).not.toContain("invented:");
    });

    it("--trace is the one way to see what was said: the prompt, the reply and the note", () => {
      const { code, stdout } = ran.ownTraced;
      expect(code).toBe(0);
      expect(stdout).toContain("only charged once");
      expect(stdout).toContain(
        "THE CANDIDATE'S RECORD (cite a fact by its [pointer]):",
      );
      expect(stdout).toMatch(
        /^ {5}note coach-replay-\d+ revision 1: \[say\] From the record: /m,
      );
      // The model's raw reply, which a call that finished used never to show.
      expect(stdout).toMatch(/^──── call 1: reply \(first text /m);
      expect(stdout).toMatch(/^SAY: From the record: \*\*.+\*\*\[\/roles\//m);
      // The coach was given the plan and the material it was replayed with.
      expect(stdout).toContain(
        "Lead with the ledger story from Larchmont Pay.",
      );
      expect(stdout).toContain(
        "EMPLOYER MATERIAL (not the candidate's experience):",
      );
    });

    it("refuses to keep its result inside the repository, outside .dev-local/, before replaying anything", async () => {
      const { code, stdout, stderr } = ran.resultsInside;
      expect(code).toBe(2);
      expect(stderr).toContain("under .dev-local/ or outside the repository");
      expect(stdout).toBe("");
      await expect(
        readdir(join(WORKER, "fixtures", "kept-here")),
      ).rejects.toThrow();
    });
  });

  it("reads every path from the repository's root, and a kept pack with today's material", async () => {
    const run = ran.kept;
    expect(run.code).toBe(0);
    expect(run.stderr).toBe("");
    const { result } = await scoredIn(join(own, "kept"));
    // A call kept as a folder is named by its folders; a coach given a kept
    // pack is a benchmark of its own.
    expect(result.benchmark).toBe("calls-screening-services+kept");
    expect(result.material).toEqual({
      pack: true,
      application: false,
      preferences: true,
      kept: true,
      stage: null,
    });
    // The kept pack is outside the repository, so the run is a guarded one.
    expect(result.guarded).toBe(true);
    expect(result.questions.every((each) => each.acted)).toBe(true);
    expect(
      result.questions.some(
        (each) => (each.note?.evidence.sources.length ?? 0) > 0,
      ),
    ).toBe(true);
  });

  it.each([
    ["half", 2, "needs --matrix and --brief together"],
    ["noSuchStage", 1, "The application has no stage 9."],
    ["stageAlone", 1, "A stage needs the application it is of."],
    ["noTextFile", 1, "A transcript's text file could not be read: "],
    ["notAPack", 1, "That file holds no prepared pack: "],
  ] as const)(
    "%s: material that cannot be used is refused with exit %i, saying which and never what it holds",
    (name, code, message) => {
      const run = ran[name];
      expect(run.code).toBe(code);
      expect(run.stderr).toContain(message);
      expect(run.stderr).not.toContain("at readFileSync");
      expect(run.stdout).not.toContain("ACT");
      for (const each of companies) expect(run.stderr).not.toContain(each);
    },
  );
});
