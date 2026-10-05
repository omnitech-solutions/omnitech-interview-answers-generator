// The on-device OCR wiring stays portable and pinned (T36 finding 9): the
// copy script converts file URLs with fileURLToPath (a checkout path with a
// space must not become a literal "%20" directory), the engine and its data
// are pinned to exact versions, and its install script is denied explicitly.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("OCR asset wiring", () => {
  it("converts file URLs with fileURLToPath, never .pathname", () => {
    const script = read("apps/web/scripts/copy-ocr-assets.mjs");
    expect(script).toMatch(/fileURLToPath\(/);
    expect(script).not.toMatch(/\.pathname/);
  });

  it("pins tesseract.js and its English data to exact versions", () => {
    const { dependencies } = JSON.parse(
      read("products/interview/package.json"),
    ) as { dependencies: Record<string, string> };
    expect(dependencies["tesseract.js"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dependencies["@tesseract.js-data/eng"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("denies the tesseract.js install script explicitly", () => {
    expect(read("pnpm-workspace.yaml")).toMatch(/^ {2}tesseract\.js: false$/m);
  });
});
