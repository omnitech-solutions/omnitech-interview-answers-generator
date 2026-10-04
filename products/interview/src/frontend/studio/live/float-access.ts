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

export function floatAccessLost(
  snapshot: LiveSnapshot,
  currentTenant: string,
): boolean {
  // Tenant switch: the page now belongs to another tenant than the store.
  if (snapshot.tenant !== currentTenant) return true;
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
