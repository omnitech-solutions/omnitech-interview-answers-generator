// The overlay route's address and the messages its page sends to the window
// that embeds it (the PiP host). Messages carry an event name only.
import { parseRoute } from "../../use-studio-route";
import { tenantFromLocation } from "../session-registry";

export const OVERLAY_MESSAGE = "interview-overlay";
export type OverlayEvent = "close" | "lost";

// /t/<tenant>/p/<product>/live/overlay[?host=pip][&session=<id>]
export function overlayUrl(
  host: "pip" | "window",
  sessionId?: string | null,
): string {
  const base =
    parseRoute(window.location).base ||
    `/t/${encodeURIComponent(tenantFromLocation())}/p/interview`;
  const query = new URLSearchParams();
  if (host === "pip") query.set("host", "pip");
  if (sessionId) query.set("session", sessionId);
  const suffix = query.toString();
  return `${base}/live/overlay${suffix ? `?${suffix}` : ""}`;
}

// From inside an embedded overlay page: tell the embedding window.
export function tellHost(event: OverlayEvent): void {
  if (window.parent !== window)
    window.parent.postMessage(
      { kind: OVERLAY_MESSAGE, event },
      window.location.origin,
    );
}

// /t/<tenant>/p/<product>/live/overlay?panel=<panel>[&host=...][&session=<id>]
export function panelUrl(
  panel: "pill" | "analysis" | "chat" | "settings",
  host: "pip" | "native" | "window" = "window",
  sessionId?: string | null,
): string {
  const base =
    parseRoute(window.location).base ||
    `/t/${encodeURIComponent(tenantFromLocation())}/p/interview`;
  const query = new URLSearchParams({ panel });
  if (host !== "window") query.set("host", host);
  if (sessionId) query.set("session", sessionId);
  return `${base}/live/overlay?${query.toString()}`;
}
