// The coach's transcript in memory: lines numbered as they arrive, read from
// a cursor, bounded, and gone (with a new epoch) when cleared. And a recorder's
// exported transcript read into lines. Every name and sentence here is invented.
import {
  coachTranscriptInputSchema,
  coachTranscriptResponseSchema,
} from "@omnitech/interview-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCoachTranscript,
  parseTranscriptFile,
  speakerOfSource,
} from "./coach-transcript";

const AT = "2026-10-08T09:00:00.000Z";

afterEach(() => {
  vi.useRealTimers();
});

describe("the coach transcript", () => {
  it("starts empty, at cursor 0, under an epoch", () => {
    const transcript = createCoachTranscript();
    const read = transcript.since();
    expect(read).toEqual({ epoch: expect.any(String), cursor: 0, lines: [] });
    expect(read.epoch.length).toBeGreaterThan(0);
    expect(coachTranscriptResponseSchema.safeParse(read).success).toBe(true);
  });

  it("numbers lines from 1, rising by one across calls, and answers an add with the cursor alone", () => {
    const transcript = createCoachTranscript();
    const first = transcript.add([
      {
        speaker: "interviewer",
        text: "Tell me about the ferry timetable.",
        at: AT,
      },
      { speaker: "candidate", text: "I rebuilt it last spring.", at: AT },
    ]);
    expect(first).toEqual({
      epoch: transcript.since().epoch,
      cursor: 2,
      lines: [],
    });
    const second = transcript.add([{ text: "And then?", at: AT }]);
    expect(second.cursor).toBe(3);
    const read = transcript.since();
    expect(read.lines).toEqual([
      {
        seq: 1,
        speaker: "interviewer",
        text: "Tell me about the ferry timetable.",
        at: AT,
      },
      {
        seq: 2,
        speaker: "candidate",
        text: "I rebuilt it last spring.",
        at: AT,
      },
      { seq: 3, speaker: "unknown", text: "And then?", at: AT },
    ]);
    expect(coachTranscriptResponseSchema.safeParse(read).success).toBe(true);
  });

  it("trims a line, drops a blank one without spending a seq, and stamps now when no time is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T10:15:00.000Z"));
    const transcript = createCoachTranscript();
    transcript.add([{ text: "   " }, { text: "  Padded words.  " }]);
    expect(transcript.since().lines).toEqual([
      {
        seq: 1,
        speaker: "unknown",
        text: "Padded words.",
        at: "2026-10-08T10:15:00.000Z",
      },
    ]);
  });

  it("reads the lines after a cursor, oldest first, with the newest seq as the cursor", () => {
    const transcript = createCoachTranscript();
    transcript.add(
      ["one", "two", "three", "four"].map((text) => ({ text, at: AT })),
    );
    expect(transcript.since(2)).toMatchObject({
      cursor: 4,
      lines: [
        { seq: 3, text: "three" },
        { seq: 4, text: "four" },
      ],
    });
    expect(transcript.since(4)).toMatchObject({ cursor: 4, lines: [] });
    expect(transcript.since(99)).toMatchObject({ cursor: 4, lines: [] });
    expect(transcript.since(0).lines).toHaveLength(4);
  });

  it("a clear starts a new epoch, empties the lines and numbers from 1 again", () => {
    const transcript = createCoachTranscript();
    transcript.add([
      { text: "before", at: AT },
      { text: "the clear", at: AT },
    ]);
    const before = transcript.since().epoch;
    const cleared = transcript.clear();
    expect(cleared).toEqual({
      epoch: expect.any(String),
      cursor: 0,
      lines: [],
    });
    expect(cleared.epoch).not.toBe(before);
    expect(transcript.since()).toEqual(cleared);
    expect(transcript.add([{ text: "after", at: AT }])).toEqual({
      epoch: cleared.epoch,
      cursor: 1,
      lines: [],
    });
    expect(transcript.since().lines).toEqual([
      { seq: 1, speaker: "unknown", text: "after", at: AT },
    ]);
  });

  it("two transcripts never share an epoch", () => {
    expect(createCoachTranscript().since().epoch).not.toBe(
      createCoachTranscript().since().epoch,
    );
  });

  it("holds the newest 4,000 lines: the oldest fall off and no seq is reused", () => {
    const transcript = createCoachTranscript();
    const batch = (from: number, count: number) =>
      Array.from({ length: count }, (_, at) => ({
        text: `line ${from + at}`,
        at: AT,
      }));
    transcript.add(batch(1, 2_000));
    transcript.add(batch(2_001, 2_000));
    expect(transcript.since().lines).toHaveLength(4_000);
    transcript.add(batch(4_001, 3));
    const read = transcript.since();
    expect(read.cursor).toBe(4_003);
    expect(read.lines).toHaveLength(4_000);
    expect(read.lines[0]).toMatchObject({ seq: 4, text: "line 4" });
    expect(read.lines.at(-1)).toMatchObject({ seq: 4_003, text: "line 4003" });
    // A reader behind the cap is given what is still held, never an error.
    expect(transcript.since(1).lines[0]?.seq).toBe(4);
  });
});

