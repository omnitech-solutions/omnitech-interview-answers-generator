// A natively hosted window never starts a session behind the person's back. It
// shows the idle "No live session" screen and a Start button (start-panel.tsx);
// a session that is already running (started on the web, or by another native
// window) is adopted, never duplicated. This file keeps the two pieces that stay:
//   - the shell's one-time consent, read and re-read while it is missing, so a
//     window can say "Consent required" and offer the shell's own dialog;
//   - the panel bus: the window that starts a session announces it and the other
//     windows (Settings) open that session.
//
// [SAFETY] Starting is not capturing: the screen is captured on the capture
// command only, and the shell's consent comes first.
import type { LiveSessionStartRequest } from "@omnitech/interview-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { useLiveSession } from "../../use-live-session";
import { openPanelBus } from "./panel-bus";
import type { NativeWindowPage } from "./panel-owner";
import { shellConsented } from "./shell-bridge";

type Live = ReturnType<typeof useLiveSession>;

// What the compact window's "Start a new session" (after one ends) starts with.
export const AUTO_SESSION: LiveSessionStartRequest = {
  processingPolicy: "permitted-remote",
  captureSources: ["microphone", "application-audio", "screen"],
};
const CONSENT_POLL_MS = 1_000;

export type AutoSessionState = "idle" | "consent";

export function useAutoSession(input: {
  panel: NativeWindowPage;
  // A natively hosted window document, signed in, with the store ready.
  enabled: boolean;
  snapshot: Live["snapshot"];
  actions: Live["actions"];
}): { state: AutoSessionState; announceStarted(): void } {
  const { enabled, snapshot, actions } = input;
  const missing = enabled && !snapshot.session;
  const [consented, setConsented] = useState(shellConsented);
  const startedHere = useRef(false);

  // The shell's consent may arrive while this page is open.
  useEffect(() => {
    if (!missing || consented) return;
    const check = () => setConsented(shellConsented());
    const timer = setInterval(check, CONSENT_POLL_MS);
    window.addEventListener("storage", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", check);
    };
  }, [missing, consented]);

  // The starter announces the session; the others open it.
  const sessionId = snapshot.session?.id ?? null;
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  useEffect(() => {
    if (!enabled) return;
    const bus = openPanelBus();
    const stop = bus.listen((message) => {
      if (message.type === "session") {
        if (sessionRef.current !== message.sessionId)
          void actions.switchSession(message.sessionId);
      } else if (message.type === "hello" && sessionRef.current) {
        bus.post({ type: "session", sessionId: sessionRef.current });
      }
    });
    return stop;
  }, [enabled, actions]);
  useEffect(() => {
    if (!sessionId || !startedHere.current) return;
    startedHere.current = false;
    openPanelBus().post({ type: "session", sessionId });
  }, [sessionId]);

  // The Start button calls this once its session has started.
  const announceStarted = useCallback(() => {
    startedHere.current = true;
  }, []);
  return { state: missing && !consented ? "consent" : "idle", announceStarted };
}
