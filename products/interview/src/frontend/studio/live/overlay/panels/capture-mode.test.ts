// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadCaptureMode, saveCaptureMode } from "./capture-mode";

describe("capture mode", () => {
  beforeEach(() => window.localStorage.clear());

  it("is auto until the person chooses, then remembers it per tenant", () => {
    expect(loadCaptureMode("local")).toBe("auto");
    saveCaptureMode("local", "manual");
    expect(loadCaptureMode("local")).toBe("manual");
    expect(loadCaptureMode("other")).toBe("auto");
    saveCaptureMode("local", "auto");
    expect(loadCaptureMode("local")).toBe("auto");
  });
});
