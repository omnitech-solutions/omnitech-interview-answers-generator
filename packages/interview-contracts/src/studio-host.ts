// The host adapter contract (ADR-0019): what a native shell that hosts the one
// overlay route (ADR-0017) offers the Studio frontend as `window.studioHost`.
// A shell fulfils capture and window chrome; it owns no session state, makes no
// assist request and calls no model. Every frame it returns is posted by the
// page to the existing owner-authenticated capture route, so masking-before-send,
// locality, stale protection and persistence stay Studio's (ADR-0018).
//
// A browser and an installed web app have no bridge: `window.studioHost` is
// absent and the page uses the browser's own capture, as before.
import type { LiveCaptureMode, LiveCaptureRegion } from "./live-session";

// Bumps only on an incompatible change. A page ignores a bridge it does not know.
export const STUDIO_HOST_VERSION = 1;

export const STUDIO_HOST_KINDS = ["native-macos"] as const;
export type StudioHostKind = (typeof STUDIO_HOST_KINDS)[number];

export const STUDIO_HOST_CAPABILITIES = [
  "capture-screen",
  "pin-on-top",
  "hotkeys",
  "open-external",
  "screen-watch",
  "text-recognition",
  "display-selection",
] as const;
export type StudioHostCapability = (typeof STUDIO_HOST_CAPABILITIES)[number];

// A mode and, exactly when the mode is "region", a region normalised to the
// main display. The shell crops before it encodes, so pixels outside never
// reach the page.
export type StudioHostCaptureRequest = {
  mode: LiveCaptureMode;
  region?: LiveCaptureRegion | undefined;
  // The display the region was drawn on, echoed from an earlier result. A shell
  // that is now capturing a different display refuses with "capture-failed"
  // rather than apply the region to it.
  displayId?: StudioHostDisplayId | undefined;
  // Why the capture was asked for. "explicit" is the person's own press (the
  // capture button, the hotkey, Add screenshot): the shell may then capture the
  // last focused browser even when another app is in front. Absent means
  // automatic, which looks only while a browser is in front.
  intent?: StudioHostCaptureIntent | undefined;
};

export type StudioHostCaptureIntent = "explicit" | "auto";

// A display identifier is the system's display number (CGDirectDisplayID): an
// unsigned 32-bit integer, echoed back unchanged and carrying no content.
export type StudioHostDisplayId = number;
export const isStudioHostDisplayId = (
  value: unknown,
): value is StudioHostDisplayId =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 0xffff_ffff;

// Which display a frame came from (user request, D32). The name is the system's
// display name, never a window title or an address. `index` is 1-based in the
// system's screen order, out of `count` displays.
export type StudioHostDisplay = {
  id: StudioHostDisplayId;
  name: string;
  index: number;
  count: number;
};

// [GUARD] A closed object: exactly these four keys with sane values.
export const isStudioHostDisplay = (
  value: unknown,
): value is StudioHostDisplay => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const display = value as Partial<StudioHostDisplay>;
  const { id, name, index, count } = display;
  return (
    Object.keys(value).length === 4 &&
    isStudioHostDisplayId(id) &&
    typeof name === "string" &&
    name.length <= 64 &&
    typeof index === "number" &&
    typeof count === "number" &&
    Number.isInteger(index) &&
    Number.isInteger(count) &&
    index >= 1 &&
    index <= count
  );
};

// "Display 2 of 3", or just the name when it is the only display.
export const displayLabel = (display: StudioHostDisplay): string =>
  display.count > 1
    ? `Display ${display.index} of ${display.count}`
    : display.name;

// Why a pin was dropped (closed): the pinned display is gone, so capture follows
// the last-focused browser again.
type StudioHostPinFallback = "display-unavailable";

// Why a capture produced nothing. "no-focused-window" is never widened to the
// whole display.
export const STUDIO_HOST_CAPTURE_FAILURES = [
  "permission-denied",
  "no-focused-window",
  "capture-failed",
  "unsupported",
  // Another capture was already running; this one was refused, not queued.
  "busy",
] as const;
export type StudioHostCaptureFailure =
  (typeof STUDIO_HOST_CAPTURE_FAILURES)[number];

