import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readNdjson, useLeaveGuard, useRefreshOnReturn } from "./work-guards";

afterEach(() => vi.useRealTimers());

describe("useLeaveGuard", () => {
  const leave = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it("asks only while active, and stops when it ends or unmounts", () => {
    const { rerender, unmount } = renderHook(
      ({ active }) => useLeaveGuard(active),
      { initialProps: { active: false } },
    );
    expect(leave()).toBe(false);
    rerender({ active: true });
    expect(leave()).toBe(true);
    rerender({ active: false });
    expect(leave()).toBe(false);
    rerender({ active: true });
    unmount();
    expect(leave()).toBe(false);
  });
});

describe("useRefreshOnReturn", () => {
  it("refreshes on return after a gap, ignoring quick returns and hidden pages", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useRefreshOnReturn(refresh, 3000));
    window.dispatchEvent(new Event("focus"));
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    unmount();
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("readNdjson", () => {
  it("delivers events as they arrive, across chunk boundaries, and the last unterminated line", async () => {
    const chunks = ['{"n":1}\n{"n"', ":2}\n", '{"n":3}'];
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const seen: number[] = [];
    await readNdjson<{ n: number }>(body, (event) => seen.push(event.n));
    expect(seen).toEqual([1, 2, 3]);
  });
});
