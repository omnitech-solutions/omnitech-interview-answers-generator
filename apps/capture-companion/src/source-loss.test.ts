import { describe, expect, it } from "vitest";
import { recordingCapture } from "./fixture/fakes.js";
import { VirtualClock } from "./fixture/virtual-clock.js";
import { Outbox } from "./outbox.js";
import { recordSourceLoss } from "./source-loss.js";
import { StateModel } from "./state.js";

function deps(queueing: boolean) {
  return {
    capture: recordingCapture(),
    outbox: new Outbox(10, new VirtualClock()),
    state: new StateModel(),
    queueing,
  };
}

describe("source loss", () => {
  it("stops the source, marks it, and queues a disconnect then a gap", () => {
    const d = deps(true);
    d.state.setSource("microphone", "listening");
    recordSourceLoss(d, "microphone", "permission-revoked");
    expect(d.capture.log).toEqual(["stop:microphone"]);
    expect(d.state.sourcePhase("microphone")).toBe("permission-revoked");
    expect(d.state.phase()).toBe("permission-revoked");
    expect(d.outbox.ids().map((id) => id.eventId)).toEqual([
      "microphone.disconnected.0",
      "microphone.gap.1",
    ]);
  });

  it("marks a lost device as lost, and queues nothing while Studio has paused", () => {
    const d = deps(false);
    recordSourceLoss(d, "application-audio", "device-lost");
    expect(d.state.sourcePhase("application-audio")).toBe("lost");
    expect(d.outbox.size).toBe(0);
  });
});
