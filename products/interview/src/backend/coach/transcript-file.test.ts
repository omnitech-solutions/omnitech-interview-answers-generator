// A recorded conversation read from a file for a replay: the three shapes it
// may have, who is found in it, and what the coach is given once each label
// has a part. Every name and line here is invented.
import { describe, expect, it } from "vitest";
import {
  type Cast,
  castBlocks,
  readTranscript,
  type SpokenBlock,
  speakersOf,
} from "./transcript-file";

const text = (...lines: string[]) => lines.join("\n");
const block = (
  label: string,
  said: string,
  startMs: number,
  endMs: number,
): SpokenBlock => ({ label, text: said, startMs, endMs });

describe("reading a transcript file", () => {
  it("reads nothing from an empty file, or one of blank lines", () => {
    expect(readTranscript("")).toEqual([]);
    expect(readTranscript("\n\n   \n")).toEqual([]);
  });

  describe("a recorder's blocks", () => {
    it("reads each `HH:MM:SS --> HH:MM:SS` block as a labelled piece at its times", () => {
      expect(
        readTranscript(
          text(
            "00:00:01 --> 00:00:04",
            "Speaker 1: Thanks for joining us today.",
            "",
            "00:01:12 --> 00:01:19",
            "Speaker 2: Glad to be here.",
            "",
            "10:39:50 --> 10:40:01",
            "Unknown: Yeah.",
          ),
        ),
      ).toEqual([
        block("Speaker 1", "Thanks for joining us today.", 1_000, 4_000),
        block("Speaker 2", "Glad to be here.", 72_000, 79_000),
        block("Unknown", "Yeah.", 38_390_000, 38_401_000),
      ]);
    });

    it("joins nothing: two blocks of one speaker stay two pieces", () => {
      const blocks = readTranscript(
        text(
          "00:00:01 --> 00:00:02",
          "Speaker 1: So the booking table,",
          "00:00:03 --> 00:00:05",
          "Speaker 1: how would you shard it?",
        ),
      );
      expect(blocks.map((each) => [each.text, each.startMs])).toEqual([
        ["So the booking table,", 1_000],
        ["how would you shard it?", 3_000],
      ]);
    });

    it("reads Windows line endings", () => {
      expect(
        readTranscript(
          "00:00:01 --> 00:00:04\r\nSpeaker 1: Thanks for joining.\r\n\r\n",
        ),
      ).toEqual([block("Speaker 1", "Thanks for joining.", 1_000, 4_000)]);
    });

    it("only the first line after a time line names a speaker; a later line with a colon is what was said", () => {
      expect(
        readTranscript(
          text(
            "00:00:01 --> 00:00:04",
            "Speaker 1: There are two parts to this.",
            "First: how would you shard it?",
            "Second: how would you roll it back?",
          ),
        ),
      ).toEqual([
        block("Speaker 1", "There are two parts to this.", 1_000, 4_000),
        block("Speaker 1", "First: how would you shard it?", 1_000, 4_000),
        block("Speaker 1", "Second: how would you roll it back?", 1_000, 4_000),
      ]);
    });

    it("a label on a line of its own names the lines under it", () => {
      expect(
        readTranscript(
          text(
            "00:00:05 --> 00:00:09",
            "Speaker 2:",
            "I would start with the region.",
          ),
        ),
      ).toEqual([
        block("Speaker 2", "I would start with the region.", 5_000, 9_000),
      ]);
    });

    it("a block with no label has none when no speaker was named before it", () => {
      expect(
        readTranscript(
          text("00:00:05 --> 00:00:09", "I would start with the region."),
        ),
      ).toEqual([block("", "I would start with the region.", 5_000, 9_000)]);
    });

    it("never ends a piece before it starts", () => {
      const [only] = readTranscript(
        text("00:00:09 --> 00:00:05", "Speaker 1: A clock that ran back."),
      );
      expect(only).toEqual(
        block("Speaker 1", "A clock that ran back.", 9_000, 9_000),
      );
    });
  });

  describe("WebVTT and SRT", () => {
    it("reads WebVTT: the header, cue numbers and cue settings say nothing, and fractions of a second are kept", () => {
      expect(
        readTranscript(
          text(
            "WEBVTT",
            "",
            "1",
            "00:00:01.500 --> 00:00:04.250 align:start position:0%",
            "Imani: Thanks for joining us today.",
            "",
            "2",
            "00:00:05.000 --> 00:00:09.040",
            "Tobias: Glad to be here.",
          ),
        ),
      ).toEqual([
        block("Imani", "Thanks for joining us today.", 1_500, 4_250),
        block("Tobias", "Glad to be here.", 5_000, 9_040),
      ]);
    });

    it("reads a WEBVTT header that carries a title", () => {
      expect(
        readTranscript(
          text(
            "WEBVTT - a practice round",
            "",
            "00:00:01.000 --> 00:00:02.000",
            "Imani: Hello there.",
          ),
        ),
      ).toEqual([block("Imani", "Hello there.", 1_000, 2_000)]);
    });

    it("reads SRT: comma fractions, cue numbers, and markup taken out", () => {
      expect(
        readTranscript(
          text(
            "1",
            "00:00:01,500 --> 00:00:04,000",
            "Imani: <i>Thanks</i> for joining us <b>today</b>.",
            "",
            "2",
            "00:00:05,000 --> 00:00:09,040",
            "Tobias: Glad to be here.",
          ),
        ),
      ).toEqual([
        block("Imani", "Thanks for joining us today.", 1_500, 4_000),
        block("Tobias", "Glad to be here.", 5_000, 9_040),
      ]);
    });

    it.each([
      ["00:00:01.5 --> 00:00:02.25", 1_500, 2_250],
      ["00:00:01.05 --> 00:00:02.005", 1_050, 2_005],
      ["0:00:01 --> 0:00:02", 1_000, 2_000],
      ["01:02:03,004 --> 01:02:04", 3_723_004, 3_724_000],
      ["00:00:01-->00:00:02", 1_000, 2_000],
    ])("reads the time line %j", (timing, startMs, endMs) => {
      expect(readTranscript(text(timing, "Imani: Hello there."))).toEqual([
        block("Imani", "Hello there.", startMs, endMs),
      ]);
    });

    // DEFECT (transcript-file.ts:21-22, `CLOCK`/`TIMING`): WebVTT allows a
    // time without hours ("00:01.000"), and many exporters write it. Such a
    // time line is not recognised, so it is read as something SAID (and the
    // file as untimed, paced by its words).
    it("DEFECT: a WebVTT time line without hours is a time line, not speech", () => {
      expect(
        readTranscript(
          text(
            "WEBVTT",
            "",
            "00:01.000 --> 00:04.000",
            "Imani: Thanks for joining us today.",
          ),
        ),
      ).toEqual([block("Imani", "Thanks for joining us today.", 1_000, 4_000)]);
    });

    // DEFECT (transcript-file.ts:42, the markup strip): WebVTT names a cue's
    // speaker with a voice tag, `<v Name>`. It is removed with the rest of
    // the markup, so every speaker of such a file is lost (all one label).
    it("DEFECT: a WebVTT voice tag names the speaker", () => {
      expect(
        readTranscript(
          text(
            "WEBVTT",
            "",
            "00:00:01.000 --> 00:00:04.000",
            "<v Imani>Thanks for joining us today.</v>",
            "",
            "00:00:05.000 --> 00:00:09.000",
            "<v Tobias>Glad to be here.</v>",
          ),
        ).map((each) => each.label),
      ).toEqual(["Imani", "Tobias"]);
    });
  });

  describe("plain labelled lines", () => {
    it("reads `Label: text` lines, each paced at 400 ms a word from the end of the one before", () => {
      expect(
        readTranscript(
          text(
            "Imani: How would you shard the booking table?",
            "Tobias: By region first.",
            "",
            "Imani: Why?",
          ),
        ),
      ).toEqual([
        block("Imani", "How would you shard the booking table?", 0, 2_800),
        block("Tobias", "By region first.", 2_800, 4_000),
        block("Imani", "Why?", 4_000, 4_400),
      ]);
    });

    it("an unlabelled line goes on under the speaker before it", () => {
      expect(
        readTranscript(
          text(
            "Imani: How would you shard it?",
            "and how would you roll it back?",
            "Tobias:",
            "By region first.",
          ),
        ).map((each) => [each.label, each.text]),
      ).toEqual([
        ["Imani", "How would you shard it?"],
        ["Imani", "and how would you roll it back?"],
        ["Tobias", "By region first."],
      ]);
    });

    it("every line may name a speaker when the file has no time lines", () => {
      expect(
        readTranscript(text("Imani: Hello.", "Tobias: Hi.", "Imani: Shall we?"))
          .map((each) => each.label)
          .join(","),
      ).toBe("Imani,Tobias,Imani");
    });

    it.each([
      ["an address", "https://example.test/booking is where it lives"],
      ["a clock time", "10:30 works for me on Thursday"],
      ["a time of day mid-line", "at 10:30: we deploy"],
      ["a ratio with no space", "about 3:1 reads to writes"],
      ["a colon with no space after", "the key is region:tenant in that order"],
      [
        "a clause longer than a name",
        "so what I would say about the design of the whole booking system: split it",
      ],
    ])("%s is never a label", (_, line) => {
      expect(readTranscript(text("Imani: Go on.", line))).toEqual([
        block("Imani", "Go on.", 0, 800),
        expect.objectContaining({ label: "Imani", text: line }),
      ]);
    });
  });

  describe("plain text", () => {
    it("is one unlabelled speaker, a piece a line, paced at 400 ms a word", () => {
      expect(
        readTranscript(
          text(
            "How would you shard the booking table?",
            "I would start with the region.",
          ),
        ),
      ).toEqual([
        block("", "How would you shard the booking table?", 0, 2_800),
        block("", "I would start with the region.", 2_800, 5_200),
      ]);
    });
  });
});

