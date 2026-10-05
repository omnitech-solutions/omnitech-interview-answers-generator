// LOCAL STOP (rule:offline-local-stop). It is local-first: synchronous, no
// network, final for the run. Everything that matters happens before the
// function returns; only then does it make a best-effort attempt to
// tell Studio, and a Studio that is down changes nothing.
import type {
  CaptureSource,
  IngestMessage,
} from "@omnitech/active-session-contracts";
import type { CaptureDriver } from "./capture-driver";
import { sourceDisconnectedMessage } from "./messages";
import type { Outbox } from "./outbox";
import type { StateModel } from "./state";

export type LocalStopDeps = {
  capture: CaptureDriver;
  outbox: Outbox;
  state: StateModel;
  // The sources that were running, to say goodbye for each.
  sources: readonly CaptureSource[];
  // One attempt each, outcome ignored; never retried or queued.
  sendOnce(message: IngestMessage): Promise<unknown>;
  heartbeatIdle(): IngestMessage;
};

// Returns the farewell promise; the stop itself has already happened.
export function stopLocally(deps: LocalStopDeps): Promise<void> {
  // [SAFETY] Synchronous and network-free: stop capture, drop every buffer,
  // mark the run stopped. A later Studio answer cannot undo it.
  deps.capture.stopAll();
  deps.outbox.clear();
  deps.state.terminate("stopped-locally");
  for (const source of deps.sources) deps.state.setSource(source, "idle");

  const messages: IngestMessage[] = deps.sources.map((source) =>
    sourceDisconnectedMessage({
      ...deps.outbox.allocate(source, "stopped"),
      content: { source, reason: "user-stopped" },
    }),
  );
  messages.push(deps.heartbeatIdle());
  return (async () => {
    for (const message of messages) {
      try {
        await deps.sendOnce(message);
      } catch {
        // Best effort: a failed farewell is not an error.
      }
    }
  })();
}
