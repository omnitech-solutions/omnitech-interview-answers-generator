// Capture, the region geometry, remembered choices and what each companion light
// means: the parts of the overlay that are logic rather than layout.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionView } from "../session-fixtures";
import { companionModel, type SourceStatus } from "../session-sources";
import {
  fakeStream,
  installDisplayMedia,
  installFakeCanvas,
  installVideoSize,
  SECRET_TITLE,
} from "./capture-fixtures";
import {
  loadMask,
  loadSettings,
  saveMask,
  saveSettings,
} from "./capture-prefs";
import {
  FrameError,
  frameLabel,
  grabFrame,
  MAX_LONG_SIDE,
  QUALITIES,
  ShareError,
  sourceKind,
  startShare,
} from "./capture-source";
import {
  clampRect,
  cropPixels,
  describeArea,
  FULL,
  fitSize,
  growRect,
  isFull,
  MIN_SIZE,
  moveRect,
  PRESETS,
  resizeRect,
} from "./mask-geometry";
import { sourceAdvice } from "./overlay-model";

const MiB = 1024 * 1024;
const video = (width: number, height: number) =>
  ({ videoWidth: width, videoHeight: height }) as unknown as HTMLVideoElement;
const deps = {
  createCanvas: () => document.createElement("canvas"),
};

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("grabFrame", () => {
  it("draws the whole source scaled to 1920 px on the long side when there is no region", async () => {
    const canvas = installFakeCanvas();
    const frame = await grabFrame(
      { video: video(3840, 2160), kind: "Window" },
      FULL,
      deps,
    );
    expect(canvas.draws).toHaveLength(1);
    expect(canvas.draws[0]?.args).toEqual([0, 0, 3840, 2160, 0, 0, 1920, 1080]);
    expect(frame).toMatchObject({
      width: 1920,
      height: 1080,
      masked: false,
      label: "Window",
    });
    expect(Math.max(frame.width, frame.height)).toBeLessThanOrEqual(
      MAX_LONG_SIDE,
    );
  });

  it("crops to the region BEFORE scaling, so pixels outside it are never drawn", async () => {
    const canvas = installFakeCanvas();
    const frame = await grabFrame(
      { video: video(3840, 2160), kind: "Tab" },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
      deps,
    );
    // The right half only: 1920 x 2160 of the source, scaled to fit 1920.
    expect(canvas.draws[0]?.args.slice(0, 4)).toEqual([1920, 0, 1920, 2160]);
    expect(frame.width).toBe(1707);
    expect(frame.height).toBe(1920);
    expect(frame.masked).toBe(true);
    expect(frame.label).toBe("Tab · region");
  });

  it("does not upscale a small source", async () => {
    installFakeCanvas();
    const frame = await grabFrame(
      { video: video(800, 600), kind: "Screen" },
      FULL,
      deps,
    );
    expect([frame.width, frame.height]).toEqual([800, 600]);
  });

  it("lowers the quality stepwise until the JPEG is under 2 MiB", async () => {
    const canvas = installFakeCanvas((quality) =>
      quality > 0.6 ? 3 * MiB : MiB,
    );
    const frame = await grabFrame(
      { video: video(1920, 1080), kind: "Window" },
      FULL,
      deps,
    );
    expect(canvas.qualities).toEqual([0.85, 0.7, 0.55]);
    expect(frame.blob.size).toBeLessThanOrEqual(2 * MiB);
    expect(frame.blob.type).toBe("image/jpeg");
  });

  it("shrinks the picture when no quality is small enough, and gives up with too-large", async () => {
    const shrinking = installFakeCanvas((_quality, pixels) =>
      pixels > 1_000_000 ? 3 * MiB : MiB,
    );
    const frame = await grabFrame(
      { video: video(1920, 1080), kind: "Window" },
      FULL,
      deps,
    );
    expect(frame.width * frame.height).toBeLessThanOrEqual(1_000_000);
    expect(shrinking.qualities.length).toBeGreaterThan(QUALITIES.length);
    installFakeCanvas(() => 3 * MiB);
    await expect(
      grabFrame({ video: video(1920, 1080), kind: "Window" }, FULL, deps),
    ).rejects.toMatchObject({ code: "too-large" });
  });

  it("refuses a source that has no picture yet", async () => {
    installFakeCanvas();
    await expect(
      grabFrame({ video: video(0, 0), kind: "Window" }, FULL, deps),
    ).rejects.toBeInstanceOf(FrameError);
  });
});

