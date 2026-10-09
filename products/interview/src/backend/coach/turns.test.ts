// When the coach acts, as a pure decision: what a turn is, how a turn reads,
// and what `decide` says for a stretch of lines and a clock. No model, no
// coach: the last part replays invented conversations through `decide` alone,
// as the replay lab does in its timing-only mode.
import type { CoachTranscriptLine } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  type ActReason,
  decide,
  isNoise,
  readsAs,
  shouldRecall,
  TURN_TIMING,
  type TurnTiming,
  turnsOf,
} from "./turns";

type Speaker = CoachTranscriptLine["speaker"];
type Said = readonly [Speaker, string];
const AT = "2026-10-09T09:00:00.000Z";
// The pairs as transcript lines, numbered from `first`.
const heard = (pairs: readonly Said[], first = 1): CoachTranscriptLine[] =>
  pairs.map(([speaker, text], at) => ({
    seq: first + at,
    speaker,
    text,
    at: AT,
  }));
// `count` words that each carry content.
const points = (count: number, tag = "point") =>
  Array.from({ length: count }, (_, at) => `${tag}${at + 1}`).join(" ");
const LONG_AGO = Number.POSITIVE_INFINITY;

const QUESTION = "How would you shard the booking table?";

describe("noise", () => {
  it.each([
    "um",
    "Yeah",
    "okay okay",
    "uh, yeah, right",
    "mm, mhm",
    "Thank you",
    "you know",
    "so, um",
    "I mean, yeah",
    "",
    "   ",
    "...",
  ])("%j says nothing", (text) => {
    expect(isNoise(text)).toBe(true);
  });

  it.each([
    "Why Kafka",
    "Yeah, by region",
    "Tell me more",
    "Okay, and the rollback",
    QUESTION,
  ])("%j says something", (text) => {
    expect(isNoise(text)).toBe(false);
  });

  // DEFECT (turns.ts:63-64, `wordsOf`): the word pattern keeps a full stop
  // inside a word ("okay." is the word "okay."), so a filler that speech
  // recognition ends with a full stop is not found among the fillers. Every
  // recogniser punctuates its acknowledgements this way.
  it.each(["Okay.", "Yeah.", "Right. Okay.", "Thank you."])(
    "DEFECT: %j, an acknowledgement ending in a full stop, says nothing",
    (text) => {
      expect(isNoise(text)).toBe(true);
    },
  );
});

describe("how a turn reads", () => {
  it.each<[string, ReturnType<typeof readsAs>]>([
    // A question mark.
    [QUESTION, "question"],
    ["And why that key?", "question"],
    ['So you said "by region"?', "question"],
    ["What is that for?", "question"],
    ["  Any questions for me?  ", "question"],
    // A request, ended with a full stop.
    ["Tell me about a time you led a migration.", "question"],
    ["Walk me through the design.", "question"],
    ["I'd love to hear how you approached it.", "question"],
    ["I would like to understand the trade-off.", "question"],
    ["Could you say a bit more on that.", "question"],
    ["Talk us through the rollout!", "question"],
    // Plain talk that is finished.
    ["We run nine regions on Postgres.", "finished"],
    ["That makes sense.", "finished"],
    ["Great, glad to hear it!", "finished"],
    // It promises more.
    ["So the first question I have is about,", "trailing"],
    ["and then I was wondering...", "trailing"],
    ["and then I was wondering…", "trailing"],
    ["so the thing with our", "trailing"],
    ["we looked at the", "trailing"],
    ["how would you shard the booking table", "trailing"],
    ["Tell me about,", "trailing"],
    ["um", "trailing"],
    ["", "trailing"],
  ])("%j reads as %s", (text, reads) => {
    expect(readsAs(text)).toBe(reads);
  });

  // DEFECT (turns.ts:103-105 with `wordsOf` at :63-64): the last word keeps
  // its full stop ("the."), so it is never found among the words that cannot
  // end a sentence. A recogniser that closes a half sentence with a full stop
  // makes it read as finished, and with a request phrase as a finished
  // QUESTION, which the coach acts on after `finishedMs`: half a question.
  it.each<[string, ReturnType<typeof readsAs>]>([
    ["So the first question I have is about the.", "trailing"],
    ["Can you tell me about the.", "trailing"],
    ["Walk me through how you would decide when to.", "trailing"],
    ["We split the service because.", "trailing"],
  ])(
    "DEFECT: %j, cut off on a word that cannot end a sentence, reads as %s",
    (text, reads) => {
      expect(readsAs(text)).toBe(reads);
    },
  );
});

