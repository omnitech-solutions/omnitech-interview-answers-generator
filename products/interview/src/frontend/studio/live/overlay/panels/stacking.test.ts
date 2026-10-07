// Popovers hang from the toolbar, so they paint in the toolbar's stacking
// context. The status strip and the panes use backdrop-filter, which gives each
// its own stacking context; with the toolbar left at z-index auto, those later
// siblings painted OVER an open menu. One named scale fixes the order for every
// popover; the clear (glass) mode must not touch it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "panels.css"), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
};
const token = (name: string) =>
  Number(new RegExp(`--pn-z-${name}:\\s*(\\d+)`).exec(css)?.[1]);

describe("the stacking scale", () => {
  it("orders panes below the strip, the strip below the toolbar and the toolbar below its popovers", () => {
    expect(token("panes")).toBeLessThan(token("strip"));
    expect(token("strip")).toBeLessThan(token("toolbar"));
    expect(token("toolbar")).toBeLessThan(token("popover"));
  });

  it("is used by the toolbar, the strip and every popover panel (the one .pn-menu)", () => {
    expect(block(".pn-pill")).toMatch(/z-index:\s*var\(--pn-z-toolbar\)/);
    expect(block(".pn-root .pn-toolbar")).toMatch(
      /z-index:\s*var\(--pn-z-toolbar\)/,
    );
    expect(block(".pn-strip")).toMatch(/z-index:\s*var\(--pn-z-strip\)/);
    expect(block(".pn-menu")).toMatch(/z-index:\s*var\(--pn-z-popover\)/);
  });

  it("paints a popover portalled to <body> (the End confirmation) above the fixed panel root", () => {
    const root = Number(/\.pn-root \{[\s\S]*?z-index:\s*(\d+)/.exec(css)?.[1]);
    const wrapper = Number(
      /body > \[data-radix-popper-content-wrapper\] \{\s*z-index:\s*(\d+) !important/.exec(
        css,
      )?.[1],
    );
    expect(wrapper).toBeGreaterThan(root);
  });

  it("is not changed by clear glass", () => {
    expect(block('.pn-root[data-glass="clear"]')).not.toMatch(/z-index/);
  });
});
