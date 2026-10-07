// The microphone caret menu as data: the devices, the one in use, and the
// status the control shows (listening, muted, lost, retrying with its attempt)
// with the "Retry now" action. Derived from the engine's own typed state
// (use-engine.ts); the Alt+R toggle is unchanged. Pure: no React, no bridge.
import type {
  EngineMicrophoneDevice,
  EngineState,
} from "@omnitech/interview-contracts";

export type MicStatus = "listening" | "muted" | "lost" | "retrying";

// What stands behind a muted microphone, when the app can say: the person has
// not allowed it, there is none, or the session is held.
export type MicMuteReason = "denied" | "unavailable" | "held" | null;

export const MIC_MENU_TEXT = {
  retryNow: "Retry now",
  systemDefault: "System default",
  noDevices: "No microphones found",
  status: {
    listening: "Listening",
    muted: "Muted",
    lost: "Microphone lost",
    retrying: "Retrying",
  },
} as const satisfies {
  retryNow: string;
  systemDefault: string;
  noDevices: string;
  status: Record<MicStatus, string>;
};

export type MicDeviceRow = {
  // null is the system default row.
  id: string | null;
  name: string;
  checked: boolean;
};

export type MicMenu = {
  status: MicStatus;
  // The status as a short label ("Retrying (attempt 2)").
  statusLabel: string;
  // The automatic retry the shell is on while status is "retrying"; else 0.
  attempt: number;
  muteReason: MicMuteReason;
  // The rows of the device list: the system default first, then each device.
  devices: MicDeviceRow[];
  selectedDeviceId: string | null;
  // Show "Retry now": only while the microphone is lost or retrying.
  retry: { label: string; enabled: boolean } | null;
  // The device list is offered only when the shell lists devices.
  canChooseDevice: boolean;
};

export type MicMenuInput = {
  // The engine's state, or null before it reports (or with no engine).
  state: EngineState | null;
  // The microphone is listening by the engine's own report.
  micOn: boolean;
  // The session (or engine) is held: nothing can retry.
  held: boolean;
  // A start, stop or retry is awaiting the shell's report.
  pending: boolean;
};

const attemptOf = (state: EngineState | null): number => {
  const raw = state?.microphoneRetryAttempt;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : 0;
};

// The status from the engine's source health. "lost" with an automatic retry
// under way is "retrying"; every other state that is not listening is muted.
export function micStatusOf(input: MicMenuInput): MicStatus {
  const health = input.state?.sources.microphone;
  if (health === "lost")
    return attemptOf(input.state) > 0 ? "retrying" : "lost";
  return input.micOn ? "listening" : "muted";
}

export function micMenu(input: MicMenuInput): MicMenu {
  const status = micStatusOf(input);
  const attempt = status === "retrying" ? attemptOf(input.state) : 0;
  const health = input.state?.sources.microphone;
  const muteReason: MicMuteReason =
    status !== "muted"
      ? null
      : health === "permission-denied"
        ? "denied"
        : health === "unavailable"
          ? "unavailable"
          : input.held
            ? "held"
            : null;
  const listed: readonly EngineMicrophoneDevice[] =
    input.state?.microphoneDevices ?? [];
  const selected = input.state?.microphoneDeviceId ?? null;
  const known = listed.some((device) => device.id === selected);
  // A selected id the shell no longer lists falls back to the system default.
  const selectedDeviceId = known ? selected : null;
  const devices: MicDeviceRow[] = [
    {
      id: null,
      name: MIC_MENU_TEXT.systemDefault,
      checked: selectedDeviceId === null,
    },
    ...listed.map((device) => ({
      id: device.id,
      name: device.name,
      checked: device.id === selectedDeviceId,
    })),
  ];
  return {
    status,
    statusLabel:
      status === "retrying"
        ? `${MIC_MENU_TEXT.status.retrying} (attempt ${attempt})`
        : MIC_MENU_TEXT.status[status],
    attempt,
    muteReason,
    devices,
    selectedDeviceId,
    retry:
      status === "lost" || status === "retrying"
        ? {
            label: MIC_MENU_TEXT.retryNow,
            enabled: !input.held && !input.pending,
          }
        : null,
    canChooseDevice: input.state?.microphoneDevices !== undefined,
  };
}