describe("turns", () => {
  it("joins the lines one side says in a row into one turn", () => {
    expect(
      turnsOf(
        heard([
          ["interviewer", "So the booking table,"],
          ["interviewer", "how would you shard it?"],
          ["candidate", "By region first, then by tenant."],
        ]),
      ),
    ).toEqual([
      {
        side: "interviewer",
        text: "So the booking table, how would you shard it?",
        words: 7,
        until: 2,
      },
      {
        side: "candidate",
        text: "By region first, then by tenant.",
        words: 6,
        until: 3,
      },
    ]);
  });

  it("says there are no turns when nothing, or only noise, was said", () => {
    expect(turnsOf([])).toEqual([]);
    expect(
      turnsOf(
        heard([
          ["interviewer", "um"],
          ["candidate", "yeah"],
          ["unknown", "okay"],
        ]),
      ),
    ).toEqual([]);
  });

  it.each<Speaker>(["candidate", "interviewer", "unknown"])(
    "noise from %s neither ends a turn nor starts one",
    (speaker) => {
      const turns = turnsOf(
        heard([
          [speaker, "um, yeah"],
          ["interviewer", "How would you shard"],
          [speaker, "okay"],
          ["interviewer", "the booking table?"],
          [speaker, "right, yeah"],
        ]),
      );
      expect(turns).toEqual([
        {
          side: "interviewer",
          text: "How would you shard the booking table?",
          words: 6,
          // The noise after it is inside the turn.
          until: 5,
        },
      ]);
    },
  );

  it("a few words from the other side are a backchannel inside the turn: no new turn, and not the turn's words", () => {
    const turns = turnsOf(
      heard([
        ["candidate", "I would shard the booking table by region first"],
        ["interviewer", "by region"],
        ["candidate", "because traffic follows the region."],
      ]),
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      side: "candidate",
      text: "I would shard the booking table by region first because traffic follows the region.",
      until: 3,
    });
  });

  it("a sentence from the other side is their turn", () => {
    expect(
      turnsOf(
        heard([
          ["candidate", "I would shard the booking table by region first"],
          ["interviewer", "Why not shard by tenant?"],
          ["candidate", "Tenants are far too uneven."],
        ]),
      ).map((turn) => [turn.side, turn.until]),
    ).toEqual([
      ["candidate", 1],
      ["interviewer", 2],
      ["candidate", 3],
    ]);
  });

  describe("a speaker the recorder could not name", () => {
    it("saying little continues whoever was speaking", () => {
      const turns = turnsOf(
        heard([
          ["candidate", "I would shard the booking table by region first"],
          ["unknown", "then tenant"],
          ["interviewer", "Why not shard by tenant?"],
          ["unknown", "or customer"],
        ]),
      );
      expect(turns.map((turn) => [turn.side, turn.text, turn.until])).toEqual([
        [
          "candidate",
          "I would shard the booking table by region first then tenant",
          2,
        ],
        ["interviewer", "Why not shard by tenant? or customer", 4],
      ]);
    });

    it("saying a sentence is the interviewer", () => {
      expect(
        turnsOf(
          heard([
            ["candidate", "I would shard the booking table by region first"],
            ["unknown", "And what happens when one region runs hot?"],
          ]),
        ).map((turn) => [turn.side, turn.until]),
      ).toEqual([
        ["candidate", 1],
        ["interviewer", 2],
      ]);
    });

    it("is the interviewer when nobody was speaking, even saying little", () => {
      expect(
        turnsOf(heard([["unknown", "Hello Priyanka"]])).map(
          (turn) => turn.side,
        ),
      ).toEqual(["interviewer"]);
    });
  });

  describe("the call heard again through the microphone", () => {
    it("a candidate line made of the interviewer's words is dropped, inside the interviewer's turn", () => {
      const turns = turnsOf(
        heard([
          ["interviewer", QUESTION],
          ["candidate", "would you shard the booking table"],
        ]),
      );
      expect(turns).toEqual([
        { side: "interviewer", text: QUESTION, words: 6, until: 2 },
      ]);
    });

    it("a candidate line of their own words is their turn", () => {
      expect(
        turnsOf(
          heard([
            ["interviewer", QUESTION],
            ["candidate", "I would shard it by region first"],
          ]),
        ).map((turn) => turn.side),
      ).toEqual(["interviewer", "candidate"]);
    });

    it("an echo is of the interviewer only: the interviewer repeating the candidate is a turn", () => {
      expect(
        turnsOf(
          heard([
            ["candidate", "I would shard the booking table by region"],
            ["interviewer", "shard the booking table by region"],
          ]),
        ).map((turn) => turn.side),
      ).toEqual(["candidate", "interviewer"]);
    });
  });
});

