// Whether a session is open (created, active or paused), for the places that
// only mark it: the nav item's red dot. Reads the store's record, not a model.
import { useMemo, useSyncExternalStore } from "react";
import { isOpenSession } from "./session-deps";
import { getSessionStore, tenantFromLocation } from "./session-registry";

export function useSessionOpen(): boolean {
  const store = useMemo(() => getSessionStore(tenantFromLocation()), []);
  const session = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().session,
    () => store.getSnapshot().session,
  );
  return isOpenSession(session);
}
