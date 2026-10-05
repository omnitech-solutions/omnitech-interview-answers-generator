// The Studio side of the host adapter (ADR-0019): without window.studioHost the
// page is unchanged; with it, capture goes through the host and nothing else.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureRequestFor,
  captureThroughHost,
  forgetHostDisplay,
  nativeCaptureAvailable,
  onHostHotkey,
  openExternalThroughHost,
  shareMenuCopy,
} from "./host-adapter";
import { FrameError } from "./overlay/capture-source";
import { FULL } from "./overlay/mask-geometry";
import { startNativeShare } from "./overlay/native-share";

const JPEG_BASE64 = btoa("\xff\xd8\xff\xe0JFIF");

function installHost(over: Record<string, unknown> = {}) {
  const host = {
    version: 1,
    hostKind: "native-macos",
    capabilities: ["capture-screen", "hotkeys", "open-external", "pin-on-top"],
    captureScreen: vi.fn(async () => ({
      ok: true,
      mediaType: "image/jpeg",
      base64: JPEG_BASE64,
    })),
    pinOnTop: vi.fn(async () => true),
    openExternal: vi.fn(async () => undefined),
    onHotkey: vi.fn(() => () => undefined),
    ...over,
  };
  window.studioHost = host;
  return host;
}

afterEach(() => {
  forgetHostDisplay();
  delete window.studioHost;
});

describe("without a host", () => {
  it("offers the browser's picker and no native capture", async () => {
    expect(nativeCaptureAvailable()).toBe(false);
    expect(shareMenuCopy().label).toBe("Share a window, tab or screen…");
    expect(await captureThroughHost()).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(openExternalThroughHost("https://example.com")).toBe(false);
    expect(onHostHotkey(() => undefined)()).toBeUndefined();
  });

  it("ignores a bridge it does not speak", () => {
    window.studioHost = { version: 99 };
    expect(nativeCaptureAvailable()).toBe(false);
  });
});

describe("with a native host", () => {
  it("offers 'This Mac (native)'", () => {
    installHost();
    expect(nativeCaptureAvailable()).toBe(true);
    expect(shareMenuCopy().label).toBe("This Mac (native)");
  });

  it("asks for the whole display with a full mask, a region otherwise", () => {
    expect(captureRequestFor(FULL)).toEqual({ mode: "display" });
    expect(captureRequestFor({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 })).toEqual({
      mode: "region",
      region: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
    });
  });

  it("returns the host's image as a JPEG blob", async () => {
    const host = installHost();
    const frame = await captureThroughHost({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(frame.ok && frame.blob.type).toBe("image/jpeg");
    expect(frame.ok && frame.blob.size).toBe(8);
    expect(frame.ok && frame.masked).toBe(true);
    expect(host.captureScreen).toHaveBeenCalledWith({
      mode: "region",
      region: { x: 0, y: 0, width: 0.5, height: 0.5 },
    });
  });

  it("maps a refusal, a throw and bad bytes to a reason", async () => {
    installHost({
      captureScreen: async () => ({ ok: false, reason: "no-focused-window" }),
    });
    expect(await captureThroughHost()).toEqual({
      ok: false,
      reason: "no-focused-window",
    });
    installHost({
      captureScreen: async () => {
        throw new Error("bridge down");
      },
    });
    expect(await captureThroughHost()).toEqual({ ok: false, reason: "failed" });
    installHost({
      captureScreen: async () => ({
        ok: true,
        mediaType: "image/jpeg",
        base64: "***",
      }),
    });
    expect(await captureThroughHost()).toEqual({ ok: false, reason: "failed" });
  });

  it("forwards hotkeys and external links", () => {
    const host = installHost();
    const listener = vi.fn();
    onHostHotkey(listener);
    expect(host.onHotkey).toHaveBeenCalledWith(listener);
    expect(openExternalThroughHost("https://example.com")).toBe(true);
    expect(host.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("does not offer a capability the host did not list", () => {
    installHost({ capabilities: ["pin-on-top"] });
    expect(nativeCaptureAvailable()).toBe(false);
    expect(openExternalThroughHost("https://example.com")).toBe(false);
  });
});

describe("the native share source", () => {
  it("labels frames by kind, never by title", async () => {
    installHost();
    vi.stubGlobal(
      "MediaStream",
      class {
        getTracks() {
          return [];
        }
      },
    );
    const share = startNativeShare();
    expect(share.kind).toBe("This Mac");
    expect((await share.grab(FULL)).label).toBe("This Mac");
    expect((await share.grab({ x: 0, y: 0, w: 0.5, h: 0.5 })).label).toBe(
      "This Mac · region",
    );
    const ended = vi.fn();
    share.onEnded(ended);
    share.stop();
    expect(ended).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("reports a failed capture as a frame error", async () => {
    installHost({
      captureScreen: async () => ({ ok: false, reason: "permission-denied" }),
    });
    vi.stubGlobal("MediaStream", class {});
    await expect(startNativeShare().grab(FULL)).rejects.toBeInstanceOf(
      FrameError,
    );
    vi.unstubAllGlobals();
  });
});

describe("the display a region belongs to", () => {
  const region = { x: 0, y: 0, w: 0.5, h: 0.5 };
  it("sends back the display of the last result with a region request", async () => {
    const host = installHost({
      captureScreen: vi.fn(async () => ({
        ok: true,
        mediaType: "image/jpeg",
        base64: JPEG_BASE64,
        displayId: 69_733_378,
      })),
    });
    await captureThroughHost(FULL);
    await captureThroughHost(region);
    expect(host.captureScreen).toHaveBeenLastCalledWith({
      mode: "region",
      region: { x: 0, y: 0, width: 0.5, height: 0.5 },
      displayId: 69_733_378,
    });
  });

  it("ignores a display id that is not a display number", async () => {
    const host = installHost({
      captureScreen: vi.fn(async () => ({
        ok: true,
        mediaType: "image/jpeg",
        base64: JPEG_BASE64,
        displayId: "display-1",
      })),
    });
    await captureThroughHost(FULL);
    await captureThroughHost(region);
    expect(host.captureScreen).toHaveBeenLastCalledWith({
      mode: "region",
      region: { x: 0, y: 0, width: 0.5, height: 0.5 },
    });
  });

  it("reports a refused region as a display change and forgets the display", async () => {
    let refuse = false;
    const host = installHost({
      captureScreen: vi.fn(async () =>
        refuse
          ? { ok: false, reason: "capture-failed" }
          : {
              ok: true,
              mediaType: "image/jpeg",
              base64: JPEG_BASE64,
              displayId: 69_733_378,
            },
      ),
    });
    await captureThroughHost(FULL);
    refuse = true;
    expect(await captureThroughHost(region)).toEqual({
      ok: false,
      reason: "display-changed",
    });
    await captureThroughHost(region);
    // Forgotten: the next request carries no display, so a plain failure.
    expect(host.captureScreen).toHaveBeenLastCalledWith({
      mode: "region",
      region: { x: 0, y: 0, width: 0.5, height: 0.5 },
    });
  });
});
