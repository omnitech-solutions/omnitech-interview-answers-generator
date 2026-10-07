import { describe, expect, it } from "vitest";
import { buildTagOf, shortSha } from "./build-tag";

describe("build tag", () => {
  it("shows sha and branch only when not packaged", () => {
    expect(
      buildTagOf({
        sha: "a1b2c3d4e5f6",
        branch: "native-swap",
        isPackaged: false,
      }),
    ).toEqual({
      sha: "a1b2c3d",
      branch: "native-swap",
      label: "a1b2c3d · native-swap",
    });
    expect(
      buildTagOf({ sha: "a1b2c3d", branch: "main", isPackaged: true }),
    ).toBeNull();
  });

  it("drops the branch when unknown and keeps the dirty marker", () => {
    expect(
      buildTagOf({ sha: "a1b2c3d4+", branch: null, isPackaged: false })?.label,
    ).toBe("a1b2c3d+");
    expect(shortSha("abc")).toBe("abc");
  });

  it("falls back to the page's build id when the shell says nothing", () => {
    expect(buildTagOf(null, "9f8e7d6c")?.label).toBe("9f8e7d6");
    expect(buildTagOf(null, "dev")?.label).toBe("dev");
  });
});
