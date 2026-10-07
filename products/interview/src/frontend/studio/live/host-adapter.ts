// The Studio side of the host adapter contract (ADR-0019). A native shell that
// hosts the overlay route injects `window.studioHost`; this file reads it, and
// is the only place the frontend does. Without it (a browser, an installed web
// app) every function here reports "no host" and the page behaves as before.
import {
  isScreenWatchHost,
  isStudioHostDisplay,
  isStudioHostDisplayId,
  type LiveOcrBlock,
  negotiateStudioHost,
  type ScreenWatchHost,
  type StudioHostCaptureIntent,
  type StudioHostCaptureRequest,
  type StudioHostDisplay,
  type StudioHostDisplayId,
  type StudioHostDisplayListResult,
  type StudioHostHotkey,
  type StudioHostInfo,
} from "@omnitech/interview-contracts";
import { noteCaptureResult, noteSource } from "./host-display";
import { FULL, isFull, type Rect } from "./overlay/mask-geometry";
import { noteScreenProblem } from "./screen-problems";
import { cleanFrontApp } from "./shared/capture-problem";
import { ocrBlockForHostCapture } from "./shared/text-recognizer";

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
  | {
      ok: true;
      blob: Blob;
      masked: boolean;
      // The text the shell read from these bytes (with its metrics), when it did.
      ocr: LiveOcrBlock | null;
    }
  | {
      ok: false;
      reason:
        | "unavailable"
        | "permission-denied"
        | "no-focused-window"
        | "display-changed"
        | "busy"
        | "timeout"
        | "failed";
      // On "no-focused-window": the name of the application that was in front.
      frontApp?: string;
    };

// How long the page waits for the shell to answer one capture. The shell's own
// budget is a few seconds (capture, then on-device text); past this the shell
// is not answering, and the person is told so instead of watching a spinner.
export const HOST_CAPTURE_TIMEOUT_MS = 20_000;