describe("who is in the file", () => {
  const blocks = readTranscript(
    text(
      "Imani: Hello there.",
      "Tobias: Hi.",
      "Imani: How would you shard the booking table?",
      "Tobias: I would start with the region and then split by tenant.",
      "Tobias: That keeps the largest tenants apart from each other.",
      "Imani: Makes sense to me.",
      "Rosalind: Sorry, wrong room.",
    ),
  );

  it("lists each label once, the most talkative first, with its pieces and words", () => {
    expect(
      speakersOf(blocks).map((each) => [each.label, each.blocks, each.words]),
    ).toEqual([
      ["Tobias", 3, 21],
      ["Imani", 3, 13],
      ["Rosalind", 1, 3],
    ]);
  });

  it("samples the first thing of six words or more each said, or nothing", () => {
    expect(
      Object.fromEntries(
        speakersOf(blocks).map((each) => [each.label, each.sample]),
      ),
    ).toEqual({
      Tobias: "I would start with the region and then split by tenant.",
      Imani: "How would you shard the booking table?",
      Rosalind: "",
    });
  });

  it("a sample is exactly six words at the least", () => {
    expect(
      speakersOf([
        block("A", "one two three four five", 0, 1),
        block("A", "one two three four five six", 1, 2),
        block("A", "one two three four five six seven", 2, 3),
      ])[0]?.sample,
    ).toBe("one two three four five six");
  });

  it("counts the unlabelled speaker of a plain file, and nobody in an empty one", () => {
    expect(speakersOf(readTranscript("just some words said"))).toEqual([
      { label: "", blocks: 1, words: 4, sample: "" },
    ]);
    expect(speakersOf([])).toEqual([]);
  });
});

