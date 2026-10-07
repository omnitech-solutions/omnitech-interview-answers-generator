// The ONE table of everything that can stop a capture or an analysis, said the
// same way on the native answer pane, the card and the web hands-free band: what
// went wrong, what to do about it, and (where the app can do it) a button. Pure.
//
// Every way a capture can fail or not start has a closed reason here; a surface
// never invents its own words, and a failure is never swallowed.
//
// [SAFETY] The only variable text is the NAME of the application that was in
// front (cleaned and bounded by `cleanFrontApp`): never a window title, an
// address or any captured content.
import { STUDIO_HOST_FRONT_APP_MAX } from "@omnitech/interview-contracts";
import { nativeChord } from "./shortcuts";

export const CAPTURE_PROBLEM_REASONS = [
  // The shell found no browser window to capture.
  "no-focused-window",
  // macOS Screen Recording is off for this app.
  "permission-denied",
  "capture-failed",
  // The shell refused: another capture was already running.
  "busy",
  // The shell did not answer within HOST_CAPTURE_TIMEOUT_MS.
  "timeout",
  // The host offers no screen capture (an older shell, or none).
  "host-unavailable",
  "device-only",
  "limit-reached",
  "session-paused",
  "session-ended",
  // The shared window, tab or screen is gone.
  "source-lost",
  "share-needed",
  "share-cancelled",
  "share-unsupported",
  "share-failed",
  "display-changed",
  "not-ready",
  "too-large",
] as const;
export type CaptureProblemReason = (typeof CAPTURE_PROBLEM_REASONS)[number];

export const isCaptureProblemReason = (
  value: unknown,
): value is CaptureProblemReason =>
  typeof value === "string" &&
  (CAPTURE_PROBLEM_REASONS as readonly string[]).includes(value);

export type CaptureProblemContext = {
  // "manual": the person asked (button, hotkey, Add screenshot). "auto": Auto asked.
  intent: "manual" | "auto";
  // The application that was in front, from the shell (a name only).
  frontApp?: string | null | undefined;
};

// A button the surface can offer for a problem; the surface wires it.
export type CaptureProblemAction = {
  id: "open-screen-recording-settings";
  label: string;
};

export type CaptureProblem = {
  reason: CaptureProblemReason;
  title: string;
  fix: string;
  action?: CaptureProblemAction;
};

export const DEVICE_ONLY_ANALYZE =
  "Device-only mode never sends a screenshot to an assistant.";

// C0 and C1 control characters, checked by code unit.
function isControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

// A name from the shell is believed only when it is plain text of bounded length.
export function cleanFrontApp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = [...value]
    .filter((char) => !isControlCharacter(char))
    .join("")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  return text === "" ? null : text.slice(0, STUDIO_HOST_FRONT_APP_MAX);
}

export const SCREEN_RECORDING_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

const SCREEN_RECORDING_ACTION: CaptureProblemAction = {
  id: "open-screen-recording-settings",
  label: "Open Screen Recording settings",
};

export function captureProblem(
  reason: CaptureProblemReason,
  context: CaptureProblemContext = { intent: "manual" },
): CaptureProblem {
  const make = (
    title: string,
    fix: string,
    action?: CaptureProblemAction,
  ): CaptureProblem => ({
    reason,
    title,
    fix,
    ...(action ? { action } : {}),
  });
  switch (reason) {
    case "no-focused-window": {
      if (context.intent === "auto") {
        const front = cleanFrontApp(context.frontApp);
        return make(
          front ? `${front} is in front` : "No browser is in front",
          `Press ${nativeChord("analyze")} while Chrome or Safari is in front, or click the browser first.`,
        );
      }
      return make(
        "No browser window found",
        "Open Chrome or Safari, then try again.",
      );
    }
    case "permission-denied":
      return make(
        "Screen Recording is off for Interview Studio",
        "Turn it on in System Settings → Privacy & Security → Screen & System Audio Recording, then reopen the app.",
        SCREEN_RECORDING_ACTION,
      );
    case "capture-failed":
      return make(
        "The capture failed",
        "Try again. If it keeps failing, check Screen Recording in System Settings.",
      );
    case "busy":
      return make(
        "A capture is already running",
        "Wait a moment for it to finish, then try again.",
      );
    case "timeout":
      return make(
        "The shell did not answer",
        "Try again. If it keeps happening, quit and reopen Interview Studio.",
      );
    case "host-unavailable":
      return make(
        "This app cannot capture the screen",
        "Update Interview Studio to the latest version, or share a window from the browser.",
      );
    case "device-only":
      return make(
        DEVICE_ONLY_ANALYZE,
        "Switch the session out of device-only to analyze a screen.",
      );
    case "limit-reached":
      return make(
        "The capture limit for this session is reached",
        "Start a new session to capture more.",
      );
    case "session-paused":
      return make("The session is paused", "Press Resume, then capture again.");
    case "session-ended":
      return make(
        "The session has ended",
        "Start a new session to capture again.",
      );
    case "source-lost":
      return make(
        "The shared window or screen is gone",
        "Share a window, tab or screen again, then capture.",
      );
    case "share-needed":
      return make(
        "Nothing is shared yet",
        "Share a window, tab or screen first (Settings), then capture.",
      );
    case "share-cancelled":
      return make(
        "Nothing was shared",
        "Choose a window, tab or screen in the browser’s picker, then capture.",
      );
    case "share-unsupported":
      return make(
        "This browser can’t share a window, tab or screen",
        "Use Chrome or Edge, or the native app.",
      );
    case "share-failed":
      return make(
        "Couldn’t start sharing",
        "Try again, and allow screen sharing in the browser if it asks.",
      );
    case "display-changed":
      return make(
        "Your display changed",
        "The capture area was cleared. Choose the area again.",
      );
    case "not-ready":
      return make(
        "The shared source isn’t ready yet",
        "Try again in a moment.",
      );
    case "too-large":
      return make(
        "That frame is too large to send",
        "Choose a smaller region, then capture.",
      );
  }
}

// A problem as one line, for a place with room for one (the Auto status line).
export const captureProblemLine = (
  reason: CaptureProblemReason,
  context: CaptureProblemContext,
): string => {
  const { title, fix } = captureProblem(reason, context);
  return `${title}. ${fix}`;
};
