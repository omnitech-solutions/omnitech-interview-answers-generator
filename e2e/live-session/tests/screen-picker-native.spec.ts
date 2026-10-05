// The native screen picker (T19, T23, T24): the toolbar icon button and its
// menu, through the recording host shim. Proven by the bridge calls the shell
// would receive (listDisplays with or without thumbnails, setCaptureDisplay),
// by what the page draws only while the menu is open, by the display a staged
// and a stored screenshot carry (the server's screenshots route), and by the one
// toast when a pinned display goes away.
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/panel-test";
import { db } from "../src/helpers/sql";
import { settled, taskIdsOf, taskScreenshots } from "../src/helpers/tasks";

const BUILT_IN = "Built-in Retina Display";
const DELL = "DELL U2723QE";
const PIN_DROPPED =
  "The pinned display was disconnected. Following your browser again.";

const button = (page: Page) =>
  page.getByRole("button", { name: /^Screen to capture: / });
const menu = (page: Page) =>
  page.getByRole("menu", { name: "Screen to capture" });
const rows = (page: Page) => page.getByTestId("pn-display-row");

test("@native native screen picker menu: the thumbnails are asked for and drawn only while the menu is open", async ({
  openPanel,
}) => {
  const { page, host } = await openPanel({ auto: "off" });
  await expect(button(page)).toHaveAccessibleName(
    "Screen to capture: Following your browser",
  );

  // Closed: the shell was only asked for the saved pin (no thumbnails), and the
  // page draws no row and no image.
  await expect
    .poll(async () => (await host.calls("listDisplays")).length)
    .toBeGreaterThan(0);
  for (const call of await host.calls("listDisplays"))
    expect(call.params).toEqual({ thumbnails: false });
  await expect(menu(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);

  await button(page).click();

  // Open: "Follow my browser" first, then one row per display with its live
  // thumbnail, read from a call that asks for thumbnails.
  await expect(menu(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0)).toHaveAccessibleName(`${BUILT_IN}, 1 of 2`);
  await expect(rows(page).nth(1)).toHaveAccessibleName(`${DELL}, 2 of 2`);
  await expect(
    menu(page).getByRole("menuitemradio", { name: /^Follow my browser/ }),
  ).toHaveAttribute("aria-checked", "true");
  const picture = rows(page).nth(1).getByRole("img", { name: DELL });
  await expect(picture).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
  await expect
    .poll(() => picture.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
  const withThumbnails = async () =>
    (await host.calls("listDisplays")).filter(
      (call) => call.params["thumbnails"] !== false,
    ).length;
  await expect.poll(withThumbnails).toBeGreaterThan(0);
  // While open it keeps refreshing the previews.
  const whileOpen = await withThumbnails();
  await expect
    .poll(withThumbnails, { timeout: 15_000 })
    .toBeGreaterThan(whileOpen);

  // Closed again: the rows and images are gone, and the shell is no longer
  // asked for thumbnails (the refresh period is 2 s; wait two of them in the
  // page itself).
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);
  const closedCount = await withThumbnails();
  await page.evaluate(() => new Promise((done) => setTimeout(done, 4_500)));
  expect(await withThumbnails()).toBe(closedCount);
});

test("@native native screen picker pin: choosing a display pins capture to it (button, dot and tooltip follow), the capture carries that display, and Follow my browser unpins", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const { page, host, id, analyze } = await openPanel({ auto: "off" });
  await host.clear();

  await button(page).click();
  await menu(page)
    .getByRole("menuitemradio", { name: `${DELL}, 2 of 2` })
    .click();

  // The shell is told which display, the menu closes and the button, its
  // tooltip and the pin dot all say pinned.
  await expect
    .poll(async () => (await host.calls("setCaptureDisplay")).at(-1)?.params)
    .toEqual({ displayId: 2 });
  await expect(menu(page)).toHaveCount(0);
  await expect(button(page)).toHaveAccessibleName(
    "Screen to capture: Pinned: Display 2 of 2",
  );
  await expect(button(page)).toHaveAttribute(
    "title",
    "Screen to capture: Pinned: Display 2 of 2",
  );
  await expect(page.getByTestId("pn-pin-dot")).toBeVisible();
  expect((await host.state()).pinnedDisplay).toBe(2);
  await button(page).click();
  await expect(
    menu(page).getByRole("menuitemradio", { name: `${DELL}, 2 of 2` }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    menu(page).getByRole("menuitemradio", { name: /^Follow my browser/ }),
  ).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");

  // The next capture comes from the pinned display: the staged screenshot is
  // labelled with it, and so is the label beside the button.
  await analyze.click();
  await expect(page.getByTestId("staged-1")).toContainText("Display 2 of 2");
  expect((await host.captures()).at(-1)?.display).toBe(DELL);

  // Applied, the SERVER holds the display name with the screenshot (T24) and
  // the stored thumbnail says so.
  await page.getByTestId("apply-screenshots").click();
  const actions = await settled(id, 1);
  const taskId = taskIdsOf(actions)[0] as string;
  await expect
    .poll(async () => (await taskScreenshots(id, taskId))[0]?.display)
    .toEqual({ name: DELL, index: 2, count: 2 });
  await expect(
    page.getByRole("list", { name: "Screenshots of this task" }),
  ).toContainText("Display 2 of 2");

  // Follow my browser: unpinned, the dot goes and the tooltip says following.
  await button(page).click();
  await menu(page)
    .getByRole("menuitemradio", { name: /^Follow my browser/ })
    .click();
  await expect
    .poll(async () => (await host.calls("setCaptureDisplay")).at(-1)?.params)
    .toEqual({ displayId: null });
  await expect(button(page)).toHaveAccessibleName(
    "Screen to capture: Following your browser",
  );
  await expect(page.getByTestId("pn-pin-dot")).toHaveCount(0);
  expect((await host.state()).pinnedDisplay).toBeNull();
  expect((await db.observations(id)).length).toBeGreaterThan(0);
});

test("@native native screen picker pin dropped: when the pinned display goes away the page says so ONCE and follows the browser again", async ({
  openPanel,
}) => {
  const { page, host } = await openPanel({
    auto: "off",
    shim: { nativeToasts: false },
  });
  await button(page).click();
  await menu(page)
    .getByRole("menuitemradio", { name: `${DELL}, 2 of 2` })
    .click();
  await expect(page.getByTestId("pn-pin-dot")).toBeVisible();
  const toast = page.getByTestId("pn-toasts").getByText(PIN_DROPPED);
  await expect(toast).toHaveCount(0);

  // The monitor is unplugged: the shell reports the loss on its next answer.
  await host.setDisplays([{ id: 1, name: BUILT_IN, index: 1, count: 1 }]);
  await button(page).click();

  await expect(toast).toHaveCount(1);
  await expect(page.getByTestId("pn-pin-dot")).toHaveCount(0);
  await expect(button(page)).toHaveAccessibleName(
    "Screen to capture: Following your browser",
  );
  // It was said once: after it fades, listing the displays again (the menu
  // refreshes itself) does not bring it back.
  await expect(toast).toHaveCount(0, { timeout: 15_000 });
  const listed = (await host.calls("listDisplays")).length;
  await expect
    .poll(async () => (await host.calls("listDisplays")).length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(listed);
  await expect(toast).toHaveCount(0);
});

test("@native native capture target: the capture button's tooltip names the target and follows the pin, and right-click or ArrowDown on it opens the screen menu while a plain click only captures", async ({
  openPanel,
}) => {
  const { page, host, analyze } = await openPanel({ auto: "off" });
  const FOLLOWING =
    "Capture the screen and analyse it as a new problem: following your browser, ⌘⇧S";
  await expect(analyze).toHaveAttribute("title", FOLLOWING);
  // No separate monitor icon: the chevron is the only screen control.
  await expect(
    page.getByRole("button", { name: /^Screen to capture:/ }),
  ).toHaveCount(1);

  // Right-click and ArrowDown open the menu without capturing.
  const before = (await host.calls("captureScreen")).length;
  await analyze.click({ button: "right" });
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await analyze.focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu(page)).toBeVisible();
  expect((await host.calls("captureScreen")).length).toBe(before);

  // Pin the second display: the tooltip says so, on the capture button.
  await rows(page).nth(1).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(analyze).toHaveAttribute(
    "title",
    "Capture the screen and analyse it as a new problem: Display 2 of 2 (pinned), ⌘⇧S",
  );
  // A plain click captures (and opens no menu).
  await analyze.click();
  await expect
    .poll(async () => (await host.calls("captureScreen")).length)
    .toBeGreaterThan(before);
  await expect(menu(page)).toHaveCount(0);
});
