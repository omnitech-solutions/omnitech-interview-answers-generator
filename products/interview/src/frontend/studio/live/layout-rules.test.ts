// Layout and theme rules for the live session stylesheets, checked from the
// CSS itself because no browser runs here (phone-width and dark-mode rendering
// stay unobserved until someone opens it). Rules: nothing fixed wider than a
// 360 px phone can hold, grids that wrap, no sideways page scroll, 40 px touch
// targets, reduced motion honoured, tokens only for colour, and a visible focus
// ring on every interactive control.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const studio = join(here, "..");

type Rule = {
  file: string;
  selector: string;
  // The at-rules around it (@media …, @keyframes …), outermost first.
  around: string[];
  decls: Record<string, string>;
};

// A small CSS reader: enough for these files (no nesting inside rules).
function readCss(file: string): Rule[] {
  const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const open: string[] = [];
  let buffer = "";
  for (const char of text) {
    if (char === "{") {
      open.push(buffer.trim().replace(/\s+/g, " "));
      buffer = "";
    } else if (char === "}") {
      const body = buffer.trim();
      buffer = "";
      const head = open.pop() ?? "";
      if (head && !head.startsWith("@") && body) {
        const decls: Record<string, string> = {};
        for (const part of body.split(";")) {
          const colon = part.indexOf(":");
          if (colon > 0)
            decls[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
        }
        rules.push({
          file,
          selector: head,
          around: open.filter((entry) => entry.startsWith("@")),
          decls,
        });
      }
    } else if (char === ";" && open.length === 0) {
      buffer = ""; // @import
    } else buffer += char;
  }
  return rules;
}

const liveFiles = readdirSync(here)
  .filter((file) => file.endsWith(".css"))
  .map((file) => join(here, file));
const rules = liveFiles
  .flatMap(readCss)
  .filter(
    (rule) => !rule.around.some((entry) => entry.startsWith("@keyframes")),
  );
const tokens = readFileSync(join(studio, "tokens.css"), "utf8");

const inMedia = (rule: Rule) =>
  rule.around.some((entry) => entry.startsWith("@media"));
const px = (value: string): number[] =>
  [...value.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
const where = (rule: Rule) => `${rule.file.split("/").pop()}: ${rule.selector}`;
// Split at commas that are not inside parentheses: ":is(a, b)" stays whole.
function topSplit(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += char;
  }
  parts.push(current.trim());
  return parts;
}
const selectors = (rule: Rule) => topSplit(rule.selector);

// The first argument of every minmax(), with min(…, 100%) kept whole.
function minmaxFloors(value: string): string[] {
  const floors: string[] = [];
  for (const match of value.matchAll(/minmax\(/g)) {
    let depth = 1;
    let index = (match.index ?? 0) + match[0].length;
    const start = index;
    for (; index < value.length && depth > 0; index += 1) {
      if (value[index] === "(") depth += 1;
      if (value[index] === ")") depth -= 1;
    }
    floors.push(topSplit(value.slice(start, index - 1))[0] ?? "");
  }
  return floors;
}

// The class tokens on every <button> in the live views' source.
function buttonClassLists(): { file: string; classes: string[] }[] {
  const found: { file: string; classes: string[] }[] = [];
  for (const file of readdirSync(here).filter(
    (name) => name.endsWith(".tsx") && !name.includes(".test."),
  )) {
    const text = readFileSync(join(here, file), "utf8");
    for (const match of text.matchAll(/<button\b/g)) {
      const tag = text.slice(match.index, text.indexOf("<", match.index + 1));
      const named = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(tag);
      const value = (named?.[1] ?? named?.[2] ?? "").replace(
        /\$\{[^}]*\}/g,
        "",
      );
      found.push({
        file,
        classes: value.split(/\s+/).filter(Boolean),
      });
    }
  }
  return found;
}

describe("live stylesheets", () => {
  it("finds the stylesheets it is meant to check", () => {
    expect(liveFiles.map((file) => file.split("/").pop()).sort()).toEqual(
      expect.arrayContaining([
        "ended.css",
        "live.css",
        "pairing.css",
        "session-bar.css",
        "session-claims.css",
        "session-tabs.css",
        "session-view.css",
        "setup.css",
        "workspace-handoff.css",
      ]),
    );
    expect(rules.length).toBeGreaterThan(100);
  });

  it("sets no fixed width above 360 px outside min(), max(), clamp() or a media query", () => {
    const offenders: string[] = [];
    for (const rule of rules) {
      if (inMedia(rule)) continue;
      for (const property of ["width", "min-width", "flex-basis", "flex"]) {
        const value = rule.decls[property];
        if (!value || /\b(min|max|clamp)\(/.test(value)) continue;
        if (px(value).some((size) => size > 360))
          offenders.push(`${where(rule)} { ${property}: ${value} }`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("wraps every grid: auto-fit or auto-fill with a minmax floor that fits a phone, or a single track", () => {
    const offenders: string[] = [];
    for (const rule of rules) {
      const columns = rule.decls["grid-template-columns"];
      if (!columns) continue;
      const wraps = /repeat\(\s*auto-(fit|fill)\s*,/.test(columns);
      const floors = minmaxFloors(columns);
      const singleTrack = /^(1fr|minmax\(0,\s*1fr\)|auto|100%)$/.test(columns);
      // A 360 px phone with 20 px padding leaves 320 px: a floor above that
      // must clamp to the container with min(…, 100%).
      const fits =
        wraps &&
        floors.length > 0 &&
        floors.every(
          (floor) =>
            (/^min\(/.test(floor) && floor.includes("100%")) ||
            px(floor).every((size) => size <= 280),
        );
      // Fixed tracks belong inside a media query (a deliberate breakpoint).
      if (!(fits || singleTrack || inMedia(rule)))
        offenders.push(`${where(rule)} { grid-template-columns: ${columns} }`);
    }
    expect(offenders).toEqual([]);
  });

  it("never scrolls the page sideways", () => {
    const offenders: string[] = [];
    for (const rule of rules) {
      const x = rule.decls["overflow-x"] ?? "";
      const both = rule.decls["overflow"] ?? "";
      if (/scroll/.test(x) || /scroll/.test(both))
        offenders.push(`${where(rule)} forces scrollbars`);
      // Page containers hold their content to the screen; only a code or
      // table block inside may scroll on its own.
      if (/auto/.test(x) && !/code|pre|table|value|test/.test(rule.selector))
        offenders.push(`${where(rule)} scrolls sideways`);
    }
    expect(offenders).toEqual([]);
    const page = rules.find((rule) => rule.selector === ".live-page");
    expect(page?.decls["min-width"]).toBe("0");
  });

  it("gives every button a 40 px touch target, by height or by an enlarged hit area", () => {
    const buttons = buttonClassLists();
    expect(buttons.length).toBeGreaterThan(10); // the rest are shared <Button>s, below
    expect(buttons.filter((button) => button.classes.length === 0)).toEqual([]);
    const minHeight = (rule: Rule) =>
      Math.max(0, ...px(rule.decls["min-height"] ?? ""));
    const covered = (name: string): boolean => {
      const own = (rule: Rule) =>
        selectors(rule).some(
          (selector) =>
            selector === `.${name}` ||
            selector === `.live-page .${name}` ||
            selector === `.live-session-bar .${name}`,
        );
      const tall = rules.some((rule) => own(rule) && minHeight(rule) >= 40);
      const hit = rules.some(
        (rule) =>
          selectors(rule).includes(`.${name}::before`) &&
          rule.decls["position"] === "absolute" &&
          /^-\d+px/.test(rule.decls["inset"] ?? ""),
      );
      return tall || hit;
    };
    // A button is covered when any of its classes is (".studio-button" via the
    // shared rule in live.css; a shared <Button> is checked separately below).
    const uncovered = buttons.filter((button) => !button.classes.some(covered));
    expect(
      uncovered.map((button) => `${button.file}: ${button.classes.join(" ")}`),
    ).toEqual([]);
    // And nothing sets a smaller min-height or a max-height on a button class.
    // (".live-chip" is also a plain 22 px label; a chip button's target is its
    // hit area, checked above.)
    const buttonSelector = new Set(
      buttons
        .flatMap((button) => button.classes)
        .filter((name) => name !== "live-chip"),
    );
    const undercut = rules.filter(
      (rule) =>
        selectors(rule).some((selector) =>
          [...buttonSelector].some(
            (name) => selector === `.${name}` || selector.endsWith(` .${name}`),
          ),
        ) &&
        (px(rule.decls["max-height"] ?? "").some((size) => size < 40) ||
          (rule.decls["min-height"] !== undefined &&
            minHeight(rule) < 40 &&
            !/^0/.test(rule.decls["min-height"]))),
    );
    expect(undercut.map(where)).toEqual([]);
  });

  it("draws every shared <Button> in the live views at size lg, the 40 px target", () => {
    // The shared Button's lg size is the --ui-height-lg token (40 px); md and sm
    // are shorter, so a live view's Button must say "lg".
    const small: string[] = [];
    let seen = 0;
    for (const file of readdirSync(here).filter(
      (name) => name.endsWith(".tsx") && !name.includes(".test."),
    )) {
      const text = readFileSync(join(here, file), "utf8");
      for (const match of text.matchAll(/<Button\b/g)) {
        let depth = 0;
        let end = (match.index ?? 0) + 7;
        for (; end < text.length; end += 1) {
          const char = text[end];
          if (char === "{") depth += 1;
          else if (char === "}") depth -= 1;
          else if (char === ">" && depth === 0 && text[end - 1] !== "=") break;
        }
        const tag = text.slice(match.index, end);
        seen += 1;
        if (!/\bsize="lg"/.test(tag))
          small.push(`${file}: ${tag.slice(0, 60)}`);
      }
    }
    expect(seen).toBeGreaterThan(20);
    expect(small).toEqual([]);
  });

  it("honours reduced motion for every animation and transition", () => {
    const calm = new Set<string>();
    for (const rule of rules)
      if (
        rule.around.some((entry) =>
          /prefers-reduced-motion:\s*reduce/.test(entry),
        ) &&
        (/^none/.test(rule.decls["animation"] ?? "x") ||
          /^none/.test(rule.decls["transition"] ?? "x"))
      )
        for (const selector of selectors(rule))
          calm.add(`${rule.file}|${selector}`);
    const loud: string[] = [];
    for (const rule of rules) {
      const moving =
        (rule.decls["animation"] && !/^none/.test(rule.decls["animation"])) ||
        (rule.decls["transition"] &&
          !/^none|^0s/.test(rule.decls["transition"]));
      if (!moving) continue;
      // Only for people who have not asked for less motion: fine as is.
      if (
        rule.around.some((entry) =>
          /prefers-reduced-motion:\s*no-preference/.test(entry),
        )
      )
        continue;
      if (rule.around.some((entry) => /prefers-reduced-motion/.test(entry)))
        continue;
      if (
        !selectors(rule).every((selector) =>
          calm.has(`${rule.file}|${selector}`),
        )
      )
        loud.push(where(rule));
    }
    expect(loud).toEqual([]);
    // The pulse (and the fade-up, which only runs for no-preference) exist.
    const css = liveFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(css).toMatch(/@keyframes live-pulse/);
    expect(css).toMatch(/@keyframes live-fade-up/);
    expect(css).toMatch(/\.live-dot\.pulse \{\s*animation: none/);
  });

  it("uses theme tokens only: no hex, rgb or oklch literal outside tokens.css", () => {
    const offenders: string[] = [];
    for (const rule of rules)
      for (const [property, value] of Object.entries(rule.decls))
        if (
          /(^|[^\w-])#[0-9a-f]{3,8}\b/i.test(value) ||
          /\b(rgba?|hsla?|oklch|oklab|lab|lch)\(/i.test(value)
        )
          offenders.push(`${where(rule)} { ${property}: ${value} }`);
    expect(offenders).toEqual([]);
  });

  it("only reads tokens that both themes define", () => {
    const defined = (theme: "light" | "dark") => {
      const block = tokens.match(
        new RegExp(
          `:root\\[data-theme="${theme}"\\][^{]*\\{([\\s\\S]*?)\\n\\}`,
        ),
      );
      return new Set(
        [...(block?.[1] ?? "").matchAll(/(--[\w-]+)\s*:/g)].map(
          (match) => match[1],
        ),
      );
    };
    const light = defined("light");
    const dark = defined("dark");
    // The shell derives more variables for both themes further down.
    const derived = new Set(
      [...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]),
    );
    // Variables a stylesheet sets itself (component-local).
    const local = new Set<string>();
    for (const rule of rules)
      for (const property of Object.keys(rule.decls))
        if (property.startsWith("--")) local.add(property);
    const missing: string[] = [];
    for (const rule of rules)
      for (const value of Object.values(rule.decls))
        for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
          const name = match[1] as string;
          if (local.has(name) || derived.has(name)) continue;
          if (!(light.has(name) && dark.has(name)))
            missing.push(`${name} (${rule.selector})`);
        }
    expect([...new Set(missing)]).toEqual([]);
    // The tokens the design adds are in both themes.
    for (const name of [
      "--code-text",
      "--green",
      "--red",
      "--amber",
      "--accent",
    ]) {
      expect(light.has(name), `light ${name}`).toBe(true);
      expect(dark.has(name), `dark ${name}`).toBe(true);
    }
  });

  it("shows a focus ring on every interactive control", () => {
    const ringed = (selector: string) =>
      rules.some(
        (rule) =>
          /:focus-visible/.test(rule.selector) &&
          /outline:\s*(?!none|0)/.test(
            `outline: ${rule.decls["outline"] ?? "none"}`,
          ) &&
          (rule.selector.includes(selector) ||
            /\.live-page :is\(button/.test(rule.selector)),
      );
    // One shared ring covers buttons, inputs, summaries and links in the page
    // and the bar (so .studio-button and native inputs are covered).
    const shared = rules.find((rule) =>
      selectors(rule).some((selector) =>
        selector.startsWith(".live-page :is(button"),
      ),
    );
    expect(shared?.selector).toMatch(/input/);
    expect(shared?.selector).toMatch(/summary/);
    expect(shared?.decls["outline"]).toMatch(/var\(--accent\)/);
    expect(
      selectors(shared as Rule).some((selector) =>
        selector.startsWith(".live-session-bar :is(button"),
      ),
    ).toBe(true);
    for (const control of [
      ".live-chip-button",
      ".live-banner-action",
      ".live-tab",
      ".live-link",
      ".setup-switch",
      ".setup-segment",
    ])
      expect(ringed(control), control).toBe(true);
  });
});
