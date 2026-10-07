// The overlay route is for the native shell and its panels. An ordinary browser
// tab that lands on it (a bookmark, a typed address) goes to the full Studio
// session view instead, so /live is always the page the person expects.
export type OverlayContext = {
  search: string;
  pathname: string;
};

// The address to go to instead, or null when this document is a legitimate
// overlay host: `?panel=` (a panel window) or `?host=native`.
export function overlayRedirect(context: OverlayContext): string | null {
  const params = new URLSearchParams(context.search);
  if (params.get("panel") || params.get("host") === "native") return null;
  const session = params.get("session");
  const live = context.pathname.replace(/\/live\/overlay\/?$/, "/live");
  return session ? `${live}?session=${encodeURIComponent(session)}` : live;
}
