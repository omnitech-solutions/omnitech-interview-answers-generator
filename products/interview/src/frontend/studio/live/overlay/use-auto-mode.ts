// Hands-free Auto (ADR-0022): continuous listening whose finished phrases go to
// the session as heard speech, and a watch on the shared screen that captures
// and analyses when the picture changes and settles. Owner-enabled, visible,
// one click to stop. Nothing here sends a frame: a capture goes through the
// card's own capture route, with the owner's region, exactly as a press would.
//
// [SAFETY] The decisions live in pure modules (auto-change, auto-gate,
// auto-restart, auto-line); this hook only runs the timers and calls out.

import type { ScreenWatchHost } from "@omnitech/interview-contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nativeCaptureAvailable, screenWatchHost } from "../host-adapter";
import { holdAwake } from "../keep-awake";
import type { CommandResult } from "../session-snapshot";
import {
  AUTO_MAX_PER_SESSION,
  type AutoBlock,
  gateAutoCapture,
} from "./auto-gate";
import type { FrameHash } from "./auto-hash";
import { clampIntervalSeconds, shouldAnalyze } from "./auto-interval";
import { type AutoLine, autoLine } from "./auto-line";
import { isOwnerPaused } from "./auto-owner-pause";
import {
  loadAutoHeartbeat,
  loadAutoInterval,
  loadAutoPreferred,
  saveAutoHeartbeat,
  saveAutoInterval,
  saveAutoPreferred,
} from "./auto-prefs";
import { useDictation } from "./dictation";
import type { Rect } from "./mask-geometry";

