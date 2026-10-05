// The page's copy of the shell's capture source: a state machine over the three
// echoes (capture result, watch change, setCaptureDisplay answer).
import { describe, expect, it } from "vitest";
import {
  type CaptureSource,
  INITIAL_SOURCE,
  reduceSource,
  type SourceEvent,
} from "./host-display";

const d1 = { id: 1, name: "Built-in", index: 1, count: 2 };
const d2 = { id: 2, name: "DELL", index: 2, count: 2 };
const pinned2: CaptureSource = {
  display: d2,
  pinned: true,
  pinnedId: 2,
  pinDropped: false,
};

const table: [string, CaptureSource, SourceEvent, CaptureSource][] = [
  [
    "a capture names the display",
    INITIAL_SOURCE,
    { kind: "capture", display: d1 },
    { ...INITIAL_SOURCE, display: d1 },
  ],
  [
    "a pinned capture shows the pin on that display",
    INITIAL_SOURCE,
    { kind: "capture", display: d2, pinned: true },
    pinned2,
  ],
  [
    "a capture without display info keeps what was known",
    pinned2,
    { kind: "capture", pinned: true },
    pinned2,
  ],
  [
    "a fallback unpins and raises the notice once",
    pinned2,
    {
      kind: "capture",
      display: d1,
      pinned: true,
      pinFallback: "display-unavailable",
    },
    { display: d1, pinned: false, pinnedId: null, pinDropped: true },
  ],
  [
    "an unpinned capture after a fallback leaves the notice pending until told",
    { display: d1, pinned: false, pinnedId: null, pinDropped: true },
    { kind: "capture", display: d1, pinned: false },
    { display: d1, pinned: false, pinnedId: null, pinDropped: true },
  ],
  [
    "told lowers the notice",
    { display: d1, pinned: false, pinnedId: null, pinDropped: true },
    { kind: "told" },
    { display: d1, pinned: false, pinnedId: null, pinDropped: false },
  ],
  [
    "a watch change updates the display only",
    pinned2,
    { kind: "watch", display: d1 },
    { ...pinned2, display: d1 },
  ],
  [
    "a watch change without a display changes nothing",
    pinned2,
    { kind: "watch" },
    pinned2,
  ],
  [
    "pinning echoes the shell's answer",
    INITIAL_SOURCE,
    { kind: "select", result: { ok: true, pinned: true, display: d2 } },
    pinned2,
  ],
  [
    "following again unpins",
    pinned2,
    { kind: "select", result: { ok: true, pinned: false } },
    { ...pinned2, pinned: false, pinnedId: null },
  ],
  [
    "a display that is gone unpins and raises the notice",
    pinned2,
    { kind: "select", result: { ok: false, reason: "display-unavailable" } },
    { ...pinned2, pinned: false, pinnedId: null, pinDropped: true },
  ],
  [
    "a listing's pin shows on a fresh page, on its display",
    INITIAL_SOURCE,
    { kind: "pin", pinnedId: 2, display: d2 },
    pinned2,
  ],
  [
    "a listing that says no pin unpins",
    pinned2,
    { kind: "pin", pinnedId: null },
    { ...pinned2, pinned: false, pinnedId: null },
  ],
  [
    "a listing's fallback unpins and raises the notice",
    pinned2,
    { kind: "pin", pinnedId: null, pinFallback: "display-unavailable" },
    { ...pinned2, pinned: false, pinnedId: null, pinDropped: true },
  ],
];

describe("reduceSource", () => {
  it.each(table)("%s", (_name, state, event, expected) => {
    expect(reduceSource(state, event)).toEqual(expected);
  });

  it("returns the same object when nothing changes", () => {
    expect(reduceSource(INITIAL_SOURCE, { kind: "told" })).toBe(INITIAL_SOURCE);
    expect(reduceSource(INITIAL_SOURCE, { kind: "watch" })).toBe(
      INITIAL_SOURCE,
    );
  });
});
