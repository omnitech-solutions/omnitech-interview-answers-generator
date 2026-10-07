// The native toolbar as the component library draws it: the capture split
// button (its caret opens ONE menu: "When to analyse", "Display", "Add screen to
// ..."), tooltips that are real tooltips (not `title` attributes), and the
// window-size menu under the green dot. Specs go through these helpers so a
// change to the toolbar's DOM is fixed in one place.
import { expect, type Locator, type Page } from "@playwright/test";

export type CaptureMode = "Auto" | "Manual";

// The capture split button's caret (the mic has its own caret, so the control is
// found through its own test id).
export const captureCaret = (page: Page): Locator =>
  page.getByTestId("pn-capture").locator('[data-slot="split-button-caret"]');

// The capture menu: "Screen to capture" where the host can choose a display,
// "Capture options" where it cannot.
export const captureMenu = (page: Page): Locator =>
  page.getByRole("menu", { name: /^(Screen to capture|Capture options)$/ });

const modeRow = (page: Page, mode: CaptureMode): Locator =>
  captureMenu(page)
    .getByRole("group", { name: "When to analyse" })
    .getByRole("menuitemradio", { name: new RegExp(`^${mode}\\b`) });

export async function openCaptureMenu(page: Page): Promise<void> {
  await captureCaret(page).click();
  await expect(captureMenu(page)).toBeVisible();
}

// Chooses Auto or Manual in the capture menu; choosing closes the menu.
export async function chooseCaptureMode(
  page: Page,
  mode: CaptureMode,
): Promise<void> {
  await openCaptureMenu(page);
  await modeRow(page, mode).click();
  await expect(captureMenu(page)).toBeHidden();
}

// The mode the menu shows as checked: the toolbar has no mode label of its own
// any more, so the state is read from the open menu (and the menu closed again).
export async function expectCaptureMode(
  page: Page,
  mode: CaptureMode,
): Promise<void> {
  const other: CaptureMode = mode === "Auto" ? "Manual" : "Auto";
  await openCaptureMenu(page);
  await expect(modeRow(page, mode)).toHaveAttribute("aria-checked", "true");
  await expect(modeRow(page, other)).toHaveAttribute("aria-checked", "false");
  // The caret's own tooltip can be the first thing Escape dismisses (focus came
  // back to the caret after an earlier choice), so press until the menu is gone.
  await expect(async () => {
    if (await captureMenu(page).isVisible())
      await page.keyboard.press("Escape");
    await expect(captureMenu(page)).toBeHidden({ timeout: 1_000 });
  }).toPass();
}

// The display rows of the capture menu's Display section (the "Follow my
// browser" row and the unavailable-note row are not displays).
export const displayRows = (page: Page): Locator =>
  captureMenu(page).locator('[data-item-id^="display:"]');

// A control's tooltip: focusing it opens the tooltip (read by its role, since
// the library's triggers do not always keep the tooltip's aria-describedby).
// The control is blurred again and the tooltip waited out, so the next control's
// tooltip is never confused with this one's.
export async function expectTooltip(
  page: Page,
  control: Locator,
  text: string | RegExp,
): Promise<void> {
  // A menu returns focus to its caret, whose tooltip is still fading: let go of
  // whatever has focus and wait for every tooltip to be gone first.
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await control.focus();
  await expect(page.getByRole("tooltip")).toHaveText(text);
  await control.blur();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
}

// A locked control (nothing to act on yet): disabled, or aria-disabled so it
// stays hoverable, and it names what is missing as its title (a natively
// disabled button) or its tooltip (an aria-disabled one).
export async function expectLocked(
  page: Page,
  control: Locator,
  reason: string,
): Promise<void> {
  await expect(control).toBeDisabled();
  const title = await control.getAttribute("title");
  if (title === reason) return;
  await expectTooltip(page, control, reason);
}

// The green dot's window-size menu (ArrowDown opens it, as resting on it does).
export const sizeMenu = (page: Page): Locator =>
  page.getByRole("menu", { name: "Window size" });
export const sizeRow = (page: Page, name: RegExp): Locator =>
  sizeMenu(page).getByRole("menuitemradio", { name });
export async function openSizeMenu(page: Page): Promise<void> {
  await page.getByTestId("pn-dot-size").focus();
  await page.keyboard.press("ArrowDown");
  await expect(sizeMenu(page)).toBeVisible();
}
