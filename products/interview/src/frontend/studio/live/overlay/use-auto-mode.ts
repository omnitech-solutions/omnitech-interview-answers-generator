// Hands-free Auto (ADR-0022): continuous listening whose finished phrases go to
// the session as heard speech, and a watch on the shared screen that captures
// and analyses when the picture changes and settles. Owner-enabled, visible,
// one click to stop. Nothing here sends a frame: a capture goes through the
// card's own capture route, with the owner's region, exactly as a press would.
//
// [SAFETY] The decisions live in pure modules (auto-change, auto-gate,
// auto-restart, auto-line); this hook only runs the timers and calls out.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { holdAwake } from "../keep-awake";
import type { CommandResult } from "../session-snapshot";
import { createChangeDetector, SAMPLE_MS } from "./auto-change";
import { type AutoBlock, gateAutoCapture } from "./auto-gate";
import type { FrameHash } from "./auto-hash";
import { type AutoLine, autoLine } from "./auto-line";
import { isOwnerPaused } from "./auto-owner-pause";
import { loadAutoPreferred, saveAutoPreferred } from "./auto-prefs";
import { useDictation } from "./dictation";
import type { Rect } from "./mask-geometry";

// How often listening is checked and, if it ended for a reason retrying can
// fix, started again. The dictation hook's own restart handles the common case
// (silence); this is the backstop, and it never runs faster than this.
export const LISTEN_CHECK_MS = 5_000;
export const RESUME_FIRST_MS = 1_500;
export const RESUME_RETRY_MS = 8_000;
export const RESUME_MAX_TRIES = 3;
const HEARD_RETRY_MS = 1_000;
// Finals closer together than this are one question.
export const COALESCE_MS = 800;
const COALESCE_MAX_CHARS = 900;

export type AutoModeInput = {
  tenant: string;
  sessionId: string | null;
  open: boolean;
  paused: boolean;
  deviceOnly: boolean;
  wantsScreen: boolean;
  sharing: boolean;
  watchable: boolean;
  sample(mask: Rect): FrameHash | null;
  mask: Rect;
  // A capture or analysis is in flight (a press, an auto capture, a request).
  busy: boolean;
  // Takes the fresh capture and analyses it; true when it was sent.
  capture(): Promise<boolean>;
  submitHeard(text: string, requestId: string): Promise<CommandResult>;
  resume(): Promise<CommandResult>;
  // Heard while Auto is off: the card's own dictation handling.
  onManualFinal(text: string): void;
  // Another listener (the native engine) posts the transcripts, so this one
  // stays off: only one may.
  engineListening?: boolean;
  now?: () => number;
};

const retryable = (code: string): boolean =>
  !["status_refused", "invalid_input", "not_found", "unauthorized"].includes(
    code,
  );

