// Whether the overlay page may show the session. Pure, so each rule is tested
// on its own.
import type { SessionErrorCode } from "./session-client";
import type { LiveSnapshot } from "./session-snapshot";

// A stream that answers any of these will not answer differently on retry:
// signed out (401), not ours or gone (404), or the origin refused (403).
const STREAM_LOST: readonly SessionErrorCode[] = [
  "unauthorized",
  "not_found",
  "origin_forbidden",
];
// A command's 404 can mean a missing route, so only sign-out ends the session's access.
const COMMAND_LOST: readonly SessionErrorCode[] = [
  "unauthorized",
  "origin_forbidden",
];

// The finished session the owner explicitly switched to: it stays in the panel
// as its ended state, even when it has been purged (nothing is shown but the
// fact that it ended) or its stream answers 404. Only sign-out still ends it.
const switchedFinished = (snapshot: LiveSnapshot): boolean =>
  snapshot.session !== null && snapshot.switchedTo === snapshot.session.id;

// The overlay page's own rules (it runs as its own page, so no Studio shell
// is around to decide for it): signed out, or the session or tenant is not
// ours (any 404/403 or a tenant mismatch). "ok" includes having no session,
// which the page shows as an empty state.
export type OverlayAccess = "ok" | "signed-out" | "unavailable";

export function overlayAccess(
  snapshot: LiveSnapshot,
  currentTenant: string,
): OverlayAccess {
  if (snapshot.tenant !== currentTenant) return "unavailable";
  const kept = switchedFinished(snapshot);
  if (
    snapshot.streamError === "unauthorized" ||
    snapshot.commandError === "unauthorized"
  )
    return "signed-out";
  if (
    (snapshot.streamError && STREAM_LOST.includes(snapshot.streamError)) ||
    (snapshot.commandError && COMMAND_LOST.includes(snapshot.commandError))
  )
    return kept &&
      snapshot.streamError === "not_found" &&
      !snapshot.commandError
      ? "ok"
      : "unavailable";
  if (!kept && snapshot.hydration === "ready" && snapshot.session?.purged)
    return "unavailable";
  return "ok";
}
