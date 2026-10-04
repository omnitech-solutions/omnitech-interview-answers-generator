import { AUTO_INTERVAL_DEFAULT_S, clampIntervalSeconds } from "./auto-interval";

// Whether the owner wants Auto (hands-free), remembered per tenant in this
// browser. Auto is ON by default where the host is hands-free (the native
// shell, the Picture-in-Picture window, an installed app window) and once the
// owner has turned it on anywhere; it is off only where the owner turned it
// off, and in a plain tab that nobody opted in. localStorage is optional and
// every access is guarded.
const key = (tenant: string) => `interview-studio.live.auto.${tenant}`;

// A host that hosts the card for hands-free use.
export function handsFreeHost(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const host = params.get("host");
    // The shell's hands-free (minified) state, as a page parameter or as its
    // reported app mode.
    if (params.get("handsfree") === "1") return true;
    const presentation = (
      window as { studioHost?: { presentation?: { appMode?: () => unknown } } }
    ).studioHost?.presentation;
    if (presentation?.appMode?.() === "minified") return true;
    if (host === "pip" || host === "native") return true;
    if ((window as { studioHost?: unknown }).studioHost) return true;
    return (
      host === "pwa" &&
      window.matchMedia?.("(display-mode: standalone)").matches === true
    );
  } catch {
    return false;
  }
}

export function loadAutoPreferred(tenant: string): boolean {
  try {
    const stored = window.localStorage.getItem(key(tenant));
    if (stored === "on") return true;
    if (stored === "off") return false;
  } catch {
    // Fall through to the host's default.
  }
  return handsFreeHost();
}

export function saveAutoPreferred(tenant: string, on: boolean): void {
  try {
    window.localStorage.setItem(key(tenant), on ? "on" : "off");
  } catch {
    // Kept for this page only.
  }
}

// The capture interval (seconds, 3 to 30) and the heartbeat option, per tenant.
const intervalKey = (tenant: string) =>
  `interview-studio.live.auto-interval.${tenant}`;
const heartbeatKey = (tenant: string) =>
  `interview-studio.live.auto-heartbeat.${tenant}`;

export function loadAutoInterval(tenant: string): number {
  try {
    const raw = window.localStorage.getItem(intervalKey(tenant));
    return raw === null
      ? AUTO_INTERVAL_DEFAULT_S
      : clampIntervalSeconds(Number(raw));
  } catch {
    return AUTO_INTERVAL_DEFAULT_S;
  }
}
export function saveAutoInterval(tenant: string, seconds: number): void {
  try {
    window.localStorage.setItem(
      intervalKey(tenant),
      String(clampIntervalSeconds(seconds)),
    );
  } catch {
    // Kept for this page only.
  }
}
export function loadAutoHeartbeat(tenant: string): boolean {
  try {
    return window.localStorage.getItem(heartbeatKey(tenant)) === "on";
  } catch {
    return false;
  }
}
export function saveAutoHeartbeat(tenant: string, on: boolean): void {
  try {
    window.localStorage.setItem(heartbeatKey(tenant), on ? "on" : "off");
  } catch {
    // Kept for this page only.
  }
}
