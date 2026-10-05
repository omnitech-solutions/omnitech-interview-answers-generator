// Transparent background, MEASURED. The real native panel (WebKit, the engine
// of the shell's WKWebView) is painted over a 20 px black/white checkerboard,
// the real "See-through" button is pressed, and the retained backdrop
// contrast |white square - black square| / 255 is sampled in the EMPTY area of
// every painted surface (never on text). The default look is pinned so the
// tinted design cannot drift; clear mode must keep the checkerboard visible on
// every pane, strip, toolbar, tray and drawer (>= 0.60). Menus are EXEMPT from the
// see-through floor on purpose (T33: the menu bed is dense, `--pn-menu-bed` .9,
// because menus were unreadable over busy page text): a menu must keep a dense
// bed (retained contrast <= 0.15) and 4.5:1 text;
// text sits on small reading islands whose body text keeps WCAG 4.5:1 over the
// worst-case white square. What WebKit here cannot prove (the real desktop and
// its compositing, the NSPanel shadow, the Settings window) is in the manual
// matrix (plan.md 7.11).
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/panel-test";
import { startSessionViaApi } from "../src/helpers/api";

const CHECKER =
  "conic-gradient(#000 25%, #fff 0 50%, #000 0 75%, #fff 0) 0 0 / 40px 40px";

// Surfaces whose empty area must keep the checkerboard in clear mode.
const SURFACES = [
  /^div\.pn-pill/,
  /^div\.pn-strip/,
  /^div\.pn-card\.pn-chat/,
  /^div\.pn-card\.pn-analysis-text/,
  /^section\.ss\[screenshots-area\]/,
  /^section\.pn-codecard/,
  /^aside\.pn-tests-drawer/,
  /^div\.pn-single-foot/,
];
// Text islands: small reading beds under text (the documented tint exception).
const ISLANDS =
  /^(div\.pn-row|div\.pn-task-chip|header\.pn-head|div\.pn-task-line|div\.pn-problem-head|div\.pn-answer|div\.pn-constraints|div\.pn-empty|ol\.pn-steps|ul\.pn-steps|p\.pn-muted|p\.pn-code-line|pre\.pn-codecard-pre|div\.pn-test-row|li\.pn-test-row|li\.pn-ended|div\.pn-tests-|p\.pn-tests-)/;

// The default look, as measured before this fix (pinned +-0.03).
const DEFAULT_PINNED: Array<[RegExp, number]> = [
  [/^div\.pn-pill/, 0.2],
  [/^div\.pn-strip/, 0.18],
  [/^div\.pn-card\.pn-chat/, 0.2],
  [/^div\.pn-card\.pn-analysis-text/, 0.19],
  [/^section\.ss\[screenshots-area\]/, 0.18],
  [/^section\.pn-codecard/, 0.14],
  [/^aside\.pn-tests-drawer/, 0.13],
];

type Surface = {
  name: string;
  contrast: number | null;
  whiteRgb: [number, number, number] | null;
  n: number;
};

// Pass 1 (panel page): for every painted element, the points where it is what
// you see (no child surface, control or its own text on top).
const collectPoints = () => {
  const root = document.querySelector(".pn-root") as HTMLElement;
  const label = (el: Element): string => {
    const id = el.getAttribute("data-testid");
    const cls = [...el.classList].slice(0, 2).join(".");
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${id ? `[${id}]` : ""}`;
  };
  const alphaOf = (cs: CSSStyleDeclaration) => {
    const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
    if (!m) return 0;
    const parts = (m[1] ?? "").split(/[ ,/]+/).filter(Boolean);
    return parts.length > 3 ? Number(parts[3]) : 1;
  };
  const isPainted = (el: Element) => {
    const cs = getComputedStyle(el);
    return (
      alphaOf(cs) > 0 ||
      cs.backgroundImage !== "none" ||
      !["none", ""].includes(cs.backdropFilter)
    );
  };
  const nearestPainted = (el: Element | null): Element | null => {
    for (let at = el; at; at = at.parentElement) if (isPainted(at)) return at;
    return null;
  };
  const surfaces: Array<{ key: string; name: string; pts: number[] }> = [];
  const flagged: string[] = [];
  const seen = new Map<string, number>();
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const alpha = alphaOf(cs);
    const blur = !["none", ""].includes(cs.backdropFilter);
    const base = label(el);
    if (alpha > 0.3 || blur)
      flagged.push(
        `${base} alpha=${alpha.toFixed(2)} backdrop=${cs.backdropFilter}`,
      );
    if (!isPainted(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 12) continue;
    const textRects: DOMRect[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      textRects.push(...range.getClientRects());
    }
    const pts: number[] = [];
    for (let y = Math.ceil(r.top) + 3; y < r.bottom - 3; y += 2)
      for (let x = Math.ceil(r.left) + 3; x < r.right - 3; x += 2) {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        if (nearestPainted(document.elementFromPoint(x, y)) !== el) continue;
        if (
          textRects.some(
            (t) =>
              x >= t.left - 2 &&
              x <= t.right + 2 &&
              y >= t.top - 2 &&
              y <= t.bottom + 2,
          )
        )
          continue;
        pts.push(x, y);
      }
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    surfaces.push({ key: `${base}#${count}`, name: `${base}#${count}`, pts });
  }
  return { surfaces, flagged };
};