// How often listening is checked and, if it ended for a reason retrying can
// fix, started again. The dictation hook's own restart handles the common case
// (silence); this is the backstop, and it never runs faster than this.
export const LISTEN_CHECK_MS = 5_000;
export const RESUME_FIRST_MS = 1_500;
export const RESUME_RETRY_MS = 8_000;
export const RESUME_MAX_TRIES = 3;
// How a host watch that found no focused window is started again.
export const WATCH_RETRY_MS = 5_000;
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
  // A hash of the current frame inside the mask (a browser share's video, or a
  // fresh host capture). Null: no frame yet. May throw a FrameProblem.
  sample(mask: Rect): FrameHash | null | Promise<FrameHash | null>;
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
  // The host's screen watch; defaults to the one `window.studioHost` offers.
  // null forces the browser sampler.
  screenWatch?: ScreenWatchHost | null | undefined;
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
    if (!on || !input.open) return;
    return holdAwake();
  }, [on, input.open]);
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
      // [SAFETY] Auto on (live, or as the owner stored it) submits what was
      // heard; only with Auto off does it become a typed draft.
      if (onRef.current || loadAutoPreferred(input.tenant)) sendHeard(phrase);
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
  const [block, setBlock] = useState<AutoBlock | null>(null);
  const [autoCount, setAutoCount] = useState(0);
  const counted = useRef({ count: 0, lastAt: null as number | null });
  const inFlight = useRef(false);
  // The last ANALYSED frame: new frames are compared with it on this device.
  const analyzed = useRef<{ hash: FrameHash | null; at: number | null }>({
    hash: null,
    at: null,
  });
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<number | null>(null);
  const [screenProblem, setScreenProblem] = useState<
    "permission-denied" | "display-changed" | null
  >(null);
  const [intervalSec, setIntervalState] = useState(() =>
    loadAutoInterval(input.tenant),
  );
  const [heartbeat, setHeartbeatState] = useState(() =>
    loadAutoHeartbeat(input.tenant),
  );
  useEffect(() => {
    setIntervalState(loadAutoInterval(input.tenant));
    setHeartbeatState(loadAutoHeartbeat(input.tenant));
  }, [input.tenant]);
  const setIntervalSec = useCallback(
    (seconds: number) => {
      const next = clampIntervalSeconds(seconds);
      saveAutoInterval(input.tenant, next);
      setIntervalState(next);
    },
    [input.tenant],
  );
  const setHeartbeat = useCallback(
    (next: boolean) => {
      saveAutoHeartbeat(input.tenant, next);
      setHeartbeatState(next);
    },
    [input.tenant],
  );
  const heartbeatRef = useRef(heartbeat);
  heartbeatRef.current = heartbeat;
  // Another session starts the count and the picture over.
  useEffect(() => {
    counted.current = { count: 0, lastAt: null };
    analyzed.current = { hash: null, at: null };
    setLastAnalyzedAt(null);
    setAutoCount(0);
    setBlock(null);
    setScreenProblem(null);
  }, [input.sessionId]);

  // ---- Watching the screen: an interval --------------------------------------
  // Every `intervalSec` a frame is sampled and hashed on this device. It is
  // analysed (a fresh capture, through the card's own route) only when it
  // differs from the last analysed frame, is the first, or the optional
  // heartbeat elapsed; an identical frame is dropped here. The rate limit, the
  // cap, pause, device-only and one-in-flight apply as before.
  const host = useMemo(
    () =>
      input.screenWatch === undefined ? screenWatchHost() : input.screenWatch,
    [input.screenWatch],
  );
  const native = nativeCaptureAvailable();
  const sourceReady = input.sharing || native;
  const interval =
    on && input.open && !input.paused && !input.deviceOnly && input.wantsScreen;
  const captureTick = useCallback(async () => {
    const now = latest.current;
    if (!now.open || now.paused || now.deviceOnly) return;
    if (!(now.sharing || nativeCaptureAvailable())) {
      setBlock("no-source");
      return;
    }
    // Nothing is sampled while a capture or analysis is in flight.
    if (inFlight.current || now.busy) {
      setBlock("busy");
      return;
    }
    let hash: FrameHash | null;
    try {
      hash = await now.sample(now.mask);
      setScreenProblem(null);
    } catch (error) {
      const reason = (error as { code?: string } | null)?.code;
      setScreenProblem(
        reason === "permission-denied" || reason === "display-changed"
          ? reason
          : null,
      );
      return;
    }
    if (!hash) return;
    if (
      !shouldAnalyze({
        hash,
        nowMs: clock(),
        lastHash: analyzed.current.hash,
        lastAnalyzedAtMs: analyzed.current.at,
        heartbeat: heartbeatRef.current,
      })
    ) {
      setBlock(null);
      return;
    }
    const gate = gateAutoCapture({
      nowMs: clock(),
      open: now.open,
      paused: now.paused,
      deviceOnly: now.deviceOnly,
      sharing: true,
      inFlight: inFlight.current || now.busy,
      autoCount: counted.current.count,
      lastAutoAtMs: counted.current.lastAt,
    });
    if (!gate.ok) {
      // The frame stays unanalysed, so it is tried again on a later tick.
      setBlock(gate.reason);
      return;
    }
    setBlock(null);
    inFlight.current = true;
    counted.current = { count: counted.current.count + 1, lastAt: clock() };
    setAutoCount(counted.current.count);
    const sent = await now.capture().catch(() => false);
    inFlight.current = false;
    if (sent) {
      analyzed.current = { hash, at: clock() };
      setLastAnalyzedAt(clock());
    } else {
      // Not charged; the same picture is tried again next tick.
      counted.current = {
        count: counted.current.count - 1,
        lastAt: counted.current.lastAt,
      };
      setAutoCount(counted.current.count);
    }
  }, [clock]);
  const tickRef = useRef(captureTick);
  tickRef.current = captureTick;
  useEffect(() => {
    if (!on) return;
    if (input.deviceOnly) setBlock("device-only");
  }, [on, input.deviceOnly]);
  useEffect(() => {
    if (!interval) return;
    const timer = setInterval(
      () => void tickRef.current(),
      intervalSec * 1_000,
    );
    return () => clearInterval(timer);
  }, [interval, intervalSec]);

  // ---- The host's own change events -----------------------------------------
  // They only TRIGGER a tick sooner; the interval stays the primary path and
  // the same hash comparison and gate decide.
  useEffect(() => {
    if (!host || !interval) return;
    let cancelled = false;
    let removeListener: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const begin = async () => {
      const result = await host
        .start({ mode: "focused-window" })
        .catch(() => ({ ok: false as const, reason: "invalid" as const }));
      if (cancelled) return;
      if (!result.ok) {
        if (result.reason === "no-focused-window")
          retry = setTimeout(() => void begin(), WATCH_RETRY_MS);
        return;
      }
      removeListener = host.onChange(() => void tickRef.current());
    };
    void begin();
    return () => {
      cancelled = true;
      if (retry !== null) clearTimeout(retry);
      removeListener?.();
      void Promise.resolve(host.stop()).catch(() => undefined);
    };
  }, [host, interval]);

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
        engine: input.engineListening === true,
        micError:
          heardError === null
            ? null
            : "a phrase could not be sent. It will be tried again with the next one.",
        listening: dictation.state === "listening",
        heardAgoMs:
          dictation.heardAt === null ? null : clock() - dictation.heardAt,
        wantsScreen: input.wantsScreen,
        deviceOnly: input.deviceOnly,
        sharing: sourceReady,
        watchable: input.watchable,
        intervalSec,
        lastAnalyzedAgoMs:
          lastAnalyzedAt === null ? null : clock() - lastAnalyzedAt,
        screenProblem,
        autoCount,
        autoMax: AUTO_MAX_PER_SESSION,
        block,
      })
    : null;

  return {
    on,
    setOn,
    line,
    autoCount,
    intervalSec,
    setIntervalSec,
    heartbeat,
    setHeartbeat,
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
