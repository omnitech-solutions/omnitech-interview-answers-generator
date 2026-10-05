import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCopied } from "./use-copied";

const writeText = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});
afterEach(() => {
  vi.useRealTimers();
  writeText.mockReset();
});

it("reports copied only after the clipboard accepted the text, then resets", async () => {
  writeText.mockResolvedValue(undefined);
  const { result } = renderHook(() => useCopied(1000));
  await act(async () => {
    expect(await result.current.copy("hello")).toBe(true);
  });
  expect(writeText).toHaveBeenCalledWith("hello");
  expect(result.current.copied).toBe(true);
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.copied).toBe(false);
});

it("never says copied when nothing could be copied", async () => {
  writeText.mockRejectedValue(new Error("denied"));
  document.execCommand = vi.fn(() => false);
  const { result } = renderHook(() => useCopied());
  await act(async () => {
    expect(await result.current.copy("hello")).toBe(false);
  });
  expect(result.current.copied).toBe(false);
});
