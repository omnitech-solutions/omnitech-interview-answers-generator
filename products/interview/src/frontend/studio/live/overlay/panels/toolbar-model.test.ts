// What the toolbar says, as data: tone, menu sections, microphone look, chords.
import { describe, expect, it } from "vitest";
import { answerStyleRows, autoLimits } from "./toolbar-config";
import {
  answerStyleHint,
  answerStyleSections,
  captureSections,
  captureTone,
  chordGlyphs,
  displayIdOfRow,
  displayRowId,
  micLook,
  screenNotice,
  shortcutSections,
} from "./toolbar-model";

describe("chordGlyphs", () => {
  it("writes the page's Alt chords as macOS glyphs and leaves glyph chords alone", () => {
    expect(chordGlyphs("Alt+Shift+A")).toBe("⌥⇧A");
    expect(chordGlyphs("Alt+R")).toBe("⌥R");
    expect(chordGlyphs("Alt+]")).toBe("⌥]");
    expect(chordGlyphs("⌘⇧S")).toBe("⌘⇧S");
    expect(chordGlyphs("⌘,")).toBe("⌘,");
  });
});

describe("captureTone", () => {
  const idle = {
    waiting: false,
    problem: false,
    analysing: false,
    auto: false,
  };
  it("is neutral for Manual, blue for Auto, amber for a problem, dim while it waits", () => {
    expect(captureTone(idle)).toBeUndefined();
    expect(captureTone({ ...idle, auto: true })).toBe("accent");
    expect(captureTone({ ...idle, problem: true, auto: true })).toBe("warning");
    expect(captureTone({ ...idle, waiting: true, problem: true })).toBe("dim");
  });
  it("leaves the tone to the ring while analysing", () => {
    expect(
      captureTone({ ...idle, analysing: true, auto: true }),
    ).toBeUndefined();
  });
});

describe("captureSections", () => {
  const input = {
    mode: "manual" as const,
    auto: autoLimits(12),
    target: null,
    open: true,
    waiting: null,
    displays: null,
    chords: { auto: "⌥⇧U" },
  };
  it("lists When to analyse (Manual, then Auto) above the screen action, and no Display without a host", () => {
    const sections = captureSections(input);
    expect(sections.map((section) => section.id)).toEqual(["mode", "extra"]);
    expect(sections[0]?.label).toBe("When to analyse");
    expect(sections[0]?.value).toBe("manual");
    expect(sections[0]?.items.map((item) => item.id)).toEqual([
      "manual",
      "auto",
    ]);
    expect(sections[0]?.items[1]?.shortcut).toEqual(["⌥⇧U"]);
  });
  it("puts Display between them where the host can choose a screen, with its notice as a disabled row", () => {
    const sections = captureSections({
      ...input,
      displays: {
        rows: [
          {
            kind: "follow",
            label: "Follow my browser",
            sub: "x",
            checked: true,
          },
        ],
        notice: { text: "No displays found" },
      },
    });
    expect(sections.map((section) => section.id)).toEqual([
      "mode",
      "display",
      "extra",
    ]);
    const display = sections[1];
    expect(display?.label).toBe("Display");
    expect(display?.items.map((item) => item.id)).toEqual([
      "follow",
      "display-note",
    ]);
    expect(display?.items[1]?.disabled).toBe(true);
  });
  it("waits with a reason while paused: the display rows and Add screen say why, the modes never do", () => {
    const sections = captureSections({
      ...input,
      target: "T1",
      waiting: "Resume to capture",
      displays: {
        rows: [
          {
            kind: "follow",
            label: "Follow my browser",
            sub: "x",
            checked: true,
          },
        ],
        notice: null,
      },
    });
    expect(sections[0]?.items.every((item) => !item.disabledReason)).toBe(true);
    expect(sections[1]?.items[0]?.disabledReason).toBe("Resume to capture");
    expect(sections[2]?.items[0]?.disabledReason).toBe("Resume to capture");
  });
  it("names the task Add screen would join, and says what it needs when there is none", () => {
    expect(
      captureSections({ ...input, target: "T2" })[1]?.items[0],
    ).toMatchObject({ label: "Add screen to T2" });
    expect(captureSections(input)[1]?.items[0]).toMatchObject({
      label: "Add screen to this problem",
      disabledReason: "Needs a task first",
    });
  });
  it("gives each display row a small picture of that screen, and none to Follow my browser or a display without one", () => {
    const display = captureSections({
      ...input,
      displays: {
        rows: [
          {
            kind: "follow",
            label: "Follow my browser",
            sub: "x",
            checked: false,
          },
          {
            kind: "display",
            id: 7,
            name: "Studio Display",
            position: "2 of 3",
            thumbnailSrc: "data:image/jpeg;base64,AAAA",
            checked: true,
          },
          {
            kind: "display",
            id: 9,
            name: "Built-in",
            position: "3 of 3",
            thumbnailSrc: "",
            checked: false,
          },
        ],
        notice: null,
      },
    })[1];
    const [follow, pictured, plain] = display?.items ?? [];
    expect(follow?.icon).toBeUndefined();
    expect(plain?.icon).toBeUndefined();
    expect(pictured).toMatchObject({
      id: displayRowId(7),
      label: "Studio Display",
      description: "2 of 3",
      checked: true,
    });
    const picture = pictured?.icon as {
      type: string;
      props: Record<string, unknown>;
    };
    expect(picture.type).toBe("img");
    expect(picture.props).toMatchObject({
      src: "data:image/jpeg;base64,AAAA",
      // Decorative: the row's name already says which display it is.
      alt: "",
      draggable: false,
    });
  });
  it("maps display rows to ids and back", () => {
    expect(displayIdOfRow("follow")).toBeNull();
    expect(displayIdOfRow(displayRowId(7))).toBe(7);
  });
});

