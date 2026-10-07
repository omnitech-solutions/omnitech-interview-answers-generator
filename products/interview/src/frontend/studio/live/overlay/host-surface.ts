// How the page paints inside a native shell window. The shell's window is
// transparent (the desktop shows through), so the page marks its document
// `data-panel-host="native"` and the CSS then uses translucent surfaces. Any
// other document is marked as a plain window.
import { studioHostInfo } from "../host-adapter";

export const isNativeSurface = (
  params: URLSearchParams,
  presentationCapabilities = 0,
): boolean =>
  params.get("host") === "native" ||
  presentationCapabilities > 0 ||
  studioHostInfo() !== null;

// Marks the document. Returns the remover.
export function installHostSurface(native: boolean): () => void {
  const root = document.documentElement;
  root.setAttribute("data-panel-host", native ? "native" : "window");
  return () => root.removeAttribute("data-panel-host");
}
