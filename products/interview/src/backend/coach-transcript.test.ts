// The coach's transcript in memory: lines numbered as they arrive, read from
// a cursor, bounded, and gone (with a new epoch) when cleared. And a recorder's
// exported transcript read into lines. Every name and sentence here is invented.
import {
  COACH_SPACES,
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
    expect(read).toEqual({
      epoch: expect.any(String),
      cursor: 0,
      lines: [],
      space: "live",
    });
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
      space: "replay",
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
      space: "replay",
    });
    expect(cleared.epoch).not.toBe(before);
    expect(transcript.since()).toEqual(cleared);
    expect(transcript.add([{ text: "after", at: AT }])).toEqual({
      epoch: cleared.epoch,
      cursor: 1,
      lines: [],
      space: "replay",
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
    expect(read.space).toBe("live");
    expect(coachTranscriptResponseSchema.safeParse(read).success).toBe(true);
  });

  it("follows the session last heard", () => {
    const transcript = createCoachTranscript();
    transcript.add([{ text: "first session", at: AT }], SESSION);
    transcript.add([{ text: "second session", at: AT }], NEXT);
    expect(transcript.since().session).toEqual(NEXT);
  });

  it("outlives a clear while the transcript is still the live one", () => {
    const transcript = createCoachTranscript();
    transcript.add([{ text: "heard live", at: AT }], SESSION);
    const cleared = transcript.clear();
    expect(cleared).toEqual({
      epoch: expect.any(String),
      cursor: 0,
      lines: [],
      space: "live",
      session: SESSION,
    });
    expect(transcript.since()).toEqual(cleared);
  });

  it("is not reported for a transcript attached afterwards: a replay is coached from itself alone", () => {
    const transcript = createCoachTranscript();
    transcript.add([{ text: "heard live", at: AT }], SESSION);
    const attached = transcript.add([{ text: "attached afterwards", at: AT }]);
    expect(attached).not.toHaveProperty("session");
    expect(transcript.since()).not.toHaveProperty("session");
    expect(transcript.clear()).not.toHaveProperty("session");
  });
});

describe("the space a transcript is in", () => {
  const SESSION = {
    tenantId: "00000000-0000-4000-8000-000000000001",
    actorId: "00000000-0000-4000-8000-000000000002",
    sessionId: "00000000-0000-4000-8000-000000000003",
  };

  it("is one of live and replay, and an answer without one is still read", () => {
    expect(COACH_SPACES).toEqual(["live", "replay"]);
    const answer = { epoch: "e", cursor: 0, lines: [] };
    expect(coachTranscriptResponseSchema.parse(answer)).toEqual(answer);
    expect(
      coachTranscriptResponseSchema.parse({ ...answer, space: "replay" }).space,
    ).toBe("replay");
    expect(
      coachTranscriptResponseSchema.safeParse({ ...answer, space: "test" })
        .success,
    ).toBe(false);
  });

  it("is live until lines are added without a session, which is a replay under a NEW epoch", () => {
    const transcript = createCoachTranscript();
    const start = transcript.since();
    expect(start.space).toBe("live");
    const attached = transcript.add([{ text: "attached", at: AT }]);
    expect(attached.space).toBe("replay");
    expect(attached.epoch).not.toBe(start.epoch);
    expect(attached.cursor).toBe(1);
    // More of the same replay stays under its epoch.
    const more = transcript.add([{ text: "and more", at: AT }]);
    expect(more).toMatchObject({
      epoch: attached.epoch,
      cursor: 2,
      space: "replay",
    });
  });

  it("a replay after a live session never holds the live lines, and numbers from 1", () => {
    const transcript = createCoachTranscript();
    const live = transcript.add(
      [
        { text: "heard live", at: AT },
        { text: "and again", at: AT },
      ],
      SESSION,
    );
    expect(live.space).toBe("live");
    const replay = transcript.add([{ text: "attached", at: AT }]);
    expect(replay.epoch).not.toBe(live.epoch);
    expect(transcript.since()).toEqual({
      epoch: replay.epoch,
      cursor: 1,
      lines: [{ seq: 1, speaker: "unknown", text: "attached", at: AT }],
      space: "replay",
    });
  });

  it("a session's line after a replay switches back to live under a new epoch, with the session named", () => {
    const transcript = createCoachTranscript();
    transcript.add([{ text: "heard live", at: AT }], SESSION);
    const replay = transcript.add([{ text: "attached", at: AT }]);
    const back = transcript.add([{ text: "live again", at: AT }], SESSION);
    expect(back.epoch).not.toBe(replay.epoch);
    expect(transcript.since()).toEqual({
      epoch: back.epoch,
      cursor: 1,
      lines: [{ seq: 1, speaker: "unknown", text: "live again", at: AT }],
      space: "live",
      session: SESSION,
    });
  });

  it("a clear keeps the space it was in", () => {
    const transcript = createCoachTranscript();
    transcript.add([{ text: "attached", at: AT }]);
    expect(transcript.clear().space).toBe("replay");
    transcript.add([{ text: "live", at: AT }], SESSION);
    expect(transcript.clear().space).toBe("live");
  });
});

