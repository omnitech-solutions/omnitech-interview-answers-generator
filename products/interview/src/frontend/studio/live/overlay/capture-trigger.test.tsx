// One press of the capture key is one capture, whichever routes carry it.
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimCaptureTrigger,
  resetCaptureTrigger,
  TRIGGER_WINDOW_MS,
} from "./capture-trigger";
import { useHostHotkeys } from "./use-host-hotkeys";

// A host that lets a test press the system-wide key.
function installHost() {
  const listeners = new Set<(hotkey: "capture-analyze") => void>();
  window.studioHost = {
    version: 1,
    hostKind: "native-macos",
    capabilities: ["capture-screen", "hotkeys"],
    captureScreen: vi.fn(),
    pinOnTop: vi.fn(),
    openExternal: vi.fn(),
    onHotkey: (listener: (hotkey: "capture-analyze") => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return () => {
    for (const listener of [...listeners]) listener("capture-analyze");
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetCaptureTrigger();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.studioHost;
});

describe("the capture trigger", () => {
  it("grants once per window, however many routes ask", async () => {
    const results = await Promise.all([
      claimCaptureTrigger(),
      claimCaptureTrigger(),
      claimCaptureTrigger(),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(TRIGGER_WINDOW_MS + 1);
    expect(await claimCaptureTrigger()).toBe(true);
  });

  it("refuses when another window already holds the grant", async () => {
    vi.stubGlobal("navigator", {
      locks: {
        request: (
          _name: string,
          _options: unknown,
          run: (lock: unknown) => unknown,
        ) => Promise.resolve(run(null)),
      },
    });
    expect(await claimCaptureTrigger()).toBe(false);
  });

  it("takes a Web Lock for the window when the browser has them", async () => {
    const held: string[] = [];
    vi.stubGlobal("navigator", {
      locks: {
        request: (
          name: string,
          _options: unknown,
          run: (lock: unknown) => unknown,
        ) => {
          held.push(name);
          return Promise.resolve(run({}));
        },
      },
    });
    expect(await claimCaptureTrigger()).toBe(true);
    expect(held).toEqual(["interview-studio.capture-trigger"]);
  });

  it("the system-wide key and the card's own key press together make one capture", async () => {
    const press = installHost();
    const onAnalyze = vi.fn();
    renderHook(() => useHostHotkeys(onAnalyze));
    // The card's own Alt+Shift+A keydown claims the same grant.
    const keydown = claimCaptureTrigger();
    press();
    await vi.advanceTimersByTimeAsync(0);
    expect(await keydown).toBe(true);
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it("two cards in one host (tab and overlay) share the one hotkey grant", async () => {
    const press = installHost();
    const first = vi.fn();
    const second = vi.fn();
    renderHook(() => useHostHotkeys(first));
    renderHook(() => useHostHotkeys(second));
    press();
    await vi.advanceTimersByTimeAsync(0);
    expect(first.mock.calls.length + second.mock.calls.length).toBe(1);
  });

  it("a hidden page never handles the hotkey", async () => {
    const press = installHost();
    const onAnalyze = vi.fn();
    renderHook(() => useHostHotkeys(onAnalyze));
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    press();
    await vi.advanceTimersByTimeAsync(0);
    expect(onAnalyze).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
