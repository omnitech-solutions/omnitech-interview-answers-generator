// The Studio side of the host adapter contract (ADR-0019). A native shell that
// hosts the overlay route injects `window.studioHost`; this file reads it, and
// is the only place the frontend does. Without it (a browser, an installed web
// app) every function here reports "no host" and the page behaves as before.
import {
  negotiateStudioHost,
  type StudioHostCaptureRequest,
  type StudioHostHotkey,
  type StudioHostInfo,
} from "@omnitech/interview-contracts";
import { FULL, isFull, type Rect } from "./overlay/mask-geometry";

declare global {
  interface Window {
    studioHost?: unknown;
  }
}

// The negotiated host, or null. Read on each call: the bridge is injected before
// the page runs, and a test or a host may replace it.
export function studioHostInfo(): StudioHostInfo | null {
  if (typeof window === "undefined") return null;
  return negotiateStudioHost(window.studioHost);
}

export function nativeCaptureAvailable(): boolean {
  return studioHostInfo()?.capabilities.has("capture-screen") ?? false;
}

// What the capture menu's first row says: the host's source when there is one,
// the browser's picker otherwise.
export function shareMenuCopy(): { label: string; sub: string } {
  return nativeCaptureAvailable()
    ? {
        label: "This Mac (native)",
        sub: "The window you are in, or your region of the main display; captured on this Mac and cropped before it is sent",
      }
    : {
        label: "Share a window, tab or screen…",
        sub: "Your browser asks once; the preview stays on this device",
      };
}

// A full mask asks for the focused window; a partial one for that region of the
// main display (the same meaning as the companion's two modes in ADR-0018).
export function captureRequestFor(
  mask: Rect,
  displayId: string | null = null,
): StudioHostCaptureRequest {
  if (isFull(mask)) return { mode: "focused-window" };
  return {
    mode: "region",
    region: { x: mask.x, y: mask.y, width: mask.w, height: mask.h },
    ...(displayId ? { displayId } : {}),
  };
}

// The display the host last captured from. A region is drawn relative to it, so
// it is sent back with each region request; the host refuses a region when the
// main display has changed, and the caller then drops the stored area. Kept in
// memory only.
let knownDisplayId: string | null = null;
export const hostDisplayId = (): string | null => knownDisplayId;
export const forgetHostDisplay = (): void => {
  knownDisplayId = null;
};

export type HostFrame =
  | { ok: true; blob: Blob; masked: boolean }
  | {
      ok: false;
      reason:
        | "unavailable"
        | "permission-denied"
        | "no-focused-window"
        | "display-changed"
        | "failed";
    };

// Asks the host for one fresh image. The host crops to the region before it
// encodes; nothing here is stored.
export async function captureThroughHost(
  mask: Rect = FULL,
): Promise<HostFrame> {
  const info = studioHostInfo();
  if (!info || !info.capabilities.has("capture-screen"))
    return { ok: false, reason: "unavailable" };
  let result: Awaited<ReturnType<typeof info.host.captureScreen>>;
  const request = captureRequestFor(mask, knownDisplayId);
  try {
    result = await info.host.captureScreen(request);
  } catch {
    return { ok: false, reason: "failed" };
  }
  // A region the host would not apply to the display it now captures: the area
  // no longer means what the person drew.
  if (!result.ok && request.displayId && result.reason === "capture-failed") {
    knownDisplayId = null;
    return { ok: false, reason: "display-changed" };
  }
  if (result.ok && result.displayId) knownDisplayId = result.displayId;
  if (!result.ok)
    return {
      ok: false,
      reason:
        result.reason === "permission-denied" ||
        result.reason === "no-focused-window"
          ? result.reason
          : "failed",
    };
  try {
    const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
    return {
      ok: true,
      blob: new Blob([bytes], { type: result.mediaType }),
      masked: !isFull(mask),
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

// Calls `listener` for each system-wide key press the host registered.
export function onHostHotkey(
  listener: (hotkey: StudioHostHotkey) => void,
): () => void {
  const info = studioHostInfo();
  if (!info?.capabilities.has("hotkeys")) return () => undefined;
  return info.host.onHotkey(listener);
}

// Links open in the person's browser from a native window; elsewhere the page
// keeps its normal behaviour (returns false).
export function openExternalThroughHost(url: string): boolean {
  const info = studioHostInfo();
  if (!info?.capabilities.has("open-external")) return false;
  void info.host.openExternal(url).catch(() => undefined);
  return true;
}
