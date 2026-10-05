import { describe, expect, it } from "vitest";
import {
  isStudioHostDisplayId,
  negotiatePresentation,
  negotiateStudioHost,
  STUDIO_HOST_VERSION,
} from "./studio-host.js";

const bridge = (over: Record<string, unknown> = {}) => ({
  version: STUDIO_HOST_VERSION,
  hostKind: "native-macos",
  capabilities: ["capture-screen", "pin-on-top", "hotkeys", "open-external"],
  captureScreen: async () => ({ ok: false, reason: "unsupported" }),
  pinOnTop: async () => true,
  openExternal: async () => undefined,
  onHotkey: () => () => undefined,
  ...over,
});

describe("negotiateStudioHost", () => {
  it("accepts a complete bridge and lists its capabilities", () => {
    const info = negotiateStudioHost(bridge());
    expect([...(info?.capabilities ?? [])].sort()).toEqual([
      "capture-screen",
      "hotkeys",
      "open-external",
      "pin-on-top",
    ]);
  });

  it("ignores no bridge, a wrong version and an unknown kind", () => {
    expect(negotiateStudioHost(undefined)).toBeNull();
    expect(negotiateStudioHost("studio")).toBeNull();
    expect(negotiateStudioHost(bridge({ version: 2 }))).toBeNull();
    expect(negotiateStudioHost(bridge({ hostKind: "toaster" }))).toBeNull();
    expect(negotiateStudioHost(bridge({ capabilities: "all" }))).toBeNull();
  });

  it("drops unknown capabilities and ones whose method is missing", () => {
    const info = negotiateStudioHost(
      bridge({
        capabilities: ["capture-screen", "teleport", "pin-on-top"],
        pinOnTop: undefined,
      }),
    );
    expect([...(info?.capabilities ?? [])]).toEqual(["capture-screen"]);
  });
});

describe("screen-watch capability", () => {
  const watch = {
    start: async () => ({ ok: true }),
    stop: async () => undefined,
    status: () => ({ watching: false }),
    onChange: () => () => undefined,
  };
  it("is available only with a complete screenWatch object", () => {
    const names = ["capture-screen", "screen-watch"];
    expect(
      negotiateStudioHost(
        bridge({ capabilities: names, screenWatch: watch }),
      )?.capabilities.has("screen-watch"),
    ).toBe(true);
    for (const bad of [undefined, {}, { ...watch, onChange: undefined }])
      expect(
        negotiateStudioHost(
          bridge({ capabilities: names, screenWatch: bad }),
        )?.capabilities.has("screen-watch"),
      ).toBe(false);
  });
  it("is not assumed from the object alone", () => {
    expect(
      negotiateStudioHost(bridge({ screenWatch: watch }))?.capabilities.has(
        "screen-watch",
      ),
    ).toBe(false);
  });
});

describe("isStudioHostDisplayId", () => {
  it("accepts a short opaque id and refuses anything else", () => {
    expect(isStudioHostDisplayId("69733250.2")).toBe(true);
    for (const bad of ["", "a b", "x".repeat(65), 5, undefined, "a/b"])
      expect(isStudioHostDisplayId(bad)).toBe(false);
  });
});

describe("negotiatePresentation (the one-window presentation)", () => {
  const presentation = (over: Record<string, unknown> = {}) => ({
    capabilities: ["click-through", "always-on-top", "multi-panel", "bogus"],
    nativeToasts: true,
    openSettings: async () => true,
    closeSettings: async () => true,
    setVisible: async () => true,
    interactionMode: () => true,
    setInteractionMode: async () => true,
    onInteractionMode: () => () => undefined,
    ...over,
  });

  it("keeps the known capabilities in contract order and drops the rest", () => {
    // "multi-panel" belonged to the removed per-panel windows.
    expect(negotiatePresentation(presentation())?.capabilities).toEqual([
      "always-on-top",
      "click-through",
    ]);
  });

  it("requires every window method and carries the optional extras only when present", () => {
    expect(negotiatePresentation(null)).toBeNull();
    expect(negotiatePresentation({})).toBeNull();
    for (const missing of [
      "openSettings",
      "closeSettings",
      "setVisible",
      "interactionMode",
      "setInteractionMode",
      "onInteractionMode",
    ])
      expect(
        negotiatePresentation(presentation({ [missing]: undefined })),
      ).toBeNull();
    const bare = negotiatePresentation(presentation());
    expect(bare?.setWindowSize).toBeUndefined();
    expect(bare?.quit).toBeUndefined();
    const full = negotiatePresentation(
      presentation({
        setWindowSize: async () => true,
        quit: async () => true,
        appMode: () => "minified",
      }),
    );
    expect(typeof full?.setWindowSize).toBe("function");
    expect(typeof full?.quit).toBe("function");
    expect(full?.appMode?.()).toBe("minified");
  });

  it("does not offer the removed panel, layout or opacity operations", () => {
    const host = negotiatePresentation(
      presentation({
        open: async () => true,
        setLayout: async () => true,
        setOpacity: async () => true,
        opacity: () => 0.5,
      }),
    ) as Record<string, unknown>;
    for (const removed of ["open", "setLayout", "setOpacity", "opacity"])
      expect(host[removed]).toBeUndefined();
  });
});
