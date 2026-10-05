// Dictation belongs to the session it started in.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRecognition, installRecognition } from "./capture-fixtures";
import { useDictation } from "./dictation";

beforeEach(() => installRecognition(true));

describe("dictation across a session switch", () => {
  it("drops phrases heard after the session changed and ends listening", async () => {
    const onFinal = vi.fn();
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useDictation({ deviceOnly: false, bindingKey: key, onFinal }),
      { initialProps: { key: "session-a" } },
    );
    act(() => result.current.toggle());
    const rec = FakeRecognition.instances[0] as FakeRecognition;
    act(() => rec.say({ text: "for session a", final: true }));
    expect(onFinal).toHaveBeenCalledWith("for session a");
    rerender({ key: "session-b" });
    expect(result.current.state).toBe("idle");
    act(() => rec.say({ text: "late words", final: true }));
    expect(onFinal).toHaveBeenCalledTimes(1);
  });

  it("an on-device check that finishes after the session changed starts nothing", async () => {
    let release!: (value: string) => void;
    FakeRecognition.available = () =>
      new Promise<string>((resolve) => {
        release = resolve;
      });
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useDictation({ deviceOnly: true, bindingKey: key, onFinal: vi.fn() }),
      { initialProps: { key: "session-a" } },
    );
    act(() => result.current.toggle());
    rerender({ key: "session-b" });
    await act(async () => release("available"));
    expect(
      (FakeRecognition.instances[0] as FakeRecognition).start,
    ).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });
});

describe("the level meter", () => {
  it("start, stop, start again before the first getUserMedia resolves: the first stream is stopped, only the newest meter is kept", async () => {
    const tracks = [vi.fn(), vi.fn()];
    const gates: ((stream: unknown) => void)[] = [];
    let asked = 0;
    const getUserMedia = vi.fn(
      () =>
        new Promise((resolve) => {
          const mine = asked++;
          gates.push(() =>
            resolve({ getTracks: () => [{ stop: tracks[mine] }] }),
          );
        }),
    );
    const original = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    class FakeContext {
      createAnalyser() {
        return { fftSize: 0, getByteTimeDomainData: () => undefined };
      }
      createMediaStreamSource() {
        return { connect: () => undefined };
      }
      close() {
        return Promise.resolve();
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
    try {
      const { result } = renderHook(() =>
        useDictation({ deviceOnly: false, onFinal: vi.fn() }),
      );
      act(() => result.current.start());
      act(() => result.current.stop());
      act(() => result.current.start());
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      await act(async () => gates[0]?.(null));
      // The older attempt's stream is closed as soon as it arrives.
      expect(tracks[0]).toHaveBeenCalledTimes(1);
      expect(tracks[1]).not.toHaveBeenCalled();
      await act(async () => gates[1]?.(null));
      expect(tracks[1]).not.toHaveBeenCalled();
      act(() => result.current.stop());
      expect(tracks[1]).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: original,
      });
      delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    }
  });
});