describe("sharing", () => {
  it("names only the kind of source, never its title", async () => {
    installVideoSize();
    for (const [surface, kind] of [
      ["monitor", "Screen"],
      ["window", "Window"],
      ["browser", "Tab"],
    ] as const) {
      const fake = fakeStream(surface);
      installDisplayMedia(async () => fake.stream);
      const handle = await startShare();
      expect(handle.kind).toBe(kind);
      expect(frameLabel(handle.kind, true)).toBe(`${kind} · region`);
      expect(
        JSON.stringify([handle.kind, frameLabel(handle.kind, false)]),
      ).not.toContain(SECRET_TITLE);
      handle.stop();
    }
    expect(sourceKind(undefined)).toBe("Shared source");
  });

  it("asks for video only, keeps the stream, and tells the owner when the browser stops it", async () => {
    installVideoSize();
    const fake = fakeStream();
    const media = installDisplayMedia(async () => fake.stream);
    const handle = await startShare();
    expect(media).toHaveBeenCalledWith({ video: true, audio: false });
    const ended = vi.fn();
    handle.onEnded(ended);
    fake.endFromBrowser();
    expect(ended).toHaveBeenCalledTimes(1);
    // Stopping again changes nothing.
    handle.stop();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("says why it could not start", async () => {
    installDisplayMedia(undefined);
    await expect(startShare()).rejects.toMatchObject({ code: "unsupported" });
    installDisplayMedia(async () => {
      throw Object.assign(new Error("x"), { name: "NotAllowedError" });
    });
    await expect(startShare()).rejects.toMatchObject({ code: "cancelled" });
    installDisplayMedia(async () => {
      throw new Error("boom");
    });
    await expect(startShare()).rejects.toBeInstanceOf(ShareError);
  });
});

describe("region geometry", () => {
  it("keeps a region inside the source and no smaller than the minimum", () => {
    expect(clampRect({ x: -1, y: 2, w: 3, h: 0 })).toEqual({
      x: 0,
      y: 1 - MIN_SIZE,
      w: 1,
      h: MIN_SIZE,
    });
  });
  it("moves and clamps", () => {
    expect(moveRect({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 0.3, -0.7)).toEqual({
      x: 0.5,
      y: 0,
      w: 0.5,
      h: 0.5,
    });
  });
  it("resizes by an edge or corner with the opposite side fixed", () => {
    const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    expect(resizeRect(start, "e", 0.2, 0)).toEqual({
      x: 0.2,
      y: 0.2,
      w: 0.6,
      h: 0.4,
    });
    expect(resizeRect(start, "nw", -0.1, -0.1)).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.5,
      h: 0.5,
    });
    // Cannot cross the opposite edge.
    expect(resizeRect(start, "w", 5, 0).w).toBe(MIN_SIZE);
  });
  it("grows around its centre", () => {
    const grown = growRect({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 0.1, 0);
    expect(grown).toEqual({ x: 0.35, y: 0.4, w: 0.3, h: 0.2 });
  });
  it("has the six presets, and Full is full", () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual([
      "full",
      "left",
      "right",
      "top",
      "bottom",
      "center",
    ]);
    expect(isFull(PRESETS[0].rect)).toBe(true);
    expect(isFull(PRESETS[1].rect)).toBe(false);
  });
  it("turns a region into whole pixels and fits a long side", () => {
    expect(cropPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 1000, 800)).toEqual({
      sx: 250,
      sy: 400,
      sw: 500,
      sh: 400,
    });
    expect(fitSize(4000, 1000, 1920)).toEqual({ width: 1920, height: 480 });
  });
});

describe("remembered choices", () => {
  it("keeps the region and the hints per tenant", () => {
    saveMask("a", { x: 0.1, y: 0.2, w: 0.5, h: 0.5 });
    saveSettings("a", { skill: "dsa", language: "react" });
    expect(loadMask("a")).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.5 });
    expect(loadSettings("a")).toEqual({ skill: "dsa", language: "react" });
    expect(loadMask("b")).toEqual(FULL);
    expect(loadSettings("b")).toEqual({});
  });
  it("ignores values it does not recognise", () => {
    window.localStorage.setItem(
      "interview-studio.live.capture-mask.a",
      "{nope",
    );
    window.localStorage.setItem(
      "interview-studio.live.capture-settings.a",
      JSON.stringify({ skill: "hacking", language: "cobol" }),
    );
    expect(loadMask("a")).toEqual(FULL);
    expect(loadSettings("a")).toEqual({});
  });
  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveMask("a", FULL)).not.toThrow();
    expect(loadMask("a")).toEqual(FULL);
    expect(loadSettings("a")).toEqual({});
  });
});

