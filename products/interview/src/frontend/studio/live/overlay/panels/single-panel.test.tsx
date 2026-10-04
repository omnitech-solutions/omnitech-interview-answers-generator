import { describe, expect, it } from "vitest";
import type { LiveAction } from "@omnitech/interview-contracts";
import {
  BARE_WIDTH,
  generatedByLabel,
  PANE_WIDTH,
  windowWidthFor,
} from "./single-panel";

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

describe("the model chip", () => {
  const action = (
    updatedAt: string,
    generatedBy?: { runtime: string; model: string },
    dispatchStatus = "succeeded",
  ) => ({ updatedAt, generatedBy, dispatchStatus }) as unknown as LiveAction;

  it("names the runtime and model of the latest succeeded answer", () => {
    expect(
      generatedByLabel([
        action("2026-10-04T10:00:00Z", { runtime: "codex", model: "gpt-x" }),
        action("2026-10-04T10:05:00Z", {
          runtime: "claude-code",
          model: "claude-sonnet-5-5",
        }),
      ]),
    ).toBe("Claude · claude-sonnet-5-5");
  });

  it("shows nothing before any answer, and ignores failed or unlabelled ones", () => {
    expect(generatedByLabel([])).toBeNull();
    expect(
      generatedByLabel([
        action("2026-10-04T10:00:00Z", undefined),
        action(
          "2026-10-04T10:01:00Z",
          { runtime: "codex", model: "m" },
          "failed",
        ),
      ]),
    ).toBeNull();
  });
});
