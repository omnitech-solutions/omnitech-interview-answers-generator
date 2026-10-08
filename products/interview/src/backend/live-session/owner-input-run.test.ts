// Owner input in a run's task state (ADR-0016), without a database: an analyze
// or typed input becomes a task (or a revision) whose provenance names the
// input and the exact snapshots, never a transcript segment; replay after a
// restart does not apply an input twice; attachments name provenance ids only.
import { describe, expect, it } from "vitest";
import { createInterviewSessionPolicy } from "./interview-policy";
import type { SessionStorePort } from "./processor-ports";
import type { StoredAction, StoredObservation } from "./session-reads";
import {
  attachmentsFor,
  capturedFor,
  createRun,
  hintsFor,
  processInOrder,
  processOwnerInputs,
  processUtterances,
  replayObservations,
  type SessionRun,
  seedFromActions,
} from "./session-run";

const SESSION = "00000000-0000-4000-8000-000000000001";
const policy = createInterviewSessionPolicy();
const traces: string[] = [];

const newRun = (): SessionRun =>
  createRun(
    { tenantId: "t", ownerUserId: "o", sessionId: SESSION, fence: 1 } as never,
    "w",
    (event) => traces.push(`${event.event}:${event.outcome}`),
  );

let sequence = 0;
const observation = (
  kind: string,
  sourceId: string,
  eventId: string,
  body: unknown,
  screenshotArtifactId: string | null = null,
): StoredObservation => ({
  sequence: ++sequence,
  sourceId,
  eventId,
  kind,
  receivedAt: "2026-10-03T10:00:00.000Z",
  content: { occurredAt: "2026-10-03T10:00:00.000Z", sourceSequence: 1, body },
  screenshotArtifactId,
});
const spoken = (eventId: string, text: string, startMs = 0) =>
  observation("transcript.final", "app", eventId, {
    speaker: "interviewer",
    source: "application-audio",
    text,
    startMs,
    endMs: startMs + 4_000,
  });
const shot = (eventId: string) =>
  observation(
    "screen.snapshot",
    "screen",
    eventId,
    {
      payloadRef: `p-${eventId}`,
      mediaType: "image/png",
      byteLength: 10,
      windowLabel: "w",
    },
    "artifact",
  );
const input = (requestId: string, body: Record<string, unknown>) =>
  observation("owner.input", "studio.owner-input", requestId, body);

const storeOf = (rows: StoredObservation[]): SessionStorePort =>
  ({
    observationsAfter: async (
      _scope: unknown,
      _session: string,
      after: number,
      limit: number,
    ) => rows.filter((row) => row.sequence > after).slice(0, limit),
    processedThrough: async () => 0,
    recordFailure: async () => ({ outcome: "recorded" }),
  }) as unknown as SessionStorePort;

async function replay(run: SessionRun, rows: StoredObservation[]) {
  await replayObservations(run, storeOf(rows), 1_000, 200);
}

describe("an owner capture with hints", () => {
  it("attaches the owner-capture snapshot and carries the newest hints on the task", async () => {
    const run = newRun();
    await replay(run, [
      observation(
        "screen.snapshot",
        "studio.owner-capture",
        "r-1",
        {
          payloadRef: "r-1",
          mediaType: "image/png",
          byteLength: 10,
          windowLabel: "Chrome",
        },
        "artifact",
      ),
      input("r-1", {
        operation: "analyze",
        skill: "dsa",
        snapshots: [{ sourceId: "studio.owner-capture", eventId: "r-1" }],
      }),
    ]);
    processOwnerInputs(run);
    const task = run.tasks.tasks["task-i.r-1"] as never;
    expect(attachmentsFor(run, task).map((a) => a.reference)).toEqual([
      `snap/${SESSION}/studio.owner-capture/r-1`,
    ]);
    expect(hintsFor(run, task)).toEqual({ skill: "dsa" });
    // A later input on the same task overrides skill and adds a language.
    await replay(run, [
      input("r-2", {
        operation: "follow-up",
        text: "again",
        skill: "programming",
        language: "typescript",
        target: { taskId: "task-i.r-1", revision: 1 },
        snapshots: [],
      }),
    ]);
    processOwnerInputs(run);
    expect(hintsFor(run, run.tasks.tasks["task-i.r-1"] as never)).toEqual({
      skill: "programming",
      language: "typescript",
    });
    // An input that omits both keeps them; "auto" RESETS the one it names.
    await replay(run, [
      input("r-3", {
        operation: "follow-up",
        text: "more",
        target: { taskId: "task-i.r-1", revision: 1 },
        snapshots: [],
      }),
    ]);
    processOwnerInputs(run);
    expect(hintsFor(run, run.tasks.tasks["task-i.r-1"] as never)).toEqual({
      skill: "programming",
      language: "typescript",
    });
    await replay(run, [
      input("r-4", {
        operation: "follow-up",
        text: "detect it",
        language: "auto",
        target: { taskId: "task-i.r-1", revision: 1 },
        snapshots: [],
      }),
    ]);
    processOwnerInputs(run);
    expect(hintsFor(run, run.tasks.tasks["task-i.r-1"] as never)).toEqual({
      skill: "programming",
    });
  });
});

