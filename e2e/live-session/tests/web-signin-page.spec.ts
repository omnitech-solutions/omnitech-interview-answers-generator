import { request } from "@playwright/test";
import { expect, test } from "../src/fixtures/test";

// Every test here starts signed out; the shared signed-in state is never used.
test.use({ storageState: { cookies: [], origins: [] } });

test("web signin page: the design's title, both providers, the footnote and the local user on this computer", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Sign in to Interview Studio" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Prepare, rehearse and get live help in developer interviews.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue as local user" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Shown because Studio is running on this computer. No account or password; data stays here.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "We only receive your name, email and photo. Studio never sees your password.",
    ),
  ).toBeVisible();
  // Providers that are not configured here are disabled, with the reason,
  // never a button that fails.
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Google sign-in is not set up on this Studio."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with LinkedIn" }),
  ).toBeDisabled();
});

test("web signin page: dark by default, light when the system asks, and never white while loading", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/sign-in");
  const dark = await page
    .locator(".auth-page")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(dark).toBe("rgb(17, 18, 20)");
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe("rgb(17, 18, 20)");
  await page.emulateMedia({ colorScheme: "light" });
  const light = await page
    .locator(".auth-page")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(light).toBe("rgb(246, 247, 249)");
});

test("web signin page: a phone-width screen has no sideways scroll and keeps every control reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/sign-in");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Continue as local user" }).focus();
  await expect(
    page.getByRole("button", { name: "Continue as local user" }),
  ).toBeFocused();
});

test("web signin page: a deep link says where it returns to, an unsafe one is ignored, an expired session says so", async ({
  page,
}) => {
  await page.goto("/sign-in?next=/t/local/p/interview/live");
  await expect(page.getByRole("status")).toHaveText(
    "You’ll go back to Live session after signing in",
  );
  await page.goto("/sign-in?next=https://evil.example/t/local");
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.goto("/sign-in?next=//evil.example");
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.goto("/sign-in?reason=expired&next=/t/local/p/interview/live");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByText(/Your sign-in expired/)).toBeVisible();
});

test("web signin page: an unauthenticated visit to a page goes to sign-in and back after the local sign-in, with the welcome once", async ({
  page,
  stack,
}) => {
  await page.goto(`/t/${stack.tenantSlug}/p/interview/live`);
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await expect(page.getByRole("status")).toHaveText(
    "You’ll go back to Live session after signing in",
  );
  await page.getByRole("button", { name: "Continue as local user" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/t/${stack.tenantSlug}/p/interview/live$`),
  );
  await expect(page.getByRole("status").first()).toContainText(
    "Continuing as local user on this computer",
  );
  // The marker is removed from the address, so a reload does not repeat it.
  await page.reload();
  await expect(page.getByRole("button", { name: /^Account: / })).toBeVisible();
  await expect(
    page.getByText("Continuing as local user on this computer"),
  ).toHaveCount(0);
});

test("web signin page: a hostile next lands on the product home, on this origin", async ({
  page,
  stack,
}) => {
  await page.goto("/sign-in?next=//evil.example/t/local");
  await page.getByRole("button", { name: "Continue as local user" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/t/${stack.tenantSlug}/p/interview$`),
  );
  expect(new URL(page.url()).origin).toBe(new URL(stack.webUrl).origin);
});

test("web signin page: the local user is hidden, and cannot sign in, when the request is not for this computer", async ({
  stack,
}) => {
  const elsewhere = await request.newContext({
    baseURL: stack.webUrl,
    extraHTTPHeaders: { host: "studio.example.com" },
  });
  const html = await (await elsewhere.get("/sign-in")).text();
  expect(html).toContain("Sign in to Interview Studio");
  expect(html).not.toContain("Continue as local user");

  // The provider itself refuses: no session results from a forged form post.
  const { csrfToken } = (await (
    await elsewhere.get("/api/auth/csrf")
  ).json()) as {
    csrfToken: string;
  };
  await elsewhere.post("/api/auth/callback/local", {
    form: { csrfToken, callbackUrl: `${stack.webUrl}/t/${stack.tenantSlug}` },
    maxRedirects: 0,
  });
  const session = await (await elsewhere.get("/api/auth/session")).json();
  expect(session?.user?.email ?? null).toBeNull();
  await elsewhere.dispose();

  // The same request for this computer works (the control for the check above).
  const here = await request.newContext({ baseURL: stack.webUrl });
  const token = (await (await here.get("/api/auth/csrf")).json()) as {
    csrfToken: string;
  };
  await here.post("/api/auth/callback/local", {
    form: {
      csrfToken: token.csrfToken,
      callbackUrl: `${stack.webUrl}/t/${stack.tenantSlug}`,
    },
    maxRedirects: 0,
  });
  const ok = await (await here.get("/api/auth/session")).json();
  expect(ok?.user?.email).toBe("local@omnitech.test");
  await here.dispose();
});
