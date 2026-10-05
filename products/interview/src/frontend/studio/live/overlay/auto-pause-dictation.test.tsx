// A paused session (the window hidden, Pause, the yellow dot) holds no open
// microphone: dictation a Manual press started ends with it, and in the Mac
// app the missing-speech advice never sends the person to another browser.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeRecognition, installRecognition } from "./capture-fixtures";
import { DICTATION_MESSAGES } from "./dictation";
import { useAutoMode } from "./use-auto-mode";

const base = {
  tenant: "t",
  sessionId: "s1",
  open: true,
  paused: false,
  deviceOnly: false,
  wantsScreen: false,
  sharing: false,
  watchable: false,
  sample: () => null,
  mask: { x: 0, y: 0, w: 1, h: 1 },
  busy: false,
  capture: async () => false,
  submitHeard: async () => ({ ok: true }) as never,
  resume: async () => ({ ok: true }) as never,
  onManualFinal: () => undefined,
  screenWatch: null,
};

beforeEach(() => {
  window.localStorage.clear();
  installRecognition(true);
});

describe("pause and dictation", () => {
  it("a Manual dictation ends when the session pauses (hide)", () => {
    const { result, rerender } = renderHook((p) => useAutoMode(p), {
      initialProps: base,
    });
    act(() => result.current.dictation.start());
    expect(result.current.dictation.state).toBe("listening");
    rerender({ ...base, paused: true });
    expect(result.current.dictation.state).toBe("idle");
    expect(
      (FakeRecognition.instances[0] as FakeRecognition).stop,
    ).toHaveBeenCalled();
  });
});

describe("no speech recognition in the Mac app", () => {
  it("says nothing about Chrome or Edge", () => {
    installRecognition(false);
    const { result } = renderHook(() =>
      useAutoMode({ ...base, nativeEngine: true }),
    );
    act(() => result.current.dictation.start());
    expect(result.current.dictation.error).toBe(
      DICTATION_MESSAGES.unsupportedInApp,
    );
    expect(result.current.dictation.error).not.toMatch(/Chrome|Edge/);
  });
});
