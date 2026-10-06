import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/test";
import { db } from "../src/helpers/sql";

// Each test signs in for itself, in its own browser context, so signing out
// never invalidates the shared signed-in state the other specs use.
test.use({ storageState: { cookies: [], origins: [] } });

async function signInAsLocal(page: Page, next = "/t/local/p/interview") {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByRole("button", { name: "Continue as local user" }).click();
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}
const account = (page: Page) =>
  page.getByRole("button", { name: "Account: Local user" });

test("web account: the footer names the member and the menu works by mouse and keyboard", async ({
  page,
}) => {
  await signInAsLocal(page);
  await expect(account(page)).toBeVisible();
  await expect(account(page)).toHaveAttribute("aria-expanded", "false");

  // Mouse: opens, lists only real destinations, closes on an outside click.
  await account(page).click();
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Connected accounts",
    "Sign in with an account",
    "Sign out",
  ]);
  await expect(menu).toContainText("No account · this computer");
  await page.locator(".studio-main").click({ position: { x: 5, y: 200 } });
  await expect(menu).toBeHidden();

  // Keyboard: ArrowDown opens on the first item, arrows move, Escape closes
  // and returns focus to the footer button.
  await account(page).focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(account(page)).toBeFocused();
});

test("web account: Connected accounts and Sign in with an account lead somewhere real", async ({
  page,
}) => {
  await signInAsLocal(page);
  await account(page).click();
  await page.getByRole("menuitem", { name: "Connected accounts" }).click();
  await expect(page).toHaveURL(/\/t\/local\/settings\/integrations$/);
  await expect(
    page.getByRole("heading", { name: "Connected accounts" }),
  ).toBeVisible();

  await page.goto("/t/local/p/interview/rehearsal");
  await account(page).click();
  await page.getByRole("menuitem", { name: "Sign in with an account" }).click();
  await expect(page).toHaveURL(
    /\/sign-in\?next=%2Ft%2Flocal%2Fp%2Finterview%2Frehearsal$/,
  );
  await expect(page.getByRole("status")).toContainText("Rehearsal");
});

test("web account: the welcome banner shows once after signing in and can be dismissed", async ({
  page,
}) => {
  await signInAsLocal(page);
  const banner = page.getByRole("status").filter({
    hasText: "Continuing as local user on this computer",
  });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Dismiss welcome message" }).click();
  await expect(banner).toBeHidden();
});

test("web account: signing out without a live session asks, can be cancelled, then leaves for the signed-out page", async ({
  page,
}) => {
  await signInAsLocal(page);
  await account(page).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Leave local session?");
  await expect(dialog).toContainText("Your local data is kept.");
  await expect(dialog).not.toContainText("live session is running");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  // Cancel (Escape) keeps the session and returns focus to the footer.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(account(page)).toBeFocused();
  await page.reload();
  await expect(account(page)).toBeVisible();

  await account(page).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Sign out" })
    .click();
  await expect(page).toHaveURL(/\/signed-out\?as=local$/);
  await expect(
    page.getByRole("heading", { name: "You’re signed out" }),
  ).toBeVisible();
  await expect(
    page.getByText("Your local data is still on this computer."),
  ).toBeVisible();

  // Really signed out: the session is gone and the app asks to sign in.
  const session = await (await page.request.get("/api/auth/session")).json();
  expect(session?.user?.email ?? null).toBeNull();
  await page.goto("/t/local/p/interview");
  await expect(page).toHaveURL(/\/sign-in\?next=/);

  // "Sign in again" returns to the login page.
  await page.goto("/signed-out");
  await page.getByRole("link", { name: "Sign in again" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("web account: signing out with a live session warns, ends the session first, then signs out", async ({
  page,
  live,
}) => {
  await signInAsLocal(page, "/t/local/p/interview/live");
  const session = await live.startRehearsal();
  await account(page).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(
    "A live session is running. Signing out ends it and stops capture.",
  );
  // Cancel first: the session must still be running.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect((await db.session(session.id))?.status).toBe("active");

  await account(page).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "End session and sign out" })
    .click();
  await expect(page).toHaveURL(/\/signed-out\?as=local$/);
  await expect
    .poll(async () => (await db.session(session.id))?.status)
    .toBe("ended");
});
