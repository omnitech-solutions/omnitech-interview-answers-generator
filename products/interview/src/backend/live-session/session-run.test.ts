// The run's utterance processing, paced like the processor does it: segments
// arrive over time, the settle window closes an utterance, and a closed
// utterance is never reopened by a later segment (M1). No database.
import { describe, expect, it } from "vitest";
import { applyTranscriptFinal, markSegmentsSuperseded } from "./core/index";
import { createInterviewSessionPolicy } from "./interview-policy";
import { ALL_REPLAY_SETS } from "./replay-fixture-sets";
import {
  capturedFor,
  createRun,
  processUtterances,
  type SessionRun,
} from "./session-run";

const SETTLE_MS = 1_500;
const policy = createInterviewSessionPolicy();

const newRun = (): SessionRun =>
  createRun(
    {
      tenantId: "t",
      ownerUserId: "o",
      sessionId: "00000000-0000-4000-8000-000000000001",
      fence: 1,
    } as never,
    "w",
    () => {},
  );

let ordinal = 0;
function arrive(
  run: SessionRun,
  nowMs: number,
  segment: {
    eventId: string;
    speaker: "interviewer" | "candidate";
    text: string;
    startMs: number;
    endMs: number;
    supersedes?: string;
  },
) {
  ordinal += 1;
  const { eventId, speaker, supersedes, ...content } = segment;
  const applied = applyTranscriptFinal(
    run.transcript,
    {
      version: 1,
      kind: "transcript.final",
      sourceId: speaker === "interviewer" ? "app" : "mic",
      eventId,
      occurredAt: "2026-10-03T10:00:00.000Z",
      sequence: ordinal,
      content: { speaker, ...content, ...(supersedes ? { supersedes } : {}) },
    } as never,
    ordinal,
  );
  run.transcript = applied.view;
  run.seenAtMs.set(eventId, nowMs);
  // As replayObservations does: work built on a superseded segment goes stale.
  if (applied.supersededIds.length > 0)
    run.tasks = markSegmentsSuperseded(run.tasks, applied.supersededIds).state;
}

const taskList = (run: SessionRun) =>
  Object.values(run.tasks.tasks).map((t) => `${t.taskKey}@r${t.revision}`);

describe("a processed utterance is closed (M1)", () => {
  it("answers a question that follows an interviewer statement and a backchannel", async () => {
    const run = newRun();
    arrive(run, 1_000, {
      eventId: "e1",
      speaker: "interviewer",
      text: "Thanks for joining today.",
      startMs: 0,
      endMs: 1_000,
    });
    await processUtterances(run, policy, 3_000, SETTLE_MS);
    arrive(run, 4_000, {
      eventId: "e2",
      speaker: "candidate",
      text: "Mm-hm.",
      startMs: 3_000,
      endMs: 3_500,
    });
    await processUtterances(run, policy, 6_000, SETTLE_MS);
    arrive(run, 7_000, {
      eventId: "e3",
      speaker: "interviewer",
      text: "What is your notice period?",
      startMs: 6_000,
      endMs: 7_000,
    });
    await processUtterances(run, policy, 9_000, SETTLE_MS);
    expect(taskList(run)).toEqual(["q-e3@r1"]);
  });

  it("answers a question that follows a context sentence after a pause over the settle window", async () => {
    const run = newRun();
    arrive(run, 2_000, {
      eventId: "e1",
      speaker: "interviewer",
      text: "Thanks, that is really helpful context.",
      startMs: 0,
      endMs: 2_000,
    });
    await processUtterances(run, policy, 3_600, SETTLE_MS);
    arrive(run, 5_000, {
      eventId: "e2",
      speaker: "interviewer",
      text: "What is your notice period?",
      startMs: 3_700,
      endMs: 5_000,
    });
    await processUtterances(run, policy, 6_600, SETTLE_MS);
    expect(taskList(run)).toEqual(["q-e2@r1"]);
  });

  it("a correction of the second segment of a merged utterance revises the task and marks the first answer stale", async () => {
    const run = newRun();
    arrive(run, 1_000, {
      eventId: "e1",
      speaker: "interviewer",
      text: "Thanks for joining.",
      startMs: 0,
      endMs: 1_000,
    });
    arrive(run, 2_000, {
      eventId: "e2",
      speaker: "interviewer",
      text: "What is your notice peroid?",
      startMs: 1_200,
      endMs: 2_000,
    });
    await processUtterances(run, policy, 4_000, SETTLE_MS);
    expect(taskList(run)).toEqual(["q-e2@r1"]);
    arrive(run, 5_000, {
      eventId: "e2b",
      speaker: "interviewer",
      text: "What is your notice period?",
      startMs: 1_200,
      endMs: 2_000,
      supersedes: "e2",
    });
    await processUtterances(run, policy, 7_000, SETTLE_MS);
    const task = Object.values(run.tasks.tasks)[0];
    expect(task?.revision).toBe(2);
    expect(task?.revisions.map((r) => [r.reason, r.sourceSuperseded])).toEqual([
      ["opened", true],
      ["correction", false],
    ]);
  });

  it("still folds a backchannel-split question that arrives inside the settle window", async () => {
    const run = newRun();
    arrive(run, 1_000, {
      eventId: "e1",
      speaker: "interviewer",
      text: "How would you design",
      startMs: 0,
      endMs: 1_000,
    });
    arrive(run, 1_300, {
      eventId: "e2",
      speaker: "candidate",
      text: "mm-hm",
      startMs: 1_000,
      endMs: 1_200,
    });
    arrive(run, 2_000, {
      eventId: "e3",
      speaker: "interviewer",
      text: "a rate limiter?",
      startMs: 1_300,
      endMs: 2_000,
    });
    await processUtterances(run, policy, 4_000, SETTLE_MS);
    expect(taskList(run)).toEqual(["q-e1@r1"]);
  });
});

