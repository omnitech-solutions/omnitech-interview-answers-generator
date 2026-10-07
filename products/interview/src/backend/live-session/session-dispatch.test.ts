// The draft-answer dispatch streams: the draft's text so far is read out of
// the JSON the model is still writing (partialDraft) and recorded on the
// action (recordProgress) while the call runs; every other stage waits for
// execute(). In-memory world, no database.
import type {
  AiEvent,
  AiExecutionGateway,
  AiExecutionRequest,
} from "@omnitech/ai-contracts";
import { describe, expect, it } from "vitest";
import { ASSIST_ACTION_KIND } from "./assist-stage";
import type { Task } from "./core/index";
import type { InterviewSessionPolicy } from "./interview-policy";
import { createMemorySessionWorld } from "./memory-session-world";
import { beginDispatch, partialDraft } from "./session-dispatch";
import { createRun } from "./session-run";

describe("partialDraft", () => {
  it("reads the draft field out of a JSON object still being written", () => {
    expect(partialDraft('{"category":"other","draft":"- First po')).toBe(
      "- First po",
    );
    expect(
      partialDraft('{"category":"other","draft":"- One\\n- Two","claims":['),
    ).toBe("- One\n- Two");
  });

  it("is empty before the draft field or its opening quote has arrived", () => {
    expect(partialDraft("")).toBe("");
    expect(partialDraft('{"category":"other","dra')).toBe("");
    expect(partialDraft('{"category":"other","draft":')).toBe("");
    expect(partialDraft('{"category":"other","draft": ')).toBe("");
  });

  it("undoes escapes: newline, tab, quote, backslash and \\u sequences", () => {
    expect(partialDraft('{"draft":"a\\nb\\tc \\"q\\" x\\\\y \\u00e9"')).toBe(
      'a\nb\tc "q" x\\y é',
    );
  });

  it("drops an escape cut mid-sequence instead of guessing it", () => {
    expect(partialDraft('{"draft":"- Led \\')).toBe("- Led ");
    expect(partialDraft('{"draft":"- Led \\u00')).toBe("- Led ");
    expect(partialDraft('{"draft":"- Led \\n')).toBe("- Led \n");
  });

  it("stops at the closing quote whatever follows", () => {
    expect(
      partialDraft('{"draft":"done","claims":[{"text":"not this"}]}'),
    ).toBe("done");
  });
});

// A gateway whose stream hands out events on demand, so a test can look at
// the action between deltas; execute() is a separate, counted path.
function scriptedGateway() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const executed: AiExecutionRequest[] = [];
  const streamed: AiExecutionRequest[] = [];
  let script: AiEvent[] = [];
  const gateway: AiExecutionGateway = {
    async *stream<T>(request: AiExecutionRequest) {
      streamed.push(request);
      for (const [index, event] of script.entries()) {
        if (index === 1) await gate;
        yield event as AiEvent<T>;
      }
    },
    async execute<T>(request: AiExecutionRequest) {
      executed.push(request);
      return {
        executionId: "exec-1",
        family: "direct-model" as const,
        targetId: "fake",
        result: { category: "other" } as T,
      };
    },
    streamStructured() {
      throw new Error("unused");
    },
    resume() {
      throw new Error("unused");
    },
    cancel: async () => undefined,
    listAvailableTargets: async () => [],
  };
  return {
    gateway,
    executed,
    streamed,
    release: () => release(),
    play(events: AiEvent[]) {
      script = events;
    },
  };
}

const RESULT = {
  category: "other",
  draft: "- First point\n- Second point",
  claims: [],
  star: null,
  logistics: null,
  codingBrief: null,
};
const JSON_TEXT = JSON.stringify(RESULT);
const CUT = JSON_TEXT.indexOf("Second");

async function worldWithTask(
  gateway: AiExecutionGateway,
  actionKind = ASSIST_ACTION_KIND,
) {
  const world = createMemorySessionWorld();
  const [claim] = await world
    .claimFor("w1")
    .claim(1, { includeOwnLive: false });
  if (!claim) throw new Error("no claim");
  const run = createRun(claim, "w1", () => undefined);
  const task: Task = {
    taskId: "task-1",
    taskKey: "seg-1",
    revision: 1,
    revisions: [
      {
        revision: 1,
        basedOn: ["seg-1"],
        reason: "opened",
        sourceSuperseded: false,
      },
    ],
  };
  run.tasks = {
    tasks: { [task.taskId]: task },
    byKey: { "seg-1": "task-1" },
    deferred: {},
  };
  const dispatch = await beginDispatch(
    run,
    task,
    {
      store: world.store,
      gateway,
      policy: undefined as unknown as InterviewSessionPolicy,
      clock: { nowMs: () => Date.now() },
    },
    { actionKind, profileId: "fast", deviceProfileId: "device" },
  );
  if (!dispatch) throw new Error("dispatch did not begin");
  return { world, run, dispatch };
}
const PROMPT = { system: "s", prompt: "p", schema: {}, byteCount: 2 };
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("the draft-answer dispatch streams", () => {
  it("records the draft so far on the in-flight action and resolves with the completed result", async () => {
    const g = scriptedGateway();
    g.play([
      { type: "text-delta", text: JSON_TEXT.slice(0, CUT) },
      { type: "text-delta", text: JSON_TEXT.slice(CUT) },
      { type: "completed", result: RESULT },
    ]);
    const { world, dispatch } = await worldWithTask(g.gateway);
    const call = dispatch.call(PROMPT);
    await settled();
    // After the first delta: the first point and the start of the second.
    const action = world.actions[0];
    expect(action?.dispatchStatus).toBe("in_flight");
    expect(action?.progress).toEqual({ draft: "- First point\n- " });
    g.release();
    const called = await call;
    expect(called).toEqual({ ok: true, result: RESULT });
    expect(g.streamed).toHaveLength(1);
    expect(g.executed).toHaveLength(0);
    expect(g.streamed[0]?.task).toMatchObject({
      type: "structured-generation",
      system: "s",
      prompt: "p",
    });
  });

  it("turns a failed stream event into a retryable failure", async () => {
    const g = scriptedGateway();
    g.play([
      { type: "text-delta", text: '{"category":"other","draft":"- x' },
      {
        type: "failed",
        error: { code: "provider", message: "x", retryable: true },
      },
    ]);
    g.release();
    const { world, run, dispatch } = await worldWithTask(g.gateway);
    expect(await dispatch.call(PROMPT)).toEqual({ ok: false });
    expect(world.actions[0]?.dispatchStatus).toBe("failed");
    expect([...run.failures.values()]).toEqual([1]);
  });

  it("uses execute(), never the stream, for any other stage", async () => {
    const g = scriptedGateway();
    g.play([]);
    const { world, dispatch } = await worldWithTask(g.gateway, "solve-code");
    const called = await dispatch.call(PROMPT);
    expect(called).toEqual({ ok: true, result: { category: "other" } });
    expect(g.executed).toHaveLength(1);
    expect(g.streamed).toHaveLength(0);
    expect(world.actions[0]).not.toHaveProperty("progress");
  });
});
