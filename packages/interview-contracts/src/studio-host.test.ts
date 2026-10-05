import { describe, expect, it } from "vitest";
import { liveOcrBlockSchema } from "./live-session";
import {
  displayLabel,
  HIT_REGION_LIMITS,
  isStudioHostDisplay,
  isStudioHostDisplayId,
  negotiatePresentation,
  negotiateStudioHost,
  STUDIO_HOST_CAPABILITIES,
  STUDIO_HOST_VERSION,
  type StudioHostDisplayListResult,
  type StudioHostOcr,
} from "./studio-host";

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
  it("accepts an unsigned 32-bit integer and refuses anything else", () => {
    for (const good of [0, 1, 69_733_378, 0xffff_ffff])
      expect(isStudioHostDisplayId(good)).toBe(true);
    for (const bad of [
      "69733250",
      -1,
      1.5,
      0x1_0000_0000,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      null,
      undefined,
    ])
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
    // "multi-panel" belonged to the removed per-panel windows; "click-through" is retired
    // (an old shell may still advertise it) and is dropped too.
    expect(negotiatePresentation(presentation())?.capabilities).toEqual([
      "always-on-top",
    ]);
    expect(
      negotiatePresentation(
        presentation({ capabilities: ["hit-regions", "all-spaces"] }),
      )?.capabilities,
    ).toEqual(["all-spaces", "hit-regions"]);
  });

  it("carries setHitRegions only when the shell has it, and the wire limits are the shell's", async () => {
    expect(
      negotiatePresentation(presentation())?.setHitRegions,
    ).toBeUndefined();
    const sent: unknown[] = [];
    const host = negotiatePresentation(
      presentation({
        setHitRegions: async (regions: unknown) => {
          sent.push(regions);
          return true;
        },
      }),
    );
    expect(
      await host?.setHitRegions?.([{ x: 1, y: 2, width: 3, height: 4 }]),
    ).toBe(true);
    expect(await host?.setHitRegions?.(null)).toBe(true);
    expect(sent).toEqual([[{ x: 1, y: 2, width: 3, height: 4 }], null]);
    // HitRegions.swift (StudioShellCore) bounds a report by the same numbers.
    expect(HIT_REGION_LIMITS).toEqual({ maxRects: 64, maxSide: 20000 });
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
    expect(bare?.setFullScreen).toBeUndefined();
    const full = negotiatePresentation(
      presentation({
        setWindowSize: async () => true,
        setFullScreen: async () => true,
        quit: async () => true,
        appMode: () => "minified",
      }),
    );
    expect(typeof full?.setWindowSize).toBe("function");
    expect(typeof full?.setFullScreen).toBe("function");
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

describe("text-recognition capability", () => {
  it("is available only when the shell lists it and offers recognizeText", () => {
    const names = ["capture-screen", "text-recognition"];
    expect(
      negotiateStudioHost(
        bridge({
          capabilities: names,
          recognizeText: async () => ({ ok: false, reason: "unavailable" }),
        }),
      )?.capabilities.has("text-recognition"),
    ).toBe(true);
    expect(
      negotiateStudioHost(bridge({ capabilities: names }))?.capabilities.has(
        "text-recognition",
      ),
    ).toBe(false);
    expect(
      negotiateStudioHost(
        bridge({ recognizeText: async () => ({ ok: false }) }),
      )?.capabilities.has("text-recognition"),
    ).toBe(false);
  });

  it("passes the shell's recognizeText through negotiation untouched", async () => {
    const result = {
      ok: true,
      engine: "vision",
      text: "hello",
      confidence: 0.9,
      truncated: false,
    };
    const info = negotiateStudioHost(
      bridge({
        capabilities: ["text-recognition"],
        recognizeText: async () => result,
      }),
    );
    expect(
      await info?.host.recognizeText?.({
        mediaType: "image/png",
        base64: "AA",
      }),
    ).toEqual(result);
  });
});

describe("ocr metrics (D35)", () => {
  // Parity with the shell: OcrMetrics.wire in apps/studio-shell
  // (OcrMetrics.swift) sends exactly these four keys under `metrics`, and
  // liveOcrBlockSchema accepts exactly what the shell sends.
  const metrics = {
    coverage: 0.5,
    meanConfidence: 0.9,
    largestGap: 0.1,
    boxes: 3,
  };
  const block = {
    engine: "vision",
    text: "a",
    confidence: 0.9,
    truncated: false,
  };

  it("the shell's ocr block, with or without metrics, passes the request schema", () => {
    const { truncated: _truncated, ...wire } = block;
    expect(liveOcrBlockSchema.safeParse({ ...wire, metrics }).success).toBe(
      true,
    );
    expect(liveOcrBlockSchema.safeParse(wire).success).toBe(true);
  });

  it("metrics are bounded numbers and a closed shape", () => {
    const { truncated: _truncated, ...wire } = block;
    for (const bad of [
      { ...metrics, coverage: 1.01 },
      { ...metrics, meanConfidence: -0.1 },
      { ...metrics, largestGap: 2 },
      { ...metrics, boxes: -1 },
      { ...metrics, boxes: 1.5 },
      { ...metrics, boxes: 100_001 },
      { ...metrics, coverage: Number.NaN },
      { ...metrics, extra: 1 },
      { coverage: 1, meanConfidence: 1, largestGap: 0 },
    ])
      expect(
        liveOcrBlockSchema.safeParse({ ...wire, metrics: bad }).success,
      ).toBe(false);
  });

  it("the contract type carries optional metrics, so an older shell still types", () => {
    const old: StudioHostOcr = {
      engine: "vision",
      text: "x",
      confidence: 1,
      truncated: false,
    };
    const next: StudioHostOcr = { ...old, metrics };
    expect(Object.keys(next.metrics ?? {}).sort()).toEqual([
      "boxes",
      "coverage",
      "largestGap",
      "meanConfidence",
    ]);
  });
});

describe("capability names", () => {
  // The Swift shell's HostCapability (StudioShellCore/HostBridge.swift) lists these
  // same names in this order; its test pins the same literal list.
  it("are the ones the shell advertises", () => {
    expect([...STUDIO_HOST_CAPABILITIES]).toEqual([
      "capture-screen",
      "pin-on-top",
      "hotkeys",
      "open-external",
      "screen-watch",
      "text-recognition",
      "display-selection",
    ]);
  });
});

describe("display indicator and selection", () => {
  const display = { id: 2, name: "DELL U2723QE", index: 2, count: 3 };

  it("accepts exactly the closed display object", () => {
    expect(isStudioHostDisplay(display)).toBe(true);
    expect(isStudioHostDisplay({ ...display, title: "Inbox" })).toBe(false);
    expect(isStudioHostDisplay({ id: 2, name: "x", index: 2 })).toBe(false);
    expect(isStudioHostDisplay({ ...display, index: 0 })).toBe(false);
    expect(isStudioHostDisplay({ ...display, index: 4 })).toBe(false);
    expect(isStudioHostDisplay({ ...display, id: -1 })).toBe(false);
    expect(isStudioHostDisplay({ ...display, name: "x".repeat(65) })).toBe(
      false,
    );
    expect(isStudioHostDisplay(null)).toBe(false);
    expect(isStudioHostDisplay([display])).toBe(false);
  });

  it("labels 'Display n of m', or just the name for one display", () => {
    expect(displayLabel(display)).toBe("Display 2 of 3");
    expect(
      displayLabel({ id: 1, name: "Studio Display", index: 1, count: 1 }),
    ).toBe("Studio Display");
  });

  it("a listing may carry the pin and omit thumbnails (type-level)", () => {
    const withPin: StudioHostDisplayListResult = {
      ok: true,
      displays: [{ display }],
      pinnedDisplayId: null,
      pinFallback: "display-unavailable",
    };
    const pinned: StudioHostDisplayListResult = {
      ok: true,
      displays: [],
      pinnedDisplayId: 2,
    };
    expect(isStudioHostDisplayId(2)).toBe(true);
    expect([withPin.ok, pinned.ok]).toEqual([true, true]);
  });

  it("offers display-selection only when its method exists", () => {
    expect(STUDIO_HOST_CAPABILITIES).toContain("display-selection");
    const listed = negotiateStudioHost(
      bridge({ capabilities: ["display-selection"] }),
    );
    expect([...(listed?.capabilities ?? [])]).toEqual([]);
    const withMethod = negotiateStudioHost(
      bridge({
        capabilities: ["display-selection"],
        listDisplays: async () => ({ ok: true, displays: [] }),
      }),
    );
    expect([...(withMethod?.capabilities ?? [])]).toEqual([
      "display-selection",
    ]);
  });
});
