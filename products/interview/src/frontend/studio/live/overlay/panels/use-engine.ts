// The native engine (window.studioHost.engine): hands-free listening and
// watching done by the shell. Studio decides: this starts it for the open
// session when Auto begins, stops it when Auto ends, and holds and resumes it
// with the session. The shell reports typed, content-free state. The pairing
// credential never reaches this page.
//
// [SAFETY] While the engine is starting or listening, the page does NOT start
// the browser's speech recogniser: only one listener posts transcripts. With no
// engine (or one that refused to start) the browser recogniser is the fallback.
import type {
  EngineHost,
  EngineReply,
  EngineStartRefusal,
  EngineState,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useRef, useState } from "react";

export function engineHost(): EngineHost | null {
  if (typeof window === "undefined") return null;
  const candidate = (
    window.studioHost as { engine?: Partial<EngineHost> } | undefined
  )?.engine;
  if (!candidate) return null;
  const complete = (
    ["start", "stop", "pause", "resume", "status", "onEvent"] as const
  ).every((name) => typeof candidate[name] === "function");
  return complete ? (candidate as EngineHost) : null;
}

const settle = async (
  call: () => Promise<EngineReply>,
): Promise<EngineReply> => {
  try {
    return await call();
  } catch {
    return { ok: false, reason: "store-failed" };
  }
};

// What a press of the microphone control does, and whether the engine is held.
// ONE predicate: the label, the disabled state and the press all read it.
//  - "held": the session is paused (or the engine is held): nothing starts or
//    stops; the control says "Resume the session first".
//  - "stop": the engine listens and its microphone is listening.
//  - "restart": the engine runs but its microphone is starting, lost, denied or
//    unavailable: a press stops it and starts it again.
//  - "start": no engine is running (or it refused): a press starts it.
export type MicAction = "stop" | "start" | "restart" | "held";

export function micAction(input: {
  wanted: boolean;
  paused: boolean;
  refused: EngineStartRefusal | null;
  state: EngineState | null;
}): MicAction {
  if (input.wanted && (input.paused || input.state?.paused === true))
    return "held";
  if (input.refused !== null || input.state?.listening !== true) return "start";
  return input.state.sources.microphone === "listening" ? "stop" : "restart";
}

export const MIC_HELD_TEXT = "Resume the session first.";

export type EngineView = {
  present: boolean;
  state: EngineState | null;
  refused: EngineStartRefusal | null;
  // The engine is the listener: the browser recogniser must stay off.
  listening: boolean;
  // The microphone control (Alt+R, "Stop microphone"): the engine's own state,
  // not the browser's. `micOn` flips only when the engine reports it, and
  // `micPending` is true while a stop or start is awaiting that report.
  micOn: boolean;
  micPending: boolean;
  // What a press does (see micAction), and the held flag the label reads.
  micAction: MicAction;
  micHeld: boolean;
  // Auto is on for an open session: the engine is the listener the press drives.
  wanted: boolean;
  toggleMic(): void;
  // "Retry now" in the microphone menu: the shell's own retry when it has one,
  // else a restart of the engine (the same as the press on a lost microphone).
  retryMic(): void;
  // Listen to this device (an id from state.microphoneDevices); null follows
  // the system default. A no-op on a shell without device choice.
  selectMic(deviceId: string | null): void;
  // Stop and start listening again (applies a setting read when a run begins).
  restart(): void;
};

