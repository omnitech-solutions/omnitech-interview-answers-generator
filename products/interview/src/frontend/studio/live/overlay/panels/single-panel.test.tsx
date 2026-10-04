import { describe, expect, it } from "vitest";
import type { LiveAction } from "@omnitech/interview-contracts";
import { generatedByLabel } from "./single-panel";

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