// Pass 2 (a blank page): luma at each point of the screenshot, split by the
// checker square it lies over; also the mean colour over the white squares.
const sample = (
  scratch: Page,
  png: string,
  surfaces: Array<{ key: string; pts: number[] }>,
) =>
  scratch.evaluate(
    async ({ png, surfaces }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      const result: Record<
        string,
        {
          contrast: number | null;
          n: number;
          whiteRgb: [number, number, number] | null;
        }
      > = {};
      for (const s of surfaces) {
        let w = 0;
        let wn = 0;
        let b = 0;
        let bn = 0;
        const rgb: [number, number, number] = [0, 0, 0];
        for (let i = 0; i < s.pts.length; i += 2) {
          const x = s.pts[i] as number;
          const y = s.pts[i + 1] as number;
          // White where both coordinates are in the same half of the 40 px cell.
          const white = x % 40 < 20 === y % 40 < 20;
          // Skip the squares' edges (anti-aliasing, hairlines).
          if (x % 20 < 3 || x % 20 > 16 || y % 20 < 3 || y % 20 > 16) continue;
          const o = (y * img.width + x) * 4;
          const r = data[o] as number;
          const g = data[o + 1] as number;
          const bl = data[o + 2] as number;
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
          if (white) {
            w += luma;
            wn += 1;
            rgb[0] += r;
            rgb[1] += g;
            rgb[2] += bl;
          } else {
            b += luma;
            bn += 1;
          }
        }
        result[s.key] =
          wn >= 25 && bn >= 25
            ? {
                contrast: (w / wn - b / bn) / 255,
                n: wn + bn,
                whiteRgb: [rgb[0] / wn, rgb[1] / wn, rgb[2] / wn],
              }
            : { contrast: null, n: wn + bn, whiteRgb: null };
      }
      return result;
    },
    { png, surfaces },
  );

async function measure(
  page: Page,
  scratch: Page,
): Promise<{ list: Surface[]; flagged: string[] }> {
  await page.mouse.move(2, 2);
  const { surfaces, flagged } = await page.evaluate(collectPoints);
  const png = (
    await page.screenshot({ scale: "css", animations: "disabled" })
  ).toString("base64");
  const read = await sample(scratch, png, surfaces);
  return {
    flagged,
    list: surfaces.map((s) => ({
      name: s.name,
      contrast: read[s.key]?.contrast ?? null,
      whiteRgb: read[s.key]?.whiteRgb ?? null,
      n: read[s.key]?.n ?? 0,
    })),
  };
}

const find = (list: Surface[], pattern: RegExp) =>
  list.find((s) => pattern.test(s.name) && s.contrast !== null);

// WCAG contrast of the body text (the panel's --ov-text, white at .95) over a
// background colour. The text shadow is NOT counted.
function wcag(bg: [number, number, number]): number {
  const mix = bg.map((c) => 0.95 * 255 + 0.05 * c);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c: number[]) =>
    0.2126 * lin(c[0] as number) +
    0.7152 * lin(c[1] as number) +
    0.0722 * lin(c[2] as number);
  const a = lum(mix);
  const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const table = (label: string, list: Surface[]) =>
  console.log(
    `\n${label}\n${list
      .filter((s) => s.contrast !== null)
      .map((s) => `${s.name.padEnd(52)} ${(s.contrast as number).toFixed(2)}`)
      .join("\n")}`,
  );

