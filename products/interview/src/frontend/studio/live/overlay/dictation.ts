// Browser dictation: the Web Speech API's SpeechRecognition (the webkit prefix
// is fine). Continuous, with interim results shown as they come; each FINAL
// phrase is handed to the caller, which appends it to the follow-up input. It is
// never sent by itself.
//
// [SAFETY] In a device-only session the recognition must run on this device
// (`processLocally`): a browser that cannot do that refuses, with a message,
// rather than sending audio to a speech service. In a remote session Chrome may
// use its own speech service, which the tooltip says.
import { useCallback, useEffect, useRef, useState } from "react";
import { createRestartPolicy } from "./auto-restart";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
};
export type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally?: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type OnDeviceOptions = { langs: string[]; processLocally: true };
type RecognitionCtor = (new () => Recognition) & {
  // The on-device capability check and language-pack install, where the browser
  // has them (Chrome 139+).
  available?: (options: OnDeviceOptions) => Promise<string>;
  install?: (options: OnDeviceOptions) => Promise<boolean>;
};

export function recognitionCtor(): RecognitionCtor | null {
  const host = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

export const DICTATION_NOTE =
  "Browser dictation. In a remote session your browser may use its own speech service; a device-only session requires on-device recognition.";

export const DICTATION_MESSAGES = {
  unsupported:
    "This browser has no dictation. Use Chrome or Edge, or type the follow-up.",
  deviceOnlyUnsupported:
    "Device-only mode needs on-device dictation, which this browser can’t do, so dictation is off. Type the follow-up instead.",
  deviceOnlyUnavailable:
    "Device-only mode needs on-device dictation, and it isn’t available for your language in this browser, so dictation is off. Type the follow-up instead.",
  denied:
    "Microphone permission was denied. Allow it for this site in the browser’s site settings, then try again.",
  noSpeech: "No speech heard. Try again closer to the microphone.",
  noMicrophone: "No microphone was found. Connect one and try again.",
  network:
    "Dictation couldn’t reach the browser’s speech service. Check the connection and try again.",
  other: "Dictation stopped because of an error. Try again.",
} as const;

const messageFor = (error: string): string =>
  error === "not-allowed" || error === "service-not-allowed"
    ? DICTATION_MESSAGES.denied
    : error === "no-speech"
      ? DICTATION_MESSAGES.noSpeech
      : error === "audio-capture"
        ? DICTATION_MESSAGES.noMicrophone
        : error === "network"
          ? DICTATION_MESSAGES.network
          : DICTATION_MESSAGES.other;

// Errors after which listening again would only repeat the failure.
const FATAL = new Set([
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "network",
  "language-not-supported",
]);

export type DictationState = "idle" | "listening";

// How long with nothing heard before the hint says so.
export const SILENCE_HINT_MS = 6_000;
const METER_MS = 100;

type AudioCtor = new () => {
  createMediaStreamSource(stream: MediaStream): {
    connect(node: unknown): void;
  };
  createAnalyser(): {
    fftSize: number;
    getByteTimeDomainData(data: Uint8Array): void;
  };
  close(): Promise<void> | void;
};

// A local level meter: the microphone's loudness from an AnalyserNode. Nothing
// is recorded or sent; the stream and the context are closed with dictation.
// Where the browser will not give one, there is no meter and the card shows an
// animated indicator instead.
async function startMeter(
  onLevel: (level: number) => void,
): Promise<() => void> {
  const media = navigator.mediaDevices;
  const host = window as unknown as {
    AudioContext?: AudioCtor;
    webkitAudioContext?: AudioCtor;
  };
  const Ctor = host.AudioContext ?? host.webkitAudioContext;
  if (!media || typeof media.getUserMedia !== "function" || !Ctor)
    return () => undefined;
  const stream = await media.getUserMedia({ audio: true });
  const context = new Ctor();
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  context.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) sum += ((value - 128) / 128) ** 2;
    // Speech sits well below full scale: stretch it so the meter moves.
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
  }, METER_MS);
  return () => {
    clearInterval(timer);
    for (const track of stream.getTracks()) track.stop();
    void Promise.resolve(context.close()).catch(() => undefined);
  };
}

