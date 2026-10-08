// The native task bar and the Screenshots card, as library components: the
// task chips are gone (the Problem menu lists every real problem, newest
// first), revisions are a menu of their own, and the Screenshots card under
// the task line is closed until its icon opens it.
import { expect, type Locator, type Page } from "@playwright/test";

export const problemButton = (page: Page): Locator =>
  page.getByTestId("pn-problem-button");

// Shows the problem whose row matches `label` (for example /^T1 · /); the
// trigger then names it.
export async function chooseProblem(page: Page, label: RegExp): Promise<void> {
  await problemButton(page).click();
  await page
    .getByRole("menu", { name: "Problem" })
    .getByRole("menuitemradio", { name: label })
    .click();
  await expect(problemButton(page)).toHaveText(label);
}

export const revisionsButton = (page: Page): Locator =>
  page.getByTestId("pn-bar-revisions-button");

export const revisionItem = (page: Page, revision: number): Locator =>
  page
    .getByRole("menu", { name: "Revisions" })
    .getByRole("menuitemradio", { name: new RegExp(`^rev ${revision}\\b`) });

// Shows that revision of the task on show (view-only).
export async function chooseRevision(
  page: Page,
  revision: number,
): Promise<void> {
  await revisionsButton(page).click();
  await revisionItem(page, revision).click();
}

export const screenshotsToggle = (page: Page): Locator =>
  page.getByRole("button", { name: /^Screenshots \(\d+\)$/ });

// Opens the Screenshots card if it is closed (it is closed by default).
export async function openScreenshots(page: Page): Promise<void> {
  const toggle = screenshotsToggle(page);
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
