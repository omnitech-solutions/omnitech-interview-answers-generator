// The host adapter contract (ADR-0019): what a native shell that hosts the one
// overlay route (ADR-0017) offers the Studio frontend as `window.studioHost`.
// A shell fulfils capture and window chrome; it owns no session state, makes no
// assist request and calls no model. Every frame it returns is posted by the
// page to the existing owner-authenticated capture route, so masking-before-send,
// locality, stale protection and persistence stay Studio's (ADR-0018).
//
// A browser and an installed web app have no bridge: `window.studioHost` is
// absent and the page uses the browser's own capture, as before.
import type { LiveCaptureMode, LiveCaptureRegion } from "./live-session.js";

// Bumps only on an incompatible change. A page ignores a bridge it does not know.
export const STUDIO_HOST_VERSION = 1;

export const STUDIO_HOST_KINDS = ["native-macos"] as const;
export type StudioHostKind = (typeof STUDIO_HOST_KINDS)[number];

export const STUDIO_HOST_CAPABILITIES = [
  "capture-screen",
  "pin-on-top",
  "hotkeys",
  "open-external",
] as const;
export type StudioHostCapability = (typeof STUDIO_HOST_CAPABILITIES)[number];

// A mode and, exactly when the mode is "region", a region normalised to the
// main display. The shell crops before it encodes, so pixels outside never
// reach the page.
export type StudioHostCaptureRequest = {
  mode: LiveCaptureMode;
  region?: LiveCaptureRegion | undefined;
};

// Why a capture produced nothing. "no-focused-window" is never widened to the
// whole display.
export const STUDIO_HOST_CAPTURE_FAILURES = [
  "permission-denied",
  "no-focused-window",
  "capture-failed",
  "unsupported",
] as const;
export type StudioHostCaptureFailure =
  (typeof STUDIO_HOST_CAPTURE_FAILURES)[number];

export type StudioHostCaptureResult =
  | { ok: true; mediaType: "image/jpeg"; base64: string }
  | { ok: false; reason: StudioHostCaptureFailure };

// Key presses the shell registered system-wide, passed to the page as events.
export type StudioHostHotkey = "capture-analyze";

export type StudioHost = {
  readonly version: typeof STUDIO_HOST_VERSION;
  readonly hostKind: StudioHostKind;
  readonly capabilities: readonly StudioHostCapability[];
  captureScreen(
    request: StudioHostCaptureRequest,
  ): Promise<StudioHostCaptureResult>;
  // Keeps the window above others; resolves to the state now in force.
  pinOnTop(pinned: boolean): Promise<boolean>;
  // Opens an http(s) address in the person's default browser.
  openExternal(url: string): Promise<void>;
  // Returns the remover.
  onHotkey(listener: (hotkey: StudioHostHotkey) => void): () => void;
};

// What a page may rely on after negotiation.
export type StudioHostInfo = {
  host: StudioHost;
  capabilities: ReadonlySet<StudioHostCapability>;
};

// [GUARD] Accepts a bridge only at a version this page speaks, from a kind it
// knows, with every method it will call. Unknown capability names are dropped, so
// a newer shell with extra features still works with this page. A capability is
// available only when it is listed and its method exists.
export function negotiateStudioHost(candidate: unknown): StudioHostInfo | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const host = candidate as Partial<StudioHost>;
  if (host.version !== STUDIO_HOST_VERSION) return null;
  if (!STUDIO_HOST_KINDS.includes(host.hostKind as StudioHostKind)) return null;
  if (!Array.isArray(host.capabilities)) return null;
  const method: Record<StudioHostCapability, keyof StudioHost> = {
    "capture-screen": "captureScreen",
    "pin-on-top": "pinOnTop",
    hotkeys: "onHotkey",
    "open-external": "openExternal",
  };
  const capabilities = new Set<StudioHostCapability>();
  for (const name of host.capabilities as unknown[]) {
    const known = STUDIO_HOST_CAPABILITIES.find((each) => each === name);
    if (known && typeof host[method[known]] === "function")
      capabilities.add(known);
  }
  return { host: host as StudioHost, capabilities };
}
