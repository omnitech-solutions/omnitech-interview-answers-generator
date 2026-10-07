// The transparent-background switch: the real effect is the data-glass
// attribute on the panel root, which panels.css turns into see-through glass.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "panels.css"), "utf8");

// The declarations of the first rule whose selector is exactly `selector`.
function block(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}
const tokens = (declarations: string) =>
  new Map(
    [...declarations.matchAll(/^\s*(--pn-[\w-]+):\s*([^;]+);/gm)].map((m) => [
      m[1] as string,
      (m[2] as string).trim(),
    ]),
  );
const alphaOf = (value: string) =>
  Number(/rgba\([^)]*,\s*([\d.]+)\)\s*$/.exec(value)?.[1]);

const base = tokens(block(".pn-root"));
const clear = tokens(block('.pn-root[data-glass="clear"]'));
// A token whose value is another token (var(--x)) is read through it.
const resolved = (table: Map<string, string>, name: string): string => {
  const value = table.get(name) as string;
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  return ref ? resolved(base, ref[1] as string) : value;
};
const GLASS_TOKEN =
  /^--pn-(glass|chip|hair|ring|control-line|blur|shadow|text-shadow)/;

describe("clear glass in panels.css", () => {
  it("overrides every glass token the default block defines", () => {
    const glass = [...base.keys()].filter((name) => GLASS_TOKEN.test(name));
    expect(glass.length).toBeGreaterThan(8);
    for (const name of glass) expect(clear.has(name), name).toBe(true);
  });

  it("makes every fill less opaque and drops every blur", () => {
    // Menus are the exception: they sit on a dense bed (below), never clearer.
    for (const name of ["--pn-glass", "--pn-glass-code"])
      expect(alphaOf(clear.get(name) as string), name).toBeLessThan(
        alphaOf(base.get(name) as string),
      );
    for (const name of [
      "--pn-blur-control",
      "--pn-blur-menu",
      "--pn-blur-bar",
      "--pn-blur-card",
    ])
      expect(clear.get(name)).toBe("none");
  });

  it("keeps readability floors: min tint, hairline, text shadow", () => {
    const floor = alphaOf(base.get("--pn-min-tint") as string);
    expect(floor).toBeGreaterThanOrEqual(0.18);
    for (const name of ["--pn-glass", "--pn-glass-menu", "--pn-glass-code"])
      expect(alphaOf(resolved(clear, name)), name).toBeGreaterThanOrEqual(
        floor,
      );
    expect(clear.get("--pn-hair")).toMatch(/0\.2\d|0\.[3-9]/);
    expect(clear.get("--pn-control-line")).toContain("1px");
    expect(clear.get("--pn-ring")).toContain("1px");
    expect(clear.get("--pn-text-shadow")).toMatch(/0 0 3px/);
    expect(clear.get("--pn-bed")).toBe("var(--pn-text-bed)");
    expect(alphaOf(base.get("--pn-text-bed") as string)).toBeGreaterThanOrEqual(
      0.5,
    );
    expect(css).toMatch(
      /\[data-glass="clear"\]\s*:is\([^)]*\.pn-task-chip[^)]*\)\s*\{[^}]*--pn-bed/,
    );
  });

  it("puts menus and popovers on a dense bed in clear glass, and the strip line on the reading bed", () => {
    expect(clear.get("--pn-glass-menu")).toBe("var(--pn-menu-bed)");
    expect(alphaOf(base.get("--pn-menu-bed") as string)).toBeGreaterThanOrEqual(
      0.85,
    );
    expect(css).toMatch(
      /\[data-glass="clear"\]\s*:is\([^)]*\.pn-strip-main[^)]*\.pn-strip-sub[^)]*\)\s*\{[^}]*--pn-bed/,
    );
    // Every menu surface reads the menu token, so the bed applies to all of them.
    expect(block(".pn-menu")).toMatch(/background:\s*var\(--pn-glass-menu\)/);
  });

  it("reads every blur and the text shadow from the tokens", () => {
    expect(css).not.toMatch(/backdrop-filter:\s*blur\(/);
    expect(css).toMatch(/text-shadow:\s*var\(--pn-text-shadow\)/);
  });
});