describe("the decision", () => {
  const ask = (
    pairs: readonly Said[],
    silenceMs: number,
    more: { sinceActMs?: number; timing?: Partial<TurnTiming> } = {},
  ) =>
    decide({
      fresh: heard(pairs),
      silenceMs,
      sinceActMs: more.sinceActMs ?? LONG_AGO,
      ...(more.timing ? { timing: more.timing } : {}),
    });
  const acts = (
    reason: ActReason,
    until: number,
    about: "interviewer" | "candidate" = "interviewer",
  ) => ({ action: "act", reason, until, about });

  it("waits while nothing has been said, however long", () => {
    expect(ask([], 60_000)).toEqual({ action: "wait", why: "nothing said" });
    expect(ask([["interviewer", "um"]], 60_000).action).toBe("wait");
  });

  it("orders its pauses: a finished question soonest, a trailing turn last", () => {
    expect(TURN_TIMING.finishedMs).toBeLessThan(TURN_TIMING.pauseMs);
    expect(TURN_TIMING.pauseMs).toBeLessThan(TURN_TIMING.trailingMs);
    // The brief: a finished question is acted on in under 1.5 s.
    expect(TURN_TIMING.finishedMs).toBeLessThan(1_500);
    expect(TURN_TIMING.candidateEveryMs).toBeGreaterThanOrEqual(20_000);
  });

  describe("the interviewer's turn", () => {
    it("a finished question is acted on after finishedMs of silence, not before", () => {
      const said: Said[] = [["interviewer", QUESTION]];
      expect(ask(said, 0).action).toBe("wait");
      expect(ask(said, TURN_TIMING.finishedMs - 1)).toEqual({
        action: "wait",
        why: "the interviewer may go on",
      });
      expect(ask(said, TURN_TIMING.finishedMs)).toEqual(
        acts("question-finished", 1),
      );
    });

    it("a request ending in a full stop is a finished question", () => {
      const said: Said[] = [
        ["interviewer", "Tell me about a time you led a migration."],
      ];
      expect(ask(said, TURN_TIMING.finishedMs)).toEqual(
        acts("question-finished", 1),
      );
    });

    it("a finished statement is acted on after pauseMs, as a pause", () => {
      const said: Said[] = [
        ["interviewer", "We run the booking platform across nine regions."],
      ];
      expect(ask(said, TURN_TIMING.finishedMs).action).toBe("wait");
      expect(ask(said, TURN_TIMING.pauseMs - 1)).toEqual({
        action: "wait",
        why: "the interviewer may go on",
      });
      expect(ask(said, TURN_TIMING.pauseMs)).toEqual(acts("pause", 1));
    });

    it("a trailing turn is waited on until trailingMs, then acted on as a pause", () => {
      const said: Said[] = [
        ["interviewer", "So the first question I have is about sharding,"],
      ];
      for (const silenceMs of [
        TURN_TIMING.finishedMs,
        TURN_TIMING.pauseMs,
        TURN_TIMING.trailingMs - 1,
      ])
        expect(ask(said, silenceMs), `${silenceMs} ms`).toEqual({
          action: "wait",
          why: "the interviewer has not finished the sentence",
        });
      expect(ask(said, TURN_TIMING.trailingMs)).toEqual(acts("pause", 1));
    });

    it("reads the turn by how it ENDS: a question that goes on into a trailing clause waits", () => {
      const said: Said[] = [
        ["interviewer", QUESTION],
        ["interviewer", "and I mean when the tenants are,"],
      ];
      expect(ask(said, TURN_TIMING.pauseMs).action).toBe("wait");
      expect(ask(said, TURN_TIMING.trailingMs)).toEqual(acts("pause", 2));
    });

    it("says too little to act on under four words that carry content", () => {
      expect(ask([["interviewer", "Why Kafka?"]], 60_000).action).toBe("wait");
      expect(ask([["interviewer", "Why that shard key?"]], 800)).toEqual(
        acts("question-finished", 1),
      );
    });

    it("an unknown speaker's sentence is acted on as the interviewer's", () => {
      expect(ask([["unknown", "Tell me about that project."]], 800)).toEqual(
        acts("question-finished", 1),
      );
    });

    it("acts at once when the candidate starts to answer, whatever the turn reads as", () => {
      for (const question of [
        QUESTION,
        "We run the booking platform across nine regions.",
        "So the first question I have is about sharding,",
      ])
        expect(
          ask(
            [
              ["interviewer", question],
              ["candidate", "I would start with the region."],
            ],
            0,
          ),
          question,
        ).toEqual(acts("speaker-change", 1));
    });

    it("the stretch ends at the END of the interviewer's turn, not at the candidate's line", () => {
      expect(
        ask(
          [
            ["candidate", "That was the end of the last project."],
            ["interviewer", "So the booking table,"],
            ["interviewer", "how would you shard it?"],
            ["candidate", "yeah"],
            ["candidate", "I would start with the region."],
            ["candidate", "Then split by tenant inside it."],
          ],
          0,
        ),
        // Line 4 is noise, inside the interviewer's turn.
      ).toEqual(acts("speaker-change", 4));
    });

    it("a backchannel from the candidate is not an answer: the question still waits for its pause", () => {
      const said: Said[] = [
        ["interviewer", QUESTION],
        ["candidate", "yeah"],
        ["candidate", "okay, sure"],
      ];
      expect(ask(said, TURN_TIMING.finishedMs - 1).action).toBe("wait");
      expect(ask(said, TURN_TIMING.finishedMs)).toEqual(
        acts("question-finished", 3),
      );
    });

    it("an echo of the question through the microphone is not an answer", () => {
      const said: Said[] = [
        ["interviewer", QUESTION],
        ["candidate", "how would you shard the booking table"],
      ];
      expect(ask(said, 0).action).toBe("wait");
      expect(ask(said, TURN_TIMING.finishedMs)).toEqual(
        acts("question-finished", 2),
      );
    });
  });

  describe("a backlog", () => {
    it("is walked one question at a time", () => {
      const lines = heard([
        ["interviewer", QUESTION],
        ["candidate", "By region first, then by tenant."],
        ["interviewer", "And what happens when one region runs hot?"],
        ["candidate", "I would split that region again."],
        ["candidate", "And move the largest tenants out."],
        ["interviewer", "Tell me about a time you led a migration."],
      ]);
      const walked: unknown[] = [];
      let readTo = 0;
      for (let step = 0; step < 6; step += 1) {
        const decision = decide({
          fresh: lines.filter((line) => line.seq > readTo),
          silenceMs: 0,
          sinceActMs: 0,
        });
        walked.push(
          decision.action === "act"
            ? [decision.reason, decision.until]
            : decision.action,
        );
        if (decision.action === "wait") break;
        readTo = decision.until;
      }
      // The last question has no answer yet and nobody has paused.
      expect(walked).toEqual([
        ["speaker-change", 1],
        ["speaker-change", 3],
        "wait",
      ]);
      expect(
        decide({
          fresh: lines.filter((line) => line.seq > readTo),
          silenceMs: TURN_TIMING.finishedMs,
          sinceActMs: 0,
        }),
      ).toEqual(acts("question-finished", 6));
    });
  });

  describe("the candidate's own talk", () => {
    const answer = (words: number): Said[] => [
      ["candidate", points(Math.floor(words / 2), "first")],
      ["candidate", points(words - Math.floor(words / 2), "second")],
    ];

    it("waits for candidateWords, then for candidateEveryMs since the last act, then for a gap of candidateGapMs", () => {
      const { candidateWords, candidateEveryMs, candidateGapMs } = TURN_TIMING;
      expect(ask(answer(candidateWords - 1), 60_000)).toEqual({
        action: "wait",
        why: "the candidate has said little yet",
      });
      expect(
        ask(answer(candidateWords), 60_000, {
          sinceActMs: candidateEveryMs - 1,
        }),
      ).toEqual({
        action: "wait",
        why: "the coach looked at this answer recently",
      });
      expect(
        ask(answer(candidateWords), candidateGapMs - 1, {
          sinceActMs: candidateEveryMs,
        }),
      ).toEqual({ action: "wait", why: "the candidate is mid-sentence" });
      expect(
        ask(answer(candidateWords), candidateGapMs, {
          sinceActMs: candidateEveryMs,
        }),
      ).toEqual(acts("answer-check", 2, "candidate"));
    });

    it("counts words that carry content, not fillers", () => {
      const padded: Said[] = [
        ["candidate", points(TURN_TIMING.candidateWords - 1)],
        [
          "candidate",
          "um, so, like, you know, I mean, yeah, right, okay, well",
        ],
      ];
      expect(ask(padded, 60_000).action).toBe("wait");
    });

    it("a backchannel from the interviewer does not make the answer the interviewer's turn", () => {
      const said: Said[] = [
        ["candidate", points(40, "first")],
        ["interviewer", "mhm"],
        ["interviewer", "okay, right"],
        ["candidate", points(20, "second")],
      ];
      expect(ask(said, 60_000)).toEqual(acts("answer-check", 4, "candidate"));
    });
  });

  describe("timing given by the caller", () => {
    it.each<[keyof TurnTiming, Said[], number, number]>([
      ["finishedMs", [["interviewer", QUESTION]], 200, LONG_AGO],
      [
        "pauseMs",
        [["interviewer", "We run the booking platform across nine regions."]],
        300,
        LONG_AGO,
      ],
      [
        "trailingMs",
        [["interviewer", "So the first question I have is about sharding,"]],
        400,
        LONG_AGO,
      ],
      ["candidateWords", [["candidate", points(5)]], 60_000, LONG_AGO],
      ["candidateEveryMs", [["candidate", points(60)]], 60_000, 5_000],
      ["candidateGapMs", [["candidate", points(60)]], 300, LONG_AGO],
    ])("%s is honoured", (name, said, silenceMs, sinceActMs) => {
      const value = {
        ...TURN_TIMING,
        candidateWords: 5,
        candidateEveryMs: 5_000,
      }[name];
      const given =
        name === "candidateWords" || name === "candidateEveryMs"
          ? value
          : silenceMs;
      // With the standing timing it waits; with the override it acts.
      expect(ask(said, silenceMs, { sinceActMs }).action).toBe("wait");
      expect(
        ask(said, silenceMs, { sinceActMs, timing: { [name]: given } }).action,
      ).toBe("act");
      // And the override is a threshold, not a switch.
      if (given === silenceMs)
        expect(
          ask(said, silenceMs - 1, { sinceActMs, timing: { [name]: given } })
            .action,
        ).toBe("wait");
    });

    it("leaves the timings it was not given as they stand", () => {
      expect(
        ask([["interviewer", QUESTION]], TURN_TIMING.finishedMs, {
          timing: { pauseMs: 10 },
        }),
      ).toEqual(acts("question-finished", 1));
      expect(
        ask([["interviewer", QUESTION]], TURN_TIMING.finishedMs - 1, {
          timing: { pauseMs: 10 },
        }).action,
      ).toBe("wait");
    });
  });
});

