import { describe, expect, it } from "vitest";
import { headlineOf, miniStage, missingHint } from "./mini-model";

describe("headlineOf", () => {
  it("is the first sentence of the answer, on one line, without markup", () => {
    expect(headlineOf("**Use a heap.** It keeps the k largest.\nDone.")).toBe(
      "Use a heap.",
    );
  });
  it("truncates a long sentence with an ellipsis", () => {
    const out = headlineOf(`${"word ".repeat(60)}end.`) ?? "";
    expect(out.length).toBeLessThanOrEqual(90);
    expect(out.endsWith("…")).toBe(true);
  });
  it("is null with no answer", () => {
    expect(headlineOf(null)).toBeNull();
    expect(headlineOf("  \n ")).toBeNull();
  });
});

describe("miniStage", () => {
  const card = (state: string) =>
    ({ stages: [{ state }] }) as unknown as Parameters<
      typeof miniStage
    >[0]["card"];
  const idle = { open: true, phase: null, activityKey: "idle" } as const;
  it("uses the strip's wording while work runs", () => {
    expect(
      miniStage({
        ...idle,
        phase: "analyzing",
        activityKey: "drafting",
        card: null,
      }),
    ).toBe("Drafting an answer");
    expect(
      miniStage({
        ...idle,
        phase: "analyzing",
        activityKey: "coding-draft",
        card: null,
      }),
    ).toBe("Solutioning");
  });
  it("says Answer ready, Stopped, or the session ended", () => {
    expect(miniStage({ ...idle, card: card("done") })).toBe("Answer ready");
    expect(miniStage({ ...idle, card: card("stopped") })).toBe("Stopped");
    expect(miniStage({ ...idle, open: false, card: card("done") })).toBe(
      "Session ended",
    );
    expect(miniStage({ ...idle, card: null })).toBeNull();
  });
});

describe("missingHint", () => {
  it("counts", () => {
    expect(missingHint(3)).toBe("3 things may be missing");
    expect(missingHint(1)).toBe("1 thing may be missing");
  });
});
