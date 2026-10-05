// The Studio side of the host adapter contract (ADR-0019). A native shell that
// hosts the overlay route injects `window.studioHost`; this file reads it, and
// is the only place the frontend does. Without it (a browser, an installed web
// app) every function here reports "no host" and the page behaves as before.
import {
  isScreenWatchHost,
  isStudioHostDisplayId,
  negotiateStudioHost,
  type ScreenWatchHost,
  type StudioHostCaptureRequest,
  type StudioHostDisplayId,
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

// The host's screen watch, when it offers one: Auto uses it instead of the
// browser's frame sampler.
export function screenWatchHost(): ScreenWatchHost | null {
  const info = studioHostInfo();
  if (!info?.capabilities.has("screen-watch")) return null;
  const watch = info.host.screenWatch;
  return isScreenWatchHost(watch) ? watch : null;
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

// A full mask asks for the whole main display, like OpenCluely: the simplest
// capture, with no "which window" guess to get wrong (the shell leaves its own
// windows out). A partial mask asks for that region of the main display.
export function captureRequestFor(
  mask: Rect,
  displayId: StudioHostDisplayId | null = null,
): StudioHostCaptureRequest {
  if (isFull(mask)) return { mode: "display" };
  return {
    mode: "region",
    region: { x: mask.x, y: mask.y, width: mask.w, height: mask.h },
    ...(displayId !== null ? { displayId } : {}),
  };
}

// The display the host last captured from. A region is drawn relative to it, so
// it is sent back with each region request; the host refuses a region when the
// main display has changed, and the caller then drops the stored area. Kept in
// memory only.
let knownDisplayId: StudioHostDisplayId | null = null;
export const forgetHostDisplay = (): void => {
  knownDisplayId = null;
};

// A capture the server accepts is at most 2 MiB (maxOwnerCaptureBytes). A
// retina window can encode larger, so an oversize image is re-encoded smaller
// here, before it is sent; nothing else about it changes.
const HOST_FRAME_MAX_BYTES = 1_800_000;
export async function fitFrame(
  blob: Blob,
  maxBytes: number = HOST_FRAME_MAX_BYTES,
): Promise<Blob> {
  if (blob.size <= maxBytes || typeof createImageBitmap !== "function")
    return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    let scale = Math.sqrt(maxBytes / blob.size) * 0.9;
    let best = blob;
    for (let attempt = 0; attempt < 4 && best.size > maxBytes; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas
        .getContext("2d")
        ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const next = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.8),
      );
      if (!next) break;
      best = next;
      scale *= 0.8;
    }
    bitmap.close?.();
    return best;
  } catch {
    return blob;
  }
}

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
  if (
    !result.ok &&
    request.displayId !== undefined &&
    result.reason === "capture-failed"
  ) {
    knownDisplayId = null;
    return { ok: false, reason: "display-changed" };
  }
  if (result.ok && isStudioHostDisplayId(result.displayId))
    knownDisplayId = result.displayId;
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
      blob: await fitFrame(new Blob([bytes], { type: result.mediaType })),
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
