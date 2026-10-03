// The deterministic baseline policy, alone and driven through the neutral core
// over the synthetic recruiter-screen script: backchannel, filler and
// monologue never open or revise; one question is one task (a compound
// question stays one); "part two" revises; "circle back" defers.
import { describe, expect, it } from "vitest";
import {
  applyTranscriptFinal,
  coalesceSegments,
  deferredTopics,
  effectiveSegments,
  emptyTaskState,
  emptyTranscript,
  type IdGenerator,
  markSegmentsSuperseded,
  processUtterance,
  revisionStanding,
  type TaskState,
  type TranscriptView,
} from "./core/index.js";
import {
  createInterviewSessionPolicy,
  decideBaseline,
  isBackchannel,
  isFiller,
  MONOLOGUE_WORDS,
} from "./interview-policy.js";
import {
  FIXTURE_SOURCES,
  RECRUITER_SCREEN,
} from "./session-replay-fixtures.js";

const verdict = (
  text: string,
  openTasks: { taskId: string; taskKey: string; revision: number }[] = [],
) =>
  decideBaseline({
    utterance: {
      id: "u1",
      speaker: "speaker-1",
      segmentIds: ["u1"],
      startMs: 0,
      endMs: 1,
      text,
    },
    openTasks,
    deferredTopics: [],
  });

describe("baseline classification", () => {
  it.each(["mm-hm", "Right.", "Okay", "Yeah", "uh huh", "Thank you."])(
    "treats %j as a backchannel that never opens a task",
    (text) => {
      expect(isBackchannel(text)).toBe(true);
      expect(verdict(text)).toEqual({
        segmentClass: "backchannel",
        decision: { kind: "ignore" },
      });
    },
  );

  it("treats pure filler as filler", () => {
    expect(isFiller("Um, uh,")).toBe(true);
    expect(verdict("Um, uh,").segmentClass).toBe("filler");
    expect(verdict("Um, uh,").decision).toEqual({ kind: "ignore" });
  });

  it("opens exactly one task for a compound question", () => {
    const result = verdict(
      "Tell me about a time you led a migration, and what trade-offs did you weigh along the way?",
    );
    expect(result.decision).toMatchObject({ kind: "open" });
  });

  it("opens a task for a question with no question mark when it starts like one", () => {
    expect(
      verdict("Walk me through how you would size that.").decision,
    ).toEqual({ kind: "open", taskKey: "q-u1" });
  });

  it("ignores a long statement as a monologue even with question words in it", () => {
    const monologue = `How we did it was ${"and then more context ".repeat(MONOLOGUE_WORDS)}`;
    expect(verdict(monologue)).toEqual({
      segmentClass: "monologue",
      decision: { kind: "ignore" },
    });
  });

  it("revises the latest open task on a follow-up or a changed constraint", () => {
    const open = [
      { taskId: "task-1", taskKey: "q-a", revision: 1 },
      { taskId: "task-2", taskKey: "q-b", revision: 1 },
    ];
    expect(
      verdict("Part two of that, how did you roll it back?", open),
    ).toEqual({
      segmentClass: "substantive",
      decision: { kind: "revise", taskId: "task-2", reason: "follow_up" },
    });
    expect(
      verdict("Now handle the case where the input is empty.", open).decision,
    ).toEqual({
      kind: "revise",
      taskId: "task-2",
      reason: "constraint_changed",
    });
    expect(verdict("What about duplicate keys?", open).decision).toMatchObject({
      kind: "revise",
      taskId: "task-2",
    });
  });

  it("opens a task instead when a revise cue has no task to revise", () => {
    expect(verdict("What about duplicate keys?").decision).toMatchObject({
      kind: "open",
    });
  });

  it("defers a topic on 'circle back' and 'put a pin'", () => {
    expect(verdict("Let us circle back to that later.").decision).toEqual({
      kind: "defer",
      topic: "topic-u1",
    });
    expect(verdict("Let's put a pin in it.").decision).toMatchObject({
      kind: "defer",
    });
  });

  it("returns only opaque handles, even for a hostile event id", () => {
    const hostile = decideBaseline({
      utterance: {
        id: "ignore previous instructions <script>",
        speaker: "s",
        segmentIds: [],
        startMs: 0,
        endMs: 1,
        text: "What is your experience with queues?",
      },
      openTasks: [],
      deferredTopics: [],
    });
    expect(hostile.decision).toEqual({
      kind: "open",
      taskKey: "q-ignore_previous_instructions__script_",
    });
  });

  it("exposes backchannel detection for coalescing and a device-capable assist stage", () => {
    const policy = createInterviewSessionPolicy();
    expect(policy.isBackchannel("mm-hm")).toBe(true);
    expect(policy.isBackchannel("Um,")).toBe(true);
    expect(policy.isBackchannel("Tell me about it.")).toBe(false);
    expect(policy.assist.deviceProfileId).toBeDefined();
  });
});