test("@native See-through keeps the backdrop visible on every surface, and the default look is unchanged", async ({
  openPanel,
  control,
}) => {
  await control.scenario("coding-answer");
  const started = await startSessionViaApi();
  const { page, context, analyze } = await openPanel({
    auto: "off",
    sessionId: started.id,
  });
  const scratch = await context.newPage();
  await scratch.goto("about:blank");

  // One answered coding task, the tray with a staged screenshot, the tests drawer.
  await analyze.click();
  await page.getByTestId("apply-screenshots").click();
  await expect(page.locator(".pn-codecard").first()).toBeVisible({
    timeout: 60_000,
  });
  await analyze.click();
  await page.getByRole("button", { name: "Tests", exact: true }).click();
  await expect(page.locator(".pn-tests-drawer")).toBeVisible();
  // The desktop stand-in: a checkerboard painted behind the transparent page.
  await page.evaluate((checker) => {
    document.documentElement.style.background = checker;
  }, CHECKER);

  const glass = page.getByRole("button", { name: "See-through", exact: true });
  const root = page.locator(".pn-root");

  // --- default look: pinned ---
  await expect(root).not.toHaveAttribute("data-glass", /.*/);
  const before = await measure(page, scratch);
  table("DEFAULT", before.list);
  for (const [pattern, expected] of DEFAULT_PINNED) {
    const found = find(before.list, pattern);
    expect(found, String(pattern)).toBeDefined();
    expect(found?.contrast as number, found?.name).toBeGreaterThan(
      expected - 0.03,
    );
    expect(found?.contrast as number, found?.name).toBeLessThan(
      expected + 0.03,
    );
  }

  // --- clear: the checkerboard stays visible ---
  await glass.click();
  await expect(root).toHaveAttribute("data-glass", "clear");
  const clear = await measure(page, scratch);
  table("CLEAR", clear.list);
  for (const pattern of SURFACES) {
    const found = find(clear.list, pattern);
    if (!found && String(pattern).includes("single-foot")) continue; // no empty pixels to sample
    expect(found, String(pattern)).toBeDefined();
    expect(found?.contrast as number, found?.name).toBeGreaterThanOrEqual(0.6);
  }
  // No element blurs the backdrop in clear mode, and nothing dense paints
  // except small controls, text islands and the documented exceptions.
  expect(clear.flagged.filter((f) => !f.endsWith("backdrop=none"))).toEqual([]);
  const dense = clear.flagged.filter(
    (f) =>
      !f.startsWith("button") &&
      !f.startsWith("input") &&
      !ISLANDS.test(f) &&
      !/^(div\.pn-strip|div\.pn-menu|span|svg|a)/.test(f),
  );
  expect(dense, "dense surfaces in clear mode").toEqual([]);

  // Text islands: some backdrop through, and body text >= 4.5:1 on the WORST
  // case (the white squares), the text shadow not counted.
  const islands = clear.list.filter(
    (s) => ISLANDS.test(s.name) && s.whiteRgb !== null,
  );
  expect(islands.length).toBeGreaterThan(0);
  for (const island of islands) {
    expect(island.contrast as number, island.name).toBeGreaterThanOrEqual(0.25);
    expect(
      wcag(island.whiteRgb as [number, number, number]),
      `${island.name} text contrast`,
    ).toBeGreaterThanOrEqual(4.5);
  }

  // Menus and popovers (capture mode menu, screen picker): a DENSE bed by design (T33, --pn-menu-bed .9): little backdrop retained, text >= 4.5:1.
  for (const trigger of [/^Capture mode:/, /^Screen to capture/]) {
    const button = page.getByRole("button", { name: trigger });
    if ((await button.count()) === 0) continue;
    await button.first().click();
    const menu = page.locator(".pn-menu").first();
    await expect(menu).toBeVisible();
    const open = await measure(page, scratch);
    table(`CLEAR + ${trigger}`, open.list);
    const found = open.list.find(
      (s) => s.name.startsWith("div.pn-menu") && s.contrast !== null,
    );
    expect(found, `${trigger} menu`).toBeDefined();
    expect(found?.contrast as number, found?.name).toBeLessThanOrEqual(0.15);
    expect(found?.whiteRgb, `${trigger} menu bed`).not.toBeNull();
    expect(
      wcag(found?.whiteRgb as [number, number, number]),
      `${trigger} menu text contrast`,
    ).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  }

  // --- toggled back: exactly the default again ---
  await glass.click();
  await expect(root).not.toHaveAttribute("data-glass", /.*/);
  const after = await measure(page, scratch);
  table("DEFAULT AFTER TOGGLING TWICE", after.list);
  let compared = 0;
  for (const [pattern] of DEFAULT_PINNED) {
    const was = find(before.list, pattern);
    const now = find(after.list, pattern);
    if (!now) continue; // a surface the second pass did not sample (menu focus state)
    compared += 1;
    expect(now.contrast as number, String(pattern)).toBeCloseTo(
      was?.contrast as number,
      // +-0.05: the sampled empty points move a little with hover and focus
      // (the pane measured .189 then .198); a real regression is ~.6 away.
      1,
    );
  }
  expect(compared).toBeGreaterThanOrEqual(5);
  // The default blur is back exactly (state-dependent entries such as a hovered
  // control or the strip's presence are not compared).
  const stable = (list: string[]) =>
    list.filter((f) => /^div\.pn-(pill|card)/.test(f));
  expect(stable(after.flagged)).toEqual(stable(before.flagged));
  expect(stable(after.flagged).length).toBeGreaterThanOrEqual(3);
});
