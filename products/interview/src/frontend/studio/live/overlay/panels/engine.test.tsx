// The native engine, over a fake engine host: Studio starts, holds and stops it
// with Auto and the session, shows its typed state, and the browser recogniser
// stays off while it listens.
import type { EngineHost, EngineState } from "@omnitech/interview-contracts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { engineHost, engineLine, useEngine } from "./use-engine";

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

describe("the browser recogniser is off while an engine is present", () => {
  it("is told so through engineListening in the page's own Auto input", () => {
    fake();
    expect(engineHost()).not.toBeNull();
  });
});