// On-device text of one image (decision D31): Apple Vision in the native shell.
// Machine-read, so it may contain errors. `text` is in reading order and bounded
// (20,000 characters); `truncated` says it was cut at a line boundary.
export type StudioHostOcr = {
  engine: "vision";
  text: string;
  // Mean recognition confidence, 0..1.
  confidence: number;
  truncated: boolean;
  // Where the text sits in the frame (D35), measured from Vision's text boxes
  // on a 32x32 grid: numbers only, each 0..1 except `boxes`. Optional so an
  // older shell, which sends none, still works (the server then sends images).
  metrics?: StudioHostOcrMetrics | undefined;
};

type StudioHostOcrMetrics = {
  // Fraction of the frame touched by a text box.
  coverage: number;
  meanConfidence: number;
  // Area fraction of the largest rectangle no text box touches.
  largestGap: number;
  // Number of non-empty text boxes.
  boxes: number;
};

export type StudioHostCaptureResult =
  | {
      ok: true;
      mediaType: "image/jpeg";
      base64: string;
      // The display the frame was taken from, when the shell can name it.
      displayId?: StudioHostDisplayId | undefined;
      // The same display, named for an indicator; absent when the shell cannot say.
      display?: StudioHostDisplay | undefined;
      // True when the person pinned capture to a display ("display-selection").
      pinned?: boolean | undefined;
      // Present once, on the first capture after a pin was dropped.
      pinFallback?: StudioHostPinFallback | undefined;
      // The text read from these same bytes before they were handed over. Absent
      // when recognition was unavailable or ran out of time: the capture itself
      // never waits on it or fails because of it.
      ocr?: StudioHostOcr | undefined;
    }
  | {
      ok: false;
      reason: StudioHostCaptureFailure;
      // On "no-focused-window": the NAME of the application that was in front
      // (at most STUDIO_HOST_FRONT_APP_MAX characters), so the page can say what
      // to leave. Never a window title or an address.
      frontApp?: string | undefined;
    };

export const STUDIO_HOST_FRONT_APP_MAX = 64;

// Key presses the shell registered system-wide, passed to the page as events.
// "capture-analyze" is the original; the dotted names are the typed command set
// the pages understand (panels/commands.ts). The page owns the skill: the shell
// only relays `skill.next` / `skill.prev`.
export type StudioHostHotkey =
  | "capture-analyze"
  | "auto.toggle"
  | "capture.analyze"
  | "solution.generate"
  | "transcribe.toggle"
  | "skill.next"
  | "skill.prev"
  | "session.clear"
  | "chat.focus"
  | "see-through.toggle";

// An image as the page holds it from a capture (or a crop it encoded itself).
export type StudioHostImage = {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
};

type StudioHostTextRecognitionResult =
  | ({ ok: true } & StudioHostOcr)
  | {
      ok: false;
      reason: "too-large" | "unreadable" | "timeout" | "unavailable";
    };

// A small owner-visible preview of one display (320 px long edge at most), for a
// picker only. The page holds it in memory; it is never capture input.
type StudioHostDisplayPreview = {
  display: StudioHostDisplay;
  // Absent when the list was asked with `thumbnails: false` (no capture taken).
  thumbnail?: { mediaType: "image/jpeg"; base64: string } | undefined;
};

export type StudioHostDisplayListResult =
  | {
      ok: true;
      displays: StudioHostDisplayPreview[];
      // The pin in force; null follows the browser. The shell re-checks a saved
      // pin against the live displays first. Absent from an older shell.
      pinnedDisplayId?: StudioHostDisplayId | null | undefined;
      // The saved pin's display is gone: dropped, reported once (as a capture does).
      pinFallback?: StudioHostPinFallback | undefined;
    }
  | { ok: false; reason: "permission-denied" | "capture-failed" };

// The pin now in force: `display` is present exactly when pinned.
export type StudioHostDisplaySelectResult =
  | { ok: true; pinned: boolean; display?: StudioHostDisplay | undefined }
  | { ok: false; reason: "display-unavailable" };

