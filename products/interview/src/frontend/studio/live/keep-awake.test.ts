import { describe, expect, it, vi } from "vitest";
import { holdAwake, isHeldAwake, onAwakeChange } from "./keep-awake";

describe("keep awake", () => {
  it("counts holds, releases once each, and announces every change", () => {
    const changed = vi.fn();
    const stop = onAwakeChange(changed);
    expect(isHeldAwake()).toBe(false);
    const mic = holdAwake();
    const share = holdAwake();
    expect(isHeldAwake()).toBe(true);
    mic();
    mic();
    expect(isHeldAwake()).toBe(true);
    share();
    expect(isHeldAwake()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(4);
    stop();
  });
});
