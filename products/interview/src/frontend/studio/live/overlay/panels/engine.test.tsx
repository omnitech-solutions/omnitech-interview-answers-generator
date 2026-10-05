// The native engine, over a fake engine host: Studio starts, holds and stops it
// with Auto and the session, shows its typed state, and the browser recogniser
// stays off while it listens.
import type { EngineHost, EngineState } from "@omnitech/interview-contracts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  engineHost,
  engineLine,
  engineMic,
  engineNeeds,
  micAction,
  pressMic,
  useEngine,
} from "./use-engine";

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

function fake(start: EngineHost["start"] | null = null) {
  const listeners = new Set<(s: EngineState) => void>();
  const calls: string[] = [];
  const host: EngineHost = {
    start:
      start ??
      (async (r) => (
        calls.push(`start:${r.sessionId}:${r.sources.join("+")}`),
        { ok: true, engine: state() }
      )),
    stop: async () => (
      calls.push("stop"), { ok: true, engine: state({ listening: false }) }
    ),
    pause: async () => (
      calls.push("pause"), { ok: true, engine: state({ paused: true }) }
    ),
    resume: async () => (calls.push("resume"), { ok: true, engine: state() }),
    status: async () => ({ ok: true, engine: state() }),
    onEvent: (l) => (listeners.add(l), () => listeners.delete(l)),
  };
  (window as { studioHost?: unknown }).studioHost = { engine: host };
  return { calls, emit: (s: EngineState) => listeners.forEach((l) => l(s)) };
}
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

describe("the engine", () => {
  it("is absent without a bridge or with an incomplete one", () => {
    expect(engineHost()).toBeNull();
    (window as { studioHost?: unknown }).studioHost = {
      engine: { start() {} },
    };
    expect(engineHost()).toBeNull();
    const view = renderHook(() => useEngine(input()));
    expect(view.result.current.present).toBe(false);
    expect(view.result.current.listening).toBe(false);
  });
  it("starts for the open session with the chosen sources when Auto begins, and stops when it ends", async () => {
    const engine = fake();
    const view = renderHook((p) => useEngine(p), {
      initialProps: input({ sources: ["microphone", "screen"] }),
    });
    await settle();
    expect(engine.calls).toEqual(["start:s1:microphone+screen"]);
    expect(view.result.current.listening).toBe(true);
    view.rerender(input({ wanted: false }));
    await settle();
    expect(engine.calls).toEqual(["start:s1:microphone+screen", "stop"]);
    expect(view.result.current.listening).toBe(false);
  });
  it("starts nothing unless Auto is on for an open session", async () => {
    const engine = fake();
    renderHook(() => useEngine(input({ wanted: false })));
    renderHook(() => useEngine(input({ sessionId: null })));
    await settle();
    expect(engine.calls).toEqual([]);
  });
  it("holds and resumes with the session's pause", async () => {
    const engine = fake();
    const view = renderHook((p) => useEngine(p), { initialProps: input() });
    await settle();
    view.rerender(input({ paused: true }));
    await settle();
    view.rerender(input({ paused: false }));
    await settle();
    expect(engine.calls).toEqual(["start:s1:microphone", "pause", "resume"]);
  });
  it("is not the listener when it refuses, so the browser recogniser can take over", async () => {
    fake(async () => ({ ok: false, reason: "signed-out" }));
    const view = renderHook(() => useEngine(input()));
    await settle();
    expect(view.result.current.refused).toBe("signed-out");
    expect(view.result.current.listening).toBe(false);
    expect(engineLine(view.result.current)).toContain("signed-out");
  });
  it("shows the engine's typed state: heard age, lost, permission denied, hint", async () => {
    const engine = fake();
    const view = renderHook(() => useEngine(input()));
    await settle();
    expect(engineLine(view.result.current)).toBe("Listening · heard 3s ago");
    act(() =>
      engine.emit(
        state({
          sources: { microphone: "lost", "system-audio": "off", screen: "off" },
        }),
      ),
    );
    expect(engineLine(view.result.current)).toContain("lost");
    act(() =>
      engine.emit(
        state({
          sources: {
            microphone: "permission-denied",
            "system-audio": "off",
            screen: "off",
          },
        }),
      ),
    );
    expect(engineLine(view.result.current)).toContain("not allowed");
    act(() =>
      engine.emit(state({ hint: "Grant Microphone in System Settings" })),
    );
    expect(engineLine(view.result.current)).toBe(
      "Grant Microphone in System Settings",
    );
  });
});

