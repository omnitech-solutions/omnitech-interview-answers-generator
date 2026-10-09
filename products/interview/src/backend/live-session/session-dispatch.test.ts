// The draft-answer dispatch streams: the draft's text so far is read out of
// the JSON the model is still writing (partialDraft) and recorded on the
// action (recordProgress) while the call runs; every other stage reads the
// same stream and waits for the whole result. In-memory world, no database.
import type { Failure, StreamPart } from "@omnitech/ai-engine";
import { describe, expect, it } from "vitest";
import { ASSIST_ACTION_KIND } from "./assist-stage";
import type { Task } from "./core/index";
import type { SessionAttachment, SessionEngine } from "./engine-call";
import type { InterviewSessionPolicy } from "./interview-policy";
import { createMemorySessionWorld } from "./memory-session-world";
import {
  askOf,
  createFakeEngine,
  failed,
  type SessionAsk,
} from "./processor-fixture";
import { beginDispatch, partialDraft } from "./session-dispatch";
import { createRun, type RunTracer } from "./session-run";

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

// An engine whose stream hands out parts on demand, so a test can look at
// the action between text parts. Every stage reads this one stream.
function scriptedEngine() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const streamed: SessionAsk[] = [];
  let script: StreamPart[] = [];
  const engine: SessionEngine = {
    async *stream(input, execution) {
      streamed.push(askOf(input, execution));
      for (const [index, part] of script.entries()) {
        if (index === 1) await gate;
        yield part;
      }
    },
  };
  return {
    engine,
    streamed,
    release: () => release(),
    play(parts: StreamPart[]) {
      script = parts;
    },
  };
}
const NO_USAGE = {
  status: "unavailable",
  reason: "not-reported",
  cost: { status: "unavailable", reason: "not-reported" },
} as const;
const done = (value: unknown): StreamPart => ({
  type: "done",
  value: value as never,
  usage: NO_USAGE,
});

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
  engine: SessionEngine,
  actionKind = ASSIST_ACTION_KIND,
  extra: {
    world?: ReturnType<typeof createMemorySessionWorld>;
    trace?: RunTracer;
    attachments?: readonly SessionAttachment[];
    visionProfileId?: string;
  } = {},
) {
  const world = extra.world ?? createMemorySessionWorld();
  const [claim] = await world
    .claimFor("w1")
    .claim(1, { includeOwnLive: false });
  if (!claim) throw new Error("no claim");
  const run = createRun(claim, "w1", extra.trace ?? (() => undefined));
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
      engine,
      policy: undefined as unknown as InterviewSessionPolicy,
      clock: { nowMs: () => Date.now() },
      ...(extra.visionProfileId
        ? { visionProfileId: extra.visionProfileId }
        : {}),
    },
    { actionKind, profileId: "fast", deviceProfileId: "device" },
    extra.attachments ? { attachments: extra.attachments } : {},
  );
  if (!dispatch) throw new Error("dispatch did not begin");
  return { world, run, dispatch };
}
const PROMPT = { system: "s", prompt: "p", schema: {}, byteCount: 2 };
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("the draft-answer dispatch streams", () => {
  it("records the draft so far on the in-flight action and resolves with the completed result", async () => {
    const g = scriptedEngine();
    g.play([
      { type: "text", text: JSON_TEXT.slice(0, CUT) },
      { type: "text", text: JSON_TEXT.slice(CUT) },
      done(RESULT),
    ]);
    const { world, dispatch } = await worldWithTask(g.engine);
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
    // A structured call: the system text, the prompt and the schema travel.
    expect(g.streamed[0]).toMatchObject({
      system: "s",
      prompt: "p",
      schema: {},
    });
  });

  it("turns a failed stream part into a retryable failure", async () => {
    const g = scriptedEngine();
    g.play([
      { type: "text", text: '{"category":"other","draft":"- x' },
      { type: "failed", failure: failed("unavailable") },
    ]);
    g.release();
    const { world, run, dispatch } = await worldWithTask(g.engine);
    expect(await dispatch.call(PROMPT)).toEqual({ ok: false });
    expect(world.actions[0]?.dispatchStatus).toBe("failed");
    expect([...run.failures.values()]).toEqual([1]);
  });

  // Before ADR-0037 any other stage used the gateway's execute(), never its
  // stream. The engine has one way to call, so every stage reads the stream;
  // what remains of the rule is that only the draft answer records progress.
  it("waits for the whole result, recording no draft so far, for any other stage", async () => {
    const g = scriptedEngine();
    g.play([{ type: "text", text: JSON_TEXT }, done({ category: "other" })]);
    g.release();
    const { world, dispatch } = await worldWithTask(g.engine, "solve-code");
    const called = await dispatch.call(PROMPT);
    expect(called).toEqual({ ok: true, result: { category: "other" } });
    expect(g.streamed).toHaveLength(1);
    expect(world.actions[0]).not.toHaveProperty("progress");
  });
});

