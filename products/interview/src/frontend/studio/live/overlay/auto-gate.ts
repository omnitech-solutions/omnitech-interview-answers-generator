// The limits on automatic capture (ADR-0022), as one pure decision. A refusal
// names its reason so the card can say it, and says whether waiting can ever
// clear it ("too-soon" and "busy" do; the others need the owner or the session).
export const AUTO_MIN_GAP_MS = 15_000;
export const AUTO_MAX_PER_SESSION = 30;

export type AutoBlock =
  | "not-open"
  | "paused"
  | "device-only"
  | "no-source"
  | "busy"
  | "cap"
  | "too-soon";

export type AutoGateInput = {
  nowMs: number;
  open: boolean;
  paused: boolean;
  // The session refuses screenshots (vision_device_only).
  deviceOnly: boolean;
  sharing: boolean;
  // A capture or analysis is still in flight.
  inFlight: boolean;
  // Automatic analyses already made in this session, and when the last began.
  autoCount: number;
  lastAutoAtMs: number | null;
};

export function gateAutoCapture(
  input: AutoGateInput,
): { ok: true } | { ok: false; reason: AutoBlock } {
  if (!input.open) return { ok: false, reason: "not-open" };
  if (input.paused) return { ok: false, reason: "paused" };
  if (input.deviceOnly) return { ok: false, reason: "device-only" };
  if (!input.sharing) return { ok: false, reason: "no-source" };
  if (input.autoCount >= AUTO_MAX_PER_SESSION)
    return { ok: false, reason: "cap" };
  if (input.inFlight) return { ok: false, reason: "busy" };
  if (
    input.lastAutoAtMs !== null &&
    input.nowMs - input.lastAutoAtMs < AUTO_MIN_GAP_MS
  )
    return { ok: false, reason: "too-soon" };
  return { ok: true };
}

export const AUTO_BLOCK_TEXT: Record<AutoBlock, string> = {
  "not-open": "The session has ended.",
  paused: "Paused: nothing is captured until you resume.",
  "device-only":
    "Device-only mode never sends a screenshot, so the screen isn’t watched.",
  "no-source": "Share a screen to let Auto watch it.",
  busy: "Waiting for the last capture to finish.",
  cap: `Auto has made ${AUTO_MAX_PER_SESSION} captures this session, its limit. Capture by hand if you need more.`,
  "too-soon": "Waiting a moment between automatic captures.",
};
