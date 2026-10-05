import { describe, expect, it } from "vitest";
import { nativeChord } from "../../shared/shortcuts";
import { AUTO_MAX_PER_SESSION } from "../auto-gate";
import {
  ALL_PANES_SHOWN,
  answerSteps,
  autoLimits,
  BARE_WIDTH,
  CAPTURE_MODES,
  captureControl,
  captureMenuItems,
  captureModeOf,
  footerButtons,
  hideBlockedReason,
  PANES,
  phaseLabel,
  WINDOW_CONTROLS,
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
    expect(captureControl(false)).toMatchObject({ label: "Analyze screen" });
    expect(captureControl(true)).toMatchObject({
      stop: true,
      label: "Stop",
    });
  });

  it("knows its modes", () => {
    expect(CAPTURE_MODES.map((mode) => mode.id)).toEqual(["auto", "manual"]);
    // Each is one value of the single Auto preference.
    expect(captureModeOf(true).id).toBe("auto");
    expect(captureModeOf(false).id).toBe("manual");
  });
});

describe("footer buttons", () => {
  const live = { kind: "live", paused: false, busy: false } as const;
  const ids = (state: Parameters<typeof footerButtons>[0]) =>
    footerButtons(state, "short").map((button) => button.id);

  it("offers Pause and End while live, Resume and End while paused", () => {
    expect(ids(live)).toEqual(["pause", "end"]);
    expect(ids({ ...live, paused: true })).toEqual(["resume", "end"]);
    expect(
      footerButtons({ ...live, paused: true }, "short").find(
        (b) => b.id === "resume",
      )?.tone,
    ).toBe("go");
  });

  it("offers only a new session once ended", () => {
    const ended = {
      kind: "ended",
      starting: false,
      canSummary: false,
    } as const;
    expect(ids(ended)).toEqual(["start"]);
    expect(
      footerButtons({ ...ended, starting: true }, "short")[0],
    ).toMatchObject({ disabled: true, label: "Starting…" });
  });

  it("spells out the session when asked", () => {
    const labels = (wording: "short" | "session") =>
      footerButtons(live, wording).map((button) => button.label);
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

describe("the capture menu", () => {
  const items = (input: Partial<Parameters<typeof captureMenuItems>[0]> = {}) =>
    captureMenuItems({
      mode: "auto",
      auto: autoLimits(8),
      target: null,
      open: true,
      ...input,
    });

  it("reads the Auto numbers from the Auto config, never from literals", () => {
    expect(autoLimits(12)).toEqual({
      intervalSec: 12,
      maxPerSession: AUTO_MAX_PER_SESSION,
    });
    expect(items({ auto: autoLimits(12) })[0]?.subtitle).toBe(
      `Re-analyse when the screen changes · checks every 12 s, at most ${AUTO_MAX_PER_SESSION} per session`,
    );
    expect(items()[1]?.subtitle).toBe(
      `Analyse only when you press ${nativeChord("analyze")}`,
    );
  });

  it("checks the chosen mode only", () => {
    expect(items({ mode: "manual" }).map((item) => item.checked)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("offers adding the screen to the task on show, by its number", () => {
    const attach = items({ target: "T3" })[2];
    expect(attach).toMatchObject({
      id: "attach",
      label: "Add screen to T3",
      disabledReason: null,
    });
  });

  it("is disabled, with the reason, until there is a task or after the session ends", () => {
    expect(items()[2]).toMatchObject({
      label: "Add screen to this problem",
      subtitle: "Needs a task first",
      disabledReason: "Needs a task first",
    });
    expect(items({ target: "T1", open: false })[2]?.disabledReason).toBe(
      "The session has ended",
    );
  });
});

describe("panes and shortcuts", () => {
  it("labels the panes Chat, Answer and Code", () => {
    expect(PANES.map((pane) => pane.label)).toEqual(["Chat", "Answer", "Code"]);
  });

  it("takes chords from the one shortcut table", () => {
    expect(nativeChord("analyze")).toBe("⌘⇧S");
    expect(nativeChord("listening")).toBe("⌥R");
    expect(nativeChord("click-through")).toBe("⌘⇧I");
    // An id outside the table does not compile; forced past the types it fails
    // loudly instead of answering an empty chord.
    expect(() => nativeChord("nothing" as never)).toThrow();
  });
});

describe("answer steps", () => {
  const states = (phase: "capturing" | "analyzing", key: string) =>
    answerSteps(phase, key).map((step) => step.state);

  it("moves from capturing through reading to drafting", () => {
    expect(states("capturing", "idle")).toEqual([
      "active",
      "waiting",
      "waiting",
    ]);
    expect(states("analyzing", "idle")).toEqual(["done", "active", "waiting"]);
    expect(states("analyzing", "reading-coding-task")).toEqual([
      "done",
      "active",
      "waiting",
    ]);
    expect(states("analyzing", "drafting")).toEqual(["done", "done", "active"]);
    expect(states("analyzing", "coding-draft")).toEqual([
      "done",
      "done",
      "active",
    ]);
  });

  it("uses the same words as the phase line", () => {
    expect(answerSteps("capturing", "idle")[0]?.label).toBe(
      phaseLabel("capturing", "idle"),
    );
    expect(answerSteps("analyzing", "drafting")[2]?.label).toBe(
      phaseLabel("analyzing", "drafting"),
    );
  });
});

describe("the ended footer", () => {
  it("offers the summary before a new session when both can be done", () => {
    const ids = footerButtons(
      { kind: "ended", starting: false, canSummary: true },
      "session",
    ).map((button) => button.id);
    expect(ids).toEqual(["summary", "start"]);
  });
});

describe("window controls", () => {
  it("are red, yellow and green, each with a glyph, a name and an action", () => {
    expect(WINDOW_CONTROLS.map((c) => [c.colour, c.glyph, c.action])).toEqual([
      ["red", "×", "hide"],
      ["yellow", "−", "collapse"],
      ["green", "+", "expand"],
    ]);
    for (const control of WINDOW_CONTROLS) {
      expect(control.label).not.toBe("");
      expect(control.title).not.toBe("");
    }
  });

  it("tells the person how the hidden window comes back", () => {
    expect(WINDOW_CONTROLS[0].title).toContain(nativeChord("show-hide"));
  });
});

describe("hiding the window", () => {
  it("is refused, with the reason, only while the session is capturing or listening", () => {
    expect(hideBlockedReason({ open: true, paused: false })).toBe(
      "Pause the session to hide the window",
    );
    expect(hideBlockedReason({ open: true, paused: true })).toBeNull();
    expect(hideBlockedReason({ open: false, paused: false })).toBeNull();
  });
});
