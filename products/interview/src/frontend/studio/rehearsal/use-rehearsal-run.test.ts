import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { initialSession, useRehearsalRun } from "./use-rehearsal-run";

afterEach(() => vi.useRealTimers());
const material = {
  concept: null,
  coding: {
    choice: { source: "question" as const, ref: "q", title: "Solve" },
    statement: "Solve",
    example: null,
    reveals: { solution: "code", hint1: "hint" },
  },
};
it("counts each hint once, enforces complexity, and scores checklist changes", () => {
  const finish = vi.fn();
  const { result } = renderHook(() =>
    useRehearsalRun({
      settings: { format: "coding", strict: true, followUps: true },
      material,
      onFinish: finish,
    }),
  );
  act(() => {
    result.current.actions.reveal("solution");
    result.current.actions.togglePause();
  });
  expect(result.current.session.reveals).toEqual([]);
  expect(result.current.session.paused).toBe(false);
  act(() => result.current.actions.patch({ complexity: "O(n)" }));
  act(() => {
    result.current.actions.reveal("solution");
    result.current.actions.reveal("solution");
    result.current.actions.toggleCheck(0);
    result.current.actions.toggleCheck(99);
  });
  expect(result.current.session.reveals).toEqual(["solution"]);
  expect(result.current.score).toBe(7);
  act(() => {
    result.current.actions.finish();
    result.current.actions.finish();
    result.current.actions.reveal("hint1");
  });
  expect(finish).toHaveBeenCalledTimes(1);
  expect(result.current.session.reveals).toEqual(["solution"]);
});
it("ticks once a second, pauses, and finishes at the format budget", () => {
  vi.useFakeTimers();
  const finish = vi.fn();
  const { result, unmount } = renderHook(() =>
    useRehearsalRun({
      settings: { format: "concept", strict: false, followUps: true },
      material,
      initial: { ...initialSession(), elapsed: 898 },
      onFinish: finish,
    }),
  );
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.session.elapsed).toBe(899);
  act(() => result.current.actions.togglePause());
  act(() => vi.advanceTimersByTime(5000));
  expect(result.current.session.elapsed).toBe(899);
  act(() => result.current.actions.togglePause());
  act(() => vi.advanceTimersByTime(1000));
  expect(finish).toHaveBeenCalledTimes(1);
  expect(result.current.status).toBe("finished");
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