describe("what is on the shared screen", () => {
  const SESSION = {
    tenantId: "00000000-0000-4000-8000-000000000001",
    actorId: "00000000-0000-4000-8000-000000000002",
    sessionId: "00000000-0000-4000-8000-000000000003",
  };
  const NOW = "2026-10-08T10:15:00.000Z";
  const clocked = () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    return createCoachTranscript();
  };

  it("is absent until a screen was read", () => {
    const transcript = createCoachTranscript();
    expect(transcript.since()).not.toHaveProperty("screen");
    expect(
      transcript.add([{ text: "live", at: AT }], SESSION),
    ).not.toHaveProperty("screen");
  });

  it("is held trimmed, stamped now, on every answer, and names the session it came from", () => {
    const transcript = clocked();
    const epoch = transcript.since().epoch;
    transcript.setScreen("  def two_sum(nums, target):\n    pass  ", SESSION);
    const read = transcript.since();
    expect(read).toEqual({
      epoch,
      cursor: 0,
      lines: [],
      space: "live",
      session: SESSION,
      screen: { text: "def two_sum(nums, target):\n    pass", at: NOW },
    });
    expect(coachTranscriptResponseSchema.safeParse(read).success).toBe(true);
    expect(transcript.add([{ text: "live", at: AT }], SESSION).screen).toEqual(
      read.screen,
    );
  });

  it("is the latest only: a later screen takes the last one's place", () => {
    const transcript = clocked();
    transcript.setScreen("the first screen", SESSION);
    vi.setSystemTime(new Date("2026-10-08T10:15:30.000Z"));
    transcript.setScreen("the second screen");
    expect(transcript.since().screen).toEqual({
      text: "the second screen",
      at: "2026-10-08T10:15:30.000Z",
    });
    // Without a session of its own it leaves the session as it was.
    expect(transcript.since().session).toEqual(SESSION);
  });

  it("holds 8,000 characters at most: the first 8,000", () => {
    const transcript = createCoachTranscript();
    transcript.setScreen("a".repeat(8_000));
    expect(transcript.since().screen?.text).toBe("a".repeat(8_000));
    transcript.setScreen(`${"b".repeat(8_000)}c`);
    expect(transcript.since().screen?.text).toBe("b".repeat(8_000));
  });

  it.each(["", "   ", "\n\t\n"])(
    "a screen with no text (%j) changes nothing",
    (text) => {
      const transcript = clocked();
      transcript.setScreen("what was there", SESSION);
      const before = transcript.since();
      transcript.setScreen(text, { ...SESSION, sessionId: SESSION.tenantId });
      expect(transcript.since()).toEqual(before);
    },
  );

  it("is never held in the replay space: a live screen says nothing about a replay", () => {
    const transcript = createCoachTranscript();
    transcript.add([{ text: "attached", at: AT }]);
    transcript.setScreen("a live session's screen", SESSION);
    expect(transcript.since()).not.toHaveProperty("screen");
  });

  it("is cleared by a clear", () => {
    const transcript = createCoachTranscript();
    transcript.setScreen("on the screen", SESSION);
    expect(transcript.clear()).not.toHaveProperty("screen");
    expect(transcript.since()).not.toHaveProperty("screen");
  });

  it("goes when a replay is attached, and is not there when the live session comes back", () => {
    const transcript = createCoachTranscript();
    transcript.setScreen("on the screen", SESSION);
    expect(transcript.add([{ text: "attached", at: AT }])).not.toHaveProperty(
      "screen",
    );
    expect(
      transcript.add([{ text: "live again", at: AT }], SESSION),
    ).not.toHaveProperty("screen");
  });
});

