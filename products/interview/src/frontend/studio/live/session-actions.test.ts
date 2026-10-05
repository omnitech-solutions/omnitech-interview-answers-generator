// The in-flight guard dedupes an IDENTICAL request only (same session, task
// target and text): a different follow-up is its own request and is never
// dropped while another is pending.
import { describe, expect, it, vi } from "vitest";
import { createSessionActions } from "./session-actions";
import type { SessionClient } from "./session-client";
import type { LiveSnapshot } from "./session-snapshot";
import { sessionView } from "./testing/session-fixtures";

type Send = (
  sessionId: string,
  text: string,
  target: { taskId: string; revision: number } | null,
) => Promise<void>;

function setup() {
  const releases: (() => void)[] = [];
  const sent: { text: string; target: unknown }[] = [];
  const submitFollowUp = vi.fn<Send>(async (_id, text, target) => {
    sent.push({ text, target });
    await new Promise<void>((resolve) => releases.push(resolve));
  });
  const solveTask = vi.fn(async () => {
    await new Promise<void>((resolve) => releases.push(resolve));
  });
  const regenerateTask = vi.fn(async () => {
    await new Promise<void>((resolve) => releases.push(resolve));
  });
  const applyContext = vi.fn(async (..._args: unknown[]) => {
    await new Promise<void>((resolve) => releases.push(resolve));
  });
  let snapshot = {
    session: sessionView(),
    pending: [],
  } as unknown as LiveSnapshot;
  const context = {
    client: {} as SessionClient,
    snapshot: () => snapshot,
    set: (patch: Partial<LiveSnapshot>) => {
      snapshot = { ...snapshot, ...patch };
    },
    bindEpoch: () => 1,
    restartLoop: () => undefined,
    submitFollowUp,
    solveTask,
    regenerateTask,
    applyContext,
  };
  const actions = createSessionActions(
    context as unknown as Parameters<typeof createSessionActions>[0],
  );
  const finish = async () => {
    for (const release of releases.splice(0)) release();
    await Promise.resolve();
  };
  return {
    actions,
    submitFollowUp,
    solveTask,
    regenerateTask,
    applyContext,
    snapshot: () => snapshot,
    sent,
    finish,
  };
}

const T1 = { taskId: "t1", revision: 1 };
const T2 = { taskId: "t2", revision: 1 };

describe("follow-up in-flight guard", () => {
  it("sends two different follow-ups back to back, in order", async () => {
    const { actions, submitFollowUp, sent, finish } = setup();
    const first = actions.submitFollowUp("first question", T1);
    const second = actions.submitFollowUp("second question", T1);
    await Promise.resolve();
    expect(submitFollowUp).toHaveBeenCalledTimes(2);
    expect(sent.map((each) => each.text)).toEqual([
      "first question",
      "second question",
    ]);
    await finish();
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
  });

  it("sends an identical double submit once", async () => {
    const { actions, submitFollowUp, finish } = setup();
    const first = actions.submitFollowUp("same", T1);
    const second = actions.submitFollowUp("same", T1);
    await Promise.resolve();
    expect(submitFollowUp).toHaveBeenCalledTimes(1);
    await finish();
    await Promise.all([first, second]);
  });

  it("does not dedupe the same text aimed at a different target", async () => {
    const { actions, submitFollowUp, finish } = setup();
    const a = actions.submitFollowUp("same", T1);
    const b = actions.submitFollowUp("same", T2);
    const c = actions.submitFollowUp("same", { taskId: "t1", revision: 2 });
    await Promise.resolve();
    expect(submitFollowUp).toHaveBeenCalledTimes(3);
    await finish();
    await Promise.all([a, b, c]);
  });

  it("solves two different task targets side by side and one target once", async () => {
    const { actions, solveTask, finish } = setup();
    const a = actions.solveTask(T1);
    const b = actions.solveTask(T2);
    const again = actions.solveTask(T1);
    await Promise.resolve();
    expect(solveTask).toHaveBeenCalledTimes(2);
    await finish();
    await Promise.all([a, b, again]);
  });
});

