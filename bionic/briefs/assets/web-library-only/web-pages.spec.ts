// Screenshots of every web page, dark and light, at a desktop and a narrow width, for
// BRIEF-web-app-on-the-ui-library-only. Not a regression test: it asserts nothing about the pages
// and never fails on a page it cannot reach; it records that in shots.json instead.
// How to run it: see playwright.config.ts beside this file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test } from "../../../../e2e/live-session/src/fixtures/panel-test";
import { controlSession, startSessionViaApi } from "../../../../e2e/live-session/src/helpers/api";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "shots");
const THEMES = ["dark", "light"] as const;
const WIDTHS = [
  ["desktop", 1280],
  ["narrow", 480],
] as const;
type Theme = (typeof THEMES)[number];
type Shot = { page: string; url: string; file?: string; note?: string; overflowPx?: number };
const shots: Shot[] = [];

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page
    .evaluate((value) => {
      document.documentElement.dataset["theme"] = value;
    }, theme)
    .catch(() => undefined);
}

// One page in the four combinations. `prepare` runs after each load (open a dialog, click a tab).
async function capture(
  page: Page,
  name: string,
  url: string,
  prepare?: (page: Page) => Promise<void>,
): Promise<void> {
  for (const [widthName, width] of WIDTHS)
    for (const theme of THEMES) {
      const file = `${name}-${widthName}-${theme}.jpg`;
      try {
        await page.setViewportSize({ width, height: 800 });
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(900);
        await setTheme(page, theme);
        if (prepare) await prepare(page);
        await page.waitForTimeout(500);
        const overflowPx = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        await page.screenshot({
          path: join(OUT, file),
          type: "jpeg",
          quality: 55,
          scale: "css",
          fullPage: false,
        });
        shots.push({ page: name, url: new URL(page.url()).pathname, file, overflowPx });
      } catch (error) {
        shots.push({ page: name, url, note: String(error).split("\n")[0]?.slice(0, 200) ?? "failed" });
      }
    }
}

const click = (name: RegExp) => async (page: Page) => {
  await page.getByRole("button", { name }).first().click({ timeout: 4_000 });
};

test.describe.configure({ mode: "default" });
mkdirSync(OUT, { recursive: true });
// A partial run (-g) keeps the earlier entries of the pages it did not visit.
test.afterAll(() => {
  const path = join(OUT, "shots.json");
  const before: Shot[] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  const visited = new Set(shots.map((shot) => shot.page));
  const all = [...before.filter((shot) => !visited.has(shot.page)), ...shots];
  all.sort((a, b) => Number.parseInt(a.page, 10) - Number.parseInt(b.page, 10));
  writeFileSync(path, JSON.stringify(all, null, 2));
});

test("public pages, signed out", async ({ browser, stack }) => {
  const context = await browser.newContext({ baseURL: stack.webUrl, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await capture(page, "01-sign-in", "/sign-in");
  await capture(page, "02-sign-in-expired", "/sign-in?reason=expired&next=%2Ft%2Flocal%2Fp%2Finterview%2Flive");
  await capture(page, "03-signed-out", "/signed-out");
  await capture(page, "04-native-sign-in", "/native/sign-in");
  await capture(page, "05-share-presentation-unknown-token", "/share/presentation/not-a-real-token");
  await capture(page, "06-not-found", "/no-such-page");
  await context.close();
});

test("tenant pages and the Interview Studio views", async ({ page, stack }) => {
  const tenant = `/t/${stack.tenantSlug}`;
  const studio = `${tenant}/p/interview`;
  await capture(page, "10-settings-integrations", `${tenant}/settings/integrations`);
  await capture(page, "11-unknown-product", `${tenant}/p/nothing-here`);
  await capture(page, "20-home", studio);
  await capture(page, "21-home-command-palette", studio, async (p) => {
    await p.keyboard.press("ControlOrMeta+k");
  });
  await capture(page, "22-home-account-menu", studio, click(/account|local user|signed in/i));
  await capture(page, "23-home-assistant", studio, click(/assistant/i));
  await capture(page, "30-workspace", `${studio}/work`);
  // /work with no question open IS the new-question form (30). 31 opens a built-in example.
  await capture(page, "31-workspace-example-open", `${studio}/work`, click(/Maximum Events in a Time Window/i));
  await capture(page, "40-briefings", `${studio}/briefings`);
  await capture(page, "41-briefings-explanations", `${studio}/briefings/explanations`);
  await capture(page, "42-briefings-new", `${studio}/briefings`, click(/new (brief|pack|briefing)/i));
  await capture(page, "50-documents", `${studio}/documents`);
  await capture(page, "51-documents-templates", `${studio}/documents/templates`);
  await capture(page, "52-documents-new-dialog", `${studio}/documents`, click(/new document|create document|^new$/i));
  await capture(page, "60-knowledge", `${studio}/knowledge`);
  await capture(page, "61-knowledge-article", `${studio}/knowledge`, async (p) => {
    await p.locator("main a[href*='/knowledge/'], main button").first().click({ timeout: 4_000 });
  });
  await capture(page, "70-rehearsal", `${studio}/rehearsal`);
  await capture(page, "80-live-setup", `${studio}/live`);
});

test("live session: running, then ended", async ({ page, stack }) => {
  const studio = `/t/${stack.tenantSlug}/p/interview`;
  const { id } = await startSessionViaApi();
  await capture(page, "81-live-session-running", `${studio}/live`);
  await capture(page, "82-workspace-session-draft", `${studio}/work?workspace=active-session:${id}`);
  await controlSession(id, "end");
  await capture(page, "83-live-session-ended", `${studio}/live/${id}`);
});

test("native panel page (/live/overlay) with the recording host", async ({ openPanel }) => {
  for (const theme of THEMES)
    for (const [widthName, width] of [["desktop", 1320], ["narrow", 760]] as const) {
      const { page, id } = await openPanel({ viewport: { width, height: 820 } });
      await setTheme(page, theme);
      await page.waitForTimeout(600);
      const file = `90-native-overlay-${widthName}-${theme}.jpg`;
      await page.screenshot({ path: join(OUT, file), type: "jpeg", quality: 55, scale: "css" });
      shots.push({ page: "90-native-overlay", url: new URL(page.url()).pathname, file });
      await controlSession(id, "end");
    }
});

test("Presentation product routes", async ({ page, stack }) => {
  const product = `/t/${stack.tenantSlug}/p/presentation`;
  for (const [name, path] of [
    ["100-presentation-library", "/library"],
    ["101-presentation-create", "/create"],
    ["102-presentation-editor", "/editor"],
    ["103-presentation-themes", "/themes"],
    ["104-presentation-images", "/images"],
    ["105-presentation-present", "/present"],
    ["106-presentation-shared", "/shared"],
  ] as const)
    await capture(page, name, `${product}${path}`);
});

test("extra states: rehearsal running, behavioural briefing, session draft", async ({ page, stack }) => {
  const studio = `/t/${stack.tenantSlug}/p/interview`;
  await capture(page, "31-workspace-example-open", `${studio}/work`, click(/Maximum Events in a Time Window/i));
  await capture(page, "43-briefings-behavioural", `${studio}/briefings`, async (p) => {
    await p.getByText(/^Behavioural$/).first().click({ timeout: 4_000 });
  });
  await capture(page, "44-briefings-system-design", `${studio}/briefings`, async (p) => {
    await p.getByText(/^System design$/).first().click({ timeout: 4_000 });
  });
  await capture(page, "71-rehearsal-running", `${studio}/rehearsal`, click(/^Start /i));
});
