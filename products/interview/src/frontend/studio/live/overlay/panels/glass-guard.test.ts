// The glass guard: a surface under the panel root may never paint its own dense
// literal background or its own blur, because the clear (Transparent background)
// look is driven by tokens (--pn-glass*, --pn-blur-*, --pn-bed) and a literal
// would defeat it. Measured in WebKit over a checkerboard (e2e glass-clear.spec.ts):
// the panes, strip, toolbar and footer must keep the backdrop visible.
//
// Fails on: a literal background (rgba alpha > .30, #hex, rgb()) or a
// backdrop-filter that is neither `none` nor a `var(...)`, in panels.css,
// screenshots.css or overlay.css. Every exception is in ALLOWED with a reason;

// an entry that matches no rule fails as stale.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const FILES: Record<string, string> = {
  "panels.css": join(here, "panels.css"),
  "start-panel.css": join(here, "start-panel.css"),
  "screenshots.css": join(here, "../../shared/screenshots.css"),
  "overlay.css": join(here, "../overlay.css"),
};

type Allowed = readonly [
  file: string,
  selector: string,
  property: string,
  reason: string,
];
const ALLOWED: readonly Allowed[] = [
  [
    "panels.css",
    ".pn-root",
    "background",
    "The page background of a plain browser tab; native shell documents override it to transparent (overlay.css native block).",
  ],
  [
    "panels.css",
    ".pn-danger",
    "background",
    "A destructive button is a small solid control, never a surface.",
  ],
  [
    "panels.css",
    ".pn-toast",
    "background",
    "A toast is its own dark fade for legibility, not a pane.",
  ],
  [
    "panels.css",
    ':root[data-panel-host="native"] .pn-root .pn-toast',
    "background",
    "The same toast fade in the native window.",
  ],
  [
    "start-panel.css",
    '.pn-chip-initial[data-kind="local"]',
    "background",
    "A small round avatar, never a surface.",
  ],
  [
    "start-panel.css",
    '.pn-start-wide[data-provider="google"]',
    "background",
    "A provider's own brand button is a small solid control.",
  ],
  [
    "start-panel.css",
    '.pn-start-wide[data-provider="linkedin"]',
    "background",
    "A provider's own brand button is a small solid control.",
  ],
  [
    "start-panel.css",
    ".pn-start-mark-g",
    "background",
    "A provider's small brand mark inside its button.",
  ],
  [
    "start-panel.css",
    ".pn-start-mark-in",
    "background",
    "A provider's small brand mark inside its button.",
  ],
  [
    "start-panel.css",
    ".pn-start-toast",
    "background",
    "A toast is its own light chip for legibility, not a pane.",
  ],
  [
    "screenshots.css",
    ".ss-thumb",
    "background",
    "Letterbox behind a thumbnail image.",
  ],
  [
    "screenshots.css",
    ".ss-viewer-scrim",
    "background",
    "The image viewer is a modal lightbox portalled to the body, outside the panel root; it dims on purpose.",
  ],
  [
    "screenshots.css",
    ".ss-viewer",
    "background",
    "The modal image viewer (dialog) is solid by design.",
  ],
  [
    "screenshots.css",
    ".ss-viewer-stage",
    "background",
    "Letterbox behind the viewed image.",
  ],
  ["screenshots.css", ".ss-crop-handle", "background", "A white drag handle."],
  [
    "overlay.css",
    ".ov-root",
    "background",
    "The web/PiP overlay root; a native shell makes it transparent.",
  ],
  ["overlay.css", ".ov-thumb span", "background", "Skeleton placeholder bars."],
  [
    "overlay.css",
    ".ov-thumb span:nth-child(1)",
    "background",
    "Skeleton placeholder bars.",
  ],
  [
    "overlay.css",
    ".ov-sheet",
    "background",
    "The overlay sheet is a modal scrim outside the panels.",
  ],
  [
    "overlay.css",
    ".ov-sheet",
    "backdrop-filter",
    "Modal scrim outside the panels.",
  ],
  [
    "overlay.css",
    ".ov-sheet-panel",
    "background",
    "Modal sheet outside the panels.",
  ],
  [
    "overlay.css",
    ".ov-stage",
    "background",
    "Black stage behind a video/preview.",
  ],
  [
    "overlay.css",
    ".ov-card",
    "backdrop-filter",
    "The legacy overlay card (not a panel surface).",
  ],
  [
    "overlay.css",
    ".ov-menu",
    "backdrop-filter",
    "The legacy overlay menu (not a panel surface).",
  ],
  [
    "overlay.css",
    ':root[data-panel-host="native"] .ov-sheet',
    "background",
    "Modal scrim outside the panels.",
  ],
  [
    "overlay.css",
    ':root[data-panel-host="native"] .ov-sheet',
    "backdrop-filter",
    "Modal scrim outside the panels.",
  ],
  [
    "overlay.css",
    ':root[data-panel-host="native"] .lc-canvas',
    "backdrop-filter",
    "The Live Canvas window, not a panel root.",
  ],
];

export type Finding = {
  file: string;
  selector: string;
  property: string;
  value: string;
};

export function findings(file: string, source: string): Finding[] {
  const css = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import[^;]*;/g, "");
  const out: Finding[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (rule[1] ?? "").trim().replace(/\s+/g, " ");
    for (const declaration of (rule[2] ?? "").split(";")) {
      const match =
        /^\s*(background(?:-color|-image)?|backdrop-filter|-webkit-backdrop-filter)\s*:\s*([\s\S]+)$/.exec(
          declaration,
        );
      if (!match) continue;
      const value = (match[2] ?? "").trim().replace(/\s+/g, " ");
      const property = (match[1] ?? "")
        .replace(/^-webkit-/, "")
        .replace(/-(color|image)$/, "");
      const dense = [...value.matchAll(/rgba\([^)]*,\s*([\d.]+)\)/g)].some(
        (m) => Number(m[1]) > 0.3,
      );
      const bad =
        property === "backdrop-filter"
          ? !/^(none|var\()/.test(value)
          : dense || /^(#|rgb\()/.test(value);
      if (bad) out.push({ file, selector, property, value });
    }
  }
  return out;
}

const all = Object.entries(FILES).flatMap(([file, path]) =>
  findings(file, readFileSync(path, "utf8")),
);
const key = (f: { file: string; selector: string; property: string }) =>
  `${f.file}|${f.selector}|${f.property}`;

describe("glass guard", () => {
  it("finds a dense background or a literal blur", () => {
    expect(findings("x.css", ".a { background: rgba(0,0,0,.5) }")).toHaveLength(
      1,
    );
    expect(findings("x.css", ".a { backdrop-filter: blur(4px) }")).toHaveLength(
      1,
    );
    expect(
      findings(
        "x.css",
        ".a { background: rgba(0,0,0,.2); backdrop-filter: var(--pn-blur-bar) }",
      ),
    ).toEqual([]);
  });

  it("allows no literal dense background or literal blur beyond the listed exceptions", () => {
    const allowed = new Set(
      ALLOWED.map(
        ([file, selector, property]) => `${file}|${selector}|${property}`,
      ),
    );
    expect(all.filter((f) => !allowed.has(key(f))).map(key)).toEqual([]);
  });

  it("keeps no stale exception", () => {
    const found = new Set(all.map(key));
    expect(
      ALLOWED.filter(
        ([file, selector, property]) =>
          !found.has(`${file}|${selector}|${property}`),
      ).map(([f, s, p]) => `${f}|${s}|${p}`),
    ).toEqual([]);
    for (const [, , , reason] of ALLOWED)
      expect(reason.length).toBeGreaterThan(10);
  });
});