describe("making a call again", () => {
  const more = (pairs: readonly Said[]) => shouldRecall(heard(pairs, 5));

  it.each<[string, Said[]]>([
    [
      "the interviewer went on with the question",
      [["interviewer", "and how would you roll that back?"]],
    ],
    [
      "an unnamed speaker went on with a sentence",
      [["unknown", "and what about the hot regions there?"]],
    ],
    [
      "the interviewer went on in fragments",
      [
        ["interviewer", "and also"],
        ["interviewer", "the rollback plan"],
      ],
    ],
    [
      "the interviewer went on after noise from the candidate",
      [
        ["candidate", "yeah"],
        ["interviewer", "and how would you roll that back?"],
      ],
    ],
    [
      "the interviewer went on over a backchannel",
      [
        ["interviewer", "and how would you roll that back?"],
        ["candidate", "okay, sure"],
      ],
    ],
  ])("yes when %s", (_, added) => {
    expect(more(added)).toBe(true);
  });

  it.each<[string, Said[]]>([
    ["nothing was added", []],
    ["the interviewer only acknowledged", [["interviewer", "okay, right"]]],
    ["the interviewer added a word or two", [["interviewer", "by tomorrow"]]],
    [
      "only noise was added",
      [
        ["candidate", "um"],
        ["unknown", "yeah"],
      ],
    ],
    [
      "the candidate has begun to answer",
      [["candidate", "I would start with the region."]],
    ],
    [
      "the candidate answered and the interviewer spoke again",
      [
        ["candidate", "I would start with the region."],
        ["interviewer", "and how would you roll that back?"],
      ],
    ],
    [
      "the interviewer went on and the candidate has since begun to answer",
      [
        ["interviewer", "and how would you roll that back?"],
        ["candidate", "I would keep the old path live."],
      ],
    ],
  ])("no when %s", (_, added) => {
    expect(more(added)).toBe(false);
  });

  // DEFECT (turns.ts:63-64, `wordsOf`, read by `shouldRecall` at :252-261):
  // "Okay." is the word "okay.", not a filler, so three punctuated
  // acknowledgements count as three words of content and a call that was
  // answering a whole question is stopped and made again.
  it("DEFECT: no when the interviewer only acknowledged, with full stops", () => {
    expect(more([["interviewer", "Okay. Right. Yeah."]])).toBe(false);
  });
});

