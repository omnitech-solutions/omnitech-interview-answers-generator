import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

// Packages and products the web app loads from dist: each one `pnpm dev`
// must rebuild on save, or the app keeps running a stale build.
const tscBuiltPackages = ["packages", "products"]
  .flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${group}/${entry.name}`),
  )
  .filter((dir) => {
    try {
      const manifest = JSON.parse(
        readFileSync(join(root, dir, "package.json"), "utf8"),
      ) as { scripts?: Record<string, string> };
      return manifest.scripts?.["build"] === "tsc -b";
    } catch {
      return false;
    }
  })
  .sort();

// The root solution scripts/dev.mjs watches; its leading comment lines are
// not JSON.
const solution = JSON.parse(
  readFileSync(join(root, "tsconfig.json"), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n"),
) as { files: string[]; references: Array<{ path: string }> };

describe("the development build graph", () => {
  it("watches every package and product built with tsc -b", () => {
    expect(solution.references.map((ref) => ref.path).sort()).toEqual(
      tscBuiltPackages,
    );
  });

  it("is a solution file that compiles nothing itself", () => {
    expect(solution.files).toEqual([]);
  });
});
