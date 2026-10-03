// React's window onto the session store. The store lives outside React, so a
// view that unmounts neither stops the session nor starts a second poll.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getSessionStore, tenantFromLocation } from "./session-registry";
import { isOpenSession } from "./session-deps";
import type { LiveSnapshot, SessionActions } from "./session-snapshot";
import { deriveLiveModel, type LiveViewModel } from "./session-state";

export type LiveSessionHandle = {
  snapshot: LiveSnapshot;
  // The owner's commands; each returns a result carrying a fixed error code.
  actions: SessionActions;
  // Derived from the snapshot at `nowMs`.
  model: LiveViewModel;
  // The browser clock, refreshed every second while a session is open so
  // elapsed time and "ago" labels move. The model reads server time as
  // nowMs + snapshot.serverClockOffsetMs.
  nowMs: number;
};

const TICK_MS = 1_000;

// Subscribes this component to the tenant's session store. The first
// subscriber (the Studio shell) hydrates it from the server.
export function useLiveSession(): LiveSessionHandle {
  const store = useMemo(() => getSessionStore(tenantFromLocation()), []);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const ticking = isOpenSession(snapshot.session);
  useEffect(() => {
    setNowMs(Date.now());
    if (!ticking) return;
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [ticking]);
  const model = useMemo(
    () =>
      deriveLiveModel({
        session: snapshot.session,
        observations: snapshot.observations,
        actions: snapshot.actions,
        serverClockOffsetMs: snapshot.serverClockOffsetMs,
        nowMs,
      }),
    [snapshot, nowMs],
  );
  return { snapshot, actions: store.actions, model, nowMs };
}

// Keeps the store subscribed (and so hydrated and following the stream) for
// as long as the component is mounted, without reading from it. The Studio
// shell mounts this, so the session bar works on every page.
export function useSessionStoreWatch(): void {
  const store = useMemo(() => getSessionStore(tenantFromLocation()), []);
  useEffect(() => store.subscribe(() => undefined), [store]);
}