export type StudioHost = {
  readonly version: typeof STUDIO_HOST_VERSION;
  readonly hostKind: StudioHostKind;
  readonly capabilities: readonly StudioHostCapability[];
  captureScreen(
    request: StudioHostCaptureRequest,
  ): Promise<StudioHostCaptureResult>;
  // Each display, the pin in force and, unless `thumbnails` is false, a preview
  // of each ("display-selection"). With `thumbnails: false` nothing is captured,
  // so the page may ask on mount to show the pin.
  listDisplays?(request?: {
    thumbnails?: boolean;
  }): Promise<StudioHostDisplayListResult>;
  // Pins capture (Manual and Auto) to a display; null follows the last-focused
  // browser again ("display-selection").
  setCaptureDisplay?(
    displayId: StudioHostDisplayId | null,
  ): Promise<StudioHostDisplaySelectResult>;
  // Keeps the window above others; resolves to the state now in force.
  pinOnTop(pinned: boolean): Promise<boolean>;
  // Opens an http(s) address in the person's default browser.
  openExternal(url: string): Promise<void>;
  // Reads the text of an image on the device, when the shell can ("text-recognition").
  // A refusal is a typed result, never a throw. Only the image's type and bytes cross.
  recognizeText?(
    image: StudioHostImage,
  ): Promise<StudioHostTextRecognitionResult>;
  // Returns the remover.
  onHotkey(listener: (hotkey: StudioHostHotkey) => void): () => void;
  // The window presentation, when the shell offers one (below).
  readonly presentation?: PresentationHost;
  // The hands-free engine, when the shell embeds one (below).
  readonly engine?: EngineHost;
  // Watches the screen for change, when the shell can (below). The page uses it
  // instead of the browser's frame sampler.
  readonly screenWatch?: ScreenWatchHost;
};

// ---- Screen watch -----------------------------------------------------------
// The shell samples the focused window (or the owner's region) on its own timer
// and reports only that the picture changed and settled, as a content-free
// event: a time and a difference in bits. It sends no pixels; a capture is
// still one `captureScreen` request the page makes. Studio's gate (rate limit,
// cap, one in flight, pause, device-only) decides whether a change is captured.
export type ScreenWatchRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScreenWatchOptions = {
  mode: "focused-window" | "region";
  // Exactly when the mode is "region", normalised to the display.
  region?: ScreenWatchRegion | undefined;
  displayId?: StudioHostDisplayId | undefined;
  intervalMs?: number | undefined;
};

export const SCREEN_WATCH_FAILURES = [
  "permission-denied",
  "no-focused-window",
  "display-changed",
  "invalid",
] as const;
export type ScreenWatchFailure = (typeof SCREEN_WATCH_FAILURES)[number];

export type ScreenWatchResult =
  | { ok: true }
  | { ok: false; reason: ScreenWatchFailure };

export type ScreenWatchEvent = {
  at: number;
  bits: number;
  // The display the settled change was seen on, when the shell can say.
  display?: StudioHostDisplay | undefined;
};

export type ScreenWatchHost = {
  start(options: ScreenWatchOptions): Promise<ScreenWatchResult>;
  stop(): Promise<void>;
  status(): { watching: boolean; reason?: string | undefined };
  // Returns the remover.
  onChange(listener: (event: ScreenWatchEvent) => void): () => void;
};

// [GUARD] A watch object with every method, or null.
export function isScreenWatchHost(value: unknown): value is ScreenWatchHost {
  if (typeof value !== "object" || value === null) return false;
  const host = value as Partial<ScreenWatchHost>;
  return (
    typeof host.start === "function" &&
    typeof host.stop === "function" &&
    typeof host.status === "function" &&
    typeof host.onChange === "function"
  );
}

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
    "screen-watch": "screenWatch",
    "text-recognition": "recognizeText",
    "display-selection": "listDisplays",
  };
  const capabilities = new Set<StudioHostCapability>();
  for (const name of host.capabilities as unknown[]) {
    const known = STUDIO_HOST_CAPABILITIES.find((each) => each === name);
    if (!known) continue;
    const member = host[method[known]];
    if (
      known === "screen-watch"
        ? isScreenWatchHost(member)
        : typeof member === "function"
    )
      capabilities.add(known);
  }
  return { host: host as StudioHost, capabilities };
}

