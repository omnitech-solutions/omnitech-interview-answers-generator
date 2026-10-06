// The Studio's own `.studio-button` look is retired in favour of the shared
// Button. Only the live session bar (another slice's migration) may still use
// the class; when it moves, shrink LEGACY_USERS to nothing and delete the rule.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const studio = join(dirname(fileURLToPath(import.meta.url)), "..", "studio");
const LEGACY_USERS = ["live/end-confirm.tsx", "live/session-bar.tsx"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const files = walk(studio).filter((file) => !file.includes(".test."));
const relative = (file: string) => file.slice(studio.length + 1);

describe("the retired .studio-button class", () => {
  it("is used only by the live session bar's legacy buttons", () => {
    const users = files
      .filter((file) => /\.tsx$/.test(file))
      .filter((file) => readFileSync(file, "utf8").includes("studio-button"))
      .map(relative)
      .sort();
    expect(users).toEqual(LEGACY_USERS);
  });

  it("has one stylesheet definition and no ancestor-scoped variants", () => {
    const rules = files
      .filter((file) => file.endsWith(".css"))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .split("\n")
          .filter((line) => line.includes(".studio-button"))
          .map((line) => `${relative(file)}: ${line.trim()}`),
      );
    const definitions = rules.filter((rule) =>
      /\.studio-button[^-\w]/.test(`${rule} `),
    );
    // tokens.css: the rule, its :hover and :disabled; live.css: the bar's
    // min-height.
    expect(definitions.map((rule) => rule.split(":")[0]).sort()).toEqual([
      "live/live.css",
      "tokens.css",
      "tokens.css",
      "tokens.css",
    ]);
  });
});