export function useEngine(input: {
  sessionId: string | null;
  // Auto is on here, in the owning document, for an open session.
  wanted: boolean;
  paused: boolean;
  sources: readonly ("microphone" | "application-audio" | "screen")[];
}): EngineView {
  const host = engineHost();
  const [state, setState] = useState<EngineState | null>(null);
  const [refused, setRefused] = useState<EngineStartRefusal | null>(null);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const sourcesKey = input.sources.join(",");
  const [micPending, setMicPending] = useState(false);
  const micPendingRef = useRef(false);
  const latest = useRef({ input, state, host, refused });
  latest.current = { input, state, host, refused };

  // [SAFETY] Every host call goes through ONE promise chain: the shell's own
  // wait is a poll, not a queue, so a start sent before an earlier stop was
  // answered could run first. `generation` moves with every start and stop of
  // the effect below: a reply from a superseded run is dropped.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  const enqueue = useCallback(<T>(call: () => Promise<T>): Promise<T> => {
    const next = chain.current.then(call, call);
    chain.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, []);

  useEffect(() => {
    if (!host) return;
    return host.onEvent(setState);
  }, [host]);

  useEffect(() => {
    if (!host || !input.wanted || !input.sessionId) return;
    generation.current += 1;
    const mine = generation.current;
    let alive = true;
    setRefused(null);
    startingRef.current = true;
    setStarting(true);
    void enqueue(() =>
      settle(() =>
        host.start({
          sessionId: input.sessionId as string,
          sources: sourcesKey.split(",").filter(Boolean) as never,
        }),
      ),
    ).then((reply) => {
      if (!alive || generation.current !== mine) return;
      startingRef.current = false;
      setStarting(false);
      if (reply.ok) setState(reply.engine);
      else setRefused(reply.reason);
    });
    return () => {
      alive = false;
      startingRef.current = false;
      setStarting(false);
      generation.current += 1;
      const stopping = generation.current;
      void enqueue(() => settle(() => host.stop())).then((reply) => {
        // A newer run began meanwhile: its state is not this stop's to set.
        if (generation.current !== stopping) return;
        if (reply.ok) setState(reply.engine);
      });
    };
  }, [host, input.wanted, input.sessionId, sourcesKey, enqueue]);

  // The session's pause is mirrored to the engine.
  useEffect(() => {
    if (!host || !input.wanted || (!state?.listening && !state?.paused)) return;
    if (input.paused === state.paused) return;
    const mine = generation.current;
    void enqueue(() =>
      settle(() => (input.paused ? host.pause() : host.resume())),
    ).then((reply) => {
      if (reply.ok && generation.current === mine) setState(reply.engine);
    });
  }, [
    host,
    input.wanted,
    input.paused,
    state?.listening,
    state?.paused,
    enqueue,
  ]);

  // [SAFETY] One press, one host call sequence, none while one is pending. The
  // action is micAction's: stop a listening engine, start a stopped or refused
  // one, restart one whose microphone is not listening, and do nothing while
  // held. The label follows the reply, never the press.
  const toggleMic = useCallback(() => {
    const now = latest.current;
    const engine = now.host;
    if (!engine || !now.input.sessionId || !now.input.wanted) return;
    if (micPendingRef.current || startingRef.current) return;
    const action = micAction({
      wanted: now.input.wanted,
      paused: now.input.paused,
      refused: now.refused,
      state: now.state,
    });
    if (action === "held") return;
    const sessionId = now.input.sessionId;
    const sources = [...now.input.sources];
    micPendingRef.current = true;
    setMicPending(true);
    const mine = generation.current;
    const begin = () => settle(() => engine.start({ sessionId, sources }));
    void enqueue(async (): Promise<EngineReply> => {
      if (action === "stop") return settle(() => engine.stop());
      if (action === "restart") await settle(() => engine.stop());
      return begin();
    }).then((reply) => {
      micPendingRef.current = false;
      setMicPending(false);
      if (generation.current !== mine) return;
      if (reply.ok) {
        setState(reply.engine);
        if (action !== "stop") setRefused(null);
      } else if (action !== "stop") setRefused(reply.reason);
    });
  }, [enqueue]);

  // One shell call for the microphone menu (retry now, choose a device), through
  // the same chain and pending guard as the press.
  const askShell = useCallback(
    (
      call: (engine: EngineHost) => (() => Promise<EngineReply>) | undefined,
    ) => {
      const now = latest.current;
      const engine = now.host;
      if (!engine || !now.input.sessionId || !now.input.wanted) return false;
      if (micPendingRef.current || startingRef.current) return false;
      const asked = call(engine);
      if (!asked) return false;
      micPendingRef.current = true;
      setMicPending(true);
      const mine = generation.current;
      void enqueue(() => settle(asked)).then((reply) => {
        micPendingRef.current = false;
        setMicPending(false);
        if (generation.current === mine && reply.ok) setState(reply.engine);
      });
      return true;
    },
    [enqueue],
  );
  const retryMic = useCallback(() => {
    const now = latest.current;
    if (now.input.paused || now.state?.paused === true) return;
    const shellRetry = askShell((engine) =>
      engine.retryMicrophone ? () => engine.retryMicrophone!() : undefined,
    );
    if (shellRetry) return;
    // No shell retry: restart (or start) the engine, never stop a live one.
    if (now.state?.sources.microphone !== "listening") toggleMic();
  }, [askShell, toggleMic]);
  // Stop and start again with the same session and sources, so a setting the
  // shell reads when a run begins (the call-audio source) applies at once.
  // Nothing happens with no engine running, while held, or while a call is
  // pending.
  const restart = useCallback(() => {
    const now = latest.current;
    const engine = now.host;
    if (!engine || !now.input.sessionId || !now.input.wanted) return;
    if (now.input.paused || now.state?.paused === true) return;
    if (micPendingRef.current || startingRef.current) return;
    const sessionId = now.input.sessionId;
    const sources = [...now.input.sources];
    micPendingRef.current = true;
    setMicPending(true);
    const mine = generation.current;
    void enqueue(async (): Promise<EngineReply> => {
      await settle(() => engine.stop());
      return settle(() => engine.start({ sessionId, sources }));
    }).then((reply) => {
      micPendingRef.current = false;
      setMicPending(false);
      if (generation.current !== mine) return;
      if (reply.ok) {
        setState(reply.engine);
        setRefused(null);
      } else setRefused(reply.reason);
    });
  }, [enqueue]);
  const selectMic = useCallback(
    (deviceId: string | null) => {
      askShell((engine) =>
        engine.selectMicrophone
          ? () => engine.selectMicrophone!(deviceId)
          : undefined,
      );
    },
    [askShell],
  );

  const action = micAction({
    wanted: input.wanted && input.sessionId !== null,
    paused: input.paused,
    refused,
    state,
  });
  return {
    present: host !== null,
    state,
    refused,
    micOn:
      host !== null &&
      refused === null &&
      state?.listening === true &&
      state.sources.microphone === "listening",
    micPending,
    micAction: action,
    micHeld: host !== null && action === "held",
    wanted: input.wanted && input.sessionId !== null,
    toggleMic,
    retryMic,
    selectMic,
    restart,
    listening:
      host !== null &&
      input.wanted &&
      refused === null &&
      (starting || state?.listening === true || state?.paused === true),
  };
}

