import { describe, expect, it } from "vitest";
import {
  isStudioHostDisplayId,
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
