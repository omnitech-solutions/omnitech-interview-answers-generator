// One session store per tenant slug, for the life of the page. A module-level
// registry (not React state) is what lets the session outlive every view.
import { studioFetch } from "../studio-fetch";
import { isHeldAwake, onAwakeChange } from "./keep-awake";
import type { StoreDeps } from "./session-deps";
import { ownerInputDeps } from "./session-owner-input";
import type { SessionStore } from "./session-snapshot";
import { createSessionStore } from "./session-store";

// The page's own timers, visibility and tab storage. Read at call time so a
// test's fake timers are honoured.
function browserDeps(): StoreDeps {
  return {
    fetch: studioFetch,
    now: () => Date.now(),
    setTimer: (run, ms) => globalThis.setTimeout(run, ms),
    clearTimer: (handle) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    // Hidden pages keep reading while the page holds the mic or a share.
    isVisible: () =>
      typeof document === "undefined" ||
      document.visibilityState !== "hidden" ||
      isHeldAwake(),
    onVisibilityChange: (listener) => {
      if (typeof document === "undefined") return () => undefined;
      document.addEventListener("visibilitychange", listener);
      const stopAwake = onAwakeChange(listener);
      return () => {
        document.removeEventListener("visibilitychange", listener);
        stopAwake();
      };
    },
    // sessionStorage: per tab, gone with it; only the finished session's id.
    storage: {
      read: (key) => {
        try {
          return window.sessionStorage.getItem(key);
        } catch {
          return null;
        }
      },
      write: (key, value) => window.sessionStorage.setItem(key, value),
      remove: (key) => window.sessionStorage.removeItem(key),
    },
  };
}

const stores = new Map<string, SessionStore>();
let overrides: Partial<StoreDeps> = {};

export function getSessionStore(tenant: string): SessionStore {
  let store = stores.get(tenant);
  if (!store) {
    const created: { current?: SessionStore } = {};
    const deps = { ...browserDeps(), ...overrides };
    store = createSessionStore(tenant, {
      // Owner input reads the store's own held snapshot (the newest capture and
      // the task last answered), so it is built beside the store.
      ...ownerInputDeps(tenant, deps.fetch, () =>
        (created.current as SessionStore).getSnapshot(),
      ),
      ...deps,
    });
    created.current = store;
    stores.set(tenant, store);
  }
  return store;
}

// The tenant slug the page belongs to (/t/<slug>/…), as studioFetch reads it.
export function tenantFromLocation(): string {
  const slug = /^\/t\/([^/]+)/.exec(window.location.pathname)?.[1];
  return slug ? decodeURIComponent(slug) : "local";
}

// Tests: inject fetch, timers, clock, visibility or storage for the stores
// created next. Call resetSessionStores() first so no store predates it.
export function configureSessionStores(next: Partial<StoreDeps>): void {
  overrides = next;
}

// Tests: cancel every store's timers and forget them all.
export function resetSessionStores(): void {
  for (const store of stores.values()) store.dispose();
  stores.clear();
  overrides = {};
}