// ---- Presentation (the native windows) ---------------------------------------
// How a native shell presents the Active Session: ONE compact window (the
// overlay route with `?panel=single`) plus a small Settings window beside it
// (`?panel=settings`). A page reads CAPABILITIES, never the host's name.
// Presentation changes window behaviour only; it never touches the session.
export const PRESENTATION_CAPABILITIES = [
  "always-on-top",
  // Retired: the whole-window click-through (old shells advertised "click-through").
  // See-through works by region ("hit-regions"); the shell refuses to make the whole
  // window inert, and a page ignores the old name.
  "all-spaces",
  // The page reports the rectangles of its painted surfaces (setHitRegions); the
  // window takes the mouse over them and passes it to the page underneath
  // everywhere else.
  "hit-regions",
] as const;
export type PresentationCapability = (typeof PRESENTATION_CAPABILITIES)[number];

// One rectangle of the window's content, in CSS px from its top-left corner.
export type HitRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// What the shell accepts in one report (HitRegions.swift states the same
// numbers): at most `maxRects` rectangles, each side at most `maxSide`.
export const HIT_REGION_LIMITS = { maxRects: 64, maxSide: 20000 } as const;

export type PresentationHost = {
  readonly capabilities: readonly PresentationCapability[];
  // True when the shell shows its own toasts (interaction mode, recording); a page must not duplicate them.
  readonly nativeToasts?: boolean;
  // Each resolves to whether it took effect; none throws for a refusal.
  openSettings(): Promise<boolean>;
  closeSettings(): Promise<boolean>;
  setVisible(visible: boolean): Promise<boolean>;
  // Interaction mode: true when the window takes clicks. It is always true: the
  // shell refuses `setInteractionMode(false)` (the whole-window click-through is retired).
  interactionMode(): boolean;
  setInteractionMode(on: boolean): Promise<boolean>;
  // Returns the remover.
  onInteractionMode(listener: (on: boolean) => void): () => void;
  // Optional extras a shell may offer. "minified" is the hands-free state: only
  // the compact window shows and Auto is the default.
  appMode?(): PresentationAppMode;
  setAppMode?(mode: PresentationAppMode): Promise<boolean>;
  setHotkeysEnabled?(enabled: boolean): Promise<boolean>;
  // The one-window view: asks for this size (CSS px). The window widens or
  // narrows evenly about its centre, so the toolbar at the top stays put. A
  // `height` fits the window to its content from the top edge; without one the
  // window returns to the height it had before.
  setWindowSize?(size: { width: number; height?: number }): Promise<boolean>;
  // Full screen of the one window: it fills the visible frame of the display it
  // is on (not a macOS Space) and `false` restores the frame it had. The shell
  // reports nothing back; the page owns the mode.
  setFullScreen?(on: boolean): Promise<boolean>;
  // Quits the app (the Settings window's Quit button).
  quit?(): Promise<boolean>;
  // The rectangles of every painted or interactive surface. The window takes
  // the mouse only over them; `null` makes the whole window interactive again.
  // The shell falls back to interactive when reports stop, so a page repeats
  // its report while it wants pass-through.
  setHitRegions?(regions: readonly HitRegion[] | null): Promise<boolean>;
};

export const PRESENTATION_APP_MODES = ["expanded", "minified"] as const;
export type PresentationAppMode = (typeof PRESENTATION_APP_MODES)[number];

