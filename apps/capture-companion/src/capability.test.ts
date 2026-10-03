import { describe, expect, it } from "vitest";
import { assessCapability, probeCapability } from "./capability.js";
import { readyDevice, speechUnavailableDevice } from "./fixture/fakes.js";

describe("capability", () => {
  it("is ready only with on-device recognition, a recognizer and authorization", () => {
    expect(assessCapability(readyDevice())).toEqual({
      ready: true,
      blockers: [],
    });
    expect(assessCapability(speechUnavailableDevice()).blockers).toEqual([
      "on-device-unavailable",
    ]);
    const nothing = readyDevice();
    nothing.speech.onDeviceAvailable = false;
    nothing.speech.recognizerAvailable = false;
    nothing.speech.authorizationStatus = "denied";
    expect(assessCapability(nothing).blockers).toEqual([
      "on-device-unavailable",
      "recognizer-unavailable",
      "speech-not-authorized",
    ]);
  });

  it("turns a throwing or async probe into a verdict, never an error", async () => {
    expect(
      (await probeCapability(async () => readyDevice())).verdict.ready,
    ).toBe(true);
    const failed = await probeCapability(() => {
      throw new Error("secret detail");
    });
    expect(failed).toEqual({
      verdict: { ready: false, blockers: ["probe-failed"] },
    });
  });
});
