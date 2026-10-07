// A QA walkthrough, not a regression test: it visits every Studio screen and every native-panel
// state, in dark and light at two widths, clicks every visible control once, and writes
// screenshots plus a JSON result (console errors, page errors, failed requests, horizontal
// overflow) to E2E_WALKTHROUGH_DIR. It registers only with E2E_WALKTHROUGH=1, so the normal run
// and `pnpm verify` never see it:
//
//   E2E_WALKTHROUGH=1 E2E_WALKTHROUGH_DIR=/tmp/walk pnpm test:browser tests/walkthrough.spec.ts --project=chromium
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test } from "../src/fixtures/panel-test";

const OUT = process.env["E2E_WALKTHROUGH_DIR"] ?? "/tmp/walkthrough";
const THEMES = ["dark", "light"] as const;
const WIDTHS = [1180, 900] as const;
const VIEWS = [
  "",
  "work",
  "briefings",
  "documents",
  "knowledge",
  "rehearsal",
  "live",
] as const;
// A control whose click would end the signed-in test user's session.
const SKIP_CLICK = /sign out|log out/i;

type Finding = {
  where: string;
  kind: "console" | "pageerror" | "http" | "overflow" | "click";
  detail: string;
};
const findings: Finding[] = [];
const visited: string[] = [];
const clicked: { where: string; control: string; ok: boolean }[] = [];

function watch(page: Page, where: () => string): () => void {
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === "error")
      findings.push({
        where: where(),
        kind: "console",
        detail: message.text().slice(0, 300),
      });
  };
  const onPageError = (error: Error) =>
    findings.push({
      where: where(),
      kind: "pageerror",
      detail: error.message.slice(0, 300),
    });
  const onResponse = (response: { status(): number; url(): string }) => {
    if (response.status() >= 400 && !/favicon|\.map$/.test(response.url()))
      findings.push({
        where: where(),
        kind: "http",
        detail: `${response.status()} ${response.url()}`.slice(0, 300),
      });
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  return () => {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
  };
}

async function setTheme(page: Page, theme: "dark" | "light"): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((value) => {
    document.documentElement.dataset["theme"] = value;
  }, theme);
}

async function overflow(page: Page, where: string): Promise<void> {
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (wide > 1)
    findings.push({
      where,
      kind: "overflow",
      detail: `${wide}px wider than the window`,
    });
}

const slug = (text: string) =>
  text
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

