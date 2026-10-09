// The capture companion's platform-neutral core. The macOS app (macos/) is the
// same loop in Swift; this TypeScript core is what the fixture companion and
// the conformance tests run. It imports only active-session-contracts.
export { type Backoff, type BackoffOptions, createBackoff } from "./backoff";
export {
  assessCapability,
  type CapabilityBlocker,
  type CapabilityProbe,
  type CapabilityVerdict,
  type DeviceCapability,
  probeCapability,
} from "./capability";
export type { CaptureDriver, CaptureOnceResult } from "./capture-driver";
export { type Clock, isoAt, systemClock } from "./clock";
export {
  Companion,
  type CompanionOptions,
  type ScreenshotInput,
  type TranscriptInput,
} from "./companion";
export {
  type ControlTransition,
  SourceSelection,
  StudioControl,
} from "./control";
export {
  CompanionError,
  type CompanionErrorCode,
} from "./errors";
export { type LocalStopDeps, stopLocally } from "./local-stop";
export {
  capabilityReportMessage,
  captureGapMessage,
  heartbeatMessage,
  screenSnapshotMessage,
  sourceDisconnectedMessage,
  transcriptFinalMessage,
  voiceActivityMessage,
} from "./messages";
export { type Allocation, Outbox, type OutboxEntry } from "./outbox";
export {
  recordSourceLoss,
  type SourceLossDeps,
  type SourceLossReason,
} from "./source-loss";
export {
  type CompanionNotice,
  type CompanionPhase,
  type CompanionSnapshot,
  type SourcePhase,
  StateModel,
  type TerminalPhase,
} from "./state";
export {
  createWireClient,
  type FetchInit,
  type FetchLike,
  type FetchResponse,
  type SendOutcome,
  type WireClient,
  type WireClientOptions,
} from "./wire-client";
