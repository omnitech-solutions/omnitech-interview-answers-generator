// The run's utterance processing, paced like the processor does it: segments
// arrive over time, the settle window closes an utterance, and a closed
// utterance is never reopened by a later segment (M1). No database.
import { describe, expect, it } from "vitest";
import { applyTranscriptFinal, markSegmentsSuperseded } from "./core/index";
import { createInterviewSessionPolicy } from "./interview-policy";
import { ALL_REPLAY_SETS } from "./replay-fixture-sets";
import { createRun, processUtterances, type SessionRun } from "./session-run";

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
