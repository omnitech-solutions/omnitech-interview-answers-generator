import { describe, expect, it } from "vitest";
import { CAPTURE_PROBLEM_REASONS } from "../shared/capture-problem";
import { captureFailureOf, sampleFailureOf } from "./capture-failure";
import { FrameError, ShareError } from "./capture-source";

describe("captureFailureOf: every thrown capture error becomes a closed reason", () => {
  it("maps each FrameError code, carrying the app in front", () => {
    const codes: FrameError["code"][] = [
      "not-ready",
      "too-large",
      "encode-failed",
      "display-changed",
      "permission-denied",
      "no-focused-window",
      "busy",
      "timeout",
      "unavailable",
      "capture-failed",
    ];
    for (const code of codes)
      expect(CAPTURE_PROBLEM_REASONS).toContain(
        captureFailureOf(new FrameError(code)).reason,
      );
    expect(
      captureFailureOf(new FrameError("no-focused-window", "Claude")),
    ).toEqual({ reason: "no-focused-window", frontApp: "Claude" });
    expect(captureFailureOf(new FrameError("timeout")).reason).toBe("timeout");
  });

  it("maps the browser's share errors and anything unknown", () => {
    expect(captureFailureOf(new ShareError("cancelled")).reason).toBe(
      "share-cancelled",
    );
    expect(captureFailureOf(new ShareError("unsupported")).reason).toBe(
      "share-unsupported",
    );
    expect(captureFailureOf(new Error("boom")).reason).toBe("capture-failed");
    expect(captureFailureOf(undefined).reason).toBe("capture-failed");
  });
});

describe("sampleFailureOf: what Auto's change check threw", () => {
  const thrown = (code: unknown, frontApp?: unknown) =>
    Object.assign(new Error("x"), { code, frontApp });
  it("keeps a problem the person must know, with the app in front", () => {
    expect(sampleFailureOf(thrown("no-focused-window", "Claude"))).toEqual({
      reason: "no-focused-window",
      frontApp: "Claude",
    });
    expect(sampleFailureOf(thrown("permission-denied"))?.reason).toBe(
      "permission-denied",
    );
    expect(sampleFailureOf(thrown("timeout"))?.reason).toBe("timeout");
    expect(sampleFailureOf(thrown("failed"))?.reason).toBe("capture-failed");
    expect(sampleFailureOf(thrown("unavailable"))?.reason).toBe(
      "host-unavailable",
    );
  });
  it("lets a busy shell pass (Auto tries again next tick) and never drops an unknown error", () => {
    expect(sampleFailureOf(thrown("busy"))).toBeNull();
    expect(sampleFailureOf(thrown("something-new"))?.reason).toBe(
      "capture-failed",
    );
    expect(sampleFailureOf(new Error("no code"))?.reason).toBe(
      "capture-failed",
    );
  });
});
