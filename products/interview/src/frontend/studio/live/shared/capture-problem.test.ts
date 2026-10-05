import { STUDIO_HOST_FRONT_APP_MAX } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  CAPTURE_PROBLEM_REASONS,
  captureProblem,
  captureProblemLine,
  cleanFrontApp,
  isCaptureProblemReason,
  SCREEN_RECORDING_SETTINGS_URL,
} from "./capture-problem";

describe("captureProblem: one table for every way a capture fails or cannot start", () => {
  it("answers every closed reason with a title and a fix, and nothing is empty", () => {
    for (const reason of CAPTURE_PROBLEM_REASONS) {
      for (const intent of ["manual", "auto"] as const) {
        const problem = captureProblem(reason, { intent, frontApp: "Claude" });
        expect(problem.reason).toBe(reason);
        expect(problem.title.length).toBeGreaterThan(4);
        expect(problem.fix.length).toBeGreaterThan(8);
      }
    }
  });

  it("no-focused-window names the app in front for Auto, with the chord to press", () => {
    const problem = captureProblem("no-focused-window", {
      intent: "auto",
      frontApp: "Claude",
    });
    expect(problem.title).toBe("Claude is in front");
    expect(problem.fix).toBe(
      "Press ⌘⇧S while Chrome or Safari is in front, or click the browser first.",
    );
    expect(captureProblem("no-focused-window", { intent: "auto" }).title).toBe(
      "No browser is in front",
    );
  });

  it("no-focused-window for a manual capture says no browser window was found", () => {
    const problem = captureProblem("no-focused-window", {
      intent: "manual",
      frontApp: "Claude",
    });
    expect(problem.title).toBe("No browser window found");
    expect(problem.fix).toBe("Open Chrome or Safari, then try again.");
  });

  it("permission-denied offers the Screen Recording settings action; no other reason has one", () => {
    const denied = captureProblem("permission-denied");
    expect(denied.title).toBe("Screen Recording is off for Interview Studio");
    expect(denied.action).toEqual({
      id: "open-screen-recording-settings",
      label: "Open Screen Recording settings",
    });
    for (const reason of CAPTURE_PROBLEM_REASONS)
      if (reason !== "permission-denied")
        expect(captureProblem(reason).action).toBeUndefined();
    expect(SCREEN_RECORDING_SETTINGS_URL).toBe(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
  });

  it("capture-failed and timeout use the agreed words", () => {
    expect(captureProblem("capture-failed").title).toBe("The capture failed");
    expect(captureProblem("capture-failed").fix).toContain(
      "check Screen Recording in System Settings",
    );
    expect(captureProblem("timeout").title).toBe("The shell did not answer");
  });

  it("a front app name is believed only as bounded plain text", () => {
    expect(cleanFrontApp("Claude")).toBe("Claude");
    expect(cleanFrontApp(" Claude\n")).toBe("Claude");
    expect(cleanFrontApp("A\u0007B‮C")).toBe("ABC");
    expect(cleanFrontApp("a".repeat(500))).toHaveLength(
      STUDIO_HOST_FRONT_APP_MAX,
    );
    expect(cleanFrontApp("")).toBeNull();
    expect(cleanFrontApp(42)).toBeNull();
    expect(cleanFrontApp(undefined)).toBeNull();
  });

  it("a hostile name never changes the sentence around it", () => {
    const line = captureProblemLine("no-focused-window", {
      intent: "auto",
      frontApp: "<img src=x onerror=1>",
    });
    expect(line).toContain("<img src=x onerror=1> is in front");
  });

  it("recognises exactly the closed reasons", () => {
    for (const reason of CAPTURE_PROBLEM_REASONS)
      expect(isCaptureProblemReason(reason)).toBe(true);
    expect(isCaptureProblemReason("nope")).toBe(false);
    expect(isCaptureProblemReason(null)).toBe(false);
  });
});
