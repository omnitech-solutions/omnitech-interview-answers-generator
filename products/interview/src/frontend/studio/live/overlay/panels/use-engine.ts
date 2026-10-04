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
import { useEffect, useRef, useState } from "react";

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

export type EngineView = {
  present: boolean;
  state: EngineState | null;
  refused: EngineStartRefusal | null;
  // The engine is the listener: the browser recogniser must stay off.
  listening: boolean;
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
  const sourcesKey = input.sources.join(",");
  const paused = useRef(input.paused);
  paused.current = input.paused;

  useEffect(() => {
    if (!host) return;
    return host.onEvent(setState);
  }, [host]);

  useEffect(() => {
    if (!host || !input.wanted || !input.sessionId) return;
    let alive = true;
    setRefused(null);
    setStarting(true);
    void settle(() =>
      host.start({
        sessionId: input.sessionId as string,
        sources: sourcesKey.split(",").filter(Boolean) as never,
      }),
    ).then((reply) => {
      if (!alive) return;
      setStarting(false);
      if (reply.ok) setState(reply.engine);
      else setRefused(reply.reason);
    });
    return () => {
      alive = false;
      setStarting(false);
      void settle(() => host.stop()).then((reply) => {
        if (reply.ok) setState(reply.engine);
      });
    };
  }, [host, input.wanted, input.sessionId, sourcesKey]);

  // The session's pause is mirrored to the engine.
  useEffect(() => {
    if (!host || !input.wanted || (!state?.listening && !state?.paused)) return;
    if (input.paused === state.paused) return;
    void settle(() => (input.paused ? host.pause() : host.resume())).then(
      (reply) => reply.ok && setState(reply.engine),
    );
  }, [host, input.wanted, input.paused, state?.listening, state?.paused]);

  return {
    present: host !== null,
    state,
    refused,
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
  if (view.refused) return `Engine could not start (${view.refused}).`;
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