// One call that the engine ends with the given failure, and everything the
// dispatch then settled and traced. `during` runs while the call is with the
// engine (after the dispatch's own standing re-read, before the failure).
type Traced = Parameters<RunTracer>[0];
const IMAGE: SessionAttachment = {
  id: "shot-1",
  kind: "image",
  name: "screen",
  reference: "session-screenshot:shot-1",
  mimeType: "image/png",
};
async function failedCall(
  failure: Failure,
  options: {
    images?: boolean;
    during?: (world: ReturnType<typeof createMemorySessionWorld>) => void;
  } = {},
) {
  const world = createMemorySessionWorld();
  const events: Traced[] = [];
  const engine = createFakeEngine({
    fail: () => {
      options.during?.(world);
      return failure;
    },
  });
  const { run, dispatch } = await worldWithTask(engine, ASSIST_ACTION_KIND, {
    world,
    trace: (event) => events.push(event),
    ...(options.images
      ? { attachments: [IMAGE], visionProfileId: "vision" }
      : {}),
  });
  const called = await dispatch.call({
    ...PROMPT,
    ...(options.images ? { attachments: dispatch.screenshots.images } : {}),
  });
  return {
    called,
    engine,
    events,
    last: events.at(-1),
    action: world.actions[0],
    actions: world.actions,
    settledForGood: run.settled.has(dispatch.key),
    failures: [...run.failures.values()],
  };
}
// No result was published, whatever else the dispatch did.
const nothingPublished = (outcome: Awaited<ReturnType<typeof failedCall>>) => {
  expect(outcome.called).toEqual({ ok: false });
  expect(outcome.engine.requests).toHaveLength(1);
  expect(outcome.actions).toHaveLength(1);
  expect(outcome.action?.result).toBeNull();
  expect(outcome.action?.shown).toBe(false);
  expect(outcome.events.map((event) => event.event)).not.toContain(
    "dispatch.published",
  );
};

