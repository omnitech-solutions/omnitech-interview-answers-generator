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

describe("panels.css rules", () => {
  it("the analysis pane hides a note only while the chat pane (which shows it) is on screen", () => {
    expect(css).not.toMatch(
      /\.pn-single-pane\[data-which="analysis"\]\s*\.pn-note/,
    );
    expect(css).toMatch(
      /\.pn-single-body:has\(> \[data-which="chat"\]\)\s*>\s*\[data-which="analysis"\]\s*\.pn-note\s*\{\s*display: none;/,
    );
  });

  it("the toolbar is drawn by the library: no size system, no old control families left in panels.css", () => {
    const at = css.indexOf(".pn-root .pn-toolbar {");
    expect(at).toBeGreaterThanOrEqual(0);
    const toolbar = css.slice(at, css.indexOf("}", at));
    // T9: heights, radius and gaps come from the library tokens (36 px
    // controls, radius 10, gap 6), never from an override here.
    for (const property of ["height", "padding", "gap", "border-radius"])
      expect(toolbar, property).not.toMatch(new RegExp(`\\b${property}:`));
    // See-through lowers the surface only, through the library's level.
    expect(toolbar).toContain("--oui-panel-see-through");
    for (const old of [
      "pn-split-main",
      "pn-split-menu",
      "pn-skill",
      "pn-keys",
      "pn-level",
      "pn-icon-button",
      "pn-mic-button",
      "pn-display-",
      "pn-screen-button",
      "pn-pin-dot",
      "pn-quit-confirm",
    ])
      expect(css, old).not.toContain(old);
  });
});
