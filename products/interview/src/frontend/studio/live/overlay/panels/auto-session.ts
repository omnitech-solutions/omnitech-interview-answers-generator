// A natively hosted window never asks the person to "start a session in Studio":
// once the shell has recorded its one-time consent, the first window document to
// find no live session starts one with the defaults (permitted-remote, the
// microphone, the app's audio and the screen). A Web Lock lets exactly one
// document start it; it tells the others over the panel bus, which then open
// that session. Without the shell's consent nothing starts: the window shows one
// "Consent required" line with a button that asks the shell for its dialog.
//
// [SAFETY] Starting a session is not capturing: the screen is captured on the
// capture command only, and the shell's consent comes first.
import type { LiveSessionStartRequest } from "@omnitech/interview-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { useLiveSession } from "../../use-live-session";
import { openPanelBus } from "./panel-bus";
import type { NativeWindowPage } from "./panel-owner";
import { shellConsented } from "./shell-bridge";

type Live = ReturnType<typeof useLiveSession>;

export const AUTO_SESSION: LiveSessionStartRequest = {
  processingPolicy: "permitted-remote",
  captureSources: ["microphone", "application-audio", "screen"],
};
const START_LOCK = "interview-studio.panel-autostart";
const CONSENT_POLL_MS = 1_000;
const START_RETRY_MS = 4_000;
// Settings waits a moment so the always-open compact window usually starts it.
const LATE_START_DELAY_MS = 1_500;

export type AutoSessionState = "idle" | "consent" | "starting" | "failed";

export function useAutoSession(input: {
  panel: NativeWindowPage;
  // A natively hosted window document, signed in, with the store ready.
  enabled: boolean;
  snapshot: Live["snapshot"];
  actions: Live["actions"];
}): { state: AutoSessionState; retry(): void } {
  const { panel, enabled, snapshot, actions } = input;
  const missing = enabled && !snapshot.session;
  const [consented, setConsented] = useState(shellConsented);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const startedHere = useRef(false);
  const inFlight = useRef(false);

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

  // Start one session, once, for every window document.
  useEffect(() => {
    if (!missing || !consented || failed) return;
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const start = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const result = await actions.start(AUTO_SESSION);
        if (!alive) return;
        if (result.ok) {
          startedHere.current = true;
          return;
        }
        // Another panel document may have started it first: open that one.
        const listed = await actions.listSessions();
        const running = listed.ok
          ? listed.sessions.find(
              (s) => s.status === "active" || s.status === "paused",
            )
          : undefined;
        if (running) {
          await actions.switchSession(running.id);
          return;
        }
        if (alive) setFailed(true);
      } finally {
        inFlight.current = false;
      }
    };
    const begin = () => {
      const locks =
        typeof navigator === "undefined"
          ? undefined
          : (navigator as { locks?: LockManager }).locks;
      if (!locks) return void start();
      void locks
        .request(
          `${START_LOCK}.${snapshot.tenant}`,
          { ifAvailable: true },
          (lock) => {
            if (!lock) {
              // Another document is starting it; look again if nothing arrives.
              retry = setTimeout(
                () => alive && setAttempt((n) => n + 1),
                START_RETRY_MS,
              );
              return undefined;
            }
            return start().then(
              () => new Promise<void>((done) => setTimeout(done, 2_000)),
            );
          },
        )
        .catch(() => void start());
    };
    const delay = setTimeout(
      begin,
      panel === "single" ? 0 : LATE_START_DELAY_MS,
    );
    return () => {
      alive = false;
      clearTimeout(delay);
      if (retry) clearTimeout(retry);
    };
  }, [missing, consented, failed, attempt, panel, actions, snapshot.tenant]);

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

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);
  const state: AutoSessionState = !missing
    ? "idle"
    : !consented
      ? "consent"
      : failed
        ? "failed"
        : "starting";
  return { state, retry };
}
