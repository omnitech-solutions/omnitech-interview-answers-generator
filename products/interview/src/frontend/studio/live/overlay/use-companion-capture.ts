// Asking the native companion to capture once, and following the request until it
// is no longer pending: about once a second. Following stops when the request
// ends, when a newer one replaces it, when the card goes away or the session
// changes, and when the request's own deadline has passed.
import type { LiveCaptureMode } from "@omnitech/interview-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanionCaptureInput } from "../session-capture";
import { TERMINAL_CODES } from "../session-codes";
import type { CaptureRequestResult, SessionActions } from "../session-snapshot";

export const POLL_MS = 1_000;
// A request the server has not settled this long after its deadline is shown
// as expired (the poll may be failing).
export const DEADLINE_GRACE_MS = 2_000;
// How long "Captured, analyzing…" stays when no new work appears.
export const CAPTURED_SHOWN_MS = 45_000;

export type CaptureProgress =
  | { phase: "asking"; mode: LiveCaptureMode }
  | { phase: "captured"; baseline: number }
  | { phase: "expired" }
  | { phase: "refused"; reason: string | null }
  // The companion was asked and said it could not capture: shown at once, with
  // its closed code, never held until the request expires.
  | { phase: "failed"; reason: string | null };

export function useCompanionCapture(
  actions: SessionActions,
  sessionId: string | null,
  // How much work the session shows now: "Captured" ends when it grows.
  activityCount: number,
) {
  const [progress, setProgress] = useState<CaptureProgress | null>(null);
  const token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ activityCount });
  latest.current = { activityCount };

  const stop = useCallback(() => {
    token.current += 1;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // Another session, or leaving: nothing is followed any more.
  useEffect(() => {
    setProgress(null);
    return stop;
  }, [sessionId, stop]);

  const start = useCallback(
    async (input: CompanionCaptureInput): Promise<CaptureRequestResult> => {
      stop();
      const mine = token.current;
      setProgress({ phase: "asking", mode: input.mode });
      const sent = await actions.requestCapture(input);
      if (mine !== token.current) return sent;
      if (!sent.ok) {
        setProgress(null);
        return sent;
      }
      const settle = (state: typeof sent.state): boolean => {
        if (state.status === "pending") return false;
        setProgress(
          state.status === "captured"
            ? { phase: "captured", baseline: latest.current.activityCount }
            : state.status === "expired"
              ? { phase: "expired" }
              : state.status === "failed"
                ? { phase: "failed", reason: state.reason ?? null }
                : { phase: "refused", reason: state.reason ?? null },
        );
        return true;
      };
      const deadline = Date.parse(sent.state.expiresAt) + DEADLINE_GRACE_MS;
      const step = (state: typeof sent.state) => {
        if (settle(state)) return;
        timer.current = setTimeout(async () => {
          if (mine !== token.current) return;
          const read = await actions.captureStatus(sent.state.requestId);
          if (mine !== token.current) return;
          if (read.ok) return step(read.state);
          // Gone or not ours: nothing more to follow.
          if (TERMINAL_CODES.includes(read.code)) {
            setProgress(null);
            return;
          }
          if (Date.now() > deadline) {
            setProgress({ phase: "expired" });
            return;
          }
          step(state);
        }, POLL_MS);
      };
      step(sent.state);
      return sent;
    },
    [actions, stop],
  );

  // "Captured, analyzing…" ends when the session shows new work, or after a while.
  const captured = progress?.phase === "captured" ? progress : null;
  useEffect(() => {
    if (!captured) return;
    if (activityCount > captured.baseline) {
      setProgress(null);
      return;
    }
    const done = setTimeout(() => setProgress(null), CAPTURED_SHOWN_MS);
    return () => clearTimeout(done);
  }, [captured, activityCount]);

  return { progress, start, dismiss: () => setProgress(null) };
}
