// The presentation contract, passed by every adapter: PiP, native (over a fake
// bridge) and the no-op. Each only answers true when it did something.
import type { PresentationHost } from "@omnitech/interview-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nativePresentation } from "./native-adapter";
import { createPipPresentation } from "./pip-adapter";
import {
  hasCapability,
  noopPresentation,
  selectPresentation,
} from "./presentation-host";

function fakeNative(): PresentationHost & { mode: boolean } {
  const open = new Set<string>(["pill"]);
  const listeners = new Set<(on: boolean) => void>();
  const host = {
    mode: true,
    capabilities: ["multi-panel", "click-through", "bogus"] as never,
    open: async (p: string) => (open.add(p), true),
    close: async (p: string) => (p === "pill" ? false : open.delete(p)),
    focus: async (p: string) => open.has(p),
    openPanels: () => [...open] as never,
    setLayout: async () => true,
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
  ["pip", () => createPipPresentation({ closeWindow: () => undefined }).host],
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
      expect(Array.isArray(host.openPanels())).toBe(true);
      await expect(host.open("analysis")).resolves.toEqual(expect.any(Boolean));
      await expect(host.close("analysis")).resolves.toEqual(
        expect.any(Boolean),
      );
      await expect(host.focus("chat")).resolves.toEqual(expect.any(Boolean));
      await expect(host.setLayout("compact")).resolves.toEqual(
        expect.any(Boolean),
      );
      const off = host.onInteractionMode(() => undefined);
      expect(typeof off).toBe("function");
      off();
    });
    it("never closes the pill", async () => {
      await expect(make().close("pill")).resolves.toBe(false);
    });
  },
);

describe("pip adapter", () => {
  it("shows the pill plus the one active panel and has no multi-panel", async () => {
    const pip = createPipPresentation({ closeWindow: () => undefined });
    expect(hasCapability(pip.host, "multi-panel")).toBe(false);
    expect(pip.host.openPanels()).toEqual(["pill"]);
    const seen = vi.fn();
    pip.subscribe(seen);
    await pip.host.open("analysis");
    await pip.host.open("chat");
    expect(pip.active()).toBe("chat");
    expect(pip.host.openPanels()).toEqual(["pill", "chat"]);
    await pip.host.close("chat");
    expect(pip.active()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(3);
    expect(await pip.host.setInteractionMode(false)).toBe(false);
    expect(pip.host.interactionMode()).toBe(true);
  });
  it("asks the float host to close the window when hidden", async () => {
    const closeWindow = vi.fn();
    const pip = createPipPresentation({ closeWindow });
    await pip.host.setVisible(true);
    expect(closeWindow).not.toHaveBeenCalled();
    await pip.host.setVisible(false);
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });
});

describe("native adapter", () => {
  it("is null without a bridge or with an incomplete one, and refusals are false", async () => {
    expect(nativePresentation()).toBeNull();
    (window as { studioHost?: unknown }).studioHost = {
      presentation: { open() {} },
    };
    expect(nativePresentation()).toBeNull();
    const bridge = fakeNative();
    bridge.open = async () => {
      throw new Error("boom");
    };
    (window as { studioHost?: unknown }).studioHost = { presentation: bridge };
    const host = nativePresentation() as PresentationHost;
    expect(host.capabilities).toEqual(["multi-panel", "click-through"]);
    await expect(host.open("chat")).resolves.toBe(false);
  });
  it("follows interaction mode changes, and is preferred by selectPresentation", async () => {
    const bridge = fakeNative();
    (window as { studioHost?: unknown }).studioHost = { presentation: bridge };
    const host = selectPresentation(null);
    expect(hasCapability(host, "click-through")).toBe(true);
    const seen: boolean[] = [];
    host.onInteractionMode((on) => seen.push(on));
    await host.setInteractionMode(false);
    expect(seen).toEqual([false]);
    expect(host.interactionMode()).toBe(false);
  });
  it("falls back to the given PiP host, then to the no-op", () => {
    const pip = createPipPresentation({ closeWindow: () => undefined }).host;
    expect(selectPresentation(pip)).toBe(pip);
    expect(selectPresentation(null)).toBe(noopPresentation);
  });
});
