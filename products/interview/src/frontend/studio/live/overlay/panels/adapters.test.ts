// The presentation contract, passed by every adapter: native (over a fake
// bridge) and the no-op. Each only answers true when it did something.
import type { PresentationHost } from "@omnitech/interview-contracts";
import { afterEach, describe, expect, it } from "vitest";
import { nativePresentation } from "./native-adapter";
import {
  hasCapability,
  noopPresentation,
  selectPresentation,
} from "./presentation-host";

function fakeNative(): PresentationHost & { mode: boolean } {
  const listeners = new Set<(on: boolean) => void>();
  const host = {
    mode: true,
    capabilities: [
      "multi-panel",
      "hit-regions",
      "click-through",
      "bogus",
    ] as never,
    openSettings: async () => true,
    closeSettings: async () => true,
    setVisible: async () => true,
    interactionMode: () => host.mode,
    setInteractionMode: async (on: boolean) => {
      host.mode = on;
      for (const l of listeners) l(on);
      return true;
    },
    onInteractionMode: (l: (on: boolean) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return host as never;
}

const adapters: [string, () => PresentationHost][] = [
  [
    "native",
    () => {
      (window as { studioHost?: unknown }).studioHost = {
        presentation: fakeNative(),
      };
      return nativePresentation() as PresentationHost;
    },
  ],
  ["noop", () => noopPresentation],
];

afterEach(() => {
  delete (window as { studioHost?: unknown }).studioHost;
});

describe.each(adapters)(
  "the %s adapter honours the contract",
  (_name, make) => {
    it("lists only known capabilities, reports a boolean interaction mode, never throws", async () => {
      const host = make();
      expect(host.capabilities.every((c) => !["bogus"].includes(c))).toBe(true);
      expect(typeof host.interactionMode()).toBe("boolean");
      await expect(host.openSettings()).resolves.toEqual(expect.any(Boolean));
      await expect(host.closeSettings()).resolves.toEqual(expect.any(Boolean));
      await expect(host.setVisible(true)).resolves.toEqual(expect.any(Boolean));
      const off = host.onInteractionMode(() => undefined);
      expect(typeof off).toBe("function");
      off();
    });
  },
);

describe("native adapter", () => {
  it("is null without a bridge or with an incomplete one, and refusals are false", async () => {
    expect(nativePresentation()).toBeNull();
    (window as { studioHost?: unknown }).studioHost = {
      presentation: { openSettings() {} },
    };
    expect(nativePresentation()).toBeNull();
    const bridge = fakeNative();
    bridge.closeSettings = async () => {
      throw new Error("boom");
    };
    (window as { studioHost?: unknown }).studioHost = { presentation: bridge };
    const host = nativePresentation() as PresentationHost;
    // "multi-panel" belonged to the removed per-panel windows and the retired "click-through" is no longer known: both are dropped.
    expect(host.capabilities).toEqual(["hit-regions"]);
    await expect(host.closeSettings()).resolves.toBe(false);
  });
  it("passes the optional extras through only when the shell has them", async () => {
    const bridge = fakeNative() as PresentationHost & Record<string, unknown>;
    (window as { studioHost?: unknown }).studioHost = { presentation: bridge };
    const bare = nativePresentation() as PresentationHost;
    expect(bare.quit).toBeUndefined();
    expect(bare.setWindowSize).toBeUndefined();
    expect(bare.setFullScreen).toBeUndefined();
    let quits = 0;
    bridge.quit = async () => {
      quits += 1;
      return true;
    };
    bridge.setWindowSize = async () => {
      throw new Error("boom");
    };
    bridge.setFullScreen = async () => {
      throw new Error("boom");
    };
    const full = nativePresentation() as PresentationHost;
    await expect(full.setFullScreen?.(true)).resolves.toBe(false);
    await expect(full.quit?.()).resolves.toBe(true);
    expect(quits).toBe(1);
    await expect(full.setWindowSize?.({ width: 500 })).resolves.toBe(false);
  });
  it("follows interaction mode changes, and is preferred by selectPresentation", async () => {
    const bridge = fakeNative();
    (window as { studioHost?: unknown }).studioHost = { presentation: bridge };
    const host = selectPresentation();
    expect(hasCapability(host, "hit-regions")).toBe(true);
    const seen: boolean[] = [];
    host.onInteractionMode((on) => seen.push(on));
    await host.setInteractionMode(false);
    expect(seen).toEqual([false]);
    expect(host.interactionMode()).toBe(false);
  });
  it("falls back to the no-op without a shell", () => {
    expect(selectPresentation()).toBe(noopPresentation);
  });
});