describe("the live session the coach transcript was heard in", () => {
  const SESSION = {
    tenantId: "00000000-0000-4000-8000-000000000001",
    actorId: "00000000-0000-4000-8000-000000000002",
    sessionId: "00000000-0000-4000-8000-000000000003",
  };
  const NEXT = {
    ...SESSION,
    sessionId: "00000000-0000-4000-8000-000000000004",
  };

  it("is absent for a transcript that was only ever attached", () => {
    const transcript = createCoachTranscript();
    expect(transcript.add([{ text: "attached", at: AT }])).not.toHaveProperty(
      "session",
    );
    expect(transcript.since()).not.toHaveProperty("session");
    expect(transcript.clear()).not.toHaveProperty("session");
  });

  it("is named on every answer once a session's line was added, by its ids only", () => {
    const transcript = createCoachTranscript();
    expect(
      transcript.add([{ text: "heard live", at: AT }], SESSION).session,
    ).toEqual(SESSION);
    const read = transcript.since();
    expect(read.session).toEqual(SESSION);
    expect(coachTranscriptResponseSchema.safeParse(read).success).toBe(true);
    // An attached line afterwards leaves the session as it was.
    expect(transcript.add([{ text: "attached", at: AT }]).session).toEqual(
      SESSION,
    );
  });

  it("follows the session last heard", () => {
    const transcript = createCoachTranscript();
    transcript.add([{ text: "first session", at: AT }], SESSION);
    transcript.add([{ text: "second session", at: AT }], NEXT);
    expect(transcript.since().session).toEqual(NEXT);
  });

  it("outlives a clear, so a transcript attached afterwards keeps that session", () => {
    const transcript = createCoachTranscript();
    transcript.add([{ text: "heard live", at: AT }], SESSION);
    const cleared = transcript.clear();
    expect(cleared).toEqual({
      epoch: expect.any(String),
      cursor: 0,
      lines: [],
      session: SESSION,
    });
    transcript.add([{ text: "attached afterwards", at: AT }]);
    expect(transcript.since()).toMatchObject({ cursor: 1, session: SESSION });
  });
});

describe("who an audio source is to the coach", () => {
  it.each([
    ["microphone", "candidate"],
    ["application-audio", "interviewer"],
    ["screen", "unknown"],
    ["", "unknown"],
    [undefined, "unknown"],
  ] as const)("%s is the %s", (source, speaker) => {
    expect(speakerOfSource(source)).toBe(speaker);
  });
});

