import { describe, expect, it } from "vitest";
import { SourceSelection, StudioControl } from "./control.js";

describe("studio control", () => {
  it("reports one transition per change", () => {
    const control = new StudioControl();
    expect(control.observe("active")).toBe("none");
    expect(control.observe("paused")).toBe("pause");
    expect(control.observe("paused")).toBe("none");
    expect(control.paused).toBe(true);
    expect(control.observe("active")).toBe("resume");
    expect(control.state).toBe("active");
  });

  it("treats ended and purging as final", () => {
    const ended = new StudioControl();
    expect(ended.observe("ended")).toBe("end");
    expect(ended.observe("active")).toBe("none");
    expect(ended.state).toBe("ended");
    const purging = new StudioControl();
    expect(purging.observe("purging")).toBe("end");
    expect(purging.observe("paused")).toBe("none");
  });
});

describe("source selection", () => {
  it("offers only locally selected sources and can only narrow", () => {
    const selection = new SourceSelection(["microphone", "screen"]);
    expect(selection.eligible()).toEqual(["microphone", "screen"]);
    expect(selection.has("application-audio")).toBe(false);
    // Refusing a source never selected changes nothing.
    expect(selection.refuse("application-audio")).toBe(false);
    expect(selection.eligible()).toEqual(["microphone", "screen"]);
    expect(selection.refuse("screen")).toBe(true);
    expect(selection.refuse("screen")).toBe(false);
    expect(selection.isRefused("screen")).toBe(true);
    expect(selection.eligible()).toEqual(["microphone"]);
  });
});
