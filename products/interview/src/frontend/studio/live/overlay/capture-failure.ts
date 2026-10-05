// What a thrown capture error means to the person: one place that turns the
// errors a grab can end with into a closed capture-problem reason, so no surface
// reads error codes (or ignores them) on its own.
import {
  type CaptureProblemReason,
  cleanFrontApp,
} from "../shared/capture-problem";
import { FrameError, ShareError } from "./capture-source";

export type CaptureFailure = {
  reason: CaptureProblemReason;
  // The application that was in front, for no-focused-window.
  frontApp: string | null;
};

const FRAME_REASONS: Record<FrameError["code"], CaptureProblemReason> = {
  "not-ready": "not-ready",
  "too-large": "too-large",
  "encode-failed": "capture-failed",
  "display-changed": "display-changed",
  "permission-denied": "permission-denied",
  "no-focused-window": "no-focused-window",
  busy: "busy",
  timeout: "timeout",
  unavailable: "host-unavailable",
  "capture-failed": "capture-failed",
};
const SHARE_REASONS: Record<ShareError["code"], CaptureProblemReason> = {
  unsupported: "share-unsupported",
  cancelled: "share-cancelled",
  failed: "share-failed",
};

// Anything unknown is still a capture failure the person is told about.
export function captureFailureOf(error: unknown): CaptureFailure {
  if (error instanceof FrameError)
    return {
      reason: FRAME_REASONS[error.code],
      frontApp: cleanFrontApp(error.frontApp),
    };
  if (error instanceof ShareError)
    return { reason: SHARE_REASONS[error.code], frontApp: null };
  return { reason: "capture-failed", frontApp: null };
}

const SAMPLE_REASONS: Record<string, CaptureProblemReason | null> = {
  "permission-denied": "permission-denied",
  "display-changed": "display-changed",
  "no-focused-window": "no-focused-window",
  timeout: "timeout",
  failed: "capture-failed",
  unavailable: "host-unavailable",
  // Another capture was running: Auto simply tries again on its next tick.
  busy: null,
};

// What Auto's change check threw (a host frame that was refused carries its
// reason as `code`): the problem its status line shows, or null for a hiccup
// that clears by itself.
export function sampleFailureOf(error: unknown): CaptureFailure | null {
  const { code, frontApp } = (error ?? {}) as {
    code?: unknown;
    frontApp?: unknown;
  };
  const reason =
    typeof code === "string" ? SAMPLE_REASONS[code] : "capture-failed";
  if (reason === undefined) return { reason: "capture-failed", frontApp: null };
  return reason === null ? null : { reason, frontApp: cleanFrontApp(frontApp) };
}
