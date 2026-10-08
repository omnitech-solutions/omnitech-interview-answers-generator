// `pnpm dev` keeps a copy of what its servers print in .dev-local/dev.log, so a
// failure can be read after the terminal has scrolled past it. scripts/dev.mjs
// is a launcher that starts Docker, builds and spawns servers at import, so it
// is read here as source (the same way dev-build-graph.test.ts reads what it
// watches) instead of being run.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(import.meta.dirname, "dev.mjs"),
  "utf8",
).replace(/\s+/g, " ");
// The launcher's own colour pattern, compiled from its source.
const pattern = /const ANSI = \/(.+?)\/g;/.exec(source)?.[1];
const strip = (text: string) =>
  text.replace(new RegExp(pattern as string, "g"), "");
const ESC = String.fromCharCode(27);

describe("the development log", () => {
  it("is written to .dev-local/dev.log, fresh on every run", () => {
    expect(source).toContain(
      'mkdirSync(new URL("../.dev-local/", import.meta.url), { recursive: true });',
    );
    // No append flag: the file holds this run only.
    expect(source).toContain(
      'createWriteStream(new URL("../.dev-local/dev.log", import.meta.url));',
    );
  });

  it("tees the servers and the build watcher to the terminal and to the log", () => {
    // Both long-running children write to pipes that the launcher copies.
    expect(source).toContain(
      'const logged = { env: loggedEnvironment, stdio: ["inherit", "pipe", "pipe"] };',
    );
    expect(source.match(/= tee\( ?spawn\(/g)).toHaveLength(2);
    expect(source.match(/\], logged, ?\)\);/g)).toHaveLength(2);
    for (const pair of [
      "[running.stdout, process.stdout]",
      "[running.stderr, process.stderr]",
    ])
      expect(source).toContain(pair);
    expect(source).toContain("terminal.write(chunk);");
    expect(source).toContain('devLog.write(String(chunk).replace(ANSI, ""));');
  });

  it("strips colours and cursor codes from the log, and nothing else", () => {
    expect(pattern).toBeDefined();
    expect(
      strip(
        `${ESC}[32m✓${ESC}[0m ready in ${ESC}[1;36m812ms${ESC}[39m${ESC}[2K${ESC}[?25l`,
      ),
    ).toBe("✓ ready in 812ms");
    expect(strip("GET /t/local [200] in 12ms\n")).toBe(
      "GET /t/local [200] in 12ms\n",
    );
  });

  it("asks the children to keep their colours on a pipe, unless NO_COLOR is set", () => {
    expect(source).toContain(
      'const loggedEnvironment = process.env.NO_COLOR ? localEnvironment : { ...localEnvironment, FORCE_COLOR: localEnvironment.FORCE_COLOR ?? "1" };',
    );
  });
});
