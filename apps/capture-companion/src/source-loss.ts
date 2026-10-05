// A source that stops without the user asking: the OS revoked a permission or
// a device vanished. The companion stops that source, tells Studio why
// (source.disconnected plus a capture.gap), and shows it. It never returns to
// "listening" for that source by itself.
import type { CaptureSource } from "@omnitech/active-session-contracts";
import type { CaptureDriver } from "./capture-driver";
import { captureGapMessage, sourceDisconnectedMessage } from "./messages";
import type { Outbox } from "./outbox";
import type { StateModel } from "./state";

export type SourceLossReason = "permission-revoked" | "device-lost";

export type SourceLossDeps = {
  capture: CaptureDriver;
  outbox: Outbox;
  state: StateModel;
  // False while Studio has paused capture: nothing is queued then, because
  // Studio would refuse it, but the visible state still changes.
  queueing: boolean;
};

export function recordSourceLoss(
  deps: SourceLossDeps,
  source: CaptureSource,
  reason: SourceLossReason,
): void {
  deps.capture.stop(source);
  // [DOMAIN] "permission revoked" is its own visible state, distinct from a
  // lost device, and is never shown as listening.
  deps.state.setSource(
    source,
    reason === "permission-revoked" ? "permission-revoked" : "lost",
  );
  if (!deps.queueing) return;
  deps.outbox.enqueue(
    sourceDisconnectedMessage({
      ...deps.outbox.allocate(source, "disconnected"),
      content: { source, reason },
    }),
  );
  deps.outbox.enqueue(
    captureGapMessage({
      ...deps.outbox.allocate(source, "gap"),
      content: { source, durationMs: 0, reason: "source-interrupted" },
    }),
  );
}