// [SAFETY] Device-only: on-device recognition must be established BEFORE any
// audio is recorded. A browser that cannot say so (no available()) is refused,
// as is one whose language pack is missing and cannot be installed.
async function establishOnDevice(
  Ctor: RecognitionCtor,
  rec: Recognition,
  lang: string,
): Promise<string | null> {
  if (!("processLocally" in rec) || typeof Ctor.available !== "function")
    return DICTATION_MESSAGES.deviceOnlyUnsupported;
  const options: OnDeviceOptions = { langs: [lang], processLocally: true };
  try {
    let availability = await Ctor.available(options);
    if (
      (availability === "downloadable" || availability === "downloading") &&
      typeof Ctor.install === "function"
    ) {
      if (!(await Ctor.install(options)))
        return DICTATION_MESSAGES.deviceOnlyUnavailable;
      availability = await Ctor.available(options);
    }
    if (availability !== "available")
      return DICTATION_MESSAGES.deviceOnlyUnavailable;
  } catch {
    return DICTATION_MESSAGES.deviceOnlyUnavailable;
  }
  rec.processLocally = true;
  return null;
}

export function useDictation({
  deviceOnly,
  bindingKey = null,
  persistent = false,
  onFinal,
}: {
  // Hands-free Auto: listening carries on through silence timeouts and errors
  // that retrying can fix (restarting with a growing wait), and only stops for
  // one that cannot be fixed by retrying (permission, no microphone).
  persistent?: boolean;
  deviceOnly: boolean;
  // The session dictation belongs to: phrases heard under another one are
  // dropped, and a change of session ends listening.
  bindingKey?: string | null;
  onFinal(text: string): void;
}) {
  const [state, setState] = useState<DictationState>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  // null: no meter in this browser (the card animates instead).
  const [level, setLevel] = useState<number | null>(null);
  // Nothing at all heard since listening began, and for how long.
  const [silent, setSilent] = useState(false);
  const [heard, setHeard] = useState(false);
  // When a phrase last arrived (Date.now), and whether the browser said the
  // microphone is not allowed: the real state behind the lights.
  const [heardAt, setHeardAt] = useState<number | null>(null);
  const [denied, setDenied] = useState(false);
  const restart = useRef(createRestartPolicy());
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivity = useRef(0);
  const stopMeter = useRef<(() => void) | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  // Bumped by every stop and every new attempt: an on-device check that
  // finishes after either is ignored.
  const attempt = useRef(0);
  const binding = useRef(bindingKey);
  binding.current = bindingKey;
  const final = useRef(onFinal);
  final.current = onFinal;
  const keepAlive = useRef(persistent);
  keepAlive.current = persistent;
  const supported = recognitionCtor() !== null;

  const endMeter = useCallback(() => {
    stopMeter.current?.();
    stopMeter.current = null;
    setLevel(null);
  }, []);

  const stop = useCallback(() => {
    attempt.current += 1;
    if (restartTimer.current !== null) clearTimeout(restartTimer.current);
    restartTimer.current = null;
    restart.current.reset();
    endMeter();
    setSilent(false);
    setHeard(false);
    wanted.current = false;
    recognition.current?.stop();
    recognition.current = null;
    setState("idle");
    setInterim("");
  }, [endMeter]);

  const begin = useCallback(
    (rec: Recognition) => {
      const origin = binding.current;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || "en-US";
      rec.onresult = (event) => {
        lastActivity.current = Date.now();
        restart.current.heard();
        setSilent(false);
        setHeard(true);
        setHeardAt(lastActivity.current);
        let pending = "";
        for (let at = event.resultIndex; at < event.results.length; at += 1) {
          const result = event.results[at];
          if (!result) continue;
          const text = result[0].transcript;
          if (result.isFinal) {
            const phrase = text.trim();
            // [SAFETY] Words heard for one session never land in another's input.
            if (phrase !== "" && origin === binding.current)
              final.current(phrase);
          } else pending += text;
        }
        setInterim(pending.trim());
      };
      rec.onerror = (event) => {
        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed"
        )
          setDenied(true);
        // Silence and a dropped connection are expected in a long listen: the
        // restart below handles them, and they are not shown as errors.
        if (
          keepAlive.current &&
          (event.error === "no-speech" ||
            event.error === "aborted" ||
            event.error === "network")
        ) {
          if (event.error === "network") setError(messageFor(event.error));
          return;
        }
        setError(messageFor(event.error));
        if (FATAL.has(event.error)) wanted.current = false;
      };
      rec.onend = () => {
        // The browser ends a session after a pause; carry on while it is wanted.
        if (wanted.current) {
          const wait = restart.current.ended(Date.now());
          const again = () => {
            restartTimer.current = null;
            if (!wanted.current) return;
            try {
              restart.current.started(Date.now());
              rec.start();
            } catch {
              wanted.current = false;
              recognition.current = null;
              endMeter();
              setState("idle");
              setInterim("");
            }
          };
          // [SAFETY] A run that dies young waits longer each time: no storm.
          if (wait === 0) {
            try {
              restart.current.started(Date.now());
              rec.start();
              return;
            } catch {
              // Fall through to idle.
            }
          } else {
            restartTimer.current = setTimeout(again, wait);
            return;
          }
        }
        wanted.current = false;
        recognition.current = null;
        endMeter();
        setState("idle");
        setInterim("");
      };
      setError(null);
      setDenied(false);
      try {
        restart.current.reset();
        restart.current.started(Date.now());
        rec.start();
      } catch {
        setError(DICTATION_MESSAGES.other);
        return;
      }
      recognition.current = rec;
      wanted.current = true;
      lastActivity.current = Date.now();
      setSilent(false);
      setHeard(false);
      setState("listening");
      // Best effort: a refusal here (no permission) is dictation's own error.
      void startMeter(setLevel).then(
        (end) => {
          if (wanted.current) stopMeter.current = end;
          else end();
        },
        () => undefined,
      );
    },
    [endMeter],
  );

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError(DICTATION_MESSAGES.unsupported);
      return;
    }
    const rec = new Ctor();
    if (!deviceOnly) {
      begin(rec);
      return;
    }
    // [SAFETY] On this device or not at all, and decided before recording.
    const mine = ++attempt.current;
    setError(null);
    void establishOnDevice(Ctor, rec, navigator.language || "en-US").then(
      (refusal) => {
        if (mine !== attempt.current) return;
        if (refusal) setError(refusal);
        else begin(rec);
      },
    );
  }, [deviceOnly, begin]);

  const toggle = useCallback(() => {
    if (wanted.current) stop();
    else start();
  }, [start, stop]);

  // Another session: listening ends, whatever was being heard is dropped.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    return () => {
      attempt.current += 1;
      if (wanted.current) stopRef.current();
    };
  }, [bindingKey]);

  // After a few seconds of nothing, say so.
  useEffect(() => {
    if (state !== "listening") return;
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current >= SILENCE_HINT_MS) setSilent(true);
    }, 500);
    return () => clearInterval(timer);
  }, [state]);

  const clearInterim = useCallback(() => setInterim(""), []);

  // Leaving the page or the card ends listening.
  useEffect(
    () => () => {
      wanted.current = false;
      if (restartTimer.current !== null) clearTimeout(restartTimer.current);
      recognition.current?.abort();
      stopMeter.current?.();
    },
    [],
  );

  return {
    state,
    interim,
    error,
    supported,
    level,
    heard,
    heardAt,
    denied,
    // "Heard nothing": listening for a while and not a word yet.
    heardNothing: state === "listening" && silent && !heard,
    toggle,
    start,
    stop,
    clearInterim,
  };
}
