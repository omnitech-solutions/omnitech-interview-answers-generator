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
  "screen-watch",
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
  displayId?: string | undefined;
};

// A display identifier is opaque, short and made of a safe alphabet, so it can
// be echoed and stored without carrying content.
export const STUDIO_HOST_DISPLAY_ID_MAX_CHARS = 64;
const DISPLAY_ID = /^[A-Za-z0-9._:-]+$/;
export const isStudioHostDisplayId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= STUDIO_HOST_DISPLAY_ID_MAX_CHARS &&
  DISPLAY_ID.test(value);

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
  | {
      ok: true;
      mediaType: "image/jpeg";
      base64: string;
      // The display the frame was taken from, when the shell can name it.
      displayId?: string | undefined;
    }
  | { ok: false; reason: StudioHostCaptureFailure };

// Key presses the shell registered system-wide, passed to the page as events.
// "capture-analyze" is the original; the dotted names are the typed command set
// the pages understand (panels/commands.ts), and `skill.set:<skill id | auto>`
// picks one skill.
export type StudioHostHotkey =
  | "capture-analyze"
  | "auto.toggle"
  | "capture.analyze"
  | "solution.generate"
  | "transcribe.toggle"
  | "skill.next"
  | "skill.prev"
  | "session.clear"
  | "panel.toggle"
  | `skill.set:${string}`;

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
  // The multi-panel presentation, when the shell offers one (below).
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
  displayId?: number | undefined;
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

export type ScreenWatchEvent = { at: number; bits: number };

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

// ---- Presentation (the OpenCluely-style panels) -----------------------------
// One core interface for how the Active Session is presented: four focused
// panels (the one overlay route with `?panel=`). A host adapts it: a native
// shell opens each as a translucent window, Document Picture-in-Picture maps
// them onto one window (the pill plus the active panel), the tab card has none.
// A panel view reads CAPABILITIES, never the host's name. Presentation changes
// layout and window behaviour only; it never touches the session.
export const PRESENTATION_PANELS = [
  "pill",
  "analysis",
  "chat",
  "settings",
] as const;
export type PresentationPanel = (typeof PRESENTATION_PANELS)[number];

export const PRESENTATION_LAYOUTS = ["compact", "reading", "all"] as const;
export type PresentationLayout = (typeof PRESENTATION_LAYOUTS)[number];

export const PRESENTATION_CAPABILITIES = [
  // Several panels may be open at once (otherwise one at a time beside the pill).
  "multi-panel",
  "always-on-top",
  // Interaction mode: panels accept clicks, or pass them to the window beneath.
  "click-through",
  "all-spaces",
] as const;
export type PresentationCapability = (typeof PRESENTATION_CAPABILITIES)[number];

export type PresentationHost = {
  readonly capabilities: readonly PresentationCapability[];
  // True when the shell shows its own toasts (interaction mode, recording,
  // skill changes); a page must not duplicate them.
  readonly nativeToasts?: boolean;
  // Each resolves to whether it took effect; none throws for a refusal.
  open(panel: PresentationPanel): Promise<boolean>;
  close(panel: PresentationPanel): Promise<boolean>;
  focus(panel: PresentationPanel): Promise<boolean>;
  openPanels(): readonly PresentationPanel[];
  // "compact": the pill. "reading": pill and analysis. "all": pill, analysis
  // and chat.
  setLayout(layout: PresentationLayout): Promise<boolean>;
  setVisible(visible: boolean): Promise<boolean>;
  // Interaction mode: true when panels take clicks. A host without
  // "click-through" is always true and refuses to change it.
  interactionMode(): boolean;
  setInteractionMode(on: boolean): Promise<boolean>;
  // Returns the remover.
  onInteractionMode(listener: (on: boolean) => void): () => void;
  // Optional extras a shell may offer. "minified" is the hands-free state: only
  // the pill shows and Auto is the default.
  appMode?(): PresentationAppMode;
  setAppMode?(mode: PresentationAppMode): Promise<boolean>;
  setHotkeysEnabled?(enabled: boolean): Promise<boolean>;
  // Panel opacity, 0.3 to 1.
  opacity?(): number;
  setOpacity?(value: number): Promise<boolean>;
  // The one-window view: asks for this width (CSS px). The window widens or
  // narrows evenly about its centre, so the toolbar at the top stays put.
  setWindowWidth?(width: number): Promise<boolean>;
  // Quits the app (the Settings panel's Quit button).
  quit?(): Promise<boolean>;
};

export const PRESENTATION_APP_MODES = ["expanded", "minified"] as const;
export type PresentationAppMode = (typeof PRESENTATION_APP_MODES)[number];
export const PRESENTATION_OPACITY_MIN = 0.3;

// [GUARD] Accepts a presentation object with every method; unknown capability
// names are dropped. null for anything else.
export function negotiatePresentation(
  candidate: unknown,
): PresentationHost | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const host = candidate as Partial<PresentationHost>;
  const methods: (keyof PresentationHost)[] = [
    "open",
    "close",
    "focus",
    "openPanels",
    "setLayout",
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
    open: (panel) => inner.open(panel),
    close: (panel) => inner.close(panel),
    focus: (panel) => inner.focus(panel),
    openPanels: () => inner.openPanels(),
    setLayout: (layout) => inner.setLayout(layout),
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
    ...(typeof inner.opacity === "function"
      ? { opacity: () => inner.opacity?.() ?? 1 }
      : {}),
    ...(typeof inner.setOpacity === "function"
      ? {
          setOpacity: (value: number) =>
            inner.setOpacity?.(value) ?? Promise.resolve(false),
        }
      : {}),
    ...(typeof inner.setWindowWidth === "function"
      ? {
          setWindowWidth: (width: number) =>
            inner.setWindowWidth?.(width) ?? Promise.resolve(false),
        }
      : {}),
    ...(typeof inner.quit === "function"
      ? { quit: () => inner.quit?.() ?? Promise.resolve(false) }
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
