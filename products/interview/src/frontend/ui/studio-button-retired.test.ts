// The Studio's own `.studio-button` look is retired in favour of the library
// Button: no component uses the class and no stylesheet defines it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const studio = join(dirname(fileURLToPath(import.meta.url)), "..", "studio");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const files = walk(studio).filter((file) => !file.includes(".test."));
const relative = (file: string) => file.slice(studio.length + 1);

describe("the retired .studio-button class", () => {
  it("is used by no component", () => {
    const users = files
      .filter((file) => /\.tsx$/.test(file))
      .filter((file) => readFileSync(file, "utf8").includes("studio-button"))
      .map(relative)
      .sort();
    expect(users).toEqual([]);
  });

  it("has no stylesheet definition and no ancestor-scoped variants", () => {
    const rules = files
      .filter((file) => file.endsWith(".css"))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .split("\n")
          .filter((line) => line.includes(".studio-button"))
          .map((line) => `${relative(file)}: ${line.trim()}`),
      );
    expect(rules).toEqual([]);
  });
});
