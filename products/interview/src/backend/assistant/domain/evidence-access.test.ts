import { describe, expect, it } from "vitest";
import { evidenceUsableBy, workspaceReadableBy } from "./evidence-access";

describe("evidenceUsableBy", () => {
  it("needs the actor in the audience and a source that is not restricted", () => {
    expect(
      evidenceUsableBy("me", { classification: "internal", audience: ["me"] }),
    ).toBe(true);
    expect(
      evidenceUsableBy("me", { classification: "internal", audience: ["you"] }),
    ).toBe(false);
    expect(
      evidenceUsableBy("me", {
        classification: "restricted",
        audience: ["me"],
      }),
    ).toBe(false);
    expect(
      evidenceUsableBy("me", { classification: "public", audience: "me" }),
    ).toBe(false);
  });
});

describe("workspaceReadableBy", () => {
  const open = { classification: "public", audience: ["me"] };
  it("is open with no source and with only usable sources", () => {
    expect(workspaceReadableBy("me", [])).toBe(true);
    expect(workspaceReadableBy("me", [open, open])).toBe(true);
  });
  it("is closed by one restricted or unshared latest source", () => {
    expect(
      workspaceReadableBy("me", [
        open,
        { ...open, classification: "restricted" },
      ]),
    ).toBe(false);
    expect(workspaceReadableBy("me", [open, { ...open, audience: [] }])).toBe(
      false,
    );
  });
});
