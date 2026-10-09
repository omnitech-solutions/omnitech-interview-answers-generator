// The owner's own recording of what a session hears: off until asked for, one
// file per press of record, a block per heard line while it is on and for
// that session only, and a file the replay reads back as it was heard. Every
// file is under a temporary directory; every line said is invented.
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
import { readTranscript } from "../coach/transcript-file";
import type { HeardLine } from "./ingest";
import { createTranscriptRecordings } from "./transcript-recording";

const root = mkdtempSync(join(tmpdir(), "transcript-recording-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let made = 0;
// A recorder over a folder of its own, which does not exist yet.
const fresh = () => {
  made += 1;
  const directory = join(root, `case-${made}`, "transcripts");
  return { directory, recordings: createTranscriptRecordings(directory) };
};
const SESSION = "5e551011-0000-4000-8000-00000000000a";
const OTHER = "07he2222-0000-4000-8000-00000000000b";
const T0 = new Date("2026-10-08T09:40:00.000Z");
const heardIn = (
  sessionId: string,
  text: string,
  afterMs: number,
  source?: string,
): HeardLine => ({
  text,
  ...(source ? { source } : {}),
  occurredAt: new Date(T0.getTime() + afterMs).toISOString(),
  session: { tenantId: "tenant-test", actorId: "actor-test", sessionId },
  remote: true,
});
// The time of day a block is stamped with, as the recorder writes it (the
// machine's own clock), and the same in milliseconds as the replay reads it.
const stamp = (afterMs: number) =>
  new Date(T0.getTime() + afterMs).toTimeString().slice(0, 8);
const clockMs = (afterMs: number) => {
  const at = new Date(T0.getTime() + afterMs);
  return (at.getHours() * 3600 + at.getMinutes() * 60 + at.getSeconds()) * 1000;
};
const filesIn = (directory: string) =>
  existsSync(directory) ? readdirSync(directory).sort() : [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("a recording that was never started", () => {
  it("is off, with no file and no lines, and nothing is made on disk", () => {
    const { directory, recordings } = fresh();
    expect(recordings.state(SESSION)).toEqual({ on: false, lines: 0 });
    expect(existsSync(directory)).toBe(false);
  });

  it("writes nothing of what is heard, and stays off", () => {
    const { directory, recordings } = fresh();
    recordings.heard(heardIn(SESSION, "said before any recording", 1_000));
    expect(recordings.state(SESSION)).toEqual({ on: false, lines: 0 });
    expect(filesIn(directory)).toEqual([]);
  });

  it("stays off when stopped", () => {
    const { recordings } = fresh();
    expect(recordings.stop(SESSION)).toEqual({ on: false, lines: 0 });
  });
});

describe("pressing record", () => {
  it("turns it on: when it began, an empty count and a file named by the moment and the session", () => {
    const { recordings } = fresh();
    const state = recordings.start(SESSION);
    expect(state).toEqual({
      on: true,
      startedAt: "2026-10-08T09:40:00.000Z",
      file: "2026-10-08T09-40-00-5e551011.txt",
      lines: 0,
    });
    expect(recordings.state(SESSION)).toEqual(state);
  });

  it("a second press while it is on is the same recording: its file, its start and its lines", () => {
    const { directory, recordings } = fresh();
    const first = recordings.start(SESSION);
    recordings.heard(heardIn(SESSION, "one line so far", 2_000, "microphone"));
    vi.setSystemTime(T0.getTime() + 90_000);
    expect(recordings.start(SESSION)).toEqual({ ...first, lines: 1 });
    expect(filesIn(directory)).toEqual([first.file]);
  });

  it("after a stop it is a NEW file: the earlier one is never added to", () => {
    const { directory, recordings } = fresh();
    const first = recordings.start(SESSION);
    recordings.heard(heardIn(SESSION, "kept in the first", 2_000));
    recordings.stop(SESSION);
    const before = readFileSync(join(directory, first.file as string), "utf8");
    vi.setSystemTime(T0.getTime() + 60_000);
    const second = recordings.start(SESSION);
    expect(second).toEqual({
      on: true,
      startedAt: "2026-10-08T09:41:00.000Z",
      file: "2026-10-08T09-41-00-5e551011.txt",
      lines: 0,
    });
    recordings.heard(heardIn(SESSION, "kept in the second", 62_000));
    expect(filesIn(directory)).toEqual([first.file, second.file]);
    expect(readFileSync(join(directory, first.file as string), "utf8")).toBe(
      before,
    );
    expect(
      readFileSync(join(directory, second.file as string), "utf8"),
    ).not.toContain("kept in the first");
    expect(recordings.state(SESSION).lines).toBe(1);
  });

  // DEFECT (transcript-recording.ts:66): the file is named to the second, so
  // record, stop and record again within one second names the SAME file: the
  // second recording is appended to the first, whose lines it then counts
  // from 0. "One file per press of record: an earlier one is never added to"
  // does not hold. Remove `.fails` when each press has a file of its own.
  it.fails("DEFECT: a stop and a press within the same second is a new file too", () => {
    const { recordings } = fresh();
    const first = recordings.start(SESSION);
    recordings.stop(SESSION);
    vi.setSystemTime(T0.getTime() + 400);
    expect(recordings.start(SESSION).file).not.toBe(first.file);
  });

  // DEFECT, minor (transcript-recording.ts:67-75): pressing record makes the
  // folder and names a file but creates none until a line is heard, so a
  // recording stopped before anything was said reports a `file` that does not
  // exist (the window then says "The last one is kept as <file>"). Remove
  // `.fails` when the file is there from the press, or is not named until it is.
  it.fails("DEFECT: the file a press names exists", () => {
    const { directory, recordings } = fresh();
    const { file } = recordings.start(SESSION);
    expect(existsSync(join(directory, file as string))).toBe(true);
  });

  it("makes its folder, however deep, on the first press", () => {
    const { directory, recordings } = fresh();
    recordings.start(SESSION);
    expect(statSync(directory).isDirectory()).toBe(true);
  });
});

describe("what is heard while it is on", () => {
  it("is appended as a block: from the line before it (or the press) to when it was heard, then who and what", () => {
    const { directory, recordings } = fresh();
    const { file } = recordings.start(SESSION);
    recordings.heard(
      heardIn(SESSION, "How would you shard it?", 5_000, "application-audio"),
    );
    recordings.heard(heardIn(SESSION, "By region first.", 9_000, "microphone"));
    recordings.heard(heardIn(SESSION, "words from the room", 12_000));
    recordings.heard(heardIn(SESSION, "an unknown source", 13_000, "screen"));
    expect(readFileSync(join(directory, file as string), "utf8")).toBe(
      [
        `${stamp(0)} --> ${stamp(5_000)}`,
        "Interviewer: How would you shard it?",
        "",
        `${stamp(5_000)} --> ${stamp(9_000)}`,
        "Me: By region first.",
        "",
        `${stamp(9_000)} --> ${stamp(12_000)}`,
        "Heard: words from the room",
        "",
        `${stamp(12_000)} --> ${stamp(13_000)}`,
        "Heard: an unknown source",
        "",
        "",
      ].join("\n"),
    );
    expect(stamp(5_000)).toMatch(/^\d{2}:\d{2}:05$/);
    expect(recordings.state(SESSION).lines).toBe(4);
  });

  it("keeps a line on one line: its line breaks and runs of space are closed up", () => {
    const { directory, recordings } = fresh();
    const { file } = recordings.start(SESSION);
    recordings.heard(
      heardIn(
        SESSION,
        "  first part\n\nsecond\tpart  \r\n",
        3_000,
        "microphone",
      ),
    );
    expect(
      readFileSync(join(directory, file as string), "utf8").split("\n")[1],
    ).toBe("Me: first part second part");
  });

  it("is for that session only: another session's line is written nowhere and counted nowhere", () => {
    const { directory, recordings } = fresh();
    const { file } = recordings.start(SESSION);
    recordings.heard(heardIn(OTHER, "said in another session", 2_000));
    expect(recordings.state(SESSION).lines).toBe(0);
    expect(recordings.state(OTHER)).toEqual({ on: false, lines: 0 });
    recordings.heard(heardIn(SESSION, "said in this one", 3_000));
    expect(filesIn(directory)).toEqual([file]);
    expect(readFileSync(join(directory, file as string), "utf8")).not.toContain(
      "another session",
    );
  });

  it("two sessions recorded at once each keep their own file", () => {
    const { directory, recordings } = fresh();
    const mine = recordings.start(SESSION);
    const theirs = recordings.start(OTHER);
    expect(theirs.file).not.toBe(mine.file);
    recordings.heard(heardIn(SESSION, "mine alone", 1_000));
    recordings.heard(heardIn(OTHER, "theirs alone", 2_000));
    recordings.stop(SESSION);
    recordings.heard(heardIn(OTHER, "theirs again", 3_000));
    expect(recordings.state(SESSION)).toMatchObject({ on: false, lines: 1 });
    expect(recordings.state(OTHER)).toMatchObject({ on: true, lines: 2 });
    const text = (file?: string) =>
      readFileSync(join(directory, file as string), "utf8");
    expect(text(mine.file)).not.toContain("theirs");
    expect(text(theirs.file)).not.toContain("mine");
  });

  it("is written to a file only its owner can read (0600)", () => {
    const { directory, recordings } = fresh();
    const { file } = recordings.start(SESSION);
    recordings.heard(heardIn(SESSION, "for the owner's eyes", 1_000));
    expect(statSync(join(directory, file as string)).mode & 0o777).toBe(0o600);
  });

  it("is timed by this machine's clock when a line says no time that can be read, and never backwards", () => {
    const { directory, recordings } = fresh();
    const { file } = recordings.start(SESSION);
    vi.setSystemTime(T0.getTime() + 7_000);
    recordings.heard({
      ...heardIn(SESSION, "no time on this one", 0),
      occurredAt: "not a time",
    });
    // Heard, by its own clock, before the line already written.
    recordings.heard(heardIn(SESSION, "a clock behind", 4_000));
    const lines = readFileSync(join(directory, file as string), "utf8").split(
      "\n",
    );
    expect(lines[0]).toBe(`${stamp(0)} --> ${stamp(7_000)}`);
    expect(lines[3]).toBe(`${stamp(4_000)} --> ${stamp(4_000)}`);
  });

  it("loses the line, never the session, when the file cannot be written", () => {
    const { directory, recordings } = fresh();
    recordings.start(SESSION);
    rmSync(directory, { recursive: true, force: true });
    expect(() =>
      recordings.heard(heardIn(SESSION, "nowhere to write this", 1_000)),
    ).not.toThrow();
    expect(recordings.state(SESSION)).toMatchObject({ on: true, lines: 0 });
  });
});

describe("stopping", () => {
  it("turns it off and keeps the file's name and how many lines it holds, without a start", () => {
    const { recordings } = fresh();
    const { file } = recordings.start(SESSION);
    recordings.heard(heardIn(SESSION, "one", 1_000));
    recordings.heard(heardIn(SESSION, "two", 2_000));
    const stopped = recordings.stop(SESSION);
    expect(stopped).toEqual({ on: false, file, lines: 2 });
    expect(recordings.state(SESSION)).toEqual(stopped);
    // Stopping again changes nothing.
    expect(recordings.stop(SESSION)).toEqual(stopped);
  });

  it("writes nothing heard afterwards", () => {
    const { directory, recordings } = fresh();
    const { file } = recordings.start(SESSION);
    recordings.heard(heardIn(SESSION, "while it was on", 1_000));
    recordings.stop(SESSION);
    recordings.heard(heardIn(SESSION, "after it was stopped", 2_000));
    expect(recordings.state(SESSION).lines).toBe(1);
    expect(readFileSync(join(directory, file as string), "utf8")).not.toContain(
      "after it was stopped",
    );
  });

  it("is not remembered by a new recorder over the same folder: off, every time", () => {
    const { directory, recordings } = fresh();
    recordings.start(SESSION);
    expect(createTranscriptRecordings(directory).state(SESSION)).toEqual({
      on: false,
      lines: 0,
    });
  });
});

describe("the file, read back for a replay", () => {
  it("gives each heard line as a block: its speaker's label, its words and its times", () => {
    const { directory, recordings } = fresh();
    const { file } = recordings.start(SESSION);
    const said = [
      [
        "application-audio",
        "Tell me about a hard migration: what broke?",
        6_000,
      ],
      ["microphone", "We moved the ledger at 10:30, in two steps.", 15_000],
      [undefined, "Note: someone coughs", 16_000],
      ["application-audio", "And then?", 21_000],
    ] as const;
    for (const [source, text, afterMs] of said)
      recordings.heard(heardIn(SESSION, text, afterMs, source));
    const blocks = readTranscript(
      readFileSync(join(directory, file as string), "utf8"),
    );
    expect(blocks).toEqual([
      {
        label: "Interviewer",
        text: "Tell me about a hard migration: what broke?",
        startMs: clockMs(0),
        endMs: clockMs(6_000),
      },
      {
        label: "Me",
        text: "We moved the ledger at 10:30, in two steps.",
        startMs: clockMs(6_000),
        endMs: clockMs(15_000),
      },
      {
        label: "Heard",
        text: "Note: someone coughs",
        startMs: clockMs(15_000),
        endMs: clockMs(16_000),
      },
      {
        label: "Interviewer",
        text: "And then?",
        startMs: clockMs(16_000),
        endMs: clockMs(21_000),
      },
    ]);
    expect(blocks).toHaveLength(recordings.state(SESSION).lines);
  });

  it("reads back a line that was heard with line breaks as one block", () => {
    const { directory, recordings } = fresh();
    const { file } = recordings.start(SESSION);
    recordings.heard(
      heardIn(
        SESSION,
        "first\nMe: not another speaker\n12:00:00 --> 12:00:05",
        4_000,
        "application-audio",
      ),
    );
    expect(
      readTranscript(readFileSync(join(directory, file as string), "utf8")),
    ).toEqual([
      {
        label: "Interviewer",
        text: "first Me: not another speaker 12:00:00 --> 12:00:05",
        startMs: clockMs(0),
        endMs: clockMs(4_000),
      },
    ]);
  });
});
