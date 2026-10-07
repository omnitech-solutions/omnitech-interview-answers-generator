// One session, several surfaces. The server is the authority for the session, so
// what one surface does to it (pause, resume, end, a new task) reaches the other
// by the other's own polling; what lives in a browser profile (the Auto choice,
// the glass look) reaches the OTHER DOCUMENTS of that profile through `storage`.
// The web page and the native panel are separate profiles here, as they are for
// the owner (the browser and the shell's web view), so each pair is tested where
// it is really shared:
//  - web page + native panel, same session: pause, resume, End, and the task each
//    one has on show (a pin on one surface never moves the other);
//  - two native documents of one profile: Auto or Manual is ONE state, and the
//    glass look is shared.
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/panel-test";
import { startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";

const POLL = { timeout: 45_000 };
const bar = (page: Page) => page.getByTestId("session-bar");
const modeMenu = (page: Page) =>
  page.getByRole("button", { name: /^Capture mode:/ });

async function chooseMode(page: Page, mode: "Auto" | "Manual") {
  await modeMenu(page).click();
  await page
    .getByRole("menuitemradio", { name: new RegExp(`^${mode} `) })
    .click();
  await expect(modeMenu(page)).toHaveText(mode);
}

test("web page and native panel on one session: Pause on the web page shows Paused in the panel, and Resume in the panel puts the web page back to running", async ({
  page,
  live,
  openPanel,
}) => {
  const started = await startSessionViaApi();
  await page.goto(`${live.livePath()}/${started.id}`);
  const panel = await openPanel({ sessionId: started.id, auto: "off" });

  await bar(page).getByRole("button", { name: "Pause", exact: true }).click();
  await expect
    .poll(async () => (await db.session(started.id))?.status)
    .toBe("paused");
  await expect(
    panel.page.getByRole("button", { name: "Resume session" }),
  ).toBeVisible(POLL);

  await panel.page.getByRole("button", { name: "Resume session" }).click();
  await expect
    .poll(async () => (await db.session(started.id))?.status)
    .toBe("active");
  await expect(
    bar(page).getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible(POLL);
  await expect(
    panel.page.getByRole("button", { name: "Pause session" }),
  ).toBeVisible();
});

test("web page and native panel on one session: Pause in the panel shows Paused on the web page", async ({
  page,
  live,
  openPanel,
}) => {
  const started = await startSessionViaApi();
  await page.goto(`${live.livePath()}/${started.id}`);
  const panel = await openPanel({ sessionId: started.id, auto: "off" });

  await panel.page.getByRole("button", { name: "Pause session" }).click();
  await expect
    .poll(async () => (await db.session(started.id))?.status)
    .toBe("paused");
  await expect(bar(page).getByRole("status").first()).toHaveText(
    "Paused",
    POLL,
  );
  await expect(
    bar(page).getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
});

test("web page and native panel on one session: End on the web page shows the ended card with Open summary in the panel", async ({
  page,
  live,
  openPanel,
}) => {
  const started = await startSessionViaApi();
  await page.goto(`${live.livePath()}/${started.id}`);
  const panel = await openPanel({ sessionId: started.id, auto: "off" });

  await live.end();
  await expect
    .poll(async () => (await db.session(started.id))?.status)
    .toBe("ended");

  await expect(
    panel.page.getByRole("button", { name: "Open summary" }),
  ).toBeVisible(POLL);
  await expect(
    panel.page.getByRole("button", { name: "Pause session" }),
  ).toHaveCount(0);
});

test("web page and native panel on one session: End in the panel shows the ended view on the web page", async ({
  page,
  live,
  openPanel,
}) => {
  const started = await startSessionViaApi();
  await page.goto(`${live.livePath()}/${started.id}`);
  const panel = await openPanel({ sessionId: started.id, auto: "off" });

  await panel.page.getByRole("button", { name: "End session" }).click();
  await panel.page.getByRole("button", { name: "End now" }).click();
  await expect
    .poll(async () => (await db.session(started.id))?.status)
    .toBe("ended");

  await expect(
    page.getByRole("button", { name: "Delete session data" }),
  ).toBeVisible(POLL);
  await expect(page.getByTestId("session-bar")).toHaveCount(0);
});

test("@native native two documents of one profile: Auto or Manual is one state, shared through storage in both directions", async ({
  openPanel,
  stack,
}) => {
  const first = await openPanel({ auto: "on" });
  const second = await first.context.newPage();
  await second.goto(first.page.url());
  await expect(
    second.getByRole("toolbar", { name: "Session controls" }),
  ).toBeVisible();
  await expect(modeMenu(first.page)).toHaveText("Auto");
  await expect(modeMenu(second)).toHaveText("Auto");

  await chooseMode(first.page, "Manual");
  await expect(modeMenu(second)).toHaveText("Manual");
  expect(
    await first.page.evaluate(
      (key) => localStorage.getItem(key),
      `interview-studio.live.auto.${stack.tenantSlug}`,
    ),
  ).toBe("off");

  await chooseMode(second, "Auto");
  await expect(modeMenu(first.page)).toHaveText("Auto");
});