// ---- Invented conversations, replayed through `decide` ----------------------

type Spoken = readonly [atMs: number, speaker: Speaker, text: string];
type Acted = { atMs: number; reason: ActReason; from: number; until: number };

// The coach's loop without a model: a line is heard at its moment, the clock
// is stepped, and a decision to act is obeyed at once (the stand-in answers
// instantly, so every act is collected before the next look).
function replay(
  spoken: readonly Spoken[],
  options: { stepMs?: number; tailMs?: number } = {},
): Acted[] {
  const { stepMs = 100, tailMs = 12_000 } = options;
  const lines = spoken.map(([atMs, speaker, text], at) => ({
    atMs,
    line: { seq: at + 1, speaker, text, at: AT },
  }));
  const acted: Acted[] = [];
  let readTo = 0;
  let lastActMs = Number.NEGATIVE_INFINITY;
  const end = (lines.at(-1)?.atMs ?? 0) + tailMs;
  for (let now = 0; now <= end; now += stepMs) {
    const held = lines.filter((each) => each.atMs <= now);
    const fresh = held
      .filter((each) => each.line.seq > readTo)
      .map((each) => each.line);
    if (fresh.length === 0) continue;
    const decision = decide({
      fresh,
      silenceMs: now - (held.at(-1)?.atMs ?? 0),
      sinceActMs: now - lastActMs,
    });
    if (decision.action === "wait") continue;
    acted.push({
      atMs: now,
      reason: decision.reason,
      from: fresh[0]?.seq ?? 0,
      until: decision.until,
    });
    readTo = decision.until;
    lastActMs = now;
    // A backlog is walked within the same moment.
    now -= stepMs;
  }
  return acted;
}