export function useAutoMode(input: AutoModeInput) {
  const clock = input.now ?? Date.now;
  const [on, setOnState] = useState(() => loadAutoPreferred(input.tenant));
  useEffect(() => {
    setOnState(loadAutoPreferred(input.tenant));
  }, [input.tenant]);
  const setOn = useCallback(
    (next: boolean) => {
      saveAutoPreferred(input.tenant, next);
      setOnState(next);
    },
    [input.tenant],
  );
  // Auto listens and watches: the page keeps reading the session while hidden.
  useEffect(() => {
    if (!on) return;
    return holdAwake();
  }, [on]);
  const latest = useRef(input);
  latest.current = input;
  const onRef = useRef(on);
  onRef.current = on;

  // ---- Listening -------------------------------------------------------
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [heardError, setHeardError] = useState<string | null>(null);
  const send = useCallback((phrase: string) => {
    const id = `h-${globalThis.crypto.randomUUID()}`;
    // One at a time, in the order heard, each retried once under its own id.
    queue.current = queue.current.then(async () => {
      let result = await latest.current.submitHeard(phrase, id);
      if (!result.ok && retryable(result.code)) {
        await new Promise((resolve) => setTimeout(resolve, HEARD_RETRY_MS));
        result = await latest.current.submitHeard(phrase, id);
      }
      setHeardError(result.ok ? null : result.code);
    });
  }, []);
  // Finals that arrive close together are one question: they are held for
  // COALESCE_MS after the last one and sent as ONE phrase, so one utterance
  // never opens several tasks. A long run is sent before it would overflow.
  const pendingPhrase = useRef("");
  const coalesceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushHeard = useCallback(() => {
    if (coalesceTimer.current !== null) clearTimeout(coalesceTimer.current);
    coalesceTimer.current = null;
    const phrase = pendingPhrase.current.trim();
    pendingPhrase.current = "";
    if (phrase !== "") send(phrase);
  }, [send]);
  const sendHeard = useCallback(
    (phrase: string) => {
      if (
        pendingPhrase.current !== "" &&
        pendingPhrase.current.length + phrase.length + 1 > COALESCE_MAX_CHARS
      )
        flushHeard();
      pendingPhrase.current =
        pendingPhrase.current === ""
          ? phrase
          : `${pendingPhrase.current} ${phrase}`;
      if (coalesceTimer.current !== null) clearTimeout(coalesceTimer.current);
      coalesceTimer.current = setTimeout(flushHeard, COALESCE_MS);
    },
    [flushHeard],
  );
  // Nothing heard is lost when listening ends or the page goes.
  useEffect(() => flushHeard, [flushHeard]);
  const dictation = useDictation({
    deviceOnly: input.deviceOnly,
    bindingKey: input.sessionId,
    persistent: on,
    onFinal: (phrase) => {
      if (onRef.current) sendHeard(phrase);
      else latest.current.onManualFinal(phrase);
    },
  });
  // The owner turned the microphone off by hand (Alt+R) while Auto is on.
  const [micOverride, setMicOverride] = useState(false);
  const wantListening =
    on &&
    input.open &&
    !input.paused &&
    !micOverride &&
    dictation.supported &&
    input.engineListening !== true;
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;
  useEffect(() => {
    if (!wantListening) {
      if (dictationRef.current.state === "listening" && onRef.current)
        dictationRef.current.stop();
      return;
    }
    const ensure = () => {
      const current = dictationRef.current;
      if (current.state !== "idle" || current.denied) return;
      // A device-only refusal is the browser's answer, not a blip: no retry.
      if (latest.current.deviceOnly && current.error) return;
      current.start();
    };
    ensure();
    const timer = setInterval(ensure, LISTEN_CHECK_MS);
    return () => clearInterval(timer);
  }, [wantListening]);
  // Turning Auto off ends the listening it started.
  useEffect(() => {
    if (!on && dictationRef.current.state === "listening")
      dictationRef.current.stop();
    if (!on) setMicOverride(false);
  }, [on]);
  const toggleListening = useCallback(() => {
    const current = dictationRef.current;
    if (onRef.current) {
      if (current.state === "listening") {
        setMicOverride(true);
        current.stop();
      } else {
        setMicOverride(false);
        current.start();
      }
    } else current.toggle();
  }, []);

  // ---- Watching the screen -----------------------------------------------
  const detector = useMemo(() => createChangeDetector(), []);
  const [block, setBlock] = useState<AutoBlock | null>(null);
  const [autoCount, setAutoCount] = useState(0);
  const counted = useRef({ count: 0, lastAt: null as number | null });
  const inFlight = useRef(false);
  // Another session starts the count and the picture over.
  useEffect(() => {
    counted.current = { count: 0, lastAt: null };
    setAutoCount(0);
    setBlock(null);
    detector.reset();
  }, [input.sessionId, detector]);
  const watching =
    on &&
    input.open &&
    !input.paused &&
    !input.deviceOnly &&
    input.sharing &&
    input.watchable;
  useEffect(() => {
    if (!on) return;
    if (input.deviceOnly) {
      setBlock("device-only");
      return;
    }
    if (!watching) return;
    const tick = async () => {
      const now = latest.current;
      const hash = now.sample(now.mask);
      if (!hash) return;
      if (detector.observe(hash, clock()) !== "ready") {
        setBlock(null);
        return;
      }
      const gate = gateAutoCapture({
        nowMs: clock(),
        open: now.open,
        paused: now.paused,
        deviceOnly: now.deviceOnly,
        sharing: now.sharing,
        inFlight: inFlight.current || now.busy,
        autoCount: counted.current.count,
        lastAutoAtMs: counted.current.lastAt,
      });
      if (!gate.ok) {
        setBlock(gate.reason);
        return;
      }
      setBlock(null);
      inFlight.current = true;
      counted.current = { count: counted.current.count + 1, lastAt: clock() };
      detector.markCaptured();
      setAutoCount(counted.current.count);
      const sent = await now.capture().catch(() => false);
      inFlight.current = false;
      if (!sent) {
        // Not charged, and the same picture is tried again after the gap.
        counted.current = {
          count: counted.current.count - 1,
          lastAt: counted.current.lastAt,
        };
        setAutoCount(counted.current.count);
        detector.reset();
      }
    };
    const timer = setInterval(() => void tick(), SAMPLE_MS);
    return () => clearInterval(timer);
  }, [on, watching, input.deviceOnly, detector, clock]);

  // ---- Resuming ----------------------------------------------------------
  const [resumeFailed, setResumeFailed] = useState(false);
  const ownerPaused =
    input.sessionId !== null && input.paused && isOwnerPaused(input.sessionId);
  useEffect(() => {
    setResumeFailed(false);
    if (!on || !input.open || !input.paused || !input.sessionId) return;
    if (isOwnerPaused(input.sessionId)) return;
    let tries = 0;
    const attempt = async () => {
      // [SAFETY] Only the tab the owner is looking at resumes, only a pause the
      // owner did not press, and only a few times.
      if (document.visibilityState !== "visible" || tries >= RESUME_MAX_TRIES)
        return;
      if (isOwnerPaused(input.sessionId as string)) return;
      tries += 1;
      const result = await latest.current.resume();
      setResumeFailed(!result.ok && tries >= RESUME_MAX_TRIES);
    };
    const first = setTimeout(() => void attempt(), RESUME_FIRST_MS);
    const again = setInterval(() => void attempt(), RESUME_RETRY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(again);
    };
  }, [on, input.open, input.paused, input.sessionId]);

  // ---- The line ----------------------------------------------------------
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [on]);
  void tick;
  const line: AutoLine | null = on
    ? autoLine({
        open: input.open,
        paused: input.paused,
        ownerPaused,
        resumeFailed,
        micDenied: dictation.denied,
        micUnsupported: !dictation.supported,
        micError:
          dictation.error && dictation.state === "idle" && input.deviceOnly
            ? dictation.error
            : heardError === null
              ? null
              : "a phrase could not be sent. It will be tried again with the next one.",
        listening: dictation.state === "listening",
        heardAgoMs:
          dictation.heardAt === null ? null : clock() - dictation.heardAt,
        wantsScreen: input.wantsScreen,
        deviceOnly: input.deviceOnly,
        sharing: input.sharing,
        watchable: input.watchable,
        block,
      })
    : null;

  return {
    on,
    setOn,
    line,
    autoCount,
    dictation,
    toggleListening,
    // The mic light's real state.
    mic: dictation.denied
      ? ("denied" as const)
      : dictation.state === "listening"
        ? ("listening" as const)
        : ("off" as const),
  };
}
