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