describe("one question said in two pieces is one task (E4)", () => {
  const QUESTION =
    "My next question is more of a storytelling opportunity, so I would love to hear if you can walk me through a project you are proud of.";
  const CONTINUATION =
    "What were some of the goals and maybe challenges you ran into?";

  async function run2(
    reaction: string | null,
    gapMs: number,
    reactionWords?: string,
  ) {
    const run = newRun();
    arrive(run, 2_000, {
      eventId: "e1",
      speaker: "interviewer",
      text: QUESTION,
      startMs: 0,
      endMs: 2_000,
    });
    await processUtterances(run, policy, 4_000, SETTLE_MS);
    if (reaction !== null)
      arrive(run, 4_500, {
        eventId: "e2",
        speaker: "candidate",
        text: reaction,
        startMs: 3_000,
        endMs: 3_600,
      });
    const start = 2_000 + gapMs;
    arrive(run, start + 2_000, {
      eventId: "e3",
      speaker: "interviewer",
      text: reactionWords ?? CONTINUATION,
      startMs: start,
      endMs: start + 2_000,
    });
    await processUtterances(run, policy, start + 5_000, SETTLE_MS);
    return taskList(run);
  }

  it("revises the open task when the rest of the question follows after a short reaction", async () => {
    expect(await run2("Okay, sure.", 6_000)).toEqual(["q-e1@r2"]);
  });

  it("revises it when the rest follows with no reaction at all", async () => {
    expect(await run2(null, 4_000)).toEqual(["q-e1@r2"]);
  });

  it("opens a new task when the candidate has answered in between", async () => {
    expect(
      await run2(
        "Sure, so the project I would pick is the payments migration we did last year, where I led the team through the cutover.",
        6_000,
      ),
    ).toEqual(["q-e1@r1", "q-e3@r1"]);
  });

  it("opens a new task when the next question comes long after", async () => {
    expect(await run2("Okay.", 30_000)).toEqual(["q-e1@r1", "q-e3@r1"]);
  });

  it("gives the one task every piece of the question, including a middle piece that is no question itself", async () => {
    // Said in three pieces with short reactions between: the ask, the three buckets
    // it refers to (which end on a dangling "I would love to ask how you"), and the
    // last words of the question. The draft must see all three.
    const run = newRun();
    const piece = async (
      eventId: string,
      speaker: "interviewer" | "candidate",
      text: string,
      startMs: number,
    ) => {
      arrive(run, startMs + 2_000, {
        eventId,
        speaker,
        text,
        startMs,
        endMs: startMs + 2_000,
      });
      await processUtterances(run, policy, startMs + 4_500, SETTLE_MS);
    };
    await piece(
      "p1",
      "interviewer",
      "It is a bit tricky, but I would love to see how you might estimate your time.",
      0,
    );
    await piece("r1", "candidate", "Okay, sure.", 5_000);
    await piece(
      "p2",
      "interviewer",
      "First bucket would be hands-on coding, second bucket would be architectural design, third bucket would be mentoring the team. So yeah, I would love to ask how you",
      8_000,
    );
    await piece("r2", "candidate", "Mm-hmm.", 13_000);
    await piece(
      "p3",
      "interviewer",
      "currently split your time between those responsibilities?",
      16_000,
    );
    expect(taskList(run)).toEqual(["q-p1@r2"]);
    const task = Object.values(run.tasks.tasks)[0];
    const heard = capturedFor(run, task as never)
      .map((line) => line.text)
      .join(" ");
    expect(heard).toContain("estimate your time");
    expect(heard).toContain("First bucket would be hands-on coding");
    expect(heard).toContain("currently split your time");
    expect(heard).not.toContain("Okay, sure");
  });

  it("never continues a question that was already completed: the next question is its own task", async () => {
    const run = newRun();
    const piece = async (
      eventId: string,
      speaker: "interviewer" | "candidate",
      text: string,
      startMs: number,
    ) => {
      arrive(run, startMs + 2_000, {
        eventId,
        speaker,
        text,
        startMs,
        endMs: startMs + 2_000,
      });
      await processUtterances(run, policy, startMs + 4_500, SETTLE_MS);
    };
    await piece(
      "n1",
      "interviewer",
      "Is that something you have used previously that maybe was not mentioned on your resume?",
      0,
    );
    await piece("r1", "candidate", "Yeah, sure.", 4_000);
    await piece(
      "n2",
      "interviewer",
      "Oh lovely. I will send you a follow up email after our chat today.",
      7_000,
    );
    await piece(
      "n3",
      "interviewer",
      "Sorry, I am just making a note so I do not forget to follow up.",
      10_000,
    );
    await piece(
      "n4",
      "interviewer",
      "And then my next question for you is regarding best practices, and I would love to hear if you have considered observability and security before.",
      13_000,
    );
    expect(taskList(run)).toEqual(["q-n1@r1", "q-n4@r1"]);
  });

  it("treats a turn that starts by acknowledging the answer as a new question, not the rest of a cut-off one", async () => {
    const run = newRun();
    const piece = async (
      eventId: string,
      speaker: "interviewer" | "candidate",
      text: string,
      startMs: number,
    ) => {
      arrive(run, startMs + 2_000, {
        eventId,
        speaker,
        text,
        startMs,
        endMs: startMs + 2_000,
      });
      await processUtterances(run, policy, startMs + 4_500, SETTLE_MS);
    };
    // An ask, a short reaction, a middle piece that is cut off (no question mark, no
    // task of its own), another reaction, then the interviewer's next turn.
    await piece(
      "c1",
      "interviewer",
      "And regarding paid time off, I would love your input, because we would offer three weeks every year.",
      0,
    );
    await piece("r1", "candidate", "Mm-hmm.", 4_000);
    await piece(
      "c1b",
      "interviewer",
      "So that is fifteen business days plus five wellbeing days. Does that sound, uh...",
      7_000,
    );
    await piece("r2", "candidate", "Yeah, sounds good.", 11_000);
    await piece(
      "c2",
      "interviewer",
      "Okay, fantastic, great. Did you have any other questions for me for now?",
      14_000,
    );
    expect(taskList(run)).toEqual(["q-c1@r1", "q-c2@r1"]);
  });

  it("treats an acknowledgement inside the utterance as the end of the old turn", async () => {
    // The cut-off ask and the closing turn arrive as one coalesced utterance (the same
    // speaker, a reaction in between, under the merge gap): the acknowledgement in the
    // middle marks where the old turn ended.
    const run = newRun();
    const piece = async (
      eventId: string,
      speaker: "interviewer" | "candidate",
      text: string,
      startMs: number,
      endMs: number,
    ) => {
      arrive(run, endMs, { eventId, speaker, text, startMs, endMs });
      await processUtterances(run, policy, endMs + 100, SETTLE_MS);
    };
    await piece(
      "d1",
      "interviewer",
      "And regarding paid time off, I would love your input, because we would offer three weeks every year.",
      0,
      3_000,
    );
    await piece("e1", "candidate", "Mm-hmm.", 3_500, 4_000);
    // These two arrive within the merge gap and with a reaction between: one utterance.
    arrive(run, 8_000, {
      eventId: "d2",
      speaker: "interviewer",
      text: "So that is fifteen business days plus five wellbeing days. Does that sound, uh...",
      startMs: 6_000,
      endMs: 7_000,
    });
    arrive(run, 8_100, {
      eventId: "e2",
      speaker: "candidate",
      text: "Yeah.",
      startMs: 7_100,
      endMs: 7_400,
    });
    arrive(run, 10_000, {
      eventId: "d3",
      speaker: "interviewer",
      text: "Okay, fantastic, great. Did you have any other questions for me for now?",
      startMs: 7_800,
      endMs: 10_000,
    });
    await processUtterances(run, policy, 12_000, SETTLE_MS);
    expect(taskList(run)).toEqual(["q-d1@r1", "q-d3@r1"]);
  });

  it("holds an announcement that trails off, and the question that follows opens the one task", async () => {
    const run = newRun();
    arrive(run, 2_000, {
      eventId: "a1",
      speaker: "interviewer",
      text: "Thank you so much for sharing that, and my next question for you now.",
      startMs: 0,
      endMs: 2_000,
    });
    await processUtterances(run, policy, 4_000, SETTLE_MS);
    expect(taskList(run)).toEqual([]);
    arrive(run, 12_000, {
      eventId: "a2",
      speaker: "interviewer",
      text: "How would you estimate the way you currently split your time between coding, design and mentoring?",
      startMs: 9_000,
      endMs: 12_000,
    });
    await processUtterances(run, policy, 14_000, SETTLE_MS);
    expect(taskList(run)).toEqual(["q-a2@r1"]);
  });
});

