import { describe, expect, it } from "vitest";
import { BARE_WIDTH, PANE_WIDTH, windowWidthFor } from "./single-panel";

describe("the one window's width follows the panes that are showing", () => {
  const all = { chat: true, analysis: true, code: true };

  it("fits every pane when all show, and only the toolbar when none do", () => {
    expect(windowWidthFor(all)).toBe(
      PANE_WIDTH.chat + PANE_WIDTH.analysis + PANE_WIDTH.code + 8 * 2 + 16,
    );
    expect(windowWidthFor({ chat: false, analysis: false, code: false })).toBe(
      BARE_WIDTH,
    );
  });

  it("narrows by a pane and its gap when that pane is hidden", () => {
    expect(windowWidthFor({ ...all, code: false })).toBe(
      PANE_WIDTH.chat + PANE_WIDTH.analysis + 8 + 16,
    );
  });
});
