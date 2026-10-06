import { describe, expect, it } from "vitest";

import { isTransientBuildFile, walk } from "./guard-support";

describe("the guards' file walk", () => {
  it("skips the files a build tool writes beside its config and deletes again", () => {
    expect(isTransientBuildFile("tsup.config.bundled_ngab4xhuszp.mjs")).toBe(
      true,
    );
    expect(
      isTransientBuildFile("vite.config.ts.timestamp-1791-ab12cd.mjs"),
    ).toBe(true);
  });

  it("still walks real source, config included", () => {
    for (const name of ["tsup.config.ts", "main.ts", "bundle-node-app.mjs"])
      expect(isTransientBuildFile(name)).toBe(false);
  });

  it("does not walk the gitignored audit scratch folders", () => {
    expect(
      walk("e2e/live-session", /\.(ts|mts|mjs)$/).some((file) =>
        file.includes("/.audit/"),
      ),
    ).toBe(false);
  });
});