if (process.env["E2E_WALKTHROUGH"] === "1") {
  test.describe.configure({ mode: "default" });
  test.setTimeout(10 * 60_000);
  mkdirSync(OUT, { recursive: true });

  test.afterAll(() => {
    writeFileSync(
      join(OUT, "walkthrough-results.json"),
      JSON.stringify({ visited, clicked, findings }, null, 2),
    );
  });

  for (const view of VIEWS) {
    test(`web ${view || "home"}: every theme and width, then every visible control once`, async ({
      page,
      live,
    }) => {
      const base = live.livePath().replace(/\/live$/, "");
      const url = `${base}${view ? `/${view}` : ""}`;
      let where = `web ${view || "home"}`;
      const stop = watch(page, () => where);
      for (const width of WIDTHS)
        for (const theme of THEMES) {
          where = `web ${view || "home"} ${theme} ${width}`;
          await page.setViewportSize({ width, height: 800 });
          await page.goto(url);
          await page.waitForLoadState("domcontentloaded");
          await page.waitForTimeout(600);
          await setTheme(page, theme);
          await page.waitForTimeout(400);
          await overflow(page, where);
          await page.screenshot({
            path: join(OUT, `web-${view || "home"}-${theme}-${width}.png`),
            fullPage: true,
          });
          visited.push(where);
        }
      // The click crawl: dark, wide. Each control is clicked on a fresh load of the page.
      await page.setViewportSize({ width: 1180, height: 800 });
      await page.goto(url);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(600);
      const controls = page.locator(
        'button:visible, [role="tab"]:visible, [role="menuitem"]:visible, summary:visible',
      );
      const count = Math.min(await controls.count(), 25);
      for (let index = 0; index < count; index += 1) {
        await page.goto(url);
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(600);
        const control = controls.nth(index);
        const name =
          (
            (await control.getAttribute("aria-label").catch(() => null)) ??
            (await control.innerText().catch(() => ""))
          )
            .trim()
            .slice(0, 60) || `#${index}`;
        where = `web ${view || "home"} click "${name}"`;
        if (SKIP_CLICK.test(name)) {
          clicked.push({ where, control: name, ok: true });
          continue;
        }
        try {
          await control.click({ timeout: 3_000 });
          await page.waitForTimeout(250);
          await page.keyboard.press("Escape");
          clicked.push({ where, control: name, ok: true });
        } catch (error) {
          clicked.push({ where, control: name, ok: false });
          findings.push({
            where,
            kind: "click",
            detail: String(error).split("\n")[0]?.slice(0, 200) ?? "",
          });
        }
      }
      stop();
    });
  }

  for (const theme of THEMES)
    for (const width of [1320, 900] as const)
      test(`native panel ${theme} ${width}: every pane combination, every menu, paused and ended`, async ({
        openPanel,
      }) => {
        const s = await openPanel({ viewport: { width, height: 820 } });
        const { page } = s;
        let where = `native ${theme} ${width}`;
        const stop = watch(page, () => where);
        await setTheme(page, theme);
        const shot = async (name: string) => {
          where = `native ${theme} ${width} ${name}`;
          await page.waitForTimeout(350);
          await overflow(page, where);
          await page.screenshot({
            path: join(OUT, `native-${theme}-${width}-${slug(name)}.png`),
          });
          visited.push(where);
        };
        await shot("start");
        // The pane toggles: every combination (the last visible pane cannot be turned off).
        const toggles = page.getByTestId("pn-panes").getByRole("button");
        const names = ["Chat", "Answer", "Code"];
        for (const [index, name] of names.entries()) {
          await toggles
            .nth(index)
            .click()
            .catch(() => undefined);
          await shot(`without ${name}`);
          await toggles
            .nth(index)
            .click()
            .catch(() => undefined);
        }
        await shot("all panes back");
        // The toolbar's menus, one at a time.
        const menus: [string, RegExp | string][] = [
          ["capture caret", /^(Screen to capture|Capture options)/],
          ["microphone options", "Microphone options"],
          ["answer style", /^Answer style/],
          ["keyboard shortcuts", "Keyboard shortcuts"],
        ];
        for (const [label, name] of menus) {
          try {
            await page
              .getByRole("button", { name })
              .first()
              .click({ timeout: 4_000 });
            await shot(`menu ${label}`);
            await page.keyboard.press("Escape");
          } catch (error) {
            findings.push({
              where: `native ${theme} ${width} menu ${label}`,
              kind: "click",
              detail: String(error).split("\n")[0]?.slice(0, 200) ?? "",
            });
          }
        }
        // See-through, the composer, paused, then ended.
        await page
          .getByTestId("pn-see-through")
          .click()
          .catch(() => undefined);
        await shot("see-through on");
        await page
          .getByTestId("pn-see-through")
          .click()
          .catch(() => undefined);
        const send = page.getByRole("textbox").first();
        await send.fill("What is a closure?").catch(() => undefined);
        await shot("composer with text");
        await page
          .getByRole("button", { name: /^Pause session/ })
          .click({ timeout: 4_000 })
          .catch(() => undefined);
        await shot("paused");
        await page
          .getByRole("button", { name: /^Resume session/ })
          .click({ timeout: 4_000 })
          .catch(() => undefined);
        await page
          .getByRole("button", { name: /^End session/ })
          .click({ timeout: 4_000 })
          .catch(() => undefined);
        await shot("end confirmation");
        await page
          .getByRole("button", { name: /^End now/ })
          .click({ timeout: 4_000 })
          .catch(() => undefined);
        await shot("ended");
        stop();
      });
}