describe("who is speaking", () => {
  const SESSION = {
    tenantId: "00000000-0000-4000-8000-000000000001",
    actorId: "00000000-0000-4000-8000-000000000002",
    sessionId: "00000000-0000-4000-8000-000000000003",
  };
  const clocked = () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T10:15:00.000Z"));
    return createCoachTranscript();
  };

  it("is absent from every answer until activity was ever reported: not known is not nobody", () => {
    const transcript = createCoachTranscript();
    expect(transcript.since()).not.toHaveProperty("speaking");
    expect(
      transcript.add([{ text: "live", at: AT }], SESSION),
    ).not.toHaveProperty("speaking");
    expect(transcript.since(1)).not.toHaveProperty("speaking");
  });

  it("is on every answer once reported, as the speakers speaking now, and still reads by the contract", () => {
    const transcript = clocked();
    transcript.add([{ text: "live", at: AT }], SESSION);
    transcript.setSpeaking("interviewer", true);
    const read = transcript.since();
    expect(read.speaking).toEqual(["interviewer"]);
    expect(coachTranscriptResponseSchema.safeParse(read).success).toBe(true);
    expect(
      transcript.add([{ text: "more", at: AT }], SESSION).speaking,
    ).toEqual(["interviewer"]);
    transcript.setSpeaking("candidate", true);
    expect(new Set(transcript.since().speaking)).toEqual(
      new Set(["interviewer", "candidate"]),
    );
    transcript.setSpeaking("unknown", true);
    expect(new Set(transcript.since().speaking)).toEqual(
      new Set(["interviewer", "candidate", "unknown"]),
    );
  });

  it("a speaker who stopped is no longer listed; the list is then empty, not absent", () => {
    const transcript = clocked();
    transcript.setSpeaking("interviewer", true);
    transcript.setSpeaking("candidate", true);
    transcript.setSpeaking("interviewer", false);
    expect(transcript.since().speaking).toEqual(["candidate"]);
    transcript.setSpeaking("candidate", false);
    expect(transcript.since()).toHaveProperty("speaking", []);
  });

  it("a first report that somebody stopped makes activity known: nobody is speaking", () => {
    const transcript = createCoachTranscript();
    transcript.setSpeaking("interviewer", false);
    expect(transcript.since()).toHaveProperty("speaking", []);
  });

  it("names a speaker once however often they say they are speaking", () => {
    const transcript = clocked();
    transcript.setSpeaking("interviewer", true);
    transcript.setSpeaking("interviewer", true);
    expect(transcript.since().speaking).toEqual(["interviewer"]);
  });

  it("a speaking that is not said again lapses after 5 s, and not before", () => {
    const transcript = clocked();
    transcript.setSpeaking("interviewer", true);
    vi.advanceTimersByTime(5_000);
    expect(transcript.since().speaking).toEqual(["interviewer"]);
    vi.advanceTimersByTime(1);
    // Lapsed is nobody speaking, still known.
    expect(transcript.since()).toHaveProperty("speaking", []);
    // It stays lapsed until it is said again.
    vi.advanceTimersByTime(60_000);
    expect(transcript.since().speaking).toEqual([]);
    transcript.setSpeaking("interviewer", true);
    expect(transcript.since().speaking).toEqual(["interviewer"]);
  });

  it("a speaking said again is kept alive from the last time it was said", () => {
    const transcript = clocked();
    transcript.setSpeaking("interviewer", true);
    for (let said = 0; said < 5; said += 1) {
      vi.advanceTimersByTime(4_000);
      transcript.setSpeaking("interviewer", true);
    }
    // Twenty seconds on, never five without a word of it.
    expect(transcript.since().speaking).toEqual(["interviewer"]);
    vi.advanceTimersByTime(5_001);
    expect(transcript.since().speaking).toEqual([]);
  });

  it("each speaker lapses by their own clock", () => {
    const transcript = clocked();
    transcript.setSpeaking("interviewer", true);
    vi.advanceTimersByTime(3_000);
    transcript.setSpeaking("candidate", true);
    vi.advanceTimersByTime(2_001);
    expect(transcript.since().speaking).toEqual(["candidate"]);
    vi.advanceTimersByTime(3_000);
    expect(transcript.since().speaking).toEqual([]);
  });

  it("is forgotten by a clear: the next conversation does not know who is speaking", () => {
    const transcript = clocked();
    transcript.setSpeaking("interviewer", true);
    expect(transcript.clear()).not.toHaveProperty("speaking");
    expect(transcript.since()).not.toHaveProperty("speaking");
    // Known again from the first report after it, and only who said so since.
    transcript.setSpeaking("candidate", true);
    expect(transcript.since().speaking).toEqual(["candidate"]);
  });

  it("is forgotten when a replay is attached after a live session: that is another conversation", () => {
    const transcript = clocked();
    transcript.add([{ text: "live", at: AT }], SESSION);
    transcript.setSpeaking("interviewer", true);
    expect(transcript.add([{ text: "attached", at: AT }])).not.toHaveProperty(
      "speaking",
    );
  });
});

