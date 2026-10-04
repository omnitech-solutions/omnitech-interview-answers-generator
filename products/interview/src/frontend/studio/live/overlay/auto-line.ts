// The one line the Auto control shows: its state when all is well, or the single
// thing that needs the owner when it is not. Pure. Browser security requires a
// click to share a screen again, and the line says so rather than pretending
// Auto could do it.
import { AUTO_BLOCK_TEXT, type AutoBlock } from "./auto-gate";

export type AutoLineInput = {
  open: boolean;
  paused: boolean;
  ownerPaused: boolean;
  resumeFailed: boolean;
  // The browser said the microphone is not allowed.
  micDenied: boolean;
  // This browser has no speech recognition.
  micUnsupported: boolean;
  // Dictation could not start for a reason it states (device-only, no mic).
  micError: string | null;
  listening: boolean;
  // Milliseconds since a phrase was last heard; null: none yet.
  heardAgoMs: number | null;
  // The session has a screen source and is not device-only.
  wantsScreen: boolean;
  deviceOnly: boolean;
  sharing: boolean;
  // A native host share cannot be watched for change.
  watchable: boolean;
  block: AutoBlock | null;
};

export type AutoLine = {
  text: string;
  // "problem": one action is needed; "ok": running; "wait": paused for a reason
  // that clears by itself.
  tone: "ok" | "problem" | "wait";
};

const seconds = (ms: number): string =>
  `${Math.max(0, Math.round(ms / 1000))} s`;

export function autoLine(input: AutoLineInput): AutoLine | null {
  if (!input.open) return null;
  if (input.paused)
    return input.ownerPaused
      ? {
          tone: "wait",
          text: "Auto · paused by you. Press Resume to continue.",
        }
      : input.resumeFailed
        ? {
            tone: "problem",
            text: "Auto · the session is paused and could not resume itself. Press Resume.",
          }
        : { tone: "wait", text: "Auto · session paused · resuming…" };
  if (input.micDenied)
    return {
      tone: "problem",
      text: "Auto · microphone not allowed. Allow it in the browser’s site settings, then turn Auto off and on.",
    };
  if (input.micUnsupported)
    return {
      tone: "problem",
      text: "Auto · this browser can’t listen. Use Chrome or Edge, or the native companion for audio.",
    };
  if (input.micError)
    return { tone: "problem", text: `Auto · ${input.micError}` };
  if (input.wantsScreen && !input.deviceOnly && !input.sharing)
    return {
      tone: "problem",
      text: "Auto · not watching a screen. The browser needs one click to share again: press Share.",
    };
  const ear = input.listening
    ? input.heardAgoMs === null
      ? "listening"
      : `listening · heard ${seconds(input.heardAgoMs)} ago`
    : "starting to listen";
  const eye = input.deviceOnly
    ? "screen not analysed (device-only)"
    : !input.wantsScreen
      ? null
      : !input.watchable
        ? "capture the screen by hand"
        : "watching screen";
  const tail =
    input.block === "cap" || input.block === "no-source"
      ? ` · ${AUTO_BLOCK_TEXT[input.block]}`
      : "";
  return {
    tone: "ok",
    text: `Auto · ${[ear, eye].filter(Boolean).join(" · ")}${tail}`,
  };
}
