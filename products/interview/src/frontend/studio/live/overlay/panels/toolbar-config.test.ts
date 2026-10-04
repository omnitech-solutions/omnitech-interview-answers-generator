import { describe, expect, it } from "vitest";
import {
  ALL_PANES_SHOWN,
  BARE_WIDTH,
  CAPTURE_MODES,
  captureControl,
  footerButtons,
  isCaptureMode,
  PANES,
  phaseLabel,
  windowWidthFor,
} from "./toolbar-config";

const none = { chat: false, analysis: false, code: false };

describe("pane table", () => {
  it("sizes the window from the panes that show, never below the toolbar", () => {
    const sum = PANES.reduce((total, pane) => total + pane.width, 0);
    expect(windowWidthFor(ALL_PANES_SHOWN)).toBe(
      sum + 8 * (PANES.length - 1) + 16,
    );
    expect(windowWidthFor(none)).toBe(BARE_WIDTH);
    expect(windowWidthFor({ ...none, chat: true })).toBe(BARE_WIDTH);
    expect(windowWidthFor(ALL_PANES_SHOWN, 2000)).toBe(2000);
  });
});

describe("capture control", () => {
  it("keeps capturing until work runs, then means stop", () => {
    expect(captureControl(false)).toMatchObject({ stop: false });
    expect(captureControl(true)).toMatchObject({
      stop: true,
      label: "Stop analysis",
    });
  });

  it("knows its modes", () => {
    expect(CAPTURE_MODES.map((mode) => mode.id)).toEqual(["auto", "manual"]);
    expect(isCaptureMode("manual")).toBe(true);
    expect(isCaptureMode("later")).toBe(false);
  });
});

describe("footer buttons", () => {
  const base = {
    paused: false,
    ended: false,
    starting: false,
    busy: false,
    wording: "short" as "short" | "session",
    canStart: true,
  };
  const ids = (input: Partial<typeof base>) =>
    footerButtons({ ...base, ...input }).map((button) => button.id);

  it("offers Pause and End while live, Resume and End while paused", () => {
    expect(ids({})).toEqual(["pause", "end"]);
    expect(ids({ paused: true })).toEqual(["resume", "end"]);
    expect(
      footerButtons({ ...base, paused: true }).find((b) => b.id === "resume")
        ?.tone,
    ).toBe("go");
  });

  it("offers only a new session once ended, and nothing when it cannot start one", () => {
    expect(ids({ ended: true })).toEqual(["start"]);
    expect(ids({ ended: true, canStart: false })).toEqual([]);
    expect(
      footerButtons({ ...base, ended: true, starting: true })[0],
    ).toMatchObject({ disabled: true, label: "Starting…" });
  });

  it("spells out the session when asked", () => {
    const labels = (wording: "short" | "session") =>
      footerButtons({ ...base, wording }).map((button) => button.label);
    expect(labels("short")).toEqual(["Pause", "End"]);
    expect(labels("session")).toEqual(["Pause session", "End session"]);
  });
});

describe("phase wording", () => {
  it("says what is happening, and Solutioning once a coding problem is detected", () => {
    expect(phaseLabel(null, "idle")).toBeNull();
    expect(phaseLabel("capturing", "idle")).toBe("Capturing the screen");
    expect(phaseLabel("analyzing", "idle")).toBe("Analyzing");
    expect(phaseLabel("analyzing", "reading-coding-task")).toBe(
      "Reading the problem",
    );
    expect(phaseLabel("analyzing", "coding-draft")).toBe("Solutioning");
    expect(phaseLabel("analyzing", "agent-working")).toBe("Solutioning");
    expect(phaseLabel("analyzing", "drafting")).toBe("Drafting an answer");
  });
});
