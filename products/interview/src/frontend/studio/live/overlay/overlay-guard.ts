// The overlay route is for hosts: the PiP window, the installed web app, the
// native shell and its panels. An ordinary browser tab that lands on it (a
// bookmark, a typed address) goes to the full Studio session view instead, so
// /live is always the page the person expects.
export type OverlayContext = {
  search: string;
  pathname: string;
  // The page runs as an installed app window (display-mode: standalone).
  standalone: boolean;
};

export function isStandaloneDisplay(): boolean {
  try {
    return (
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (navigator as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

// The address to go to instead, or null when this document is a legitimate
// overlay host: `?panel=` (a panel window), `?host=pip|native|window`, or
// `?host=pwa` inside an installed app window.
export function overlayRedirect(context: OverlayContext): string | null {
  const params = new URLSearchParams(context.search);
  if (params.get("panel")) return null;
  const host = params.get("host");
  if (host === "pip" || host === "native" || host === "window") return null;
  if (host === "pwa" && context.standalone) return null;
  const session = params.get("session");
  const live = context.pathname.replace(/\/live\/overlay\/?$/, "/live");
  return session ? `${live}?session=${encodeURIComponent(session)}` : live;
}
