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
import { say, settled, taskIdsOf } from "../src/helpers/tasks";

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
  await live.useManual();
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
  await live.useManual();
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
  await live.useManual();
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
  await live.useManual();
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

test("web page and native panel on one session: a pin on one surface never moves the other, and each surface's follow-up goes to the task ITS pin or newest names", async ({
  page,
  live,
  control,
  openPanel,
}) => {
  await control.scenario("plain-answer");
  const started = await startSessionViaApi();
  await page.goto(`${live.livePath()}/${started.id}`);
  await live.useManual();
  const panel = await openPanel({ sessionId: started.id, auto: "off" });
  const credential = started.response.credential.value;
  await say(credential, "What is a closure in JavaScript?");
  await expect(live.task(1)).toBeVisible();
  await settled(started.id, 1);
  await say(credential, "What is the event loop?");
  await expect(live.task(2)).toBeVisible();
  await settled(started.id, 2);

  // Pin T1 on the web page, then a third task arrives.
  await live.chip(1).click();
  await expect(live.chip(1)).toHaveAttribute("aria-pressed", "true");
  await say(credential, "What is a promise?");
  const all = await settled(started.id, 3);
  const [first, , second] = taskIdsOf(all) as [string, string, string];

  // The web page stays on its pinned T1; the panel, with no pin, shows the newest.
  await expect(live.task(1)).toBeVisible();
  await expect(page.getByText("Viewing an earlier task.")).toBeVisible();
  await expect(panel.page.getByTestId("pn-task-line")).toContainText(
    "T3",
    POLL,
  );
  await expect(panel.page.getByTestId("pn-earlier")).toHaveCount(0);

  // Follow-ups go where each surface points.
  await live.followUp().fill("Add an example to this one.");
  await live.sendFollowUp().click();
  await expect
    .poll(async () =>
      (await db.actions(started.id)).some(
        (a) => a.task_id === first && a.task_revision === 2,
      ),
    )
    .toBe(true);
  await settled(started.id, 3);
  const message = panel.page.getByRole("textbox", { name: "Message" });
  await message.fill("Add a caveat to the newest.");
  await panel.page.getByRole("button", { name: "Send message" }).click();
  await expect
    .poll(async () =>
      (await db.actions(started.id)).some(
        (a) => a.task_id === second && a.task_revision === 2,
      ),
    )
    .toBe(true);
  expect(taskIdsOf(await db.actions(started.id))).toEqual(
    expect.arrayContaining([first, second]),
  );

  // One pin rule: the web page's Back returns it to the newest task.
  await page.getByRole("button", { name: "Back to T3" }).click();
  await expect(live.task(3)).toBeVisible();
  await expect(page.getByText("Viewing an earlier task.")).toHaveCount(0);
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

test("@native native two documents of one profile: the See-through look is shared, and a reload keeps it", async ({
  openPanel,
}) => {
  const first = await openPanel({ auto: "off" });
  const second = await first.context.newPage();
  await second.goto(first.page.url());
  await expect(
    second.getByRole("toolbar", { name: "Session controls" }),
  ).toBeVisible();
  const root = (page: Page) => page.locator(".pn-root");
  await expect(root(first.page)).not.toHaveAttribute("data-glass", /.*/);
  await expect(root(second)).not.toHaveAttribute("data-glass", /.*/);

  await first.page.getByRole("button", { name: "See-through" }).click();
  await expect(root(first.page)).toHaveAttribute("data-glass", "clear");
  await expect(root(second)).toHaveAttribute("data-glass", "clear");

  await second.reload();
  await expect(root(second)).toHaveAttribute("data-glass", "clear");
  await second.getByRole("button", { name: "See-through" }).click();
  await expect(root(first.page)).not.toHaveAttribute("data-glass", /.*/);
});

// F-OWNER. In the shell the Studio main window and the panel are documents of one
// web view profile, so they share the Web Lock: the panel (native, steals the
// lock) owns hands-free and the Live page in the main window shows the mirror.
// The mirror wording names the native app as the owner, and Capture & analyze
// is disabled with that reason (F-OWNER, plan.md 7.16).
test("@native native owner and the web Live page in the same web view: the page says the Interview Studio app owns capture and its Capture & analyze is disabled with that reason", async ({
  openPanel,
  stack,
}) => {
  const panel = await openPanel({ auto: "on" });
  await expect
    .poll(async () => (await panel.host.calls("engine.start")).length)
    .toBe(1);
  const web = await panel.context.newPage();
  await web.goto(
    `${stack.webUrl}/t/${stack.tenantSlug}/p/interview/live/${panel.id}`,
  );
  const band = web.getByTestId("hands-free-band");
  await expect(band).toBeVisible();
  // The page is the mirror, not the owner.
  await expect(band).toHaveAttribute("data-owner", "other-window");
  await expect(web.getByTestId("auto-mirror")).toContainText(
    "Auto · running in the Interview Studio app",
  );
  await expect(web.getByTestId("share-mirror")).toContainText(
    "The Interview Studio app owns capture",
  );
  // Still readable, not hidden: disabled, with the reason as its title.
  const capture = band.getByRole("button", { name: /Capture & analyze/ });
  await expect(capture).toBeVisible();
  await expect(capture).toBeDisabled();
  await expect(capture).toHaveAttribute(
    "title",
    /Interview Studio app owns capture/,
  );
  expect(await web.getByTestId("share-mirror").innerText()).not.toContain(
    "No source shared",
  );
});
