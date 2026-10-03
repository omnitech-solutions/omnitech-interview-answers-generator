import { describe, expect, it } from "vitest";
import { StateModel } from "./state.js";

describe("state model", () => {
  it("is connecting until a source listens", () => {
    const state = new StateModel();
    expect(state.phase()).toBe("connecting");
    state.setSource("microphone", "listening");
    expect(state.phase()).toBe("listening");
  });

  it("never shows listening while a permission is revoked", () => {
    const state = new StateModel();
    state.setSource("microphone", "listening");
    state.setSource("application-audio", "permission-revoked");
    expect(state.phase()).toBe("permission-revoked");
  });

  it("ranks speech-unavailable, revoked, paused and lost above listening", () => {
    const state = new StateModel();
    state.setSource("microphone", "listening");
    state.setSource("screen", "lost");
    expect(state.phase()).toBe("source-lost");
    state.setPaused(true);
    expect(state.phase()).toBe("paused");
    state.setSpeechBlocked(true);
    expect(state.phase()).toBe("speech-unavailable");
    expect(state.speechUnavailable).toBe(true);
  });

  it("keeps the first terminal phase and exposes content-free snapshots", () => {
    const state = new StateModel();
    state.setSource("microphone", "listening");
    state.terminate("stopped-locally");
    state.terminate("ended");
    expect(state.phase()).toBe("stopped-locally");
    expect(state.terminalPhase).toBe("stopped-locally");
    state.setConnected(true);
    state.notice({ code: "event_conflict", source: "microphone" });
    expect(state.snapshot()).toEqual({
      phase: "stopped-locally",
      sources: { microphone: "listening" },
      notices: [{ code: "event_conflict", source: "microphone" }],
      connected: true,
    });
    expect(state.sourcePhase("screen")).toBe("idle");
  });

  it("bounds the notices it keeps", () => {
    const state = new StateModel();
    for (let n = 0; n < 30; n += 1) state.notice({ code: `n${n}` });
    const { notices } = state.snapshot();
    expect(notices).toHaveLength(20);
    expect(notices[19]?.code).toBe("n29");
  });
});
