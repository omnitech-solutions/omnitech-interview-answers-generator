// The message the overlay page sends to the window that embeds it. Messages
// carry an event name only.
const OVERLAY_MESSAGE = "interview-overlay";
export type OverlayEvent = "close" | "lost";

// From inside an embedded overlay page: tell the embedding window.
export function tellHost(event: OverlayEvent): void {
  if (window.parent !== window)
    window.parent.postMessage(
      { kind: OVERLAY_MESSAGE, event },
      window.location.origin,
    );
}