describe("an analyze input", () => {
  it("opens its own task named after the request, resting on the input and the snapshot, with no transcript segment", async () => {
    const run = newRun();
    await replay(run, [
      shot("s1"),
      input("r-1", {
        operation: "analyze",
        snapshots: [{ sourceId: "screen", eventId: "s1" }],
      }),
    ]);
    expect(processOwnerInputs(run)).toBe(1);

    const task = run.tasks.tasks["task-i.r-1"];
    expect(task?.revision).toBe(1);
    expect(task?.revisions[0]?.basedOn).toEqual([
      "input/r-1",
      `snap/${SESSION}/screen/s1`,
    ]);
    expect(Object.keys(run.transcript.segments)).toEqual([]);
    expect(attachmentsFor(run, task as never)).toEqual([
      {
        id: `snap/${SESSION}/screen/s1`,
        kind: "image",
        name: "screenshot-1",
        reference: `snap/${SESSION}/screen/s1`,
        mimeType: "image/png",
      },
    ]);
    expect(capturedFor(run, task as never)).toEqual([]);
  });

  it("attaches at most the newest few images, and none that were never replayed as snapshots", async () => {
    const run = newRun();
    const ids = ["a", "b", "c", "d", "e", "f"];
    await replay(run, [
      ...ids.map(shot),
      input("r-1", {
        operation: "analyze",
        snapshots: ids
          .slice(0, 4)
          .map((eventId) => ({ sourceId: "screen", eventId })),
      }),
    ]);
    processOwnerInputs(run);
    // A later analyze aimed at the same task adds two more snapshots.
    await replay(run, [
      input("r-2", {
        operation: "analyze",
        target: { taskId: "task-i.r-1", revision: 1 },
        snapshots: ids
          .slice(4)
          .map((eventId) => ({ sourceId: "screen", eventId })),
      }),
    ]);
    processOwnerInputs(run);
    const task = run.tasks.tasks["task-i.r-1"];
    expect(task?.revision).toBe(2);
    const attached = attachmentsFor(run, task as never);
    expect(attached.map((a) => a.id)).toEqual(
      ids.slice(-4).map((id) => `snap/${SESSION}/screen/${id}`),
    );
    // An unreplayed snapshot has no declared type, so the port will refuse it.
    const bare = newRun();
    await replay(bare, [
      input("r-9", {
        operation: "analyze",
        snapshots: [{ sourceId: "screen", eventId: "ghost" }],
      }),
    ]);
    processOwnerInputs(bare);
    expect(
      attachmentsFor(bare, bare.tasks.tasks["task-i.r-9"] as never)[0]
        ?.mimeType,
    ).toBeUndefined();
  });

  it("ignores a snapshot row that has no stored image, and an unreadable input", async () => {
    const run = newRun();
    await replay(run, [
      observation("screen.snapshot", "screen", "bare", {
        payloadRef: "p",
        mediaType: "image/png",
        byteLength: 1,
        windowLabel: "w",
      }),
      input("r-1", { operation: "analyze", snapshots: [] }),
      input("r-2", { operation: "explode" }),
    ]);
    expect(run.snapshots.size).toBe(0);
    expect(run.pendingInputs).toHaveLength(0);
    expect(traces).toContain("observation.unreadable:invalid");
  });
});