describe("a recorder's transcript file", () => {
  const startedAt = new Date("2026-10-08T09:00:00.000Z");
  const speakers = {
    "Speaker 1": "interviewer",
    "Mira Okonjo": "candidate",
  } as const;
  const FILE = [
    "00:00:03 --> 00:00:09",
    "Speaker 1: Thanks for joining, Mira.",
    "",
    "00:00:10 --> 00:00:14",
    "Speaker 1: Tell me about the tide table service",
    "",
    "00:00:15 --> 00:00:19",
    "Speaker 1: you rebuilt at Harbourline.",
    "",
    "00:01:12 --> 00:01:19",
    "Mira Okonjo: We moved it off a nightly batch.",
    "",
    "01:02:03 --> 01:02:08",
    "Guest 7: Can you hear me?",
    "",
  ].join("\n");

  it("reads `Label: text` blocks, joins consecutive blocks by one speaker, and maps the labels", () => {
    expect(parseTranscriptFile(FILE, { speakers, startedAt })).toEqual([
      {
        speaker: "interviewer",
        text: "Thanks for joining, Mira. Tell me about the tide table service you rebuilt at Harbourline.",
        at: "2026-10-08T09:00:03.000Z",
      },
      {
        speaker: "candidate",
        text: "We moved it off a nightly batch.",
        at: "2026-10-08T09:01:12.000Z",
      },
      {
        speaker: "unknown",
        text: "Can you hear me?",
        at: "2026-10-08T10:02:03.000Z",
      },
    ]);
  });

  it("gives lines the contract takes, with no label left on them", () => {
    const lines = parseTranscriptFile(FILE, { speakers, startedAt });
    expect(coachTranscriptInputSchema.safeParse({ lines }).success).toBe(true);
    for (const line of lines)
      expect(Object.keys(line).sort()).toEqual(["at", "speaker", "text"]);
  });

  it("places each line on the clock by its block's start offset from `startedAt`", () => {
    const lines = parseTranscriptFile(
      [
        "0:00:00 --> 0:00:02",
        "Speaker 1: First.",
        "00:10:30.250 --> 00:10:33.900",
        "Speaker 2: Second.",
        "02:00:00,500 --> 02:00:04,000",
        "Speaker 1: Third.",
      ].join("\r\n"),
      { startedAt },
    );
    expect(lines.map((line) => line.at)).toEqual([
      "2026-10-08T09:00:00.000Z",
      "2026-10-08T09:10:30.000Z",
      "2026-10-08T11:00:00.000Z",
    ]);
  });

  it("an unmapped label, and every label when no mapping is given, is unknown", () => {
    expect(
      parseTranscriptFile(FILE, { startedAt }).map((line) => line.speaker),
    ).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("a change of speaker ends the join, and the same speaker later starts another line", () => {
    const lines = parseTranscriptFile(
      [
        "00:00:01 --> 00:00:02",
        "Speaker 1: One.",
        "00:00:03 --> 00:00:04",
        "Speaker 2: Two.",
        "00:00:05 --> 00:00:06",
        "Speaker 1: Three.",
        "00:00:07 --> 00:00:08",
        "Speaker 1: Four.",
      ].join("\n"),
      { startedAt },
    );
    expect(lines.map((line) => line.text)).toEqual([
      "One.",
      "Two.",
      "Three. Four.",
    ]);
    expect(lines[2]?.at).toBe("2026-10-08T09:00:05.000Z");
  });

  it("stops joining once a line would pass 1,200 characters", () => {
    const block = (at: number, text: string) =>
      `00:00:0${at} --> 00:00:0${at + 1}\nSpeaker 1: ${text}`;
    const lines = parseTranscriptFile(
      [
        block(1, "a".repeat(700)),
        block(2, "b".repeat(499)),
        block(3, "c"),
      ].join("\n\n"),
      { startedAt },
    );
    expect(lines.map((line) => line.text.length)).toEqual([700 + 1 + 499, 1]);
    expect(lines[1]?.at).toBe("2026-10-08T09:00:03.000Z");
  });

  it("skips a block with no words and a label with nothing after it", () => {
    expect(
      parseTranscriptFile(
        "00:00:01 --> 00:00:02\n\n00:00:03 --> 00:00:04\nSpeaker 1:   \n",
        { startedAt },
      ),
    ).toEqual([]);
    expect(parseTranscriptFile("", { startedAt })).toEqual([]);
  });

  it("reads a line with no label as an unknown speaker's words", () => {
    expect(
      parseTranscriptFile("00:00:05 --> 00:00:06\nJust some words", {
        speakers,
        startedAt,
      }),
    ).toEqual([
      {
        speaker: "unknown",
        text: "Just some words",
        at: "2026-10-08T09:00:05.000Z",
      },
    ]);
  });

  it("only the line straight after a time line names a speaker: a later line with a colon is more of what they said", () => {
    expect(
      parseTranscriptFile(
        [
          "00:00:05 --> 00:00:12",
          "Mira Okonjo: We moved it off a nightly batch.",
          "Note: we shipped it in March.",
          "Speaker 1: is what the dashboard called it.",
          "The write-up is at https://example.test/x",
          "",
          "00:00:20 --> 00:00:24",
          "Speaker 1: And the result?",
        ].join("\n"),
        { speakers, startedAt },
      ),
    ).toEqual([
      {
        speaker: "candidate",
        text: "We moved it off a nightly batch. Note: we shipped it in March. Speaker 1: is what the dashboard called it. The write-up is at https://example.test/x",
        at: "2026-10-08T09:00:05.000Z",
      },
      {
        speaker: "interviewer",
        text: "And the result?",
        at: "2026-10-08T09:00:20.000Z",
      },
    ]);
  });

  it("a blank line inside a block does not let the next line name a speaker", () => {
    expect(
      parseTranscriptFile(
        "00:00:05 --> 00:00:12\nSpeaker 1: First.\n\nMira Okonjo: not a label here.",
        { speakers, startedAt },
      ),
    ).toEqual([
      {
        speaker: "interviewer",
        text: "First. Mira Okonjo: not a label here.",
        at: "2026-10-08T09:00:05.000Z",
      },
    ]);
  });

  it("an unlabelled block carries on the speaker before it", () => {
    const lines = parseTranscriptFile(
      [
        "00:00:05 --> 00:00:08",
        "Mira Okonjo: We moved it off a nightly batch",
        "",
        "00:00:09 --> 00:00:12",
        "and onto a stream.",
        "",
        "00:00:20 --> 00:00:22",
        "Speaker 1: Why?",
        "",
        "00:00:23 --> 00:00:25",
        "What did it cost?",
      ].join("\n"),
      { speakers, startedAt },
    );
    expect(lines.map((line) => [line.speaker, line.text])).toEqual([
      ["candidate", "We moved it off a nightly batch and onto a stream."],
      ["interviewer", "Why? What did it cost?"],
    ]);
  });

  // DEFECT (coach-transcript.ts:89 `SPOKEN`, :118): the first line of a block
  // that begins with an address or a clock time ("https://...", "10:30 is
  // fine") is taken for `Label: text`: the words before the colon are lost
  // from the text and the line is given to an unknown speaker named "https".
  // Remove `.fails` when that is fixed.
  it("a block that opens with an address is more of what the last speaker said", () => {
    const lines = parseTranscriptFile(
      [
        "00:00:05 --> 00:00:08",
        "Mira Okonjo: The write-up is at",
        "",
        "00:00:09 --> 00:00:12",
        "https://example.test/x on the wiki.",
      ].join("\n"),
      { speakers, startedAt },
    );
    expect(lines.map((line) => [line.speaker, line.text])).toEqual([
      ["candidate", "The write-up is at https://example.test/x on the wiki."],
    ]);
  });

  it("with no time lines at all, only the very first line can name a speaker", () => {
    expect(
      parseTranscriptFile(
        "Speaker 1: Tell me about it.\nMira Okonjo: It was a batch job.",
        { speakers, startedAt },
      ),
    ).toEqual([
      {
        speaker: "interviewer",
        text: "Tell me about it. Mira Okonjo: It was a batch job.",
        at: "2026-10-08T09:00:00.000Z",
      },
    ]);
  });

  it("an unlabelled continuation past 1,200 characters starts a line by the same speaker", () => {
    const lines = parseTranscriptFile(
      [
        "00:00:01 --> 00:00:02",
        `Mira Okonjo: ${"a".repeat(1_000)}`,
        "00:00:03 --> 00:00:04",
        "b".repeat(300),
      ].join("\n"),
      { speakers, startedAt },
    );
    expect(lines.map((line) => [line.speaker, line.text.length])).toEqual([
      ["candidate", 1_000],
      ["candidate", 300],
    ]);
  });

  it("starts from now when no start is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
    expect(
      parseTranscriptFile("00:00:30 --> 00:00:31\nSpeaker 1: Hello.")[0]?.at,
    ).toBe("2026-10-08T12:00:30.000Z");
  });
});
