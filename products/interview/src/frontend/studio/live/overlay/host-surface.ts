// How the page paints inside a native shell window. The shell's window is
// transparent (blur and desktop show through), so the page marks its document
// `data-panel-host="native"` (the CSS then uses translucent surfaces) and mirrors
// the shell's opacity setting into `--ov-alpha`. A browser tab, an installed web
// app and a PiP window are untouched: no attribute, no variable.
import {
  negotiatePresentation,
  PRESENTATION_OPACITY_MIN,
} from "@omnitech/interview-contracts";
import { studioHostInfo } from "../host-adapter";

export const OPACITY_POLL_MS = 1_000;

export const isNativeSurface = (
  params: URLSearchParams,
  presentationCapabilities = 0,
): boolean =>
  params.get("host") !== "pip" &&
  (params.get("host") === "native" ||
    presentationCapabilities > 0 ||
    studioHostInfo() !== null);

// The shell's panel opacity (0.3 to 1), or null when it reports none.
export function shellOpacity(): number | null {
  try {
    const raw = (window as { studioHost?: { presentation?: unknown } })
      .studioHost?.presentation;
    const value = negotiatePresentation(raw)?.opacity?.();
    return typeof value === "number" && Number.isFinite(value)
      ? Math.min(1, Math.max(PRESENTATION_OPACITY_MIN, value))
      : null;
  } catch {
    return null;
  }
}

// Marks the document and keeps `--ov-alpha` current. Returns the remover.
export function installHostSurface(native: boolean): () => void {
  const root = document.documentElement;
  root.setAttribute("data-panel-host", native ? "native" : "window");
  if (!native) return () => root.removeAttribute("data-panel-host");
  const apply = () => {
    const value = shellOpacity();
    if (value === null) root.style.removeProperty("--ov-alpha");
    else root.style.setProperty("--ov-alpha", String(value));
  };
  apply();
  const timer = setInterval(apply, OPACITY_POLL_MS);
  return () => {
    clearInterval(timer);
    root.removeAttribute("data-panel-host");
    root.style.removeProperty("--ov-alpha");
  };
}