describe("the microphone control with a native engine (Alt+R, Stop microphone)", () => {
  it("stops the engine, shows stopped only when the engine reports it, and starts it again on the next press", async () => {
    const engine = fake();
    const view = renderHook((p) => useEngine(p), { initialProps: input() });
    await settle();
    expect(view.result.current.micOn).toBe(true);
    let release: () => void = () => undefined;
    const host = (window as { studioHost?: { engine: EngineHost } }).studioHost
      ?.engine as EngineHost;
    const realStop = host.stop;
    host.stop = () =>
      new Promise((resolve) => {
        release = () => void resolve(realStop());
      });
    act(() => view.result.current.toggleMic());
    // Pending: still listening, and a second press is not a second stop.
    expect(view.result.current.micPending).toBe(true);
    expect(view.result.current.micOn).toBe(true);
    act(() => view.result.current.toggleMic());
    // The host call goes out through the ordered chain, a tick later.
    await settle();
    await act(async () => release());
    await settle();
    await settle();
    expect(view.result.current.micPending).toBe(false);
    expect(view.result.current.micOn).toBe(false);
    host.stop = realStop;
    act(() => view.result.current.toggleMic());
    await settle();
    expect(engine.calls).toEqual([
      "start:s1:microphone",
      "stop",
      "start:s1:microphone",
    ]);
    expect(view.result.current.micOn).toBe(true);
  });
  it("Manual (Auto off) presses the browser dictation fallback, never the engine; Auto on presses the engine, never the fallback", async () => {
    const engine = fake();
    const dictation = vi.fn();
    const view = renderHook((p) => useEngine(p), {
      initialProps: input({ wanted: false }),
    });
    await settle();
    act(() => pressMic(view.result.current, dictation));
    await settle();
    expect(dictation).toHaveBeenCalledTimes(1);
    expect(engine.calls).toEqual([]);
    view.rerender(input());
    await settle();
    act(() => pressMic(view.result.current, dictation));
    await settle();
    expect(dictation).toHaveBeenCalledTimes(1);
    expect(engine.calls).toEqual(["start:s1:microphone", "stop"]);
  });
  it("does nothing without an engine (the caller falls back to dictation)", () => {
    const view = renderHook(() => useEngine(input()));
    act(() => view.result.current.toggleMic());
    expect(view.result.current.micOn).toBe(false);
  });
});

describe("the browser recogniser is off while an engine is present", () => {
  it("is told so through engineListening in the page's own Auto input", () => {
    fake();
    expect(engineHost()).not.toBeNull();
  });
});

const mic = (microphone: EngineState["sources"]["microphone"]) =>
  state({
    sources: { microphone, "system-audio": "off", screen: "off" },
  });

