// Fakes a fixture companion needs: a capture driver that only records what was
// started, and capability probes for a Mac that can and cannot do on-device
// speech. No real capture, speech or network happens here.
import type { CaptureSource } from "@omnitech/active-session-contracts";
import type { DeviceCapability } from "../capability.js";
import type { CaptureDriver } from "../capture-driver.js";

export type RecordingCapture = CaptureDriver & {
  // Sources currently capturing.
  active(): CaptureSource[];
  // Every start and stop in order, e.g. "start:microphone".
  readonly log: string[];
};

export function recordingCapture(): RecordingCapture {
  const running = new Set<CaptureSource>();
  const log: string[] = [];
  return {
    log,
    active: () => [...running],
    start(source) {
      running.add(source);
      log.push(`start:${source}`);
    },
    stop(source) {
      running.delete(source);
      log.push(`stop:${source}`);
    },
    stopAll() {
      running.clear();
      log.push("stop:all");
    },
  };
}

export const readyDevice = (locale = "en-GB"): DeviceCapability => ({
  speech: {
    locale,
    onDeviceAvailable: true,
    recognizerAvailable: true,
    authorizationStatus: "authorized",
  },
  permissions: { microphone: "granted", screen: "granted" },
});

export const speechUnavailableDevice = (
  locale = "en-GB",
): DeviceCapability => ({
  speech: {
    locale,
    onDeviceAvailable: false,
    recognizerAvailable: true,
    authorizationStatus: "authorized",
  },
  permissions: { microphone: "granted", screen: "granted" },
});
