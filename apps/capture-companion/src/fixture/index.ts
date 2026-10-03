// The fixture companion: the public entrypoint for tests that need a real
// companion without a Mac. It is the whole companion loop over injected fakes
// (fetch, capture, speech capability, clock); only the platform is faked.
import type { CaptureSource } from "@omnitech/active-session-contracts";
import type { CapabilityProbe } from "../capability.js";
import type { Clock } from "../clock.js";
import { Companion } from "../companion.js";
import type { FetchLike } from "../wire-client.js";
import {
  type RecordingCapture,
  readyDevice,
  recordingCapture,
} from "./fakes.js";

export type FixtureCompanionOptions = {
  baseUrl: string;
  tenantSlug: string;
  credential: string;
  fetch: FetchLike;
  clock: Clock;
  // Defaults to both audio sources.
  sources?: readonly CaptureSource[];
  // Defaults to a device that can do on-device speech.
  probeCapability?: CapabilityProbe;
  heartbeatIntervalMs?: number;
  outboxCapacity?: number;
  maxScreenshots?: number;
  // Defaults to a fixed 0.5 so backoff delays are deterministic.
  jitter?: () => number;
};

export type FixtureCompanion = {
  companion: Companion;
  capture: RecordingCapture;
};

export function createFixtureCompanion(
  options: FixtureCompanionOptions,
): FixtureCompanion {
  const capture = recordingCapture();
  const companion = new Companion({
    baseUrl: options.baseUrl,
    tenantSlug: options.tenantSlug,
    credential: options.credential,
    fetch: options.fetch,
    clock: options.clock,
    capture,
    probeCapability: options.probeCapability ?? (() => readyDevice()),
    sources: options.sources ?? ["microphone", "application-audio"],
    jitter: options.jitter ?? (() => 0.5),
    ...(options.heartbeatIntervalMs === undefined
      ? {}
      : { heartbeatIntervalMs: options.heartbeatIntervalMs }),
    ...(options.outboxCapacity === undefined
      ? {}
      : { outboxCapacity: options.outboxCapacity }),
    ...(options.maxScreenshots === undefined
      ? {}
      : { maxScreenshots: options.maxScreenshots }),
  });
  return { companion, capture };
}

export type { DeviceCapability } from "../capability.js";
export type { Clock } from "../clock.js";
export { Companion } from "../companion.js";
export type { CompanionSnapshot } from "../state.js";
export type { FetchInit, FetchLike, FetchResponse } from "../wire-client.js";
export {
  acceptedAck,
  FAKE_CREDENTIAL,
  FAKE_CREDENTIAL_EXPIRY,
  type FakeStudio,
  fakeStudio,
  type RecordedRequest,
  type Reply,
  refusedAck,
} from "./fake-studio.js";
export {
  type RecordingCapture,
  readyDevice,
  recordingCapture,
  speechUnavailableDevice,
} from "./fakes.js";
export {
  type ReplayOptions,
  type ReplayResult,
  type ReplaySegment,
  type ReplaySet,
  replayInputOf,
  replayInto,
  replaySet,
  sourceForRole,
} from "./replayer.js";
export { VirtualClock } from "./virtual-clock.js";
