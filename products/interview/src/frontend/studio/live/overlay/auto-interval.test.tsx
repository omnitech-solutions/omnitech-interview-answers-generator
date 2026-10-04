// Auto's interval capture through the hook, with fake timers: native vs
// browser source, the screen-watch events as an extra trigger, a failed
// capture not blocking the next tick, and the decision itself.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_MAX_PER_SESSION, AUTO_MIN_GAP_MS } from "./auto-gate";
import type { FrameHash } from "./auto-hash";
import {
  AUTO_CHANGE_BITS,
  AUTO_HEARTBEAT_MS,
  clampIntervalSeconds,
  shouldAnalyze,
} from "./auto-interval";
import { saveAutoPreferred } from "./auto-prefs";
import { FakeRecognition, installRecognition } from "./capture-fixtures";
import { type AutoModeInput, useAutoMode } from "./use-auto-mode";

const A: FrameHash = [0, 0];
const FAR: FrameHash = [0xffffffff, 0];
let hash: FrameHash = A;
let captureResult = true;
const capture = vi.fn(async () => captureResult);
const sample = vi.fn(async () => hash);
const submitHeard = vi.fn(async () => ({ ok: true }) as never);
const onManualFinal = vi.fn();

const base = (over: Partial<AutoModeInput> = {}): AutoModeInput => ({
  tenant: "t",
  sessionId: "s1",
  open: true,
  paused: false,
  deviceOnly: false,
  wantsScreen: true,
  sharing: true,
  watchable: true,
  sample,
  mask: { x: 0, y: 0, w: 1, h: 1 },
  busy: false,
  capture,
  submitHeard,
  resume: async () => ({ ok: true }) as never,
  onManualFinal,
  screenWatch: null,
  engineListening: true,
  ...over,
});
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const mount = (over: Partial<AutoModeInput> = {}) =>
  renderHook((props: AutoModeInput) => useAutoMode(props), {
    initialProps: base(over),
  });

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  saveAutoPreferred("t", true);
  hash = A;
  captureResult = true;
  submitHeard.mockClear();
  onManualFinal.mockClear();
  capture.mockClear();
  sample.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as { studioHost?: unknown }).studioHost;
});

describe("shouldAnalyze", () => {
  it("analyses the first frame, a changed one, and a heartbeat only when enabled", () => {
    const at = { lastHash: A, lastAnalyzedAtMs: 0 };
    expect(
      shouldAnalyze({
        hash: A,
        nowMs: 1,
        lastHash: null,
        lastAnalyzedAtMs: null,
        heartbeat: false,
      }),
    ).toBe(true);
    expect(
      shouldAnalyze({ hash: A, nowMs: 1_000, ...at, heartbeat: false }),
    ).toBe(false);
    const nearly: FrameHash = [(1 << (AUTO_CHANGE_BITS - 1)) - 1, 0];
    expect(
      shouldAnalyze({ hash: nearly, nowMs: 1_000, ...at, heartbeat: false }),
    ).toBe(false);
    const changed: FrameHash = [(1 << AUTO_CHANGE_BITS) - 1, 0];
    expect(
      shouldAnalyze({ hash: changed, nowMs: 1_000, ...at, heartbeat: false }),
    ).toBe(true);
    expect(
      shouldAnalyze({
        hash: A,
        nowMs: AUTO_HEARTBEAT_MS,
        ...at,
        heartbeat: false,
      }),
    ).toBe(false);
    expect(
      shouldAnalyze({
        hash: A,
        nowMs: AUTO_HEARTBEAT_MS,
        ...at,
        heartbeat: true,
      }),
    ).toBe(true);
  });
  it("keeps the interval between 3 and 30 s", () => {
    expect([1, 8, 99, Number.NaN].map(clampIntervalSeconds)).toEqual([
      3, 8, 30, 8,
    ]);
  });
});

