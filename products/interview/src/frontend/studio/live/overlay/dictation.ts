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
type RecognitionCtor = new () => Recognition;

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

export function useDictation({
  deviceOnly,
  onFinal,
}: {
  deviceOnly: boolean;
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
  const lastActivity = useRef(0);
  const stopMeter = useRef<(() => void) | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const final = useRef(onFinal);
  final.current = onFinal;
  const supported = recognitionCtor() !== null;

  const endMeter = useCallback(() => {
    stopMeter.current?.();
    stopMeter.current = null;
    setLevel(null);
  }, []);

  const stop = useCallback(() => {
    endMeter();
    setSilent(false);
    setHeard(false);
    wanted.current = false;
    recognition.current?.stop();
    recognition.current = null;
    setState("idle");
    setInterim("");
  }, [endMeter]);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError(DICTATION_MESSAGES.unsupported);
      return;
    }
    const rec = new Ctor();
    if (deviceOnly) {
      // [SAFETY] On this device or not at all.
      if (!("processLocally" in rec)) {
        setError(DICTATION_MESSAGES.deviceOnlyUnsupported);
        return;
      }
      rec.processLocally = true;
    }
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (event) => {
      lastActivity.current = Date.now();
      setSilent(false);
      setHeard(true);
      let pending = "";
      for (let at = event.resultIndex; at < event.results.length; at += 1) {
        const result = event.results[at];
        if (!result) continue;
        const text = result[0].transcript;
        if (result.isFinal) {
          const phrase = text.trim();
          if (phrase !== "") final.current(phrase);
        } else pending += text;
      }
      setInterim(pending.trim());
    };
    rec.onerror = (event) => {
      setError(messageFor(event.error));
      if (FATAL.has(event.error)) wanted.current = false;
    };
    rec.onend = () => {
      // The browser ends a session after a pause; carry on while it is wanted.
      if (wanted.current) {
        try {
          rec.start();
          return;
        } catch {
          // Fall through to idle.
        }
      }
      wanted.current = false;
      recognition.current = null;
      endMeter();
      setState("idle");
      setInterim("");
    };
    setError(null);
    try {
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
  }, [deviceOnly, endMeter]);

  const toggle = useCallback(() => {
    if (wanted.current) stop();
    else start();
  }, [start, stop]);

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
    // "Heard nothing": listening for a while and not a word yet.
    heardNothing: state === "listening" && silent && !heard,
    toggle,
    stop,
    clearInterim,
  };
}