// One short line for the pill and status: what the engine needs or hears.
export function engineLine(view: EngineView): string | null {
  if (!view.present) return null;
  if (view.refused)
    return `Engine could not start (${view.refused}). Press the microphone to try again.`;
  const state = view.state;
  if (!state) return null;
  if (state.hint) return state.hint;
  const mic = state.sources.microphone;
  if (mic === "permission-denied") return "Microphone is not allowed.";
  if (mic === "lost") return "Microphone lost. Trying again.";
  if (state.listening && state.lastHeardAgeSeconds !== null)
    return `Listening · heard ${state.lastHeardAgeSeconds}s ago`;
  return state.listening ? "Listening" : null;
}

// Only what the owner has to act on (a refusal, a hint, a lost or denied
// microphone), for the status strip: the steady "Listening" line is not one.
export function engineNeeds(view: EngineView): string | null {
  if (!view.present || !view.wanted) return null;
  if (view.refused) return engineLine(view);
  const state = view.state;
  if (!state) return null;
  const mic = state.sources.microphone;
  if (state.hint || mic === "permission-denied" || mic === "lost")
    return engineLine(view);
  return null;
}

// What the status strip says of the engine: engineNeeds without the lost
// microphone, which the toolbar's microphone says itself (an amber "!" badge and
// "Trying again" in its menu), so there is no second banner for it.
export function engineStripNeeds(view: EngineView): string | null {
  const needs = engineNeeds(view);
  const state = view.state;
  const onlyLost =
    view.refused === null &&
    state !== null &&
    !state.hint &&
    state.sources.microphone === "lost";
  return onlyLost ? null : needs;
}

// The microphone press: the engine when it is the listener's owner (present,
// Auto on: including a refused engine, whose press starts it again), else the
// browser's dictation (Manual, unchanged). Never both.
export function pressMic(view: EngineView, dictation: () => void): void {
  if (view.present && view.wanted) view.toggleMic();
  else dictation();
}

// The microphone state both controllers report: the engine's own denial, its
// listening microphone, else the browser dictation's state.
export function engineMic(
  view: EngineView,
  fallback: "off" | "listening" | "denied",
): "off" | "listening" | "denied" {
  if (view.state?.sources.microphone === "permission-denied") return "denied";
  return view.micOn ? "listening" : fallback;
}
