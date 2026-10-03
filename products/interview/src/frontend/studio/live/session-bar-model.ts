// What the session bar shows, as pure functions of the view model: the state
// dot and label, one chip per selected source, and the fixed sentences for
// command failures. No React, no fetching. Every claim here is checked against
// the server record: "receiving" is never said without companion contact, and
// the companion is never called connected before the server has seen it.
import type {
  LiveCaptureSource,
  LiveSessionView,
} from "@omnitech/interview-contracts";
import type { IconName } from "../icon";
import type { SessionErrorCode } from "./session-client";
import type { SourceStatus } from "./session-sources";
import type { LiveViewModel } from "./session-state";

export type BarTone = "red" | "amber" | "neutral";

export type BarStateKey =
  | "live"
  | "paused"
  | "permission-revoked"
  | "source-lost"
  | "companion-offline"
  | "waiting";

export type BarStateView = {
  key: BarStateKey;
  label: string;
  tone: BarTone;
  // Only a live capture pulses.
  pulse: boolean;
  // A lost or revoked source frames the whole bar.
  bordered: boolean;
};

// Priority: the owner's pause, a revoked permission, a lost source, a silent or
// absent companion, and otherwise live. A gap alone (audio dropped, capture
// back) is shown on its chip and does not change the bar's state.
export function stateView(model: LiveViewModel): BarStateView {
  if (model.status === "paused")
    return {
      key: "paused",
      label: "Paused",
      tone: "amber",
      pulse: false,
      bordered: false,
    };
  const revoked = model.sources.find((s) => s.health === "lost-permission");
  if (revoked)
    return {
      key: "permission-revoked",
      label: "Permission revoked",
      tone: "amber",
      pulse: false,
      bordered: true,
    };
  const lost = model.sources.filter((s) => s.lost);
  const [first] = lost;
  if (first)
    return {
      key: "source-lost",
      // App audio keeps the design's wording; the microphone and the screen
      // are named so the owner knows which capture to restart.
      label:
        lost.length === 1 && first.source !== "application-audio"
          ? `${first.label} capture lost`
          : "Source lost",
      tone: "red",
      pulse: false,
      bordered: true,
    };
  if (model.companion.status === "never-seen")
    return {
      key: "waiting",
      label: "Waiting for companion",
      tone: "neutral",
      pulse: false,
      bordered: false,
    };
  if (model.companion.status === "offline")
    return {
      key: "companion-offline",
      label: "Companion offline",
      tone: "amber",
      pulse: false,
      bordered: false,
    };
  return {
    key: "live",
    label: "Live",
    tone: "red",
    pulse: true,
    bordered: false,
  };
}

export type SourceChip = {
  source: LiveCaptureSource;
  label: string;
  icon: IconName;
  tone: BarTone | "none";
  // "<label> · <state>", the tooltip and the screen-reader text.
  title: string;
  // The state alone, for the screen-reader text.
  state: string;
  // The server's disconnect or gap reason, as sent.
  reason: string | null;
};

const SOURCE_ICON: Record<LiveCaptureSource, IconName> = {
  microphone: "mic",
  "application-audio": "graphic_eq",
  screen: "screenshot_monitor",
};

const REASON_TEXT: Record<string, string> = {
  "device-lost": "device lost",
  error: "capture error",
};

function chipState(
  status: SourceStatus,
  companionOnline: boolean,
): { tone: SourceChip["tone"]; state: string } {
  switch (status.health) {
    case "disconnected":
      return { tone: "red", state: "disconnected" };
    case "lost-permission":
      return {
        tone: "amber",
        state: "permission revoked, the system withdrew access",
      };
    case "lost":
      return {
        tone: "red",
        state: `disconnected, ${REASON_TEXT[status.reason ?? ""] ?? "capture lost"}`,
      };
    case "gap":
      return {
        tone: "amber",
        state:
          status.gapMs === null
            ? "audio dropped"
            : `audio dropped for ${Math.max(1, Math.round(status.gapMs / 1000))} s`,
      };
    case "waiting":
      return { tone: "neutral", state: "waiting for the companion" };
    default:
      // "receiving" was derived from earlier observations; without current
      // contact from the companion it is not claimed.
      return companionOnline
        ? { tone: "none", state: "receiving" }
        : { tone: "neutral", state: "no recent contact" };
  }
}

// One chip per SELECTED source, in the fixed capture order.
export function sourceChips(model: LiveViewModel): SourceChip[] {
  const online = model.companion.status === "online";
  return model.sources
    .filter((status) => status.selected)
    .map((status) => {
      const { tone, state } = chipState(status, online);
      return {
        source: status.source,
        label: status.label,
        icon: SOURCE_ICON[status.source],
        tone,
        title: `${status.label} · ${state}`,
        state,
        reason: status.health === "lost-permission" ? status.reason : null,
      };
    });
}

// Shown until the choices resolve, and when they cannot: a session with no
// Interview or candidacy link is a rehearsal.
export function fallbackTitle(session: LiveSessionView): string {
  return session.interviewId || session.candidacyId
    ? "Live session"
    : "Rehearsal";
}

// Fixed sentences for a failed command; the browser only ever sees a code.
const COMMAND_MESSAGE: Partial<Record<SessionErrorCode, string>> = {
  status_refused: "This session can’t be resumed. It has already ended.",
  duration_cap_reached: "This session reached its time limit.",
  credential_renewal_required:
    "The capture credential needs renewing before capture can resume.",
  job_cancellation_failed:
    "Running work couldn’t be cancelled just now. Try again.",
  not_found: "Studio no longer has this session.",
  unauthorized: "You’re signed out. Sign in again to control this session.",
  origin_forbidden: "Studio refused this request. Reload the page.",
  network: "Couldn’t reach Studio. Check your connection and try again.",
  invalid_response: "Studio answered unexpectedly. Try again.",
};
export function commandMessage(code: SessionErrorCode): string {
  return COMMAND_MESSAGE[code] ?? "Something went wrong. Try again.";
}

// The strings the design shows, rewritten where the code does not back them:
// a pause or end flips the status first and then asks the session's jobs to
// cancel (ADR-0011/pause-end-suppression), so cancellation is "requested" and
// a late result is "not published", which is the guarantee.
export const PAUSED_TOAST =
  "Paused. Running work is being cancelled and nothing new will start.";
export const RESUMED_TOAST = "Resumed.";
export const RESUMED_RENEWED_TOAST =
  "Resumed with a renewed capture credential. Open the session to hand it to the companion.";
export const END_TITLE = "End this session?";
export const END_BODY =
  "Studio stops accepting capture, cancels running work and discards any result that arrives later. This can’t be undone.";
