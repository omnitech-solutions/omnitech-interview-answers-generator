// Builders for every message the companion can emit. They take complete
// bodies and add only the wire version and kind, so the corpus test can prove
// each builder reproduces the shared valid messages exactly.
import {
  type CapabilityReport,
  type CaptureGap,
  type Heartbeat,
  type ScreenSnapshot,
  type SourceDisconnected,
  type TranscriptFinal,
  WIRE_VERSION,
} from "@omnitech/active-session-contracts";

type Body<T> = Omit<T, "version" | "kind">;

export const transcriptFinalMessage = (
  body: Body<TranscriptFinal>,
): TranscriptFinal => ({
  version: WIRE_VERSION,
  kind: "transcript.final",
  ...body,
});

export const screenSnapshotMessage = (
  body: Body<ScreenSnapshot>,
): ScreenSnapshot => ({
  version: WIRE_VERSION,
  kind: "screen.snapshot",
  ...body,
});

export const sourceDisconnectedMessage = (
  body: Body<SourceDisconnected>,
): SourceDisconnected => ({
  version: WIRE_VERSION,
  kind: "source.disconnected",
  ...body,
});

export const captureGapMessage = (body: Body<CaptureGap>): CaptureGap => ({
  version: WIRE_VERSION,
  kind: "capture.gap",
  ...body,
});

export const heartbeatMessage = (body: Body<Heartbeat>): Heartbeat => ({
  version: WIRE_VERSION,
  kind: "heartbeat",
  ...body,
});

export const capabilityReportMessage = (
  body: Body<CapabilityReport>,
): CapabilityReport => ({
  version: WIRE_VERSION,
  kind: "capability.report",
  ...body,
});
