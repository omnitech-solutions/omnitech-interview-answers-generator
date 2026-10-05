// Layout rules that live only in panels.css, pinned as text because jsdom lays
// nothing out.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "panels.css"),
  "utf8",
);
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
};

describe("panels.css rules", () => {
  it("the analysis pane hides a note only while the chat pane (which shows it) is on screen", () => {
    expect(css).not.toMatch(
      /\.pn-single-pane\[data-which="analysis"\]\s*\.pn-note/,
    );
    expect(css).toMatch(
      /\.pn-single-body:has\(> \[data-which="chat"\]\)\s*>\s*\[data-which="analysis"\]\s*\.pn-note\s*\{\s*display: none;/,
    );
  });

  it("the screen menu scrolls inside the window instead of being cut off", () => {
    const menu = rule(".pn-display-menu");
    expect(menu).toMatch(/max-height: calc\(100vh - \d+px\)/);
    expect(menu).toMatch(/overflow-y: auto/);
  });
});