describe("the brief's conversations", () => {
  it("a slow asker: fifteen seconds of fragments are one action, after the question's end", () => {
    const acted = replay([
      [0, "interviewer", "So the first question I have is about,"],
      [3_000, "interviewer", "um,"],
      [5_500, "interviewer", "service boundaries, and"],
      [9_000, "interviewer", "how do you decide when a feature"],
      [12_000, "interviewer", "should be its own service,"],
      [15_000, "interviewer", "or stay inside the monolith?"],
    ]);
    expect(acted).toEqual([
      {
        atMs: 15_000 + TURN_TIMING.finishedMs,
        reason: "question-finished",
        from: 1,
        until: 6,
      },
    ]);
  });

  it("a slow asker who never finishes is acted on at the ceiling of silence, not for ever", () => {
    const acted = replay([
      [0, "interviewer", "So the first question I have is about,"],
      [4_000, "interviewer", "how you decide when a feature should be its own"],
    ]);
    expect(acted).toEqual([
      {
        atMs: 4_000 + TURN_TIMING.trailingMs,
        reason: "pause",
        from: 1,
        until: 2,
      },
    ]);
  });

  it("a two-part question asked in one breath is one action", () => {
    const acted = replay([
      [0, "interviewer", "How would you handle one region running hot?"],
      [500, "interviewer", "And how would you roll that change back?"],
      [4_000, "candidate", "I would split the hot region first."],
    ]);
    expect(acted).toEqual([
      {
        atMs: 500 + TURN_TIMING.finishedMs,
        reason: "question-finished",
        from: 1,
        until: 2,
      },
    ]);
  });

  it("a two-part question with a pause between: the second part is cause to make the call again, and the whole turn is then one stretch", () => {
    const first: Said = [
      "interviewer",
      "How would you handle one region running hot?",
    ];
    const second: Said = [
      "interviewer",
      "And how would you roll that change back?",
    ];
    // The first part reads as finished, so the coach acts on it...
    expect(
      decide({
        fresh: heard([first]),
        silenceMs: TURN_TIMING.finishedMs,
        sinceActMs: LONG_AGO,
      }),
    ).toMatchObject({ action: "act", reason: "question-finished", until: 1 });
    // ...and what was added while that call ran says to make it again,
    expect(shouldRecall(heard([second], 2))).toBe(true);
    // with both parts, as one turn.
    expect(
      decide({
        fresh: heard([first, second]),
        silenceMs: TURN_TIMING.finishedMs,
        sinceActMs: 1_500,
      }),
    ).toMatchObject({ action: "act", reason: "question-finished", until: 2 });
  });

  it("an interruption: the answer is cut short by a new question, which is acted on once, on its own end", () => {
    const acted = replay([
      [0, "interviewer", "Tell me about a time you led a migration."],
      [400, "candidate", "Sure, at my last company we moved the ledger"],
      [2_400, "candidate", "from one big database to"],
      [3_000, "interviewer", "Sorry, before that, which database was that on?"],
      [6_000, "candidate", "It was on Postgres, version twelve."],
    ]);
    expect(acted).toEqual([
      // The candidate began to answer before the pause was up.
      { atMs: 400, reason: "speaker-change", from: 1, until: 1 },
      // The interruption is its own question; what the candidate had said
      // is read with it.
      {
        atMs: 3_000 + TURN_TIMING.finishedMs,
        reason: "question-finished",
        from: 2,
        until: 4,
      },
    ]);
  });

  it("back-channel noise: acknowledgements under the wrong speaker neither split the question nor the answer", () => {
    const acted = replay([
      [0, "interviewer", "So you have run a large migration before,"],
      [1_200, "candidate", "yeah"],
      [1_500, "unknown", "mhm"],
      [2_500, "interviewer", "what was the hardest part,"],
      [3_600, "candidate", "okay"],
      [4_500, "interviewer", "and what would you do differently now?"],
      [5_000, "unknown", "right"],
      [7_000, "candidate", points(25, "first")],
      [12_000, "interviewer", "mhm"],
      [13_000, "candidate", points(25, "second")],
      [18_000, "unknown", "yeah, okay"],
      [19_000, "candidate", points(25, "third")],
      [24_000, "interviewer", "right"],
    ]);
    expect(acted.map((each) => [each.reason, each.from, each.until])).toEqual([
      // One action for the question, at its end (the "right" is inside it).
      ["question-finished", 1, 7],
      // One look at the answer, once enough was said and time had passed.
      ["answer-check", 8, 13],
    ]);
    expect(acted[0]?.atMs).toBe(5_000 + TURN_TIMING.finishedMs);
    expect(acted[1]?.atMs).toBeGreaterThanOrEqual(
      (acted[0]?.atMs ?? 0) + TURN_TIMING.candidateEveryMs,
    );
  });

  // DEFECT (turns.ts:63-64, `wordsOf`): the same conversation as a speech
  // recogniser writes it, each acknowledgement ending in a full stop. Each
  // "Yeah." then counts as a word of content, so the lines the recorder put
  // under the wrong speaker add up to turns of their own.
  it("DEFECT: back-channel noise as a recogniser punctuates it gives the same two actions", () => {
    const acted = replay([
      [0, "interviewer", "So you have run a large migration before,"],
      [1_200, "candidate", "Yeah."],
      [1_500, "unknown", "Mhm."],
      [2_500, "interviewer", "what was the hardest part,"],
      [3_600, "candidate", "Okay."],
      [4_500, "interviewer", "and what would you do differently now?"],
      [5_000, "unknown", "Right."],
      [7_000, "candidate", points(25, "first")],
      [12_000, "interviewer", "Mhm. Okay. Right. Yeah."],
      [13_000, "candidate", points(25, "second")],
      [18_000, "unknown", "Yeah, okay."],
      [19_000, "candidate", points(25, "third")],
      [24_000, "interviewer", "Right."],
    ]);
    expect(acted.map((each) => [each.reason, each.from, each.until])).toEqual([
      ["question-finished", 1, 7],
      ["answer-check", 8, 13],
    ]);
  });

  it("a long answer is looked at no more than once per candidateEveryMs", () => {
    // Ninety seconds of answer, a fragment of twelve words every two seconds.
    const answer: Spoken[] = Array.from({ length: 45 }, (_, at) => [
      2_000 + at * 2_000,
      "candidate",
      points(12, `part${at}x`),
    ]);
    const acted = replay(
      [
        [0, "interviewer", "Tell me about a time you led a migration."],
        ...answer,
      ],
      { tailMs: 3_000 },
    );
    expect(acted[0]).toMatchObject({ reason: "question-finished", until: 1 });
    const looks = acted.slice(1);
    expect(looks.every((each) => each.reason === "answer-check")).toBe(true);
    expect(looks.length).toBeGreaterThanOrEqual(1);
    // The brief: at most one look per 20 s of the candidate's talk.
    expect(looks.length).toBeLessThanOrEqual(Math.floor(92_000 / 20_000));
    const moments = acted.map((each) => each.atMs);
    for (let at = 1; at < moments.length; at += 1)
      expect(
        (moments[at] as number) - (moments[at - 1] as number),
      ).toBeGreaterThanOrEqual(TURN_TIMING.candidateEveryMs);
  });

  it("the candidate asking the questions at the end: the interviewer's answers are never read as a finished question", () => {
    const acted = replay([
      [0, "interviewer", "Do you have any questions for me?"],
      [3_000, "candidate", "What does the on-call rotation look like?"],
      [6_000, "interviewer", "We rotate weekly across six engineers."],
      [7_500, "interviewer", "Pages are rare outside of a launch."],
      [
        13_000,
        "candidate",
        "And how is success measured in the first quarter?",
      ],
      [16_000, "interviewer", "Mostly by what ships and how it holds up."],
      [22_000, "candidate", "Thanks, that is all from me."],
    ]);
    expect(acted.map((each) => [each.reason, each.until])).toEqual([
      // The invitation to ask is a question to the candidate.
      ["question-finished", 1],
      // The interviewer's answers: talk that stopped, for the model to pass
      // over or use, never "the interviewer has just finished asking".
      ["pause", 4],
      ["pause", 6],
    ]);
    // The candidate's own short questions never bring a look at "the answer".
    expect(acted.some((each) => each.reason === "answer-check")).toBe(false);
  });
});
