import { LIVE_OWNER_SKILLS } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import { ICON_PATHS } from "../../../icons.generated";
import { nativeChord } from "../../shared/shortcuts";
import { AUTO_MAX_PER_SESSION } from "../auto-gate";
import { COMMANDS } from "./commands";
import {
  ALL_PANES_SHOWN,
  ANSWER_STYLE_GROUPS,
  answerSteps,
  answerStyleRows,
  autoLimits,
  BARE_WIDTH,
  CAPTURE_MODES,
  captureControl,
  captureMenuItems,
  captureModeOf,
  footerButtons,
  GREEN_MENU_GRACE_MS,
  GREEN_MENU_HOVER_MS,
  MINI_SIZE,
  PANES,
  phaseLabel,
  SEE_THROUGH_CONTROL,
  SHORTCUT_GROUPS,
  seeThroughTitle,
  shortcutGroups,
  WINDOW_CONTROLS,
  WINDOW_MODES,
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

describe("See-through control", () => {
  it("is one named toolbar switch with an icon from the icon set", () => {
    expect(SEE_THROUGH_CONTROL).toMatchObject({
      label: "See-through",
      icon: "contrast",
    });
    expect(Object.keys(ICON_PATHS)).toContain(SEE_THROUGH_CONTROL.icon);
  });

  it("has a tooltip that says exactly what is on, with the key only where the shell can pass clicks", () => {
    const withShell = (on: boolean) => seeThroughTitle(on, true);
    expect(withShell(true)).toMatch(/is on/);
    expect(withShell(true)).toMatch(
      /clicks on empty glass reach the page underneath/,
    );
    expect(withShell(true)).toMatch(
      /Toolbar, panes and menus still take clicks/,
    );
    expect(withShell(true)).toContain("⌘⇧I");
    expect(withShell(false)).toMatch(/is off/);
    expect(withShell(false)).toContain("⌘⇧I");
    const web = seeThroughTitle(true, false);
    expect(web).toMatch(/background is clear/);
    expect(web).not.toMatch(/clicks/);
    expect(web).not.toContain("⌘");
    expect(seeThroughTitle(false, false)).not.toContain("⌘");
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
    expect(nativeChord("see-through")).toBe("⌘⇧I");
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
  it("are red quit, yellow hide and green size, each with a glyph, a name and an action", () => {
    expect(WINDOW_CONTROLS.map((c) => [c.colour, c.glyph, c.action])).toEqual([
      ["red", "×", "quit"],
      ["yellow", "−", "hide"],
      ["green", "+", "size"],
    ]);
    for (const control of WINDOW_CONTROLS) {
      expect(control.label).not.toBe("");
      expect(control.title).not.toBe("");
    }
  });

  it("tells the person how the hidden window comes back and that a live session pauses", () => {
    const hide = WINDOW_CONTROLS[1].title;
    expect(hide).toContain(nativeChord("show-hide"));
    expect(hide).toContain("pauses first");
  });

  it("the green name says both the click and the hover", () => {
    expect(WINDOW_CONTROLS[2].label).toBe(
      "Full screen: click. Hold the pointer here for more window sizes",
    );
    expect(GREEN_MENU_HOVER_MS).toBe(1000);
    expect(GREEN_MENU_GRACE_MS).toBeLessThan(GREEN_MENU_HOVER_MS);
  });
});

describe("window sizes", () => {
  it("are exactly Normal, Mini player and Full screen, each with a hint", () => {
    expect(WINDOW_MODES.map((mode) => [mode.id, mode.label])).toEqual([
      ["normal", "Normal"],
      ["mini", "Mini player"],
      ["full", "Full screen"],
    ]);
    for (const mode of WINDOW_MODES) expect(mode.hint).not.toBe("");
  });

  it("the Mini player is a fixed card and Full screen leaves sizing to the shell", () => {
    const by = Object.fromEntries(WINDOW_MODES.map((mode) => [mode.id, mode]));
    expect(by["mini"]?.size).toEqual({ kind: "fixed", ...MINI_SIZE });
    expect(MINI_SIZE.width).toBe(440);
    expect(MINI_SIZE.height).toBe(190);
    expect(by["full"]?.size.kind).toBe("fill-display");
    expect(by["normal"]?.size.kind).toBe("fit-panes");
    expect(by["mini"]?.view).toBe("mini");
    expect(by["normal"]?.needs).toBeNull();
  });
});

describe("answer style groups", () => {
  it("puts every skill in exactly one group, in the contract's order", () => {
    const grouped = ANSWER_STYLE_GROUPS.flatMap((group) => [...group.styles]);
    expect([...grouped].sort()).toEqual([...LIVE_OWNER_SKILLS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const group of ANSWER_STYLE_GROUPS) {
      const order = group.styles.map((id) => LIVE_OWNER_SKILLS.indexOf(id));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
    expect(ANSWER_STYLE_GROUPS.map((group) => group.label)).toEqual([
      "Technical",
      "Conversation",
    ]);
  });

  it("checks the style in use", () => {
    const rows = answerStyleRows("behavioral");
    const checked = rows.flatMap((group) =>
      group.styles.filter((style) => style.checked).map((style) => style.id),
    );
    expect(checked).toEqual(["behavioral"]);
    expect(rows[1]?.styles[0]).toEqual({
      id: "behavioral",
      label: "Behavioral Interview",
      checked: true,
    });
    expect(
      answerStyleRows(undefined)
        .flatMap((group) => group.styles)
        .some((style) => style.checked),
    ).toBe(false);
  });
});

describe("shortcut groups", () => {
  it("has the five groups, each command exactly once", () => {
    const groups = shortcutGroups();
    expect(groups.map((group) => group.label)).toEqual([
      "Capture",
      "Listening",
      "View",
      "Answer style",
      "App",
    ]);
    const commands = SHORTCUT_GROUPS.flatMap((group) =>
      group.items.filter((item) => item.kind === "command").map((i) => i.id),
    );
    expect([...commands].sort()).toEqual([...COMMANDS].sort());
    for (const group of groups) expect(group.rows.length).toBeGreaterThan(0);
  });

  it("keeps the bindings the app has today", () => {
    const chords = Object.fromEntries(
      shortcutGroups().flatMap((group) =>
        group.rows
          .filter((row) => row.platform === "web")
          .map((row) => [row.id, row.chord]),
      ),
    );
    expect(chords).toEqual({
      "capture.analyze": "Alt+Shift+A",
      "solution.generate": "Alt+Shift+S",
      "transcribe.toggle": "Alt+R",
      "auto.toggle": "Alt+Shift+H",
      "see-through.toggle": "Alt+Shift+I",
      "chat.focus": "Alt+Shift+F",
      "skill.next": "Alt+]",
      "skill.prev": "Alt+[",
      "session.clear": "Alt+Shift+C",
    });
    const native = shortcutGroups()
      .flatMap((group) => group.rows)
      .filter((row) => row.platform === "native");
    expect(native.map((row) => row.chord)).toEqual([
      nativeChord("show-hide"),
      nativeChord("settings"),
    ]);
  });
});
