import { describe, expect, it } from "vitest";
import type { TaskView } from "../../session-tasks";
import {
  FINISHED_SHOWN_MS,
  finishedWork,
  type StripInput,
  stripState,
} from "./strip-model";

const quiet: StripInput = {
  paused: false,
  busy: null,
  newest: null,
  auto: { line: null, watching: false, intervalSec: 8 },
  finished: null,
};
const line = (tone: "ok" | "problem" | "wait", text = "Auto · text") => ({
  tone,
  text,
});

describe("the strip's one table of states", () => {
  it("is empty when there is nothing to say", () => {
    expect(stripState(quiet)).toBeNull();
  });

  it("says nothing while paused, whatever else is going on: the footer says it", () => {
    expect(
      stripState({
        ...quiet,
        paused: true,
        busy: { label: "Drafting an answer", seconds: 5 },
      }),
    ).toBeNull();
  });

  it("says what the work is, how long it has taken, for which task, and offers Stop analysis", () => {
    expect(
      stripState({
        ...quiet,
        busy: { label: "Drafting an answer", seconds: 12 },
        newest: { label: "T2", answered: true },
      }),
    ).toMatchObject({
      id: "busy",
      busy: true,
      label: "Drafting an answer · 12s",
      sub: "T2 · answer ready",
      action: { id: "stop", label: "Stop analysis" },
    });
  });

  it("leaves the clock out for the first seconds and the task out before one exists", () => {
    expect(
      stripState({
        ...quiet,
        busy: { label: "Capturing the screen", seconds: 1 },
      }),
    ).toMatchObject({ label: "Capturing the screen", sub: null });
  });

  it("puts an Auto problem or wait ahead of watching and finished", () => {
    for (const tone of ["problem", "wait"] as const)
      expect(
        stripState({
          ...quiet,
          auto: {
            line: line(tone, "Auto · not watching a screen."),
            watching: true,
            intervalSec: 8,
          },
          finished: { label: "T1", tookSeconds: 9 },
        }),
      ).toMatchObject({
        id: "auto-problem",
        tone: "amber",
        label: "Auto · not watching a screen.",
      });
  });

  it("says Auto is watching with the interval in force, and that a browser must be in front", () => {
    expect(
      stripState({
        ...quiet,
        auto: { line: line("ok"), watching: true, intervalSec: 15 },
      }),
    ).toMatchObject({
      id: "auto-watching",
      label: "Auto · watching the screen",
      sub: "checks every 15 s · only while a browser is in front",
    });
  });

  it("is quiet about Auto when it is not watching the screen", () => {
    expect(
      stripState({
        ...quiet,
        auto: { line: line("ok"), watching: false, intervalSec: 8 },
      }),
    ).toBeNull();
  });

  it("says Finished with the time it took and what to press next", () => {
    expect(
      stripState({ ...quiet, finished: { label: "T1", tookSeconds: 22 } }),
    ).toMatchObject({
      id: "finished",
      label: "Finished · 22s",
      sub: "T1 · press ⌘⇧S for the next problem",
    });
  });
});

describe("a finished task", () => {
  const run = (state: string, createdAt: string, updatedAt: string) => ({
    state,
    createdAt,
    updatedAt,
  });
  const task = (runs: ReturnType<typeof run>[], answer: unknown = {}) =>
    ({ answer, current: { runs } }) as unknown as TaskView;
  const start = Date.parse("2026-10-04T10:00:00Z");

  it("reports the whole work time while the line is still fresh", () => {
    const done = task([
      run("published", "2026-10-04T10:00:00Z", "2026-10-04T10:00:10Z"),
      run("published", "2026-10-04T10:00:11Z", "2026-10-04T10:00:22Z"),
    ]);
    expect(finishedWork(done, "T1", start + 30_000)).toEqual({
      label: "T1",
      tookSeconds: 22,
    });
    expect(
      finishedWork(done, "T1", start + 22_000 + FINISHED_SHOWN_MS + 1),
    ).toBeNull();
  });

  it("says nothing while anything runs, with no runs, or with no answer", () => {
    const at = start + 5_000;
    expect(
      finishedWork(
        task([run("running", "2026-10-04T10:00:00Z", "2026-10-04T10:00:03Z")]),
        "T1",
        at,
      ),
    ).toBeNull();
    expect(finishedWork(task([]), "T1", at)).toBeNull();
    expect(
      finishedWork(
        task(
          [run("cancelled", "2026-10-04T10:00:00Z", "2026-10-04T10:00:03Z")],
          null,
        ),
        "T1",
        at,
      ),
    ).toBeNull();
    expect(finishedWork(undefined, "T1", at)).toBeNull();
  });
});