describe("regenerate and apply in-flight guard", () => {
  it("sends an identical regenerate once and a different task side by side", async () => {
    const { actions, regenerateTask, snapshot, finish } = setup();
    const a = actions.regenerate(T1);
    const b = actions.regenerate(T2);
    const again = actions.regenerate(T1);
    await Promise.resolve();
    expect(regenerateTask).toHaveBeenCalledTimes(2);
    // Pending shows the command while it is in flight, like the other actions.
    expect(snapshot().pending).toEqual(["regenerate", "regenerate"]);
    await finish();
    await Promise.all([a, b, again]);
    expect(snapshot().pending).toEqual([]);
  });

  it("sends a double-clicked Apply once, and a different request id or target as its own", async () => {
    const { actions, applyContext, finish } = setup();
    const input = { requestId: "r-1", images: [new Blob(["x"])] };
    const first = actions.applyContext(T1, input);
    const second = actions.applyContext(T1, { ...input });
    const retryId = actions.applyContext(T1, { ...input, requestId: "r-2" });
    const otherTask = actions.applyContext(T2, input);
    const newTask = actions.applyContext(null, { ...input, requestId: "r-3" });
    await Promise.resolve();
    expect(applyContext).toHaveBeenCalledTimes(4);
    expect(applyContext.mock.calls.map((call) => call[1])).toEqual([
      T1,
      T1,
      T2,
      null,
    ]);
    await finish();
    await Promise.all([first, second, retryId, otherTask, newTask]);
  });

  it("applyContext sends the staged images' display labels aligned with the images", async () => {
    const { ownerInputDeps } = await import("./session-owner-input");
    const { jsonResponse } = await import("./testing/session-fixtures");
    const bodies: FormData[] = [];
    const deps = ownerInputDeps(
      "local",
      async (_url, init) => {
        bodies.push(init?.body as FormData);
        return jsonResponse(
          {
            input: { requestId: "r-d", sequence: 3 },
            snapshots: [
              { sourceId: "studio.owner-capture", eventId: "r-d" },
              { sourceId: "studio.owner-capture", eventId: "r-d.2" },
            ],
          },
          202,
        );
      },
      () => ({}) as LiveSnapshot,
    );
    const display = { name: "Studio Display", index: 2, count: 3 };
    await deps.applyContext?.("s-1", null, {
      requestId: "r-d",
      images: [new Blob(["a"]), new Blob(["b"])],
      display: [null, display],
    });
    expect(JSON.parse(String(bodies[0]?.get("display")))).toEqual([
      null,
      display,
    ]);
  });

  it("returns the fixed code and the server's refusal reason of a failed apply", async () => {
    const { ownerInputDeps } = await import("./session-owner-input");
    const { jsonResponse } = await import("./testing/session-fixtures");
    const deps = ownerInputDeps(
      "local",
      async () =>
        jsonResponse({ error: { code: "status_refused" } }, 409, {
          "x-refusal-reason": "stale_target",
        }),
      () => ({}) as LiveSnapshot,
    );
    let snapshot = {
      session: sessionView(),
      pending: [],
    } as unknown as LiveSnapshot;
    const actions = createSessionActions({
      client: {} as SessionClient,
      snapshot: () => snapshot,
      set: (patch: Partial<LiveSnapshot>) => {
        snapshot = { ...snapshot, ...patch };
      },
      bindEpoch: () => 1,
      restartLoop: () => undefined,
      applyContext: deps.applyContext,
      regenerateTask: deps.regenerateTask,
    } as unknown as Parameters<typeof createSessionActions>[0]);
    expect(await actions.regenerate(T1)).toEqual({
      ok: false,
      code: "status_refused",
      reason: "stale_target",
    });
    expect(
      await actions.applyContext(T1, { requestId: "r-9", images: [] }),
    ).toMatchObject({ ok: false, code: "status_refused" });
    expect(snapshot.commandError).toBe("status_refused");
  });
});