describe("screenNotice", () => {
  const problem = (title: string, fix: string) => ({
    kind: "capture-failed" as const,
    title,
    fix: { id: "pick-display" as const, label: fix },
  });
  it("leads with the first problem and its fix, naming the others under it", () => {
    expect(screenNotice([], () => true)).toBeNull();
    expect(
      screenNotice([problem("A", "Fix A"), problem("B", "Fix B")], () => true),
    ).toEqual({
      title: "A",
      detail: "B",
      fix: { id: "pick-display", label: "Fix A" },
    });
  });
  it("offers no fix the host cannot run", () => {
    expect(screenNotice([problem("A", "Fix A")], () => false)?.fix).toBeNull();
  });
});

describe("micLook", () => {
  const name = "Stop microphone";
  it("is neutral while listening, red and slashed when muted", () => {
    expect(
      micLook({ recording: true, status: "listening", attempt: 0, name }),
    ).toMatchObject({ icon: "mic", tone: undefined, badge: null, say: name });
    expect(
      micLook({ recording: false, status: "muted", attempt: 0, name }),
    ).toMatchObject({ icon: "mic_off", tone: "danger", badge: null });
  });
  it("is an amber outline with a ! badge when lost, and says the attempt while retrying", () => {
    const lost = micLook({
      recording: false,
      status: "lost",
      attempt: 0,
      name,
    });
    expect(lost).toMatchObject({ tone: "warning", say: "Microphone lost" });
    expect(lost.badge).toMatchObject({ tone: "warning", label: "!" });
    expect(
      micLook({ recording: false, status: "retrying", attempt: 3, name }).say,
    ).toBe("Microphone lost · Trying again · attempt 3");
  });
});

describe("answer style and shortcut menus", () => {
  it("groups the styles as Technical and Conversation with the current one checked", () => {
    const sections = answerStyleSections(answerStyleRows("behavioral"));
    expect(sections.map((section) => section.label)).toEqual([
      "Technical",
      "Conversation",
    ]);
    expect(sections.every((section) => section.labelStyle === "caps")).toBe(
      true,
    );
    expect(
      sections
        .flatMap((section) => section.items)
        .filter((item) => item.checked),
    ).toHaveLength(1);
  });
  it("shows the app's real keys in the hint row", () => {
    expect(answerStyleHint()).toEqual({
      label: "Previous / next",
      keys: ["⌥[", "⌥]"],
    });
  });
  it("groups the shortcuts, with Clear session memory last and the only destructive row", () => {
    const sections = shortcutSections();
    expect(sections.map((section) => section.label)).toEqual([
      "Capture",
      "Listening",
      "View",
      "Answer style",
      "App",
    ]);
    const rows = sections.flatMap((section) => section.items);
    expect(rows.at(-1)).toMatchObject({
      id: "session.clear",
      tone: "danger",
      shortcut: ["⌥⇧C"],
    });
    expect(rows.filter((row) => row.tone === "danger")).toHaveLength(1);
    expect(rows.every((row) => !row.shortcut?.[0]?.includes("+"))).toBe(true);
  });
});
