// The session store: the Active Session as the browser knows it, independent of
// every React component (plan #3 U3). It hydrates from the server, follows the
// stream with the observation and action cursors, runs the owner's commands and
// publishes immutable snapshots for useSyncExternalStore. Views come and go;
// this outlives them, so a session survives navigation and a remount never
// starts a second poll.
//
// [SAFETY] The server record is authoritative: every command replaces the
// session from the response. The credential from start or renewal is held in
// `pairing` only. It is never written to storage, never logged, and is never
// read back from the server.
import type {
  LiveAction,
  LiveObservation,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import { createSessionActions } from "./session-actions";
import { createSessionClient } from "./session-client";
import { errorCodeOf as codeOf, TERMINAL_CODES } from "./session-codes";
import {
  isOpenSession as isOpen,
  POLL_ACTIVE_MS,
  POLL_PAUSED_MS,
  PURGE_SETTLE_ATTEMPTS,
  PURGE_SETTLE_MS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  type StoreDeps,
} from "./session-deps";
import {
  mergeActions,
  mergeObservations,
  serverClockOffset,
} from "./session-merge";
import type { LiveSnapshot, SessionStore } from "./session-snapshot";

export function createSessionStore(
  tenant: string,
  deps: StoreDeps,
): SessionStore {
  const client = createSessionClient(tenant, deps.fetch);
  const endedKey = `interview-studio.live.ended-session.${tenant}`;
  const listeners = new Set<() => void>();
  let snapshot: LiveSnapshot = {
    tenant,
    hydration: "pending",
    session: null,
    observations: [],
    actions: [],
    pairing: null,
    serverClockOffsetMs: 0,
    lastReadAt: null,
    streamError: null,
    readFailures: 0,
    pending: [],
    commandError: null,
    endedSessionId: deps.storage.read(endedKey),
    notFoundSessionId: null,
    switchedTo: null,
  };
  let cursors: { afterSequence: number; actionCursor?: string } = {
    afterSequence: 0,
  };
  let watching = false;
  let disposed = false;
  let removeVisibility: (() => void) | null = null;
  const visible = () => deps.isVisible();
  let timer: unknown = null;
  // True while the loop is waiting on a hydration, a read or a purge check, so
  // no second one starts beside it.
  let busy = false;
  let reading: Promise<void> | null = null;
  let hydrating: Promise<void> | null = null;
  let failures = 0;
  // A terminal answer (the session is gone or not ours): no further reads
  // until the owner refreshes.
  let halted = false;
  // The session the owner switched to: refresh follows it, not "current".
  let pinned: string | null = null;
  // Raised by every bindSession: a read, a purge check or a hydration that began
  // under an earlier one belongs to the session left behind, so its result, its
  // error and its halt are all ignored.
  let bindEpoch = 0;
  let settleAttempts = 0;
  // Raised by every command response; a stream page that began before it
  // cannot overwrite the newer session record.
  let commandEpoch = 0;
  const drained = new Set<string>();

  function set(patch: Partial<LiveSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  }
  function clearTimer() {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }
  function remember(id: string) {
    try {
      deps.storage.write(endedKey, id);
    } catch {
      // Storage is optional: the ended view then needs the address.
    }
    if (snapshot.endedSessionId !== id) set({ endedSessionId: id });
  }
  function forget() {
    try {
      deps.storage.remove(endedKey);
    } catch {
      // See remember.
    }
    if (snapshot.endedSessionId !== null) set({ endedSessionId: null });
  }

  // [SAFETY] A session being deleted holds no content in the browser either.
  function adopt(view: LiveSessionView) {
    const changed = snapshot.session?.id !== view.id;
    if (changed) {
      cursors = { afterSequence: 0 };
      drained.clear();
      settleAttempts = 0;
    }
    const erase = view.status === "purging" || view.purged;
    set({
      session: view,
      ...(changed ? { observations: [], actions: [], pairing: null } : {}),
      ...(erase ? { observations: [], actions: [], pairing: null } : {}),
      notFoundSessionId: null,
    });
    if (view.status === "ended" || view.status === "purging") remember(view.id);
  }

  async function readPages(id: string): Promise<void> {
    const bound = bindEpoch;
    for (;;) {
      const epoch = commandEpoch;
      const page = await client.stream(id, {
        afterSequence: cursors.afterSequence,
        ...(cursors.actionCursor ? { actionCursor: cursors.actionCursor } : {}),
      });
      if (disposed || bound !== bindEpoch || snapshot.session?.id !== id)
        return;
      cursors = {
        afterSequence: page.nextAfterSequence,
        actionCursor: page.nextActionCursor,
      };
      // A command answered while this page was in flight is newer, so its
      // session record stands.
      if (epoch === commandEpoch) adopt(page.session);
      const erase =
        snapshot.session?.status === "purging" || snapshot.session?.purged;
      set({
        observations: erase
          ? []
          : mergeObservations(
              snapshot.observations,
              page.observations as readonly LiveObservation[],
            ),
        actions: erase
          ? []
          : mergeActions(
              snapshot.actions,
              page.actions as readonly LiveAction[],
            ),
        serverClockOffsetMs: serverClockOffset(page.serverNow, deps.now()),
        lastReadAt: deps.now(),
        streamError: null,
        readFailures: 0,
      });
      if (!page.hasMoreObservations && !page.hasMoreActions) {
        drained.add(id);
        return;
      }
    }
  }
  function startRead(id: string): Promise<void> {
    if (reading) return reading;
    const read = readPages(id).finally(() => {
      if (reading === read) reading = null;
    });
    reading = read;
    return reading;
  }

  function schedule(run: () => void, ms: number) {
    clearTimer();
    timer = deps.setTimer(() => {
      timer = null;
      run();
    }, ms);
  }
  function backoff() {
    return Math.min(
      RETRY_BASE_MS * 2 ** Math.max(0, failures - 1),
      RETRY_MAX_MS,
    );
  }

  async function pump() {
    const session = snapshot.session;
    if (!session || !isOpen(session)) return;
    const bound = bindEpoch;
    busy = true;
    try {
      await startRead(session.id);
      if (bound !== bindEpoch) return;
      failures = 0;
    } catch (error) {
      // [SAFETY] A failure of the session left behind says nothing about this one.
      if (bound !== bindEpoch) return;
      const code = codeOf(error);
      if (TERMINAL_CODES.includes(code)) halted = true;
      else failures += 1;
      set({ streamError: code, readFailures: failures });
    }
    busy = false;
    if (halted) return;
    // The next read waits for the page to be visible again.
    if (!watching || disposed || !visible()) return;
    const latest = snapshot.session;
    if (latest && isOpen(latest))
      schedule(
        ensureRunning,
        failures > 0
          ? backoff()
          : latest.status === "paused"
            ? POLL_PAUSED_MS
            : POLL_ACTIVE_MS,
      );
    else ensureRunning();
  }

  // A session that is being deleted, or ended with delete-at-end retention
  // and not yet seen purged: the purge happens on the server after the end, so
  // the store keeps asking until it observes it (bounded), rather than leaving
  // content on screen that is already gone.
  const awaitingPurge = (session: LiveSessionView): boolean =>
    session.status === "purging" ||
    (session.status === "ended" &&
      session.retention === "delete-at-end" &&
      !session.purged);

  async function settlePurge(id: string) {
    const bound = bindEpoch;
    busy = true;
    try {
      const view = await client.get(id);
      if (bound !== bindEpoch) return;
      adopt(view);
    } catch (error) {
      if (bound !== bindEpoch) return;
      set({ streamError: codeOf(error) });
    }
    settleAttempts += 1;
    busy = false;
    if (
      snapshot.session &&
      awaitingPurge(snapshot.session) &&
      settleAttempts < PURGE_SETTLE_ATTEMPTS
    )
      if (watching && !disposed) schedule(ensureRunning, PURGE_SETTLE_MS);
  }

  async function drainFinished(id: string) {
    const bound = bindEpoch;
    busy = true;
    try {
      await startRead(id);
    } catch (error) {
      if (bound !== bindEpoch) return;
      set({ streamError: codeOf(error) });
      drained.add(id);
    }
    if (bound !== bindEpoch) return;
    busy = false;
  }

  // One entry point for the loop: do whichever next step applies, once.
  function ensureRunning() {
    if (!watching || disposed || busy || timer !== null) return;
    if (snapshot.hydration !== "ready") {
      void hydrate();
      return;
    }
    const session = snapshot.session;
    if (!session) return;
    if (isOpen(session)) {
      if (visible() && !halted) void pump();
      return;
    }
    if (session.status === "purging") {
      if (settleAttempts < PURGE_SETTLE_ATTEMPTS) void settlePurge(session.id);
      return;
    }
    if (!drained.has(session.id) && !halted) {
      void drainFinished(session.id).then(ensureRunning);
      return;
    }
    if (awaitingPurge(session) && settleAttempts < PURGE_SETTLE_ATTEMPTS)
      void settlePurge(session.id);
  }

  function hydrate(): Promise<void> {
    if (hydrating) return hydrating;
    const bound = bindEpoch;
    busy = true;
    if (snapshot.hydration !== "ready") set({ hydration: "loading" });
    hydrating = (async () => {
      try {
        let view = pinned
          ? await client.get(pinned).catch((error) => {
              if (codeOf(error) !== "not_found") throw error;
              pinned = null;
              set({ switchedTo: null });
              return client.current();
            })
          : await client.current();
        if (bound !== bindEpoch) return;
        // No open session: the finished one this tab remembers, if any.
        const known = snapshot.session?.id ?? snapshot.endedSessionId;
        if (!view && known) {
          try {
            view = await client.get(known);
          } catch (error) {
            if (codeOf(error) !== "not_found") throw error;
            forget();
          }
        }
        if (bound !== bindEpoch) return;
        if (view) adopt(view);
        else set({ session: null, observations: [], actions: [] });
        failures = 0;
        set({ hydration: "ready", streamError: null, readFailures: 0 });
      } catch (error) {
        if (bound !== bindEpoch) return;
        failures += 1;
        set({
          hydration: snapshot.hydration === "ready" ? "ready" : "failed",
          streamError: codeOf(error),
          readFailures: failures,
        });
        if (watching && !disposed) schedule(ensureRunning, backoff());
      }
    })().finally(() => {
      // A hydration of an earlier binding leaves the loop's flags to the new one.
      if (bound !== bindEpoch) return;
      busy = false;
      hydrating = null;
      ensureRunning();
    });
    return hydrating;
  }

  function onVisibility() {
    clearTimer();
    if (visible()) ensureRunning();
  }

  const actions = createSessionActions({
    client,
    snapshot: () => snapshot,
    set,
    adopt,
    forget,
    bindSession(view) {
      // [SAFETY] Another session's content is dropped whole before the new
      // one is adopted; a read still in flight for the old id is ignored.
      pinned = view.id;
      bindEpoch += 1;
      busy = false;
      hydrating = null;
      cursors = { afterSequence: 0 };
      drained.clear();
      failures = 0;
      halted = false;
      settleAttempts = 0;
      reading = null;
      clearTimer();
      set({
        streamError: null,
        hydration: "ready",
        switchedTo: isOpen(view) ? null : view.id,
      });
      adopt(view);
      ensureRunning();
    },
    clearFinished() {
      const wasPinned = pinned !== null;
      pinned = null;
      forget();
      cursors = { afterSequence: 0 };
      drained.clear();
      settleAttempts = 0;
      clearTimer();
      set({
        session: null,
        observations: [],
        actions: [],
        pairing: null,
        notFoundSessionId: null,
        streamError: null,
        switchedTo: null,
      });
      // The owner had switched away from "current": look for it again, so a
      // live session is never lost behind a dismissed finished one.
      if (wasPinned) void hydrate();
    },
    isOpen,
    markCommandAnswered: () => {
      commandEpoch += 1;
    },
    restartLoop: () => {
      clearTimer();
      ensureRunning();
    },
    stopTimer: clearTimer,
    async finalRead(id) {
      try {
        if (reading) await reading.catch(() => undefined);
        await startRead(id);
      } catch {
        // The session ended; a failed last read leaves what is already held.
      }
    },
    resetLoop() {
      pinned = null;
      if (snapshot.switchedTo !== null) set({ switchedTo: null });
      reading = null;
      failures = 0;
      halted = false;
      settleAttempts = 0;
    },
    ...(deps.analyzeLatestCapture
      ? { analyzeLatestCapture: deps.analyzeLatestCapture }
      : {}),
    ...(deps.analyzeCapture ? { analyzeCapture: deps.analyzeCapture } : {}),
    ...(deps.requestCapture ? { requestCapture: deps.requestCapture } : {}),
    ...(deps.captureStatus ? { captureStatus: deps.captureStatus } : {}),
    ...(deps.submitFollowUp ? { submitFollowUp: deps.submitFollowUp } : {}),
    async refresh() {
      failures = 0;
      halted = false;
      clearTimer();
      if (reading) await reading.catch(() => undefined);
      await hydrate();
    },
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!watching && !disposed) {
        watching = true;
        removeVisibility = deps.onVisibilityChange(onVisibility);
        ensureRunning();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && watching) {
          watching = false;
          removeVisibility?.();
          removeVisibility = null;
          clearTimer();
        }
      };
    },
    getSnapshot: () => snapshot,
    actions,
    dispose() {
      disposed = true;
      watching = false;
      removeVisibility?.();
      removeVisibility = null;
      clearTimer();
      listeners.clear();
    },
  };
}