async function withinTimeout<T>(call: Promise<T>): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), HOST_CAPTURE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Asks the host for one fresh image. The host crops to the region before it
// encodes; nothing here is stored. `intent` "explicit" is the person's own press
// (the shell may then use the last focused browser); the default, "auto", looks
// only while a browser is in front.
export async function captureThroughHost(
  mask: Rect = FULL,
  intent: StudioHostCaptureIntent = "auto",
): Promise<HostFrame> {
  const info = studioHostInfo();
  if (!info?.capabilities.has("capture-screen"))
    return { ok: false, reason: "unavailable" };
  let result: Awaited<ReturnType<typeof info.host.captureScreen>>;
  const request = {
    ...captureRequestFor(mask, knownDisplayId),
    ...(intent === "explicit" ? { intent } : {}),
  };
  try {
    const answer = await withinTimeout(info.host.captureScreen(request));
    if (answer === "timeout") return { ok: false, reason: "timeout" };
    result = answer;
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
  noteCaptureResult(result);
  if (!result.ok) {
    if (result.reason === "no-focused-window") {
      const frontApp = cleanFrontApp(result.frontApp);
      return {
        ok: false,
        reason: "no-focused-window",
        ...(frontApp ? { frontApp } : {}),
      };
    }
    return {
      ok: false,
      reason:
        result.reason === "permission-denied" || result.reason === "busy"
          ? result.reason
          : "failed",
    };
  }
  try {
    const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
    return {
      ok: true,
      blob: await fitFrame(new Blob([bytes], { type: result.mediaType })),
      masked: !isFull(mask),
      ocr: ocrBlockForHostCapture(result.ocr),
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

// Whether the host can open an address in the person's own apps (for the one
// Screen Recording settings address, see capture-problem.ts).
export const canOpenExternalThroughHost = (): boolean =>
  studioHostInfo()?.capabilities.has("open-external") ?? false;

// ---- Which display to capture (D33, "display-selection") ----------------------

export function displaySelectionAvailable(): boolean {
  return studioHostInfo()?.capabilities.has("display-selection") ?? false;
}

// One display as the picker draws it: the thumbnail is already a data: URL, held
// by the component that asked and dropped when the menu closes.
export type DisplayChoice = {
  display: StudioHostDisplay;
  thumbnailSrc: string;
};

// The pin the shell reports with a listing, handed to the page's source state.
// Only a uint32 or null is believed; an older shell says nothing and nothing changes.
function notePinFrom(result: StudioHostDisplayListResult & { ok: true }): void {
  const { pinnedDisplayId } = result;
  if (pinnedDisplayId === undefined) return;
  if (pinnedDisplayId !== null && !isStudioHostDisplayId(pinnedDisplayId))
    return;
  noteSource({
    kind: "pin",
    pinnedId: pinnedDisplayId,
    display: result.displays
      .map((entry) => entry.display)
      .find((d) => isStudioHostDisplay(d) && d.id === pinnedDisplayId),
    pinFallback: result.pinFallback,
  });
}

// Reads the shell's pin without a preview being captured (`thumbnails: false`),
// so it may run on mount, before any menu is open. Never throws; failure leaves
// the state as it was.
export async function syncHostPin(): Promise<void> {
  const info = studioHostInfo();
  if (!info?.capabilities.has("display-selection") || !info.host.listDisplays)
    return;
  try {
    const result = await info.host.listDisplays({ thumbnails: false });
    if (result.ok) {
      notePinFrom(result);
      noteScreenProblem({ kind: "permission-granted" });
    }
  } catch {
    // The picker still lists on demand; the pin shows after the first capture.
  }
}

export type DisplayListing =
  | { ok: true; displays: DisplayChoice[] }
  | { ok: false; reason: "permission-denied" | "capture-failed" };

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

// Previews of every display, or an honest reason. A shell that answers with
// anything unexpected is a failure, never a half-drawn menu. [SAFETY] Nothing
// is kept or logged here: the thumbnails belong to the caller.
export async function listHostDisplays(): Promise<DisplayListing> {
  const info = studioHostInfo();
  if (!info?.capabilities.has("display-selection") || !info.host.listDisplays)
    return { ok: false, reason: "capture-failed" };
  try {
    const result = await info.host.listDisplays();
    if (!result.ok) {
      if (result.reason === "permission-denied")
        noteScreenProblem({ kind: "problem", problem: "permission-missing" });
      return {
        ok: false,
        reason:
          result.reason === "permission-denied"
            ? "permission-denied"
            : "capture-failed",
      };
    }
    notePinFrom(result);
    noteScreenProblem({ kind: "permission-granted" });
    const displays: DisplayChoice[] = [];
    for (const preview of result.displays) {
      const { thumbnail } = preview;
      if (
        !isStudioHostDisplay(preview.display) ||
        thumbnail?.mediaType !== "image/jpeg" ||
        typeof thumbnail.base64 !== "string" ||
        !BASE64.test(thumbnail.base64)
      )
        return { ok: false, reason: "capture-failed" };
      displays.push({
        display: preview.display,
        thumbnailSrc: `data:image/jpeg;base64,${thumbnail.base64}`,
      });
    }
    return { ok: true, displays };
  } catch {
    return { ok: false, reason: "capture-failed" };
  }
}

// Pins capture to a display, or null to follow the browser again. The shell's
// answer is the source of truth and is echoed to the page's copy of it.
export async function setHostCaptureDisplay(
  displayId: StudioHostDisplayId | null,
): Promise<"ok" | "display-unavailable" | "failed"> {
  const info = studioHostInfo();
  if (
    !info?.capabilities.has("display-selection") ||
    !info.host.setCaptureDisplay
  )
    return "failed";
  try {
    const result = await info.host.setCaptureDisplay(displayId);
    noteSource({ kind: "select", result });
    return result.ok ? "ok" : "display-unavailable";
  } catch {
    return "failed";
  }
}
