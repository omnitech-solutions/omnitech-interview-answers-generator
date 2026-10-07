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

  it("is not changed by clear glass", () => {
    expect(block('.pn-root[data-glass="clear"]')).not.toMatch(/z-index/);
  });

  it("keeps the panel root below the library's body-level popovers (z-50)", () => {
    // The footer's End confirmation portals to <body>; a root above it would
    // sit over the popover and take its clicks (found by the claims e2e).
    const zIndex = Number(/z-index:\s*(\d+)/.exec(block(".pn-root"))?.[1]);
    expect(zIndex).toBeLessThan(50);
  });
});
