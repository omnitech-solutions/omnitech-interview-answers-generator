// The two action slots (ADR-0016) through the REAL processor on a disposable
// database with a held fake gateway: a spoken question is answered while a
// coding action is still executing, a correction cancels the in-flight coding
// and its old output can never publish, a failure in one slot settles only its
// own action, and quiesce/close abort both slots.
import type { AiExecutionRequest } from "@omnitech/ai-contracts";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import {
  INTERVIEW_ANSWER_PROFILE,
  INTERVIEW_SESSION_FAST_PROFILE,
} from "../../assistant-profile.js";
import {
  BURSTS,
  codingDraft,
  fakeRunner,
  isSolutionRequest,
  NARRATE_1,
  QUESTION,
  revisionOf,
  solutionFor,
} from "./coding-fixture.js";
import { type Fixture, startFixture } from "./live-session-fixture.js";
import {
  buildProcessor,
  createFakeGateway,
  type FakeGateway,
  NEVER_ABORTED,
  settle,
  startSessionFor,
} from "./processor-fixture.js";
import { capturedText } from "./replay-evidence-fixture.js";
import { ActiveSessionRepository } from "./repository.js";
import { seg } from "./session-replay-fixtures.js";

let fx: Fixture;
let repo: ActiveSessionRepository;
const cleanups: Array<() => Promise<void>> = [];
beforeAll(async () => {
  fx = await startFixture();
  repo = new ActiveSessionRepository(fx.member);
}, 120_000);
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
afterAll(() => fx.stop());

const SPOKEN = seg(
  "q9",
  "interviewer",
  60_000,
  "How would you design a rate limiter?",
);

// A scripted gateway whose calls on chosen profiles are held until released
// (and, when asked, end with a rejection once the request's signal aborts).
function heldGateway(options: { honorAbort?: boolean } = {}) {
  // The spoken general question gets the default canned draft; the coding
  // question keeps the scripted coding draft and solution.
  const inner = createFakeGateway({
    result: (request) =>
      isSolutionRequest(request)
        ? solutionFor(request)
        : capturedText(request).includes("design a rate limiter")
          ? undefined
          : codingDraft(request),
  });
  const held = new Set<string>();
  const gates = new Map<string, { promise: Promise<void>; open(): void }>();
  const reached: AiExecutionRequest[] = [];
  const gateway: FakeGateway = {
    ...inner,
    execute: async (request) => {
      const profileId = request.profileId ?? "";
      const gate = held.has(profileId) ? gates.get(profileId) : undefined;
      if (gate) {
        reached.push(request);
        await new Promise<void>((resolve, reject) => {
          void gate.promise.then(resolve);
          if (options.honorAbort)
            request.signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
        });
      }
      return inner.execute(request);
    },
  };
  return {
    gateway,
    reached,
    hold(profileId: string) {
      let open: () => void = () => {};
      const promise = new Promise<void>((resolve) => {
        open = resolve;
      });
      held.add(profileId);
      gates.set(profileId, { promise, open });
    },
    release(profileId: string) {
      held.delete(profileId);
      gates.get(profileId)?.open();
    },
    releaseAll() {
      for (const profileId of [...held]) this.release(profileId);
    },
  };
}

async function world(
  name: string,
  held: ReturnType<typeof heldGateway>,
  wrapStore?: Parameters<typeof buildProcessor>[1]["wrapStore"],
) {
  const started = await startSessionFor(fx, repo, fx.tenantA, name);
  const { runner } = fakeRunner();
  const processor = buildProcessor(fx, {
    workerId: `worker-${name}`,
    gateway: held.gateway,
    codeRunner: runner,
    ...(wrapStore ? { wrapStore } : {}),
  });
  cleanups.push(async () => {
    held.releaseAll();
    await processor.close();
    await repo.controlSession(started.scope, started.sessionId, "end");
  });
  const actions = () => repo.listActions(started.scope, started.sessionId);
  return { ...started, processor, actions };
}
type World = Awaited<ReturnType<typeof world>>;