describe("a follow-up input", () => {
  async function spokenTask() {
    const run = newRun();
    await replay(run, [
      spoken("q1", "Can you implement a rate limiter in TypeScript?"),
    ]);
    await processUtterances(run, policy, 10_000, 0);
    const taskId = Object.keys(run.tasks.tasks)[0] as string;
    return { run, taskId };
  }

  it("revises the targeted task, resting on the input, and carries the typed text after the spoken lines", async () => {
    const { run, taskId } = await spokenTask();
    await replay(run, [
      input("r-2", {
        operation: "follow-up",
        text: "and the cost?",
        target: { taskId, revision: 1 },
        snapshots: [],
      }),
    ]);
    expect(processOwnerInputs(run)).toBe(1);
    const task = run.tasks.tasks[taskId];
    expect(task?.revision).toBe(2);
    expect(task?.revisions[1]?.basedOn).toEqual(["input/r-2"]);
    expect(capturedFor(run, task as never)).toEqual([
      {
        speaker: "interviewer",
        text: "Can you implement a rate limiter in TypeScript?",
      },
      { speaker: "owner", text: "and the cost?" },
    ]);
  });

  it("applies one of two add-screenshot presses aimed at the same revision, never both", async () => {
    const { run, taskId } = await spokenTask();
    await replay(run, [
      shot("s1"),
      shot("s2"),
      input("r-a", {
        operation: "analyze",
        target: { taskId, revision: 1 },
        snapshots: [{ sourceId: "screen", eventId: "s1" }],
      }),
      input("r-b", {
        operation: "analyze",
        target: { taskId, revision: 1 },
        snapshots: [{ sourceId: "screen", eventId: "s2" }],
      }),
    ]);
    // Both are handled (the second is skipped); only one revision results.
    expect(processOwnerInputs(run)).toBe(2);
    const task = run.tasks.tasks[taskId];
    expect(task?.revision).toBe(2);
    expect(task?.revisions[1]?.basedOn).toContain("input/r-a");
    expect(traces).toContain("owner-input.stale-analyze:skipped");
  });

  it("opens a new task when it targets nothing the run knows", async () => {
    const run = newRun();
    await replay(run, [
      input("r-3", {
        operation: "follow-up",
        text: "what about caching?",
        target: { taskId: "task-gone", revision: 1 },
        snapshots: [],
      }),
    ]);
    expect(processOwnerInputs(run)).toBe(1);
    expect(run.tasks.tasks["task-i.r-3"]?.revision).toBe(1);
  });

  it("waits one pass for a spoken task still settling, then revises it", async () => {
    const run = newRun();
    await replay(run, [
      spoken("q1", "Can you implement a rate limiter in TypeScript?"),
      input("r-4", {
        operation: "follow-up",
        text: "and the cost?",
        target: { taskId: "task-q1", revision: 1 },
        snapshots: [],
      }),
    ]);
    // The spoken utterance has not been processed yet: the input waits.
    expect(processOwnerInputs(run)).toBe(0);
    expect(run.pendingInputs).toHaveLength(1);
    await processUtterances(run, policy, 10_000, 0);
    const taskId = Object.keys(run.tasks.tasks)[0] as string;
    run.pendingInputs = run.pendingInputs.map((p) => ({
      ...p,
      input: { ...p.input, target: { taskId, revision: 1 } },
    }));
    expect(processOwnerInputs(run)).toBe(1);
    expect(run.tasks.tasks[taskId]?.revision).toBe(2);
  });
});