// Every synthetic set, run paced (1x, 4x: segments arrive when their audio
// ends and an ASR correction a few seconds later) and all at once (what a
// rebuilt run does), must name the same questions. Revisions may differ: at 4x
// a correction can land inside the settle window and replace the pending
// question, so that task has fewer revisions.
async function taskKeys(name: string, speed: number | null) {
  const run = newRun();
  const segments = (ALL_REPLAY_SETS[name]?.phases ?? []).flatMap(
    (phase) => phase.segments,
  );
  const deliver = (nowMs: number, segment: (typeof segments)[number]) => {
    arrive(run, nowMs, {
      eventId: segment.eventId,
      speaker: segment.role,
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      ...(segment.supersedes ? { supersedes: segment.supersedes } : {}),
    });
  };
  if (speed === null) {
    for (const segment of segments) deliver(0, segment);
    await processUtterances(run, policy, 1e9, SETTLE_MS);
  } else {
    let now = 0;
    let lastIngest = 0;
    for (const segment of segments) {
      const arrival = Math.max(
        segment.endMs / speed,
        segment.supersedes === undefined ? 0 : lastIngest + 3_000 / speed,
      );
      while (now + 100 <= arrival) {
        now += 100;
        await processUtterances(run, policy, now, SETTLE_MS);
      }
      now = Math.max(now, arrival);
      deliver(now, segment);
      lastIngest = now;
    }
    for (let i = 0; i < 100; i += 1) {
      now += 100;
      await processUtterances(run, policy, now, SETTLE_MS);
    }
  }
  return Object.values(run.tasks.tasks).map((task) => task.taskKey);
}

describe("task identity does not depend on pacing (M2)", () => {
  it.each(Object.keys(ALL_REPLAY_SETS))(
    "%s names the same questions paced and rebuilt",
    async (name) => {
      const rebuilt = await taskKeys(name, null);
      expect(await taskKeys(name, 1)).toEqual(rebuilt);
      expect(await taskKeys(name, 4)).toEqual(rebuilt);
    },
  );
});
