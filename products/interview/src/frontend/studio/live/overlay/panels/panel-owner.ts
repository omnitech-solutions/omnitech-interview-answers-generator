// Exactly ONE panel document owns the microphone and the screen sampling at a
// time (hands-free Auto, dictation, captures); the others display its state.
// Ownership is a Web Lock held for the life of the document, so it passes on by
// itself when the owner closes. The pill asks at once; the other panels wait a
// moment so the always-visible pill wins when it is open. Without Web Locks
// (an old browser, a test) a document owns what it shows.
import { useEffect, useState } from "react";
import type { PanelKind } from "./panel-kinds";

export const OWNER_LOCK = "interview-studio.panel-owner";
export const NON_PILL_DELAY_MS = 1_500;

// A document that is not a panel asks too: the Studio live view (the main
// session view, asks at once) and a standalone card (the floating or overlay
// window, waits like the other panels). `enabled` false (no open session)
// asks for nothing and owns nothing.
export type OwnerKind = PanelKind | "studio" | "card";

// The native shell's bar document takes the lock by force: the shell is the
// hands-free app, and an installed Chrome app or an open browser tab with the
// same Studio page must never keep the microphone and screen away from it. The
// document that loses the lock is told (its request rejects) and shows state.
const isNativeHost = (): boolean =>
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("host") === "native";

export function useOwnsSession(
  panel: OwnerKind,
  tenant: string,
  delayMs = panel === "pill" || panel === "studio" ? 0 : NON_PILL_DELAY_MS,
  enabled = true,
): boolean {
  const locks =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as { locks?: LockManager }).locks;
  const [owner, setOwner] = useState(locks === undefined && enabled);
  useEffect(() => {
    if (!enabled) {
      setOwner(false);
      return;
    }
    if (!locks) {
      setOwner(true);
      return;
    }
    const abort = new AbortController();
    let release: (() => void) | null = null;
    const steals = panel === "pill" && isNativeHost();
    const ask = () =>
      void locks
        .request(
          `${OWNER_LOCK}.${tenant}`,
          steals ? { steal: true } : { signal: abort.signal },
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
              setOwner(true);
            }),
        )
        // Aborted on cleanup, or stolen by the native shell: no longer the owner.
        .catch(() => setOwner(false));
    const timer = setTimeout(ask, delayMs);
    return () => {
      clearTimeout(timer);
      abort.abort();
      release?.();
      setOwner(false);
    };
  }, [locks, tenant, delayMs, enabled]);
  return owner;
}