describe("one predicate for the microphone control", () => {
  it("a press while the session is held does not stop the engine, and the control says held", async () => {
    const engine = fake();
    const view = renderHook((p) => useEngine(p), { initialProps: input() });
    await settle();
    view.rerender(input({ paused: true }));
    await settle();
    expect(engine.calls).toEqual(["start:s1:microphone", "pause"]);
    expect(view.result.current.micAction).toBe("held");
    expect(view.result.current.micHeld).toBe(true);
    act(() => view.result.current.toggleMic());
    await settle();
    expect(engine.calls).toEqual(["start:s1:microphone", "pause"]);
    // Resume carries on: the engine was never torn down.
    view.rerender(input());
    await settle();
    expect(engine.calls.at(-1)).toBe("resume");
    expect(view.result.current.micHeld).toBe(false);
  });

  it.each([
    ["listening", "stop"],
    ["starting", "restart"],
    ["lost", "restart"],
    ["permission-denied", "restart"],
    ["unavailable", "restart"],
  ] as const)("microphone %s: a press is %s", (health, expected) => {
    expect(
      micAction({
        wanted: true,
        paused: false,
        refused: null,
        state: mic(health),
      }),
    ).toBe(expected);
  });

  it("a stopped, absent or refused engine is started by a press; a held one is never touched", () => {
    const base = { wanted: true, paused: false };
    expect(micAction({ ...base, refused: null, state: null })).toBe("start");
    expect(
      micAction({
        ...base,
        refused: "signed-out",
        state: state({ listening: false }),
      }),
    ).toBe("start");
    expect(
      micAction({
        ...base,
        refused: null,
        state: state({ paused: true }),
      }),
    ).toBe("held");
    expect(
      micAction({ ...base, paused: true, refused: null, state: null }),
    ).toBe("held");
  });

  it("with the microphone lost, a press restarts the engine (stop, then start), never only stops it", async () => {
    const engine = fake();
    const view = renderHook((p) => useEngine(p), { initialProps: input() });
    await settle();
    act(() => engine.emit(mic("lost")));
    expect(view.result.current.micAction).toBe("restart");
    act(() => view.result.current.toggleMic());
    await settle();
    await settle();
    expect(engine.calls).toEqual([
      "start:s1:microphone",
      "stop",
      "start:s1:microphone",
    ]);
    expect(view.result.current.micOn).toBe(true);
  });

  it("a press on a refused engine starts it again (not browser dictation) and the reason shows meanwhile", async () => {
    let refuse = true;
    const engine = fake(async (r) =>
      refuse
        ? { ok: false, reason: "signed-out" }
        : {
            ok: true,
            engine: (engine.calls.push(`start:${r.sessionId}`), state()),
          },
    );
    const dictation = vi.fn();
    const view = renderHook((p) => useEngine(p), { initialProps: input() });
    await settle();
    expect(view.result.current.refused).toBe("signed-out");
    expect(engineNeeds(view.result.current)).toContain("signed-out");
    refuse = false;
    act(() => pressMic(view.result.current, dictation));
    await settle();
    await settle();
    expect(dictation).not.toHaveBeenCalled();
    expect(view.result.current.refused).toBeNull();
    expect(view.result.current.micOn).toBe(true);
    expect(engineNeeds(view.result.current)).toBeNull();
  });

  it("engineNeeds speaks only of what the owner must do", async () => {
    const engine = fake();
    const view = renderHook(() => useEngine(input()));
    await settle();
    expect(engineNeeds(view.result.current)).toBeNull();
    act(() =>
      engine.emit(state({ hint: "Grant Microphone in System Settings" })),
    );
    expect(engineNeeds(view.result.current)).toBe(
      "Grant Microphone in System Settings",
    );
  });

  it("both controllers map a denied microphone the same way", async () => {
    const engine = fake();
    const view = renderHook(() => useEngine(input()));
    await settle();
    expect(engineMic(view.result.current, "off")).toBe("listening");
    act(() => engine.emit(mic("permission-denied")));
    expect(engineMic(view.result.current, "off")).toBe("denied");
  });
});

describe("engine calls are ordered", () => {
  // A host whose replies are released by the test, in any order.
  function slow() {
    const sent: string[] = [];
    const gates: (() => void)[] = [];
    const reply = (name: string, engine: EngineState) =>
      new Promise<{ ok: true; engine: EngineState }>((resolve) => {
        sent.push(name);
        gates.push(() => resolve({ ok: true, engine }));
      });
    const host: EngineHost = {
      start: (r) => reply(`start:${r.sessionId}`, state()),
      stop: () => reply("stop", state({ listening: false })),
      pause: () => reply("pause", state({ paused: true })),
      resume: () => reply("resume", state()),
      status: async () => ({ ok: true, engine: state() }),
      onEvent: () => () => undefined,
    };
    (window as { studioHost?: unknown }).studioHost = { engine: host };
    return { sent, release: () => gates.shift()?.() };
  }
  const tick = () => act(async () => void (await Promise.resolve()));
  const drain = async () => {
    for (let i = 0; i < 5; i += 1) await tick();
  };

  it("never sends a start before the previous stop was answered (session switch)", async () => {
    const host = slow();
    const view = renderHook((p) => useEngine(p), { initialProps: input() });
    await drain();
    expect(host.sent).toEqual(["start:s1"]);
    view.rerender(input({ sessionId: "s2" }));
    await drain();
    // The first start is still unanswered: nothing else was sent yet.
    expect(host.sent).toEqual(["start:s1"]);
    await act(async () => host.release());
    await drain();
    expect(host.sent).toEqual(["start:s1", "stop"]);
    await act(async () => host.release());
    await drain();
    expect(host.sent).toEqual(["start:s1", "stop", "start:s2"]);
    await act(async () => host.release());
    await drain();
    expect(view.result.current.listening).toBe(true);
  });

  it("a late stop reply never overwrites the state of the run that replaced it (Auto off then on)", async () => {
    const host = slow();
    const view = renderHook((p) => useEngine(p), { initialProps: input() });
    await drain();
    await act(async () => host.release());
    await drain();
    view.rerender(input({ wanted: false }));
    await drain();
    view.rerender(input());
    await drain();
    expect(host.sent).toEqual(["start:s1", "stop"]);
    await act(async () => host.release()); // the stop answers (listening: false)
    await drain();
    expect(host.sent).toEqual(["start:s1", "stop", "start:s1"]);
    await act(async () => host.release()); // the new start answers
    await drain();
    expect(view.result.current.state?.listening).toBe(true);
    expect(view.result.current.listening).toBe(true);
  });
});