describe("a regenerate input and added screenshots", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const refs = (list: string[]) =>
    list.map((eventId) => ({ sourceId: "screen", eventId }));
  async function screenshotTask() {
    const run = newRun();
    await replay(run, [
      ...ids.map(shot),
      spoken("q1", "Can you implement a rate limiter in TypeScript?"),
      input("r-1", { operation: "analyze", snapshots: refs(["a", "b"]) }),
    ]);
    processOwnerInputs(run);
    return { run, taskId: "task-i.r-1" };
  }

  it("is a new revision of the SAME task with reason regenerate, resting on the same sources", async () => {
    const { run, taskId } = await screenshotTask();
    await replay(run, [
      input("r-2", {
        operation: "regenerate",
        target: { taskId, revision: 1 },
        snapshots: [],
      }),
    ]);
    expect(processOwnerInputs(run)).toBe(1);
    const task = run.tasks.tasks[taskId] as never as {
      revision: number;
      revisions: { reason: string; basedOn: string[] }[];
    };
    expect(Object.keys(run.tasks.tasks)).toEqual([taskId]);
    expect(task.revision).toBe(2);
    expect(task.revisions[1]?.reason).toBe("regenerate");
    expect(task.revisions[1]?.basedOn).toEqual(["input/r-2"]);
    // Every screenshot the task rests on travels again, oldest first.
    expect(attachmentsFor(run, task as never).map((a) => a.id)).toEqual([
      `snap/${SESSION}/screen/a`,
      `snap/${SESSION}/screen/b`,
    ]);
  });

  it("is skipped, not applied, when the task has moved on or is unknown", async () => {
    const { run, taskId } = await screenshotTask();
    await replay(run, [
      input("r-2", {
        operation: "regenerate",
        target: { taskId, revision: 1 },
        snapshots: [],
      }),
      input("r-3", {
        operation: "regenerate",
        target: { taskId, revision: 1 },
        snapshots: [],
      }),
      input("r-4", {
        operation: "regenerate",
        target: { taskId: "task-nope", revision: 1 },
        snapshots: [],
      }),
    ]);
    // The unknown target waits one pass (an utterance may still be settling).
    processOwnerInputs(run);
    processOwnerInputs(run);
    expect(run.pendingInputs).toHaveLength(0);
    expect(run.tasks.tasks[taskId]?.revision).toBe(2);
    expect(Object.keys(run.tasks.tasks)).toEqual([taskId]);
    expect(run.processed.has("input/r-3")).toBe(true);
  });

  it("makes one revision with reason added-screenshot for several attached images, all of the task's images travelling (newest four)", async () => {
    const { run, taskId } = await screenshotTask();
    await replay(run, [
      input("r-2", {
        operation: "analyze",
        target: { taskId, revision: 1 },
        snapshots: refs(["c", "d", "e"]),
      }),
    ]);
    processOwnerInputs(run);
    const task = run.tasks.tasks[taskId] as never as {
      revision: number;
      revisions: { reason: string }[];
    };
    expect(task.revision).toBe(2);
    expect(task.revisions[1]?.reason).toBe("added-screenshot");
    expect(attachmentsFor(run, task as never).map((a) => a.id)).toEqual(
      ["b", "c", "d", "e"].map((id) => `snap/${SESSION}/screen/${id}`),
    );
  });
});

describe("replay order", () => {
  const question = spoken(
    "q1",
    "Can you implement a rate limiter in TypeScript?",
  );
  const followUp = input("r-2", {
    operation: "follow-up",
    text: "and the cost?",
    target: { taskId: "task-q-q1", revision: 1 },
    snapshots: [],
  });
  const revision = spoken(
    "q2",
    "Now handle bursts, so allow a small burst above the limit for a client.",
    90_000,
  );
  const basedOn = (run: SessionRun) =>
    run.tasks.tasks["task-q-q1"]?.revisions.map((entry) => entry.basedOn);

  it("numbers revisions as the live run did when a restart replays an input between two utterances", async () => {
    // Live: each observation arrived and was processed before the next.
    const live = newRun();
    for (const row of [question, followUp, revision]) {
      await replay(live, [row]);
      await processInOrder(live, policy, 10_000, 0);
    }
    expect(basedOn(live)).toEqual([["q1"], ["input/r-2"], ["q2"]]);

    // Restart: the whole stored stream is replayed in one go.
    const restarted = newRun();
    await replay(restarted, [question, followUp, revision]);
    await processInOrder(restarted, policy, 10_000, 0);
    expect(basedOn(restarted)).toEqual(basedOn(live));
    expect(restarted.pendingInputs).toEqual([]);
  });

  it("holds an input behind an earlier utterance that is still settling", async () => {
    const run = newRun();
    await replay(run, [question, followUp]);
    const settling = await processInOrder(run, policy, 1_000, 5_000);
    expect(settling).toEqual({ utterances: 0, inputs: 0 });
    expect(run.pendingInputs).toHaveLength(1);
    await processInOrder(run, policy, 10_000, 5_000);
    expect(basedOn(run)).toEqual([["q1"], ["input/r-2"]]);
  });
});

