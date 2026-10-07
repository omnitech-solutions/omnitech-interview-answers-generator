// The microphone menu's actions on the engine: Retry now and choosing a device.
import type { EngineHost, EngineState } from "@omnitech/interview-contracts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { engineHost, useEngine } from "./use-engine";

const state = (extra: Partial<EngineState> = {}): EngineState => ({
  v: 1,
  pairing: "paired",
  listening: true,
  paused: false,
  sources: { microphone: "listening", "system-audio": "off", screen: "off" },
  lastHeardAgeSeconds: 3,
  hint: null,
  ...extra,
});
const settle = () => act(async () => void (await Promise.resolve()));
afterEach(() => {
  cleanup();
  delete (window as { studioHost?: unknown }).studioHost;
});
const input = (extra = {}) => ({
  sessionId: "s1",
  wanted: true,
  paused: false,
  sources: ["microphone"] as const,
  ...extra,
});

describe("the microphone menu's actions (Retry now, choose a device)", () => {
  function withMenu(lostState: EngineState) {
    const calls: string[] = [];
    const reply = (note: string, engine: EngineState) => {
      calls.push(note);
      return Promise.resolve({ ok: true, engine } as const);
    };
    const host: EngineHost = {
      start: (r) => reply(`start:${r.sessionId}`, lostState),
      stop: () => reply("stop", state({ listening: false })),
      pause: () => reply("pause", state({ paused: true })),
      resume: () => reply("resume", state()),
      status: () => Promise.resolve({ ok: true, engine: lostState }),
      retryMicrophone: () => reply("retry", state()),
      selectMicrophone: (id) =>
        reply(`select:${id}`, state({ microphoneDeviceId: id })),
      onEvent: () => () => {},
    };
    (window as { studioHost?: unknown }).studioHost = { engine: host };
    return calls;
  }
  const lost = () =>
    state({
      sources: { microphone: "lost", "system-audio": "off", screen: "off" },
      microphoneRetryAttempt: 2,
    });

  it("Retry now uses the shell's retry and shows the report", async () => {
    const calls = withMenu(lost());
    const view = renderHook(() => useEngine(input()));
    await settle();
    expect(view.result.current.state?.sources.microphone).toBe("lost");
    act(() => view.result.current.retryMic());
    await settle();
    expect(calls).toEqual(["start:s1", "retry"]);
    expect(view.result.current.micOn).toBe(true);
  });

  it("Retry now restarts the engine when the shell has no retry", async () => {
    const calls = withMenu(lost());
    const host = engineHost() as Partial<EngineHost>;
    delete host.retryMicrophone;
    const view = renderHook(() => useEngine(input()));
    await settle();
    act(() => view.result.current.retryMic());
    await settle();
    expect(calls).toEqual(["start:s1", "stop", "start:s1"]);
  });

  it("Retry now does nothing while the session is held or the mic listens", async () => {
    const calls = withMenu(lost());
    const view = renderHook((p) => useEngine(p), { initialProps: input() });
    await settle();
    view.rerender(input({ paused: true }));
    await settle();
    calls.length = 0;
    act(() => view.result.current.retryMic());
    await settle();
    expect(calls).toEqual([]);
  });

  it("choosing a device asks the shell and shows the one it reports", async () => {
    const calls = withMenu(state());
    const view = renderHook(() => useEngine(input()));
    await settle();
    act(() => view.result.current.selectMic("usb"));
    await settle();
    expect(calls).toEqual(["start:s1", "select:usb"]);
    expect(view.result.current.state?.microphoneDeviceId).toBe("usb");
  });

  it("choosing a device is a no-op on a shell without device choice", async () => {
    const calls = withMenu(state());
    const host = engineHost() as Partial<EngineHost>;
    delete host.selectMicrophone;
    const view = renderHook(() => useEngine(input()));
    await settle();
    act(() => view.result.current.selectMic("usb"));
    await settle();
    expect(calls).toEqual(["start:s1"]);
  });
});
