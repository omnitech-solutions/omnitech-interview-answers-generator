// The missing-context journey at the store: one request per send, blank text
// refused without a request, and two clients of the same session (the native
// window and the web page are separate documents with a store each) agreeing
// on the strip and on what clears it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureSessionStores,
  getSessionStore,
  resetSessionStores,
} from "./session-registry";
import type { SessionStore } from "./session-snapshot";
import { deriveTasks } from "./session-tasks";
import { taskCardModel } from "./shared/task-card-model";
import { targetOf } from "./shared/task-target";
import {
  CUT_OFF,
  CUT_OFF_TASK,
  type Journey,
  startJourney,
} from "./testing/missing-context-kit";
import { minutesAfter } from "./testing/session-fixtures";

let journey: Journey;
const flush = () => vi.advanceTimersByTimeAsync(0);

// Each client is a store under its own tenant slug; the fake server answers for
// both (it routes the one session).
function client(tenant: string): SessionStore {
  const store = getSessionStore(tenant);
  store.subscribe(() => undefined);
  return store;
}
const cardOf = (store: SessionStore) => {
  const held = store.getSnapshot();
  return taskCardModel({
    tasks: deriveTasks(held.actions, held.session?.status ?? "active"),
    actions: held.actions,
    observations: held.observations,
    selectedTaskId: null,
    deviceOnly: false,
  });
};
const targetNow = (store: SessionStore) => {
  const held = store.getSnapshot();
  const tasks = deriveTasks(held.actions, held.session?.status ?? "active");
  return targetOf(tasks[tasks.length - 1]);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(3)));
  resetSessionStores();
  journey = startJourney();
  configureSessionStores({
    fetch: (url, init) =>
      journey.server.fetch(url.replace(/\/t\/[^/]+\//, "/t/local/"), init),
    isVisible: () => true,
    storage: { read: () => null, write: () => {}, remove: () => {} },
  });
});
afterEach(() => {
  resetSessionStores();
  vi.useRealTimers();
});

describe("sending context", () => {
  it("makes one request for a double send of the same press", async () => {
    const store = client("local");
    await flush();
    const target = targetNow(store);
    const [first, second] = await Promise.all([
      store.actions.submitFollowUp("the examples", target),
      store.actions.submitFollowUp("the examples", target),
    ]);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(journey.inputs).toHaveLength(1);
    expect(journey.inputs[0]).toMatchObject({
      text: "the examples",
      target: { taskId: CUT_OFF_TASK, revision: 1 },
    });
  });

  it("refuses blank text without a request", async () => {
    const store = client("local");
    await flush();
    expect(
      await store.actions.submitFollowUp("  \n ", targetNow(store)),
    ).toEqual({ ok: false, code: "invalid_input" });
    expect(journey.inputs).toEqual([]);
  });

  it("sends a later, separate press as its own input", async () => {
    const store = client("local");
    await flush();
    await store.actions.submitFollowUp("one", targetNow(store));
    await store.actions.submitFollowUp("two", targetNow(store));
    expect(journey.inputs.map((input) => input["text"])).toEqual([
      "one",
      "two",
    ]);
  });
});

describe("two clients of one session", () => {
  it("both show the same strip, and context added on one clears it on the other", async () => {
    const native = client("local");
    const web = client("other");
    await vi.advanceTimersByTimeAsync(1_500);
    expect(cardOf(native)?.missingContext).toEqual(CUT_OFF);
    expect(cardOf(web)?.missingContext).toEqual(CUT_OFF);

    await web.actions.submitFollowUp("the examples", targetNow(web));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(cardOf(native)).toMatchObject({ revision: 2, missingContext: null });
    expect(cardOf(web)).toMatchObject({ revision: 2, missingContext: null });
    expect(cardOf(native)?.answerText).toBe("Revised with the added context.");

    // And the other way round, asking again for what is still missing.
    journey.nextMissing = [{ kind: "signature" }];
    await native.actions.submitFollowUp("python", targetNow(native));
    await vi.advanceTimersByTimeAsync(1_500);
    expect(cardOf(web)?.missingContext).toEqual([{ kind: "signature" }]);
    expect(cardOf(native)?.missingContext).toEqual([{ kind: "signature" }]);
  });
});
