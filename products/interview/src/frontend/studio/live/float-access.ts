// When the floating window must go: the session or the right to see it is
// gone. Pure, so each trigger is tested on its own.
import type { SessionErrorCode } from "./session-client";
import { isOpenSession } from "./session-deps";
import type { LiveSnapshot } from "./session-snapshot";

// A stream that answers any of these will not answer differently on retry:
// signed out (401), not ours or gone (404), or the origin refused (403).
const STREAM_LOST: readonly SessionErrorCode[] = [
  "unauthorized",
  "not_found",
  "origin_forbidden",
];
// A command's 404 can mean a missing route, so only sign-out ends the float.
const COMMAND_LOST: readonly SessionErrorCode[] = [
  "unauthorized",
  "origin_forbidden",
];

// The finished session the owner explicitly switched to: it stays in the card
// as its ended state, even when it has been purged (nothing is shown but the
// fact that it ended) or its stream answers 404. Only sign-out still ends it.
const switchedFinished = (snapshot: LiveSnapshot): boolean =>
  snapshot.session !== null && snapshot.switchedTo === snapshot.session.id;

export function floatAccessLost(
  snapshot: LiveSnapshot,
  currentTenant: string,
): boolean {
  // Tenant switch: the page now belongs to another tenant than the store.
  if (snapshot.tenant !== currentTenant) return true;
  if (switchedFinished(snapshot))
    return (
      snapshot.streamError === "unauthorized" ||
      snapshot.streamError === "origin_forbidden" ||
      snapshot.commandError === "unauthorized" ||
      snapshot.commandError === "origin_forbidden"
    );
  if (snapshot.streamError && STREAM_LOST.includes(snapshot.streamError))
    return true;
  if (snapshot.commandError && COMMAND_LOST.includes(snapshot.commandError))
    return true;
  // Before the first answer there is nothing to have lost.
  if (snapshot.hydration !== "ready") return false;
  const session = snapshot.session;
  // Ended, purging, purged, or no session at all.
  return !session || session.purged || !isOpenSession(session);
}

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