describe("what each companion light says", () => {
  const status = (over: Partial<SourceStatus>): SourceStatus => ({
    source: "screen",
    label: "Screen",
    note: "",
    selected: true,
    health: "receiving",
    since: null,
    reason: null,
    gapMs: null,
    lost: false,
    ...over,
  });
  const online = companionModel(
    sessionView({ lastHeartbeatAt: "2026-10-03T12:00:30.000Z" }),
    Date.parse("2026-10-03T12:01:00.000Z"),
  );
  const never = companionModel(
    sessionView(),
    Date.parse("2026-10-03T12:01:00.000Z"),
  );

  it("explains a revoked permission with the exact fix", () => {
    expect(
      sourceAdvice(
        status({
          health: "lost-permission",
          reason: "permission-revoked",
          lost: true,
        }),
        online,
      ),
    ).toMatchObject({
      tone: "red",
      state: "Permission revoked",
      fix: "Permission revoked: allow Screen Recording for the capture companion in System Settings, then restart it.",
    });
    expect(
      sourceAdvice(
        status({
          source: "microphone",
          label: "Microphone",
          health: "lost-permission",
          lost: true,
        }),
        online,
      ).fix,
    ).toContain("allow Microphone");
  });

  it("explains a lost screen device in the companion's terms", () => {
    const advice = sourceAdvice(
      status({ health: "lost", reason: "device-lost", lost: true }),
      online,
    );
    expect(advice.reason).toBe(
      "Device lost: no on-screen window matched the title you selected.",
    );
    expect(advice.fix).toMatch(/pick a window that is on screen/);
  });

  it("explains each other state with a reason, and a fix when something is wrong", () => {
    expect(sourceAdvice(status({}), online)).toMatchObject({
      state: "Receiving",
      fix: null,
    });
    expect(
      sourceAdvice(
        status({ health: "disconnected", reason: "user-stopped" }),
        online,
      ).reason,
    ).toMatch(/You stopped this source/);
    expect(sourceAdvice(status({ health: "waiting" }), never).reason).toMatch(
      /hasn’t made contact/,
    );
    expect(
      sourceAdvice(
        status({ health: "gap", reason: "buffer-overflow", gapMs: 4000 }),
        online,
      ).reason,
    ).toBe("Audio was dropped for 4 s: the companion’s buffer overflowed.");
    expect(
      sourceAdvice(status({ health: "not-selected", selected: false }), online)
        .fix,
    ).toMatch(/new session/);
    for (const health of [
      "receiving",
      "waiting",
      "disconnected",
      "lost-permission",
      "lost",
      "gap",
      "not-selected",
    ] as const) {
      const advice = sourceAdvice(status({ health, reason: "error" }), online);
      expect(advice.reason.length).toBeGreaterThan(10);
      expect(advice.reason.toLowerCase()).not.toBe("disconnected");
    }
  });
});

describe("the area in plain words", () => {
  it("names each preset", () => {
    const shown = Object.fromEntries(
      PRESETS.map((preset) => [
        preset.id,
        describeArea(preset.rect, "the shared screen"),
      ]),
    );
    expect(shown).toEqual({
      full: "Everything on the shared screen",
      left: "Left half of the shared screen",
      right: "Right half of the shared screen",
      top: "Top half of the shared screen",
      bottom: "Bottom half of the shared screen",
      center: "Middle of the shared screen",
    });
  });
  it("describes anything else as a custom area, never as raw coordinates", () => {
    const text = describeArea(
      { x: 0.1, y: 0.2, w: 0.62, h: 0.4 },
      "your main display",
    );
    expect(text).toBe(
      "A custom area of your main display: 62% of the width, 40% of the height",
    );
    expect(text).not.toMatch(/\bat \d+%/);
  });
  it("calls a nearly-half area half", () => {
    expect(
      describeArea({ x: 0, y: 0, w: 0.505, h: 1 }, "the shared screen"),
    ).toBe("Left half of the shared screen");
  });
  it("gives the presets plain names, none of them 'half'", () => {
    expect(PRESETS.map((preset) => preset.label)).toEqual([
      "Everything",
      "Left side",
      "Right side",
      "Top",
      "Bottom",
      "Middle",
    ]);
  });
});
