import { expect, test } from "../src/fixtures/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("@webkit web smoke: unauthenticated visit is refused and 'Continue as local user' signs in", async ({
  page,
  stack,
}) => {
  // Without a session cookie the tenant page is not served at all: the visit
  // goes to sign-in, remembering the page asked for.
  await page.goto(`/t/${stack.tenantSlug}/p/interview/live`);
  await expect(page).toHaveURL(/\/sign-in\?next=/);

  await page.getByRole("button", { name: "Continue as local user" }).click();

  // Signed in for real: the tenant workspace loads and the studio names the
  // local user, which only a valid session cookie can produce.
  await expect(page).toHaveURL(new RegExp(`/t/${stack.tenantSlug}`));
  await expect(
    page.getByRole("button", { name: "Account: Local user" }),
  ).toBeVisible();
  const live = await page.goto(`/t/${stack.tenantSlug}/p/interview/live`);
  expect(live?.status()).toBe(200);
});
