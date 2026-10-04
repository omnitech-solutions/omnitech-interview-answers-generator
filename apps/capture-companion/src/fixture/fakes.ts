// Fakes a fixture companion needs: a capture driver that only records what was
// started, and capability probes for a Mac that can and cannot do on-device
// speech. No real capture, speech or network happens here.
import type {
  CaptureRequest,
  CaptureSource,
} from "@omnitech/active-session-contracts";
import type { DeviceCapability } from "../capability.js";
import type { CaptureDriver, CaptureOnceResult } from "../capture-driver.js";

export type RecordingCapture = CaptureDriver & {
  // Sources currently capturing.
  active(): CaptureSource[];
  // Every start and stop in order, e.g. "start:microphone".
  readonly log: string[];
  // Every capture-now request handed to the driver, in order.
  readonly captured: CaptureRequest[];
  // What the next capture-now returns (a small JPEG by default).
  nextCapture: CaptureOnceResult;
};

export const fixtureJpeg = (): Uint8Array =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);

export function recordingCapture(): RecordingCapture {
  const running = new Set<CaptureSource>();
  const log: string[] = [];
  const captured: CaptureRequest[] = [];
  const capture: RecordingCapture = {
    log,
    captured,
    nextCapture: {
      kind: "image",
      payload: fixtureJpeg(),
      mediaType: "image/jpeg",
      windowLabel: "Editor",
    },
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
    async captureOnce(request) {
      captured.push(request);
      log.push(`capture:${request.mode}`);
      return capture.nextCapture;
    },
  };
  return capture;
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