describe("a failed call is classified by its typed fields", () => {
  it.each(["session-not-active", "session-not-active:whatever"])(
    "suppresses %s as session_not_active and leaves the key to be tried again",
    async (detail) => {
      const outcome = await failedCall(failed("unavailable", { detail }));
      nothingPublished(outcome);
      expect(outcome.action?.dispatchStatus).toBe("suppressed");
      expect(outcome.action?.suppressionReason).toBe("session_not_active");
      expect(outcome.last).toMatchObject({
        event: "dispatch.suppressed",
        outcome: "session_not_active",
      });
      // Not settled for good and not counted as a failure: it is answered once
      // the session is active.
      expect(outcome.settledForGood).toBe(false);
      expect(outcome.failures).toEqual([]);
    },
  );

  it("settles a runtime's refusal of a call that carried images as vision_refused", async () => {
    const outcome = await failedCall(failed("refused"), { images: true });
    nothingPublished(outcome);
    expect(outcome.engine.requests[0]?.attachments).toHaveLength(1);
    expect(outcome.engine.requests[0]?.profileId).toBe("vision");
    expect(outcome.action?.dispatchStatus).toBe("suppressed");
    expect(outcome.action?.suppressionReason).toBe("vision_refused");
    expect(outcome.last).toMatchObject({
      event: "dispatch.refused",
      outcome: "vision-refused",
    });
    expect(outcome.settledForGood).toBe(true);
    expect(outcome.failures).toEqual([]);
  });

  it("settles the same refusal of a call without images as policy_refused", async () => {
    const outcome = await failedCall(failed("refused"));
    nothingPublished(outcome);
    expect(outcome.engine.requests[0]?.attachments).toEqual([]);
    expect(outcome.action?.dispatchStatus).toBe("suppressed");
    expect(outcome.action?.suppressionReason).toBe("policy_refused");
    expect(outcome.last).toMatchObject({
      event: "dispatch.refused",
      outcome: "policy-refused",
    });
    expect(outcome.settledForGood).toBe(true);
    expect(outcome.failures).toEqual([]);
  });

  it("treats a caller the engine does not authorise as a retryable failure, never a policy refusal", async () => {
    const outcome = await failedCall(
      failed("refused", { refusal: "authorization" }),
    );
    nothingPublished(outcome);
    expect(outcome.action?.dispatchStatus).toBe("failed");
    expect(outcome.action?.suppressionReason).toBeNull();
    expect(outcome.last).toMatchObject({
      event: "dispatch.failed",
      outcome: "unavailable",
    });
    expect(outcome.events.map((event) => event.event)).not.toContain(
      "dispatch.refused",
    );
    expect(outcome.settledForGood).toBe(false);
    expect(outcome.failures).toEqual([1]);
  });

  it("suppresses a refusal as policy_changed when the session's policy changed under the call", async () => {
    // The dispatch began and made its call as permitted-remote; the session
    // tightened while the call was with the engine, so the refusal is the
    // old policy's and the task is tried again under the new one.
    const outcome = await failedCall(failed("refused", { refusal: "policy" }), {
      during: (world) => world.tighten(),
    });
    nothingPublished(outcome);
    expect(outcome.engine.requests[0]?.policy).toBe("permitted-remote");
    expect(outcome.action?.dispatchStatus).toBe("suppressed");
    expect(outcome.action?.suppressionReason).toBe("policy_changed");
    expect(outcome.last).toMatchObject({
      event: "dispatch.suppressed",
      outcome: "policy_changed",
      localityDecision: "device-only",
    });
    expect(outcome.settledForGood).toBe(false);
    expect(outcome.failures).toEqual([]);
  });
});

describe("the traced cause of a failed call", () => {
  it.each(["read-failed", "provider:error_max_turns"])(
    "is the failure's typed detail: %s",
    async (detail) => {
      const outcome = await failedCall(failed("unavailable", { detail }));
      nothingPublished(outcome);
      expect(outcome.action?.dispatchStatus).toBe("failed");
      expect(outcome.last).toMatchObject({
        event: "dispatch.failed",
        outcome: "unavailable",
        detail: { attempt: 1, cause: detail },
      });
      expect(outcome.settledForGood).toBe(false);
      expect(outcome.failures).toEqual([1]);
    },
  );

  it.each([
    ["free text", "HTTP 503 from upstream: secret"],
    ["absent", undefined],
  ])(
    "is untyped when the detail is %s, and no free text reaches the trace",
    async (_name, detail) => {
      const outcome = await failedCall(
        failed("unavailable", {
          reason: "upstream said: confidential",
          ...(detail === undefined ? {} : { detail }),
        }),
      );
      nothingPublished(outcome);
      expect(outcome.action?.dispatchStatus).toBe("failed");
      expect(outcome.last).toMatchObject({
        event: "dispatch.failed",
        outcome: "unavailable",
        detail: { attempt: 1, cause: "untyped" },
      });
      const traced = JSON.stringify(outcome.events);
      for (const text of ["HTTP", "503", "upstream", "secret", "confidential"])
        expect(traced).not.toContain(text);
      expect(outcome.settledForGood).toBe(false);
      expect(outcome.failures).toEqual([1]);
    },
  );
});
