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
  };
  const actions = createSessionActions(
    context as unknown as Parameters<typeof createSessionActions>[0],
  );
  const finish = async () => {
    for (const release of releases.splice(0)) release();
    await Promise.resolve();
  };
  return { actions, submitFollowUp, solveTask, sent, finish };
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
