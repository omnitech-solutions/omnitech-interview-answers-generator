import { afterEach, describe, expect, it, vi } from "vitest";
import { presentation } from "./focus-presentation";

afterEach(() => {
  presentation.reset();
  window.sessionStorage.clear();
});

describe("what the views share", () => {
  it("starts following the newest task, with no older revision chosen", () => {
    expect(presentation.get()).toEqual({
      pinnedTaskId: null,
      revisionPicks: {},
    });
  });

  it("pins a task and un-pins it again, telling listeners once per change", () => {
    const listener = vi.fn();
    const stop = presentation.subscribe(listener);
    presentation.pin("t1");
    presentation.pin("t1");
    expect(presentation.get().pinnedTaskId).toBe("t1");
    expect(listener).toHaveBeenCalledTimes(1);
    presentation.pin(null);
    expect(presentation.get().pinnedTaskId).toBeNull();
    stop();
  });

  it("views an older revision per task and returns to the newest on null", () => {
    presentation.pickRevision("t1", 1);
    presentation.pickRevision("t2", 3);
    expect(presentation.get().revisionPicks).toEqual({ t1: 1, t2: 3 });
    presentation.pickRevision("t1", null);
    expect(presentation.get().revisionPicks).toEqual({ t2: 3 });
  });

  it("never remembers the pin or a pick across visits", () => {
    presentation.pin("t1");
    presentation.pickRevision("t1", 1);
    presentation.reset();
    expect(presentation.get()).toEqual({
      pinnedTaskId: null,
      revisionPicks: {},
    });
    // Nothing is written for the next visit.
    expect(
      window.sessionStorage.getItem("interview-studio.live.presentation"),
    ).toBeNull();
  });
});