describe("interval capture", () => {
  it("fires on the interval, uploads the first frame once and drops identical ones", async () => {
    const view = mount();
    await advance(7_900);
    expect(sample).not.toHaveBeenCalled();
    await advance(200);
    expect(capture).toHaveBeenCalledTimes(1);
    await advance(40_000);
    expect(sample.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(view.result.current.line?.text).toMatch(
      /capturing every 8 s · last analyzed/,
    );
  });

  it("analyses a changed frame once, not before the 15 s gap", async () => {
    mount();
    await advance(8_100);
    hash = FAR;
    await advance(8_000);
    expect(capture).toHaveBeenCalledTimes(1);
    await advance(AUTO_MIN_GAP_MS);
    expect(capture).toHaveBeenCalledTimes(2);
    await advance(30_000);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("follows the owner's interval setting", async () => {
    const view = mount();
    act(() => view.result.current.setIntervalSec(3));
    await advance(3_100);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(view.result.current.line?.text).toMatch(/every 3 s/);
  });

  it("a failed capture does not block the next tick, and is not charged", async () => {
    const view = mount();
    captureResult = false;
    await advance(8_100);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(view.result.current.autoCount).toBe(0);
    captureResult = true;
    // The failed attempt still used its gap; the next tick after it retries.
    await advance(AUTO_MIN_GAP_MS + 1_000);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(view.result.current.autoCount).toBe(1);
  });

  it("takes none when paused, device-only or ended, and stops when turned off", async () => {
    for (const over of [
      { paused: true },
      { deviceOnly: true },
      { open: false },
    ])
      mount(over);
    await advance(40_000);
    expect(capture).not.toHaveBeenCalled();
    const view = mount();
    act(() => view.result.current.setOn(false));
    await advance(40_000);
    expect(capture).not.toHaveBeenCalled();
  });

  it("stops at the per-session cap", async () => {
    expect(AUTO_MAX_PER_SESSION).toBe(120);
  });
});

describe("sources", () => {
  const nativeBridge = (watch?: unknown) => {
    (window as { studioHost?: unknown }).studioHost = {
      version: 1,
      hostKind: "native-macos",
      capabilities: ["capture-screen", ...(watch ? ["screen-watch"] : [])],
      captureScreen: async () => ({ ok: false, reason: "unsupported" }),
      pinOnTop: async () => true,
      openExternal: async () => undefined,
      onHotkey: () => () => undefined,
      ...(watch ? { screenWatch: watch } : {}),
    };
  };

  it("native: captures with no browser share at all", async () => {
    nativeBridge();
    mount({ sharing: false });
    await advance(8_100);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("browser: with no share it captures nothing and says to press Share", async () => {
    const view = mount({ sharing: false });
    await advance(20_000);
    expect(capture).not.toHaveBeenCalled();
    expect(view.result.current.line?.text).toMatch(/press Share/);
  });

  it("a host refusal says Grant Screen Recording and the next tick still runs", async () => {
    nativeBridge();
    const denied = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("x"), { code: "permission-denied" }),
      )
      .mockResolvedValue(A);
    const view = mount({ sharing: false, sample: denied });
    await advance(8_100);
    expect(view.result.current.line?.text).toMatch(/Grant Screen Recording/);
    await advance(8_000);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("screen-watch events only trigger an extra tick sooner", async () => {
    let fire: (() => void) | null = null;
    const watch = {
      start: vi.fn(async () => ({ ok: true })),
      stop: vi.fn(async () => undefined),
      status: () => ({ watching: true }),
      onChange: (listener: () => void) => {
        fire = listener;
        return () => undefined;
      },
    };
    nativeBridge(watch);
    mount({ screenWatch: undefined });
    await advance(100);
    expect(watch.start).toHaveBeenCalled();
    act(() => fire?.());
    await advance(50);
    expect(capture).toHaveBeenCalledTimes(1);
  });
});

describe("heard speech", () => {
  it("is submitted by Auto and never drafted into the follow-up box", async () => {
    installRecognition();
    mount({ engineListening: false });
    await advance(100);
    const recognition = FakeRecognition.instances[0];
    expect(recognition).toBeDefined();
    act(() => recognition?.say({ text: "any questions so far?", final: true }));
    await advance(1_000);
    expect(submitHeard).toHaveBeenCalledTimes(1);
    expect(onManualFinal).not.toHaveBeenCalled();
  });

  it("with Auto off, dictation is the typed draft and nothing is submitted", async () => {
    installRecognition();
    window.localStorage.setItem("interview-studio.live.auto.t", "off");
    const view = mount({ engineListening: false });
    act(() => view.result.current.toggleListening());
    const recognition = FakeRecognition.instances[0];
    act(() => recognition?.say({ text: "typed words", final: true }));
    await advance(1_000);
    expect(onManualFinal).toHaveBeenCalledWith("typed words");
    expect(submitHeard).not.toHaveBeenCalled();
  });
});
