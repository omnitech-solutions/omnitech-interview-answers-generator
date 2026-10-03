// What the companion last told Studio about itself, as plain data for the
// screens: the speech state, the device-only blockers and the permission lines.
// Pure, no React and no fetching.
//
// The report is the owner's LAST one (GET .../sessions/companion-capability),
// sent by the companion when it checks itself at the start of a session
// (ADR-0012, Locality by stage). It is not a live connection: nothing here says
// the companion is running or connected. With no report, nothing is assumed.
//
// Facts these strings rest on (each is a test in guarantee-strings.test.tsx):
//   - the companion always requires on-device recognition, whatever the
//     session's policy, so allowing remote processing does not make an
//     unsupported language work (ADR-0012 "Locality by stage"; plan D5);
//   - a failing check stops the audio sources visibly in the companion, and
//     Studio never falls back to a remote speech service by itself.
import type { LiveCompanionCapability } from "@omnitech/interview-contracts";
import { ageLabel } from "./session-format";
import type { DeviceOnlyBlocker } from "./setup-sections";

export type SpeechKey =
  | "no-report"
  | "ready"
  | "denied"
  | "on-device-unavailable"
  | "recognizer-unavailable"
  | "not-determined";

export type SpeechState = {
  key: SpeechKey;
  // One short line, for a row or a chip.
  label: string;
  // What it means and what to do, one sentence.
  detail: string;
  tone: "green" | "amber" | "neutral";
  // True when the companion's own check would stop a speech session.
  blocksSpeech: boolean;
};

export const NO_REPORT_DETAIL =
  "No capability report yet: the companion checks on its first session and fails visibly if device-only speech is unavailable.";

const AUTHORIZATION_DETAIL: Record<"denied" | "restricted", string> = {
  denied:
    "Speech recognition is denied for the companion on this Mac. Allow it in System Settings, then run the companion again.",
  restricted:
    "Speech recognition is restricted on this Mac (for example by a profile), so the companion can’t use it.",
};

export function speechState(
  capability: LiveCompanionCapability | null,
): SpeechState {
  if (!capability)
    return {
      key: "no-report",
      label: "No report yet",
      detail: NO_REPORT_DETAIL,
      tone: "neutral",
      blocksSpeech: false,
    };
  const { speech } = capability;
  if (
    speech.authorizationStatus === "denied" ||
    speech.authorizationStatus === "restricted"
  )
    return {
      key: "denied",
      label:
        speech.authorizationStatus === "denied"
          ? "Speech permission denied"
          : "Speech restricted",
      detail: AUTHORIZATION_DETAIL[speech.authorizationStatus],
      tone: "amber",
      blocksSpeech: true,
    };
  if (!speech.onDeviceAvailable)
    return {
      key: "on-device-unavailable",
      label: `Not available on this Mac (${speech.locale})`,
      detail: `On-device recognition isn’t supported for ${speech.locale} on this Mac. The companion won’t send audio anywhere to work around it, and Studio won’t fall back to a remote service by itself.`,
      tone: "amber",
      blocksSpeech: true,
    };
  if (!speech.recognizerAvailable)
    return {
      key: "recognizer-unavailable",
      label: "Recognizer unavailable",
      detail: `The speech recognizer for ${speech.locale} was not available when the companion last checked. It may come back; the companion checks again when it starts.`,
      tone: "amber",
      blocksSpeech: true,
    };
  if (speech.authorizationStatus === "not-determined")
    return {
      key: "not-determined",
      label: "Speech permission not asked yet",
      detail: `On-device recognition is supported for ${speech.locale}. The companion asks for speech permission the first time it listens.`,
      tone: "neutral",
      blocksSpeech: false,
    };
  return {
    key: "ready",
    label: "On this Mac, in the companion",
    detail: `On-device recognition is available for ${speech.locale}, as the companion last reported.`,
    tone: "green",
    blocksSpeech: false,
  };
}

// Advisories from the companion's last stored report when it says it cannot
// recognise speech on this Mac. They never block Start: the report is
// owner-level and a session credential can post one, so the companion's own
// on-device check when it starts is the authority. Studio does not offer
// "allow remote" as the fix: speech stays on this Mac under both policies.
export function capabilityAdvisories(
  capability: LiveCompanionCapability | null,
): DeviceOnlyBlocker[] {
  const state = speechState(capability);
  if (!state.blocksSpeech) return [];
  return [
    {
      title:
        state.key === "denied"
          ? "Speech recognition isn’t allowed"
          : "Not available on this Mac",
      body: `${state.detail} The companion’s own check when it starts decides; if speech still can’t run here, it stops and says so.`,
    },
  ];
}

const PERMISSION_TEXT = {
  granted: "granted",
  denied: "denied",
  "not-determined": "not asked yet",
} as const;

export type PermissionLine = {
  source: "microphone" | "screen";
  label: string;
  state: "granted" | "denied" | "not-determined";
  text: string;
  tone: "green" | "amber" | "neutral";
};

export function permissionLines(
  capability: LiveCompanionCapability | null,
): PermissionLine[] {
  if (!capability) return [];
  return (
    [
      ["microphone", "Microphone", capability.permissions.microphone],
      ["screen", "Screen recording", capability.permissions.screen],
    ] as const
  ).map(([source, label, state]) => ({
    source,
    label,
    state,
    text: PERMISSION_TEXT[state],
    tone:
      state === "granted" ? "green" : state === "denied" ? "amber" : "neutral",
  }));
}

// "reported 4 min ago", from the server's own timestamp.
export function reportAge(
  capability: LiveCompanionCapability,
  nowMs: number,
): string {
  const at = Date.parse(capability.reportedAt);
  return Number.isNaN(at)
    ? "reported at an unknown time"
    : `reported ${ageLabel(nowMs - at)} ago`;
}