describe("restart", () => {
  it("restores tasks from the remembered provenance and never applies an input twice", async () => {
    const rows = [
      shot("s1"),
      input("r-1", {
        operation: "analyze",
        snapshots: [{ sourceId: "screen", eventId: "s1" }],
      }),
    ];
    const live = newRun();
    await replay(live, rows);
    processOwnerInputs(live);
    const remembered: StoredAction[] = [
      {
        id: "a1",
        taskId: "task-i.r-1",
        taskRevision: 1,
        actionKind: "draft-answer",
        dispatchStatus: "succeeded",
        attempt: 1,
        fenceAtDispatch: 1,
        jobId: null,
        jobCreated: false,
        sourceEventIds: ["input/r-1", `snap/${SESSION}/screen/s1`],
        result: null,
        shown: true,
        suppressionReason: null,
        createdAt: "x",
        updatedAt: "x",
      },
    ];

    const rebuilt = newRun();
    await seedFromActions(rebuilt, storeOf(rows), remembered);
    await replay(rebuilt, rows);
    // The input is part of a remembered revision: nothing is queued again.
    expect(rebuilt.pendingInputs).toHaveLength(0);
    expect(processOwnerInputs(rebuilt)).toBe(0);
    expect(rebuilt.tasks.tasks["task-i.r-1"]?.revision).toBe(1);
    expect(rebuilt.tasks.tasks["task-i.r-1"]?.revisions[0]?.basedOn).toEqual([
      "input/r-1",
      `snap/${SESSION}/screen/s1`,
    ]);
    // Its snapshot is known again, so the attachment is rebuilt from the row.
    expect(
      attachmentsFor(rebuilt, rebuilt.tasks.tasks["task-i.r-1"] as never),
    ).toHaveLength(1);
  });

  it.each(["policy_changed", "setting_changed", "session_paused"])(
    "leaves a %s suppression unsettled so the rebuilt run dispatches it again",
    async (reason) => {
      const row = (suppressionReason: string): StoredAction => ({
        id: "a1",
        taskId: "task-i.r-1",
        taskRevision: 1,
        actionKind: "draft-answer",
        dispatchStatus: "suppressed",
        attempt: 1,
        fenceAtDispatch: 1,
        jobId: null,
        jobCreated: false,
        sourceEventIds: ["input/r-1"],
        result: null,
        shown: false,
        suppressionReason,
        createdAt: "x",
        updatedAt: "x",
      });
      const rebuilt = newRun();
      await seedFromActions(rebuilt, storeOf([]), [row(reason)]);
      expect(rebuilt.settled.size).toBe(0);
      // A final suppression still settles.
      const final = newRun();
      await seedFromActions(final, storeOf([]), [row("assistance_disabled")]);
      expect(final.settled.size).toBe(1);
    },
  );

  it("applies an input that was never recorded, exactly as the live run did", async () => {
    const rows = [
      input("r-5", {
        operation: "follow-up",
        text: "and the cost?",
        snapshots: [],
      }),
    ];
    const first = newRun();
    await replay(first, rows);
    processOwnerInputs(first);
    const second = newRun();
    await seedFromActions(second, storeOf(rows), []);
    await replay(second, rows);
    processOwnerInputs(second);
    expect(Object.keys(second.tasks.tasks)).toEqual(
      Object.keys(first.tasks.tasks),
    );
  });
});

describe("heard speech from the owner microphone (ADR-0022)", () => {
  // As the owner input route stores it: no `source` label, because the browser
  // microphone hears the room, the other side of the call included.
  const heard = (eventId: string, text: string) =>
    observation("transcript.final", "studio.owner-microphone", eventId, {
      speaker: "microphone",
      text,
      startMs: 1_000,
      endMs: 1_000,
    });

  it("opens a task for a question heard through the microphone, like a companion transcript", async () => {
    const run = newRun();
    await replay(run, [
      heard("h-1", "Can you implement a rate limiter in TypeScript?"),
    ]);
    await processUtterances(run, policy, 10_000, 0);
    expect(Object.keys(run.tasks.tasks)).toHaveLength(1);
  });

  it("is ignored when the very same words carry the candidate's microphone label and an interviewer is on the call", async () => {
    const run = newRun();
    await replay(run, [
      observation("transcript.final", "app", "a-1", {
        speaker: "interviewer",
        source: "application-audio",
        text: "Thanks for joining today.",
        startMs: 0,
        endMs: 500,
      }),
      observation("transcript.final", "mic", "m-1", {
        speaker: "microphone",
        source: "microphone",
        text: "Can you implement a rate limiter in TypeScript?",
        startMs: 1_000,
        endMs: 1_000,
      }),
    ]);
    await processUtterances(run, policy, 10_000, 0);
    expect(Object.keys(run.tasks.tasks)).toHaveLength(0);
  });

  it("is answered when the microphone is the only voice heard (nobody else on the call)", async () => {
    const run = newRun();
    await replay(run, [
      observation("transcript.final", "mic", "m-1", {
        speaker: "microphone",
        source: "microphone",
        text: "Can you implement a rate limiter in TypeScript?",
        startMs: 1_000,
        endMs: 1_000,
      }),
    ]);
    await processUtterances(run, policy, 10_000, 0);
    expect(Object.keys(run.tasks.tasks)).toHaveLength(1);
  });
});