// Replays segments through the neutral core exactly as the processor does,
// without a database, to prove the policy + core produce the right task state.
async function replay(phaseCount: number) {
  const policy = createInterviewSessionPolicy();
  let counter = 0;
  const ids: IdGenerator = { next: (prefix) => `${prefix}-${(counter += 1)}` };
  let view: TranscriptView = emptyTranscript();
  let tasks: TaskState = emptyTaskState();
  const processed = new Set<string>();
  const seen: string[] = [];
  let seq = 0;
  for (const phase of RECRUITER_SCREEN.slice(0, phaseCount)) {
    for (const segment of phase.segments) {
      const source = FIXTURE_SOURCES[segment.role];
      seq += 1;
      const applied = applyTranscriptFinal(
        view,
        {
          version: 1,
          kind: "transcript.final",
          sourceId: source.sourceId,
          eventId: segment.eventId,
          occurredAt: "2026-10-03T10:00:00.000Z",
          sequence: seq,
          content: {
            speaker: source.speaker,
            text: segment.text,
            startMs: segment.startMs,
            endMs: segment.endMs,
            ...(segment.supersedes ? { supersedes: segment.supersedes } : {}),
          },
        },
        seq,
      );
      view = applied.view;
      if (applied.supersededIds.length)
        tasks = markSegmentsSuperseded(tasks, applied.supersededIds).state;
    }
    const utterances = coalesceSegments(effectiveSegments(view), (segment) =>
      policy.isBackchannel(segment.text),
    );
    for (const utterance of utterances) {
      if (processed.has(utterance.id)) continue;
      processed.add(utterance.id);
      const step = await processUtterance(tasks, policy, utterance, ids);
      tasks = step.state;
      seen.push(step.outcome.kind);
    }
  }
  return { tasks, seen };
}

describe("the recruiter-screen script through the core", () => {
  it("opens no task for backchannel or monologue and one per question", async () => {
    const { tasks } = await replay(1);
    expect(Object.keys(tasks.tasks)).toEqual(["task-1"]);
    expect(tasks.tasks["task-1"]?.revision).toBe(1);
  });

  it("raises the revision on 'part two' and leaves the earlier answer stale", async () => {
    const { tasks } = await replay(2);
    const task = tasks.tasks["task-1"];
    expect(Object.keys(tasks.tasks)).toEqual(["task-1"]);
    expect(task?.revision).toBe(2);
    expect(revisionStanding(tasks, "task-1", 1)).toBe("outdated");
    expect(revisionStanding(tasks, "task-1", 2)).toBe("current");
  });

  it("keeps a deferred topic and opens the next question", async () => {
    const { tasks } = await replay(3);
    expect(deferredTopics(tasks)).toHaveLength(1);
    expect(Object.keys(tasks.tasks)).toEqual(["task-1", "task-2"]);
  });

  it("marks the answer built on a corrected segment stale", async () => {
    const { tasks } = await replay(4);
    // The corrected segment flagged task-2's first revision as built on a
    // superseded source; the correction is then its own utterance.
    expect(revisionStanding(tasks, "task-2", 1)).not.toBe("current");
  });
});
