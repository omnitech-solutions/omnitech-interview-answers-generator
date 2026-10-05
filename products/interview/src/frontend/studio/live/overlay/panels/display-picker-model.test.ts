// The screen picker's rules as tables: rows from a list result, the refresh
// policy, the button's words and the honest states.
import { describe, expect, it } from "vitest";
import type { DisplayChoice } from "../../host-adapter";
import { type CaptureSource, INITIAL_SOURCE } from "../../host-display";
import {
  captureButtonTitle,
  captureTargetText,
  choiceText,
  DISPLAY_REFRESH_MS,
  LOADING,
  listNotice,
  listStateOf,
  nextRefreshDelay,
  pickerRows,
  screenButtonName,
} from "./display-picker-model";
import { SCREEN_CONTROL } from "./toolbar-config";

const d1 = { id: 1, name: "Built-in Retina", index: 1, count: 3 };
const d2 = { id: 2, name: "DELL U2720Q", index: 2, count: 3 };
const choices: DisplayChoice[] = [d1, d2].map((display) => ({
  display,
  thumbnailSrc: `data:image/jpeg;base64,AAAA${display.id}`,
}));
const ready = listStateOf({ ok: true, displays: choices });
const pinnedTo2: CaptureSource = {
  display: d2,
  pinned: true,
  pinnedId: 2,
  pinDropped: false,
};

describe("the control", () => {
  it("is the capture button's chevron: named, with no icon of its own", () => {
    expect(SCREEN_CONTROL.label).toBe("Screen to capture");
    expect(SCREEN_CONTROL).not.toHaveProperty("icon");
  });
});

describe("the button's words", () => {
  it.each<[string, CaptureSource, string]>([
    ["following", INITIAL_SOURCE, "Following your browser"],
    ["pinned", pinnedTo2, "Pinned: Display 2 of 3"],
    [
      "pinned, display not yet named",
      { ...INITIAL_SOURCE, pinned: true },
      "Pinned to a display",
    ],
    [
      "pinned to the only display",
      { ...pinnedTo2, display: { ...d2, count: 1 } },
      "Pinned: DELL U2720Q",
    ],
  ])("%s", (_name, source, text) => {
    expect(choiceText(source)).toBe(text);
    expect(screenButtonName(source)).toBe(`Screen to capture: ${text}`);
  });

  it("says the target in the capture button's tooltip: following, or the pinned display", () => {
    expect(captureTargetText(INITIAL_SOURCE)).toBe("following your browser");
    // A display seen in a capture result is not a pin.
    expect(captureTargetText({ ...INITIAL_SOURCE, display: d1 })).toBe(
      "following your browser",
    );
    expect(captureTargetText(pinnedTo2)).toBe("Display 2 of 3 (pinned)");
    expect(captureTargetText({ ...INITIAL_SOURCE, pinned: true })).toBe(
      "a pinned display",
    );
    expect(
      captureButtonTitle(
        "Capture the screen and analyse it as a new problem",
        INITIAL_SOURCE,
        "⌘⇧S",
      ),
    ).toBe(
      "Capture the screen and analyse it as a new problem: following your browser, ⌘⇧S",
    );
    expect(captureButtonTitle("Capture", pinnedTo2, "⌘⇧S")).toBe(
      "Capture: Display 2 of 3 (pinned), ⌘⇧S",
    );
  });
});

describe("menu rows", () => {
  it("lists 'Follow my browser' first, checked when not pinned", () => {
    const rows = pickerRows(ready, INITIAL_SOURCE);
    expect(rows.map((row) => row.kind)).toEqual([
      "follow",
      "display",
      "display",
    ]);
    expect(rows.map((row) => row.checked)).toEqual([true, false, false]);
    expect(rows[1]).toMatchObject({
      name: "Built-in Retina",
      position: "1 of 3",
      thumbnailSrc: "data:image/jpeg;base64,AAAA1",
    });
  });

  it("checks the pinned display and unchecks Follow", () => {
    expect(pickerRows(ready, pinnedTo2).map((row) => row.checked)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("is only the Follow row until displays are listed", () => {
    expect(pickerRows(LOADING, INITIAL_SOURCE)).toHaveLength(1);
    expect(
      pickerRows(
        listStateOf({ ok: false, reason: "capture-failed" }),
        pinnedTo2,
      ),
    ).toHaveLength(1);
  });
});

describe("honest states", () => {
  it.each([
    ["loading", LOADING, { text: "Looking for displays…" }],
    [
      "permission denied",
      listStateOf({ ok: false, reason: "permission-denied" }),
      {
        text: "Screen recording is not allowed",
        help: "Grant Screen Recording to the app",
      },
    ],
    [
      "capture failed",
      listStateOf({ ok: false, reason: "capture-failed" }),
      { text: "Could not read the displays" },
    ],
    [
      "no displays",
      listStateOf({ ok: true, displays: [] }),
      { text: "No displays found" },
    ],
    ["displays", ready, null],
  ])("%s", (_name, list, notice) => {
    expect(listNotice(list)).toEqual(notice);
  });
});

describe("refresh policy", () => {
  it("is at most every 2 s", () => {
    expect(DISPLAY_REFRESH_MS).toBe(2000);
  });

  it.each([
    [0, 0, 2000],
    [0, 500, 1500],
    [0, 1999, 1],
    [0, 2000, 0],
    [0, 9000, 0],
  ])("started at %i, now %i: wait %i ms", (startedAt, now, wait) => {
    expect(nextRefreshDelay(startedAt, now)).toBe(wait);
  });
});
