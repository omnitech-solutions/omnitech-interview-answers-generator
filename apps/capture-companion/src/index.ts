// The capture companion's platform-neutral core. The macOS app (macos/) is the
// same loop in Swift; this TypeScript core is what the fixture companion and
// the conformance tests run. It imports only active-session-contracts.
export { type Backoff, type BackoffOptions, createBackoff } from "./backoff.js";
export {
  assessCapability,
  type CapabilityBlocker,
  type CapabilityProbe,
  type CapabilityVerdict,
  type DeviceCapability,
  probeCapability,
} from "./capability.js";
export type { CaptureDriver, CaptureOnceResult } from "./capture-driver.js";
export { type Clock, isoAt, systemClock } from "./clock.js";
export {
  Companion,
  type CompanionOptions,
  type ScreenshotInput,
  type TranscriptInput,
} from "./companion.js";
export {
  type ControlTransition,
  SourceSelection,
  StudioControl,
} from "./control.js";
export {
  CompanionError,
  type CompanionErrorCode,
} from "./errors.js";
export { type LocalStopDeps, stopLocally } from "./local-stop.js";
export {
  capabilityReportMessage,
  captureGapMessage,
  heartbeatMessage,
  screenSnapshotMessage,
  sourceDisconnectedMessage,
  transcriptFinalMessage,
} from "./messages.js";
export { type Allocation, Outbox, type OutboxEntry } from "./outbox.js";
export {
  recordSourceLoss,
  type SourceLossDeps,
  type SourceLossReason,
} from "./source-loss.js";
export {
  type CompanionNotice,
  type CompanionPhase,
  type CompanionSnapshot,
  type SourcePhase,
  StateModel,
  type TerminalPhase,
} from "./state.js";
export {
  createWireClient,
  type FetchInit,
  type FetchLike,
  type FetchResponse,
  type SendOutcome,
  type WireClient,
  type WireClientOptions,
} from "./wire-client.js";