describe("the coach's ledger of the conversation", () => {
  const kept = (epoch: string, readTo = 3) => ({
    version: 1,
    epoch,
    readTo,
    given: [],
  });

  it("is absent until one is kept", () => {
    const transcript = createCoachTranscript();
    expect(transcript.ledger(transcript.since().epoch)).toBeUndefined();
  });

  it("is kept for the conversation in hand and given back as it was kept", () => {
    const transcript = createCoachTranscript();
    const epoch = transcript.since().epoch;
    const ledger = kept(epoch);
    expect(transcript.setLedger(epoch, ledger)).toBe(true);
    expect(transcript.ledger(epoch)).toEqual(ledger);
    // The latest takes the last one's place.
    expect(transcript.setLedger(epoch, kept(epoch, 9))).toBe(true);
    expect(transcript.ledger(epoch)).toEqual(kept(epoch, 9));
  });

  it("is never on a reading of the transcript: it is the coach's, read by its own name", () => {
    const transcript = createCoachTranscript();
    const epoch = transcript.since().epoch;
    transcript.setLedger(epoch, kept(epoch));
    expect(transcript.since()).not.toHaveProperty("ledger");
    expect(
      coachTranscriptResponseSchema.safeParse(transcript.since()).success,
    ).toBe(true);
  });

  it.each(["", "another-epoch", "00000000-0000-4000-8000-000000000009"])(
    "is refused for another conversation (%j), and what was held stays",
    (other) => {
      const transcript = createCoachTranscript();
      const epoch = transcript.since().epoch;
      expect(transcript.setLedger(other, kept(other))).toBe(false);
      expect(transcript.ledger(epoch)).toBeUndefined();
      transcript.setLedger(epoch, kept(epoch));
      expect(transcript.setLedger(other, kept(other, 99))).toBe(false);
      expect(transcript.ledger(epoch)).toEqual(kept(epoch));
      // And it is not read by another conversation's name.
      expect(transcript.ledger(other)).toBeUndefined();
    },
  );

  it("goes with the conversation on a clear: not read by the old epoch, nor by the new one", () => {
    const transcript = createCoachTranscript();
    const before = transcript.since().epoch;
    transcript.setLedger(before, kept(before));
    const after = transcript.clear().epoch;
    expect(transcript.ledger(before)).toBeUndefined();
    expect(transcript.ledger(after)).toBeUndefined();
    // The conversation that is over takes no ledger any more.
    expect(transcript.setLedger(before, kept(before))).toBe(false);
    expect(transcript.setLedger(after, kept(after))).toBe(true);
  });

  it("goes when a replay is attached after a live session, which is another conversation", () => {
    const transcript = createCoachTranscript();
    const SESSION = {
      tenantId: "00000000-0000-4000-8000-000000000001",
      actorId: "00000000-0000-4000-8000-000000000002",
      sessionId: "00000000-0000-4000-8000-000000000003",
    };
    const live = transcript.add([{ text: "live", at: AT }], SESSION).epoch;
    transcript.setLedger(live, kept(live));
    const replay = transcript.add([{ text: "attached", at: AT }]).epoch;
    expect(replay).not.toBe(live);
    expect(transcript.ledger(replay)).toBeUndefined();
    expect(transcript.ledger(live)).toBeUndefined();
  });

  it("outlives lines being added to the same conversation", () => {
    const transcript = createCoachTranscript();
    const epoch = transcript.add([{ text: "attached", at: AT }]).epoch;
    transcript.setLedger(epoch, kept(epoch));
    transcript.add([{ text: "more", at: AT }]);
    expect(transcript.ledger(epoch)).toEqual(kept(epoch));
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

// ---- A panel: who on a side spoke ----------------------------------------------

describe("who on a side spoke", () => {
  it("is kept on the line as it was added, and only there", () => {
    const transcript = createCoachTranscript();
    transcript.add([
      {
        speaker: "interviewer",
        name: "Priya",
        text: "Over to Marcus.",
        at: AT,
      },
      {
        speaker: "interviewer",
        name: "Marcus",
        text: "Thanks, Priya.",
        at: AT,
      },
      { speaker: "interviewer", text: "Can everyone hear me?", at: AT },
      { speaker: "candidate", text: "Yes, clearly.", at: AT },
    ]);
    const read = transcript.since();
    expect(read.lines).toEqual([
      {
        seq: 1,
        speaker: "interviewer",
        name: "Priya",
        text: "Over to Marcus.",
        at: AT,
      },
      {
        seq: 2,
        speaker: "interviewer",
        name: "Marcus",
        text: "Thanks, Priya.",
        at: AT,
      },
      { seq: 3, speaker: "interviewer", text: "Can everyone hear me?", at: AT },
      { seq: 4, speaker: "candidate", text: "Yes, clearly.", at: AT },
    ]);
    expect(read.lines.map((line) => "name" in line)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(coachTranscriptResponseSchema.safeParse(read).success).toBe(true);
  });

  it("is never made up: a live session's line, which has no name, is given none", () => {
    const transcript = createCoachTranscript();
    transcript.add(
      [
        {
          speaker: speakerOfSource("application-audio"),
          text: "Tell me more.",
          at: AT,
        },
      ],
      {
        tenantId: "00000000-0000-4000-8000-000000000001",
        actorId: "00000000-0000-4000-8000-000000000002",
        sessionId: "00000000-0000-4000-8000-000000000003",
      },
    );
    const [line] = transcript.since().lines;
    expect(line).toEqual({
      seq: 1,
      speaker: "interviewer",
      text: "Tell me more.",
      at: AT,
    });
  });

  it("is read from the cursor like the rest of the line, and goes with a clear", () => {
    const transcript = createCoachTranscript();
    transcript.add([
      { speaker: "interviewer", name: "Tom", text: "Why not a queue?", at: AT },
      { speaker: "interviewer", name: "Elena", text: "And the date?", at: AT },
    ]);
    expect(transcript.since(1).lines.map((line) => line.name)).toEqual([
      "Elena",
    ]);
    transcript.clear();
    expect(transcript.since().lines).toEqual([]);
  });
});

describe("a recorder's transcript file of a panel", () => {
  const startedAt = new Date("2026-10-08T09:00:00.000Z");
  const FILE = [
    "00:00:03 --> 00:00:09",
    "Priya: I'm going to hand over to Marcus now.",
    "",
    "00:00:10 --> 00:00:14",
    "Marcus: Thanks, Priya. How do you make sure a broker is charged once?",
    "",
    "00:00:15 --> 00:00:19",
    "Candidate: I key the ledger by correlation id.",
    "",
    "00:00:20 --> 00:00:21",
    "Guest 7: Can you hear me?",
    "",
  ].join("\n");

  it("keeps each interviewer's label as the name of the voice when more than one label is the interviewer", () => {
    const lines = parseTranscriptFile(FILE, {
      speakers: {
        Priya: "interviewer",
        Marcus: "interviewer",
        Candidate: "candidate",
      },
      startedAt,
    });
    expect(lines).toEqual([
      {
        speaker: "interviewer",
        name: "Priya",
        text: "I'm going to hand over to Marcus now.",
        at: "2026-10-08T09:00:03.000Z",
      },
      {
        speaker: "interviewer",
        name: "Marcus",
        text: "Thanks, Priya. How do you make sure a broker is charged once?",
        at: "2026-10-08T09:00:10.000Z",
      },
      {
        speaker: "candidate",
        text: "I key the ledger by correlation id.",
        at: "2026-10-08T09:00:15.000Z",
      },
      {
        speaker: "unknown",
        text: "Can you hear me?",
        at: "2026-10-08T09:00:20.000Z",
      },
    ]);
    expect(coachTranscriptInputSchema.safeParse({ lines }).success).toBe(true);
  });

  it("names nobody when one label is the interviewer: there is nothing to tell apart", () => {
    const lines = parseTranscriptFile(FILE, {
      speakers: { Marcus: "interviewer", Candidate: "candidate" },
      startedAt,
    });
    expect(lines.some((line) => "name" in line)).toBe(false);
    expect(lines.map((line) => line.speaker)).toEqual([
      "unknown",
      "interviewer",
      "candidate",
      "unknown",
    ]);
  });

  it("names nobody when no label is given a part", () => {
    expect(
      parseTranscriptFile(FILE, { startedAt }).some((line) => "name" in line),
    ).toBe(false);
  });

  it("does not join two interviewers' consecutive blocks into one line", () => {
    const lines = parseTranscriptFile(
      "00:00:01 --> 00:00:02\nPriya: Over to you.\n\n00:00:03 --> 00:00:04\nMarcus: Thanks.\n\n00:00:05 --> 00:00:06\nMarcus: First question.",
      { speakers: { Priya: "interviewer", Marcus: "interviewer" }, startedAt },
    );
    expect(lines.map((line) => [line.name, line.text])).toEqual([
      ["Priya", "Over to you."],
      ["Marcus", "Thanks. First question."],
    ]);
  });

  it("leaves a label that is not a name the contract takes without one, and still gives the line", () => {
    const lines = parseTranscriptFile(
      "00:00:01 --> 00:00:02\nPanel (room 2): Hello there.\n\n00:00:03 --> 00:00:04\nMarcus: Hello.",
      {
        speakers: { "Panel (room 2)": "interviewer", Marcus: "interviewer" },
        startedAt,
      },
    );
    expect(lines).toEqual([
      {
        speaker: "interviewer",
        text: "Hello there.",
        at: "2026-10-08T09:00:01.000Z",
      },
      {
        speaker: "interviewer",
        name: "Marcus",
        text: "Hello.",
        at: "2026-10-08T09:00:03.000Z",
      },
    ]);
    expect(coachTranscriptInputSchema.safeParse({ lines }).success).toBe(true);
  });
});