async function until(condition: () => boolean | Promise<boolean>, w: World) {
  for (let i = 0; i < 80; i += 1) {
    if (await condition()) return;
    await w.processor.tick(NEVER_ABORTED);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition not reached");
}

// Revision 1 is published and its solution call is held at the gateway.
async function withCodingInFlight(
  w: World,
  held: ReturnType<typeof heldGateway>,
) {
  held.hold(INTERVIEW_ANSWER_PROFILE);
  await w.ingestor.ingest(QUESTION);
  await until(() => held.reached.length === 1, w);
}

it("answers a spoken question while a coding action is still executing", async () => {
  const held = heldGateway();
  const w = await world("slots-parallel", held);
  await withCodingInFlight(w, held);
  await w.ingestor.ingest(NARRATE_1);
  await w.ingestor.ingest(SPOKEN);
  await until(async () => {
    const drafts = (await w.actions()).filter(
      (a) =>
        a.actionKind === "draft-answer" && a.dispatchStatus === "succeeded",
    );
    return drafts.length === 2;
  }, w);
  // The coding action never finished: it is still executing, not waited on.
  const solve = (await w.actions()).find((a) => a.actionKind === "solve-code");
  expect(solve?.dispatchStatus).not.toBe("succeeded");
  held.release(INTERVIEW_ANSWER_PROFILE);
  await settle(w.processor, 20);
  const done = (await w.actions()).find((a) => a.actionKind === "solve-code");
  expect(done?.dispatchStatus).toBe("succeeded");
}, 60_000);

it("a correction cancels the in-flight coding and the old output cannot publish", async () => {
  const held = heldGateway();
  const w = await world("slots-correction", held);
  await withCodingInFlight(w, held);
  const stale = held.reached[0] as AiExecutionRequest;
  expect(revisionOf(stale)).toBe(1);
  await w.ingestor.ingest(NARRATE_1);
  await w.ingestor.ingest(BURSTS);
  // The revision-2 answer is published while revision 1's solution is held,
  // and the slot's request was aborted when the task moved past revision 1.
  await until(async () => {
    const drafts = (await w.actions()).filter(
      (a) =>
        a.actionKind === "draft-answer" &&
        a.taskRevision === 2 &&
        a.dispatchStatus === "succeeded",
    );
    return drafts.length === 1 && stale.signal?.aborted === true;
  }, w);
  held.release(INTERVIEW_ANSWER_PROFILE);
  await settle(w.processor, 20);
  const solves = (await w.actions()).filter(
    (a) => a.actionKind === "solve-code",
  );
  const first = solves.find((a) => a.taskRevision === 1);
  expect(first?.dispatchStatus).not.toBe("succeeded");
  const second = solves.find((a) => a.taskRevision === 2);
  expect(second?.dispatchStatus).toBe("succeeded");
  const rows = await fx.owner.query(
    "SELECT value FROM interview.assistant_drafts WHERE actor_id=$1 AND workspace_id=$2",
    [w.person.id, `active-session:${w.sessionId}`],
  );
  const code = rows.rows[0]?.value.answer.code as string;
  expect(code).toContain("CODE-CANARY-2");
  expect(code).not.toContain("CODE-CANARY-1");
}, 60_000);

it("a failure in one slot settles only its own slot's action", async () => {
  const held = heldGateway();
  let assistActionId: string | null = null;
  let armed = false;
  const failed: string[] = [];
  const w = await world("slots-failure", held, (store) => ({
    ...store,
    recordAction: async (input) => {
      const recorded = await store.recordAction(input);
      if (
        input.actionKind === "draft-answer" &&
        recorded.outcome === "dispatched" &&
        held.reached.length === 1
      ) {
        assistActionId = recorded.actionId;
        armed = true;
      }
      return recorded;
    },
    readDispatchStanding: (input) => {
      if (armed) {
        armed = false;
        throw new Error("store unavailable");
      }
      return store.readDispatchStanding(input);
    },
    recordFailure: (input) => {
      failed.push(input.actionId);
      return store.recordFailure(input);
    },
  }));
  await withCodingInFlight(w, held);
  await w.ingestor.ingest(NARRATE_1);
  await w.ingestor.ingest(SPOKEN);
  await until(() => failed.length > 0, w);
  const solveRow = (await w.actions()).find(
    (a) => a.actionKind === "solve-code",
  );
  expect(solveRow?.dispatchStatus).not.toBe("failed");
  expect(assistActionId).not.toBeNull();
  expect(failed).toEqual([assistActionId]);
  held.release(INTERVIEW_ANSWER_PROFILE);
  await settle(w.processor, 20);
  const done = (await w.actions()).find((a) => a.actionKind === "solve-code");
  expect(done?.dispatchStatus).toBe("succeeded");
  expect(failed).not.toContain(done?.id);
}, 60_000);

it("close aborts both slots", async () => {
  const held = heldGateway({ honorAbort: true });
  const w = await world("slots-close", held);
  await withCodingInFlight(w, held);
  held.hold(INTERVIEW_SESSION_FAST_PROFILE);
  await w.ingestor.ingest(NARRATE_1);
  await w.ingestor.ingest(SPOKEN);
  await until(() => held.reached.length === 2, w);
  expect(held.reached.map((r) => r.profileId).sort()).toEqual(
    [INTERVIEW_ANSWER_PROFILE, INTERVIEW_SESSION_FAST_PROFILE].sort(),
  );
  expect(held.reached.every((r) => r.signal?.aborted === false)).toBe(true);
  await w.processor.close();
  expect(held.reached.every((r) => r.signal?.aborted === true)).toBe(true);
}, 60_000);

it("a pause quiesces both slots", async () => {
  const held = heldGateway({ honorAbort: true });
  const w = await world("slots-pause", held);
  await withCodingInFlight(w, held);
  held.hold(INTERVIEW_SESSION_FAST_PROFILE);
  await w.ingestor.ingest(NARRATE_1);
  await w.ingestor.ingest(SPOKEN);
  await until(() => held.reached.length === 2, w);
  await repo.controlSession(w.scope, w.sessionId, "pause");
  await until(() => held.reached.every((r) => r.signal?.aborted === true), w);
  await w.processor.idle();
}, 60_000);
