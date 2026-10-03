// The on-device speech capability check (D5). Recognition is always on this
// device, so a Mac that cannot do it fails VISIBLY: no source starts, the
// heartbeat says capturing:false, and capability.report tells Studio why. The
// report carries support and permission states only, never content.
import type { CapabilityReport } from "@omnitech/active-session-contracts";

// What the OS says about this device; supplied by the platform adapter.
export type DeviceCapability = Pick<CapabilityReport, "speech" | "permissions">;
export type CapabilityProbe = () =>
  | Promise<DeviceCapability>
  | DeviceCapability;

export type CapabilityBlocker =
  | "on-device-unavailable"
  | "recognizer-unavailable"
  | "speech-not-authorized"
  | "probe-failed";

export type CapabilityVerdict = {
  ready: boolean;
  blockers: CapabilityBlocker[];
};

export function assessCapability(device: DeviceCapability): CapabilityVerdict {
  const blockers: CapabilityBlocker[] = [];
  if (!device.speech.onDeviceAvailable) blockers.push("on-device-unavailable");
  if (!device.speech.recognizerAvailable) {
    blockers.push("recognizer-unavailable");
  }
  if (device.speech.authorizationStatus !== "authorized") {
    blockers.push("speech-not-authorized");
  }
  return { ready: blockers.length === 0, blockers };
}

// A probe that throws is a failed check, never a crash and never a leak.
export async function probeCapability(
  probe: CapabilityProbe,
): Promise<{ device?: DeviceCapability; verdict: CapabilityVerdict }> {
  try {
    const device = await probe();
    return { device, verdict: assessCapability(device) };
  } catch {
    return { verdict: { ready: false, blockers: ["probe-failed"] } };
  }
}
