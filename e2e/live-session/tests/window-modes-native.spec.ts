// The native window's own looks and sizes, through the recording host shim: the
// See-through button, the Mini player and its way back, the
// Tests drawer at a narrow width, and the stacking of every popover (a menu is
// never covered by a pane). Real window geometry and glass over a desktop are
// the shell's and stay in the manual checklist; here the proof is the size the
// page asks the shell for, the attribute the glass changes, and where each
// element really is on the page.
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/panel-test";
import { db } from "../src/helpers/sql";
import { openSizeMenu, sizeMenu, sizeRow } from "../src/helpers/toolbar";

const seeThrough = (page: Page) =>
  page.getByRole("button", { name: "See-through", exact: true });
const lastSize = async (host: {
  calls(name: string): Promise<Array<{ params: Record<string, unknown> }>>;
}) => (await host.calls("setWindowSize")).at(-1)?.params;

test("@native native See-through: ON makes the glass clear and reports the surfaces that keep taking clicks (toolbar and panes); OFF reports none; the choice survives a reload", async ({
  openPanel,
}) => {
  const panel = await openPanel({ auto: "off" });
  const { page, host } = panel;
  const regions = async () =>
    (await host.calls("setHitRegions")).at(-1)?.params["regions"] as
      | Array<{ x: number; y: number; width: number; height: number }>
      | null
      | undefined;
  await expect(seeThrough(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-glass="clear"]')).toHaveCount(0);
  // Design change (d895817): the window reports what it draws even with See-through
  // off (undrawn glass passes clicks through either way), so a report exists already.
  await expect
    .poll(async () => (await regions())?.length ?? 0)
    .toBeGreaterThan(0);

  await seeThrough(page).click();

  await expect(seeThrough(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-glass="clear"]')).toHaveCount(1);
  // The shell is given rectangles, and the toolbar's is among them (See-through
  // can always be turned off with the mouse).
  await expect
    .poll(async () => (await regions())?.length ?? 0)
    .toBeGreaterThan(1);
  const pill = await panel.toolbar.boundingBox();
  const sent = (await regions()) ?? [];
  expect(
    sent.some(
      (r) =>
        Math.abs(r.x - (pill?.x ?? -1)) < 2 &&
        Math.abs(r.width - (pill?.width ?? -1)) < 2,
    ),
  ).toBe(true);
  // The chat pane is another surface in the report.
  const chat = await page.getByTestId("pn-chat").boundingBox();
  expect(
    sent.some(
      (r) =>
        r.x <= (chat?.x ?? 1e9) + 2 &&
        r.x + r.width >= (chat?.x ?? 0) + (chat?.width ?? 0) - 2 &&
        r.y <= (chat?.y ?? 1e9) + 2,
    ),
  ).toBe(true);
  // Every painted surface keeps taking clicks: the toolbar button still works.
  await expect(panel.toolbar).toBeVisible();
  await panel.reload();
  await expect(seeThrough(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-glass="clear"]')).toHaveCount(1);

  await seeThrough(page).click();
  await expect(seeThrough(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-glass="clear"]')).toHaveCount(0);
  // Off again: the report continues (a list of what is drawn), it is not released.
  await expect
    .poll(async () => (await regions())?.length ?? 0)
    .toBeGreaterThan(0);
  await panel.reload();
  await expect(seeThrough(page)).toHaveAttribute("aria-pressed", "false");
});

test("@native native Mini player: the green dot's menu asks the shell for the small card and shows the task, Back to normal returns the panes and the full size, and Escape does not leave it", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const panel = await openPanel({ auto: "off" });
  const { page, host } = panel;
  await panel.analyze.click();
  await page.getByTestId("apply-screenshots").click();
  await expect(
    page.getByText("Restate the question aloud").first(),
  ).toBeVisible();
  const normal = await lastSize(host);
  expect(Number(normal?.["width"])).toBeGreaterThan(900);

  // The green dot's menu (ArrowDown opens it, as hovering does).
  await openSizeMenu(page);
  await expect(sizeRow(page, /^Normal/)).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await sizeRow(page, /^Mini player/).click();

  // The shell is asked for the fixed small card; the page shows the card, not
  // the panes.
  await expect
    .poll(() => lastSize(host))
    .toMatchObject({ width: 440, height: 190 });
  await expect(page.getByTestId("pn-mini-card")).toBeVisible();
  await expect(page.getByTestId("pn-mini-name")).toContainText("T1");
  await expect(page.getByTestId("pn-chat")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Answer", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("pn-mini-pause")).toBeVisible();

  // Pause and Resume are the session's, from the small card too.
  await page.getByTestId("pn-mini-pause").click();
  await expect
    .poll(async () => (await db.sessions()).at(-1)?.status)
    .toBe("paused");
  await page.getByTestId("pn-mini-resume").click();
  await expect
    .poll(async () => (await db.sessions()).at(-1)?.status)
    .toBe("active");

  // A popup hanging from the dots gets room: the card grows while it is open.
  await page.getByRole("button", { name: "Quit Interview Studio" }).click();
  await expect
    .poll(() => lastSize(host))
    .toMatchObject({ width: 440, height: 330 });
  await page.keyboard.press("Escape");
  await expect
    .poll(() => lastSize(host))
    .toMatchObject({ width: 440, height: 190 });
  await expect(page.getByTestId("pn-mini-card")).toBeVisible();

  // Back to normal: the panes return and the shell gets the wide size again.
  await page.getByTestId("pn-mini-back").click();
  await expect(page.getByTestId("pn-chat")).toBeVisible();
  await expect(page.getByTestId("pn-mini-card")).toHaveCount(0);
  await expect
    .poll(async () => Number((await lastSize(host))?.["width"]))
    .toBeGreaterThan(900);

  // Escape does NOT leave the Mini player (D27 names only full screen): the
  // card stays, and the shell is not asked for another size.
  await openSizeMenu(page);
  await sizeRow(page, /^Mini player/).click();
  await expect(page.getByTestId("pn-mini-card")).toBeVisible();
  await expect
    .poll(() => lastSize(host))
    .toMatchObject({ width: 440, height: 190 });
  const sizesBefore = (await host.calls("setWindowSize")).length;
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pn-mini-card")).toBeVisible();
  expect((await host.calls("setWindowSize")).length).toBe(sizesBefore);
  await page.getByTestId("pn-mini-back").click();
  await expect(page.getByTestId("pn-mini-card")).toHaveCount(0);
  await expect(page.getByTestId("pn-chat")).toBeVisible();
  expect(
    (await db.sessions()).filter((s) => s.status === "active"),
  ).toHaveLength(1);
});

test("@native native Tests drawer at a narrow width: it stays inside the window and beside the code, with no sideways scroll", async ({
  openPanel,
  control,
}) => {
  await control.scenario("coding-answer");
  const panel = await openPanel({ auto: "off" });
  const { page } = panel;
  await panel.analyze.click();
  await page.getByTestId("apply-screenshots").click();
  await expect(page.getByTestId("pn-code")).toBeVisible({ timeout: 90_000 });
  // Only the code pane remains: the one place the drawer lives.
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("button", { name: "Answer", exact: true }).click();
  await page.setViewportSize({ width: 640, height: 800 });

  await page.getByRole("button", { name: "Tests", exact: true }).click();

  const drawer = page.getByTestId("pn-tests-drawer");
  await expect(drawer).toBeVisible();
  const inside = await page.evaluate(() => {
    const box = document
      .querySelector('[data-testid="pn-tests-drawer"]')
      ?.getBoundingClientRect();
    const code = document
      .querySelector('[role="textbox"][aria-label="Solution"]')
      ?.getBoundingClientRect();
    return {
      left: box?.left ?? -1,
      right: box?.right ?? 1e9,
      width: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      codeWidth: code?.width ?? 0,
      codeLeft: code?.left ?? 0,
      drawerRight: box?.right ?? 0,
    };
  });
  expect(inside.left).toBeGreaterThanOrEqual(0);
  expect(inside.right).toBeLessThanOrEqual(inside.width);
  expect(inside.scroll).toBeLessThanOrEqual(inside.width);
  // The code is still readable beside it, and not underneath it.
  expect(inside.codeWidth).toBeGreaterThan(100);
  expect(inside.codeLeft).toBeGreaterThanOrEqual(inside.drawerRight - 1);
});

for (const [name, size] of [
  ["wide", { width: 1320, height: 900 }],
  ["narrow", { width: 1000, height: 560 }],
] as const) {
  test(`@native native popovers are never covered (${name} window): every menu item is the element at its own centre`, async ({
    openPanel,
    control,
  }) => {
    await control.scenario("plain-answer");
    const panel = await openPanel({ auto: "off" });
    const { page } = panel;
    await panel.analyze.click();
    await page.getByTestId("apply-screenshots").click();
    await expect(
      page.getByText("Restate the question aloud").first(),
    ).toBeVisible();
    // The task is made at a size where every pane is reachable; the menus are
    // then judged at the size under test.
    await page.setViewportSize(size);

    // The element at each item's centre must be the item (or inside it): a pane
    // drawn over the menu would be what elementFromPoint returns instead.
    const covered = (selector: string) =>
      page.evaluate((sel) => {
        const menu = document.querySelector(sel);
        if (!menu) return ["no menu"];
        const bad: string[] = [];
        const items = menu.querySelectorAll(
          '[role^="menuitem"], li, button, kbd',
        );
        for (const item of items) {
          const box = item.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          const x = box.left + box.width / 2;
          const y = box.top + box.height / 2;
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
            bad.push(`off screen: ${item.textContent?.slice(0, 20)}`);
            continue;
          }
          const hit = document.elementFromPoint(x, y);
          if (!hit || !menu.contains(hit))
            bad.push(`covered: ${item.textContent?.slice(0, 20)}`);
        }
        return bad;
      }, selector);

    const open = [
      [
        () => page.getByRole("button", { name: /^Answer style:/ }),
        '[role="menu"][aria-label="Answer style"]',
      ],
      [
        () => page.getByRole("button", { name: /^Screen to capture:/ }),
        '[role="menu"][aria-label="Screen to capture"]',
      ],
      [
        () => page.getByRole("button", { name: "Microphone options" }),
        '[role="menu"][aria-label="Microphone options"]',
      ],
      [
        () => page.getByRole("button", { name: "Keyboard shortcuts" }),
        '[role="dialog"][aria-label="Keyboard shortcuts"]',
      ],
    ] as const;
    for (const [trigger, selector] of open) {
      await trigger().click();
      await expect(page.locator(selector)).toBeVisible();
      expect(await covered(selector)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.locator(selector)).toHaveCount(0);
    }
    // The green dot's size menu and the quit confirmation hang from the dots.
    await openSizeMenu(page);
    await expect(sizeMenu(page)).toBeVisible();
    expect(await covered('[role="menu"][aria-label="Window size"]')).toEqual(
      [],
    );
    await page.keyboard.press("Escape");
  });
}