// [GUARD] Accepts a presentation object with every method; unknown capability
// names are dropped. null for anything else.
export function negotiatePresentation(
  candidate: unknown,
): PresentationHost | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const host = candidate as Partial<PresentationHost>;
  const methods: (keyof PresentationHost)[] = [
    "openSettings",
    "closeSettings",
    "setVisible",
    "interactionMode",
    "setInteractionMode",
    "onInteractionMode",
  ];
  if (!Array.isArray(host.capabilities)) return null;
  if (methods.some((name) => typeof host[name] !== "function")) return null;
  const capabilities = PRESENTATION_CAPABILITIES.filter((name) =>
    (host.capabilities as unknown[]).includes(name),
  );
  const inner = host as PresentationHost;
  return {
    capabilities,
    ...(host.nativeToasts === true ? { nativeToasts: true } : {}),
    openSettings: () => inner.openSettings(),
    closeSettings: () => inner.closeSettings(),
    setVisible: (visible) => inner.setVisible(visible),
    interactionMode: () => inner.interactionMode(),
    setInteractionMode: (on) => inner.setInteractionMode(on),
    onInteractionMode: (listener) => inner.onInteractionMode(listener),
    ...(typeof inner.appMode === "function"
      ? { appMode: () => inner.appMode?.() ?? "expanded" }
      : {}),
    ...(typeof inner.setAppMode === "function"
      ? {
          setAppMode: (mode: PresentationAppMode) =>
            inner.setAppMode?.(mode) ?? Promise.resolve(false),
        }
      : {}),
    ...(typeof inner.setHotkeysEnabled === "function"
      ? {
          setHotkeysEnabled: (on: boolean) =>
            inner.setHotkeysEnabled?.(on) ?? Promise.resolve(false),
        }
      : {}),
    ...(typeof inner.setWindowSize === "function"
      ? {
          setWindowSize: (size: { width: number; height?: number }) =>
            inner.setWindowSize?.(size) ?? Promise.resolve(false),
        }
      : {}),
    ...(typeof inner.setFullScreen === "function"
      ? {
          setFullScreen: (on: boolean) =>
            inner.setFullScreen?.(on) ?? Promise.resolve(false),
        }
      : {}),
    ...(typeof inner.quit === "function"
      ? { quit: () => inner.quit?.() ?? Promise.resolve(false) }
      : {}),
    ...(typeof inner.setHitRegions === "function"
      ? {
          setHitRegions: (regions: readonly HitRegion[] | null) =>
            inner.setHitRegions?.(regions) ?? Promise.resolve(false),
        }
      : {}),
  };
}

// ---- Engine (hands-free listening and watching) ------------------------------
// The shell embeds the capture companion's engine. Studio decides: the page
// starts it for one session and the sources the owner chose, and stops, holds
// or resumes it; the shell executes and reports typed state. The pairing
// credential is obtained natively through the owner-signed-in routes and never
// crosses this bridge. The session's own pause and end stay authoritative in
// Studio: they reach the engine in Studio's acknowledgements.
export const ENGINE_SOURCE_NAMES = [
  "microphone",
  "application-audio",
  "screen",
] as const;

export const ENGINE_PAIRING_STATES = [
  "idle",
  "waiting-for-sign-in",
  "pairing",
  "paired",
  "renewing",
  "unreachable",
  "failed",
  "stopped",
  "ended",
] as const;
export type EnginePairingState = (typeof ENGINE_PAIRING_STATES)[number];

export const ENGINE_SOURCE_HEALTH = [
  "off",
  "starting",
  "listening",
  "lost",
  "permission-denied",
  "unavailable",
] as const;
export type EngineSourceHealth = (typeof ENGINE_SOURCE_HEALTH)[number];

export const ENGINE_START_REFUSALS = [
  "invalid-session",
  "no-sources",
  "signed-out",
  "gone",
  "store-failed",
] as const;
export type EngineStartRefusal = (typeof ENGINE_START_REFUSALS)[number];

// Bounded and content-free: closed names and numbers only, no text, no credential.
export type EngineState = {
  v: 1;
  pairing: EnginePairingState;
  listening: boolean;
  paused: boolean;
  sources: {
    microphone: EngineSourceHealth;
    "system-audio": EngineSourceHealth;
    screen: EngineSourceHealth;
  };
  lastHeardAgeSeconds: number | null;
  // One plain line naming the one action needed ("Grant Microphone in System
  // Settings"), or null.
  hint: string | null;
  speech?: string | undefined;
};

export type EngineReply =
  | { ok: true; engine: EngineState }
  | { ok: false; reason: EngineStartRefusal };

export type EngineHost = {
  start(request: {
    sessionId: string;
    sources: readonly (typeof ENGINE_SOURCE_NAMES)[number][];
  }): Promise<EngineReply>;
  stop(): Promise<EngineReply>;
  pause(): Promise<EngineReply>;
  resume(): Promise<EngineReply>;
  status(): Promise<EngineReply>;
  // Typed events as state changes. Returns the remover.
  onEvent(listener: (state: EngineState) => void): () => void;
};
