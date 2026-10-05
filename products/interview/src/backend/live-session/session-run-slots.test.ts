// A slot's child abort follows the run's abort only while its dispatch is
// live: settling the slot detaches it, so a long-lived run does not gather one
// listener per dispatch (ADR-0016). No database.
import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";
import {
  createRun,
  occupySlot,
  releaseSlot,
  type SessionRun,
} from "./session-run";

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
const listeners = (run: SessionRun) =>
  getEventListeners(run.abort.signal, "abort").length;

describe("occupySlot", () => {
  it("removes its run-abort listener when the slot settles, however many dispatches ran", () => {
    const run = newRun();
    for (let revision = 1; revision <= 25; revision += 1) {
      occupySlot(run, run.slots.assist, "task-1", revision);
      expect(listeners(run)).toBe(1);
      releaseSlot(run.slots.assist);
    }
    expect(listeners(run)).toBe(0);
  });

  it("detaches a slot that is re-occupied before it settled, and still follows the run while live", () => {
    const run = newRun();
    const first = occupySlot(run, run.slots.coding, "task-1", 1);
    const second = occupySlot(run, run.slots.coding, "task-1", 2);
    expect(listeners(run)).toBe(1);
    run.abort.abort();
    expect(second.signal.aborted).toBe(true);
    expect(first.signal.aborted).toBe(false);
  });

  it("starts aborted when the run already is, adding no listener", () => {
    const run = newRun();
    run.abort.abort();
    expect(occupySlot(run, run.slots.assist, "task-1", 1).signal.aborted).toBe(
      true,
    );
    expect(listeners(run)).toBe(0);
  });
});