describe("giving each label its part", () => {
  const blocks: SpokenBlock[] = [
    block("Speaker 1", "How would you shard it?", 1_000, 4_000),
    block("Speaker 2", "By region first.", 5_000, 8_000),
    block("Speaker 3", "The projector needs a new bulb.", 9_000, 11_000),
    block("Unknown", "Yeah.", 12_000, 13_000),
    block("Speaker 1", "And the rollback plan?", 14_000, 17_000),
    block("Speaker 2", "Keep the old path live.", 18_000, 21_000),
  ];
  const cast: Cast = {
    "Speaker 1": "interviewer",
    "Speaker 2": "me",
    "Speaker 3": "leave-out",
  };
  const heard = (...given: Parameters<typeof castBlocks>) =>
    castBlocks(...given).map((each) => [each.speaker, each.text]);

  it("me is the candidate, a left-out label is removed, and a label with no part is unknown", () => {
    expect(heard(blocks, cast)).toEqual([
      ["interviewer", "How would you shard it?"],
      ["candidate", "By region first."],
      ["unknown", "Yeah."],
      ["interviewer", "And the rollback plan?"],
      ["candidate", "Keep the old path live."],
    ]);
  });

  it("keeps each piece as it was read, with its speaker beside it", () => {
    expect(castBlocks(blocks, cast)[0]).toEqual({
      ...blocks[0],
      speaker: "interviewer",
    });
  });

  it("with nobody named, everyone is unknown", () => {
    expect(new Set(castBlocks(blocks, {}).map((each) => each.speaker))).toEqual(
      new Set(["unknown"]),
    );
    expect(castBlocks(blocks, {})).toHaveLength(blocks.length);
  });

  it("a label may be said to be unknown, or the candidate, outright", () => {
    expect(
      heard(blocks.slice(0, 2), {
        "Speaker 1": "unknown",
        "Speaker 2": "candidate",
      }),
    ).toEqual([
      ["unknown", "How would you shard it?"],
      ["candidate", "By region first."],
    ]);
  });

  it("hideMe removes my lines and nobody else's", () => {
    expect(heard(blocks, cast, { hideMe: true })).toEqual([
      ["interviewer", "How would you shard it?"],
      ["unknown", "Yeah."],
      ["interviewer", "And the rollback plan?"],
    ]);
    expect(heard(blocks, cast, { hideMe: false })).toHaveLength(5);
  });

  it("two labels may be one person", () => {
    expect(
      heard(blocks, { ...cast, Unknown: "interviewer" }).filter(
        ([speaker]) => speaker === "interviewer",
      ),
    ).toHaveLength(3);
  });

  it("fromMs and toMs keep the pieces that touch the stretch, ends included", () => {
    const texts = (fromMs?: number, toMs?: number) =>
      castBlocks(blocks, cast, {
        ...(fromMs === undefined ? {} : { fromMs }),
        ...(toMs === undefined ? {} : { toMs }),
      }).map((each) => each.startMs);
    // A piece that ends exactly at fromMs, or starts exactly at toMs, is in.
    expect(texts(8_000)).toEqual([5_000, 12_000, 14_000, 18_000]);
    expect(texts(8_001)).toEqual([12_000, 14_000, 18_000]);
    expect(texts(undefined, 14_000)).toEqual([1_000, 5_000, 12_000, 14_000]);
    expect(texts(undefined, 13_999)).toEqual([1_000, 5_000, 12_000]);
    expect(texts(6_000, 15_000)).toEqual([5_000, 12_000, 14_000]);
    expect(texts(30_000)).toEqual([]);
  });

  it("does not change the blocks it was given", () => {
    const before = JSON.stringify(blocks);
    castBlocks(blocks, cast, { hideMe: true, fromMs: 5_000 });
    expect(JSON.stringify(blocks)).toBe(before);
  });
});
