// The Mac app's sign-in and start screens, as the shell's WKWebView draws them
// (WebKit) with the recording host shim: the signed-out window (the public
// sign-in page, no cookie), the browser round trip's waiting screen, "this Mac
// only", the idle "No live session" screen with its permission and agreement
// gates, the account menu and sign-out, and proof that Start hands over to the
// LIVE window unchanged. The page, the server and the database are real; only
// the shell's bridge (and the providers list, which names Google and LinkedIn
// the disposable stack does not configure) is simulated.
import type { BrowserContext, Page } from "@playwright/test";
import {
  type HostShim,
  installHostShim,
  nativeOverlayUrl,
} from "../src/fixtures/host-shim";
import { expect, test } from "../src/fixtures/test";
import { db } from "../src/helpers/sql";
import { expectLocked } from "../src/helpers/toolbar";
import type { StackConfig } from "../src/stack/config";

const PROVIDERS = {
  configured: true,
  providers: ["google", "linkedin", "local"],
};

// A fresh window with NO session cookie (the first launch, or after a sign-out),
// the shim installed, and Studio's providers list scripted.
async function signedOutWindow(
  browser: import("@playwright/test").Browser,
  stack: StackConfig,
  providers: unknown = PROVIDERS,
) {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 760, height: 640 },
  });
  const shimFor = await installHostShim(context);
  const page = await context.newPage();
  await page.route("**/api/native-auth/providers", (route) =>
    route.fulfill({ json: providers }),
  );
  await page.goto(`${stack.webUrl}/native/sign-in?tenant=${stack.tenantSlug}`);
  return { context, page, host: shimFor(page) as HostShim };
}

const card = (page: Page) => page.getByTestId("pn-start");
const bar = (page: Page) =>
  page.getByRole("toolbar", { name: "Session controls" });

// The window's session controls: every toolbar button except the three window
// dots and the account chip.
async function sessionControls(page: Page) {
  const buttons = bar(page).getByRole("button");
  const all = await buttons.all();
  const controls = [];
  for (const button of all) {
    // Not a session control: the window's dots, and the account chip.
    const own = await button.evaluate(
      (el) =>
        el.classList.contains("pn-window-dot") ||
        el.getAttribute("data-testid") === "pn-chip",
    );
    if (!own) controls.push(button);
  }
  return controls;
}

// The session controls that are locked: disabled, or aria-disabled so they stay
// hoverable for their tooltip. The library's controls lock the second way, the
// answer-style button the first. See-through is never locked.
async function lockedControls(page: Page) {
  const locked = [];
  for (const control of await sessionControls(page))
    if (await control.isDisabled()) locked.push(control);
  return locked;
}

// The shell's first-run consent, as StudioWebView.swift records it for the page.
const consented = (context: BrowserContext) =>
  context.addInitScript(
    `try { localStorage.setItem("studio.shell.consented", "1"); } catch {}`,
  );

// Signs the window's own web view in as the stack's local user, as Studio's
// redemption does for the shell: the session cookie is set, then the panel loads.
async function signedInHere(page: Page, stack: StackConfig) {
  await page.evaluate(async () => {
    const { csrfToken } = (await (await fetch("/api/auth/csrf")).json()) as {
      csrfToken: string;
    };
    await fetch("/api/auth/callback/local", {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, callbackUrl: "/" }).toString(),
    });
  });
  await page.goto(
    nativeOverlayUrl(stack.webUrl, stack.tenantSlug, {
      panel: "single",
      handsFree: true,
    }),
  );
}

test("@native sign-in signed out: the card sits in the same chrome, every session control is disabled and says why, the window's dots still work", async ({
  browser,
  stack,
}) => {
  const { context, page } = await signedOutWindow(browser, stack);
  await expect(card(page)).toHaveAttribute("data-stage", "out");
  await expect(
    card(page).getByRole("heading", { name: "Sign in to start a session" }),
  ).toBeVisible();
  await expect(
    card(page).getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(
    card(page).getByRole("button", { name: "Continue with LinkedIn" }),
  ).toBeVisible();
  await expect(
    card(page).getByRole("button", {
      name: "Continue on this Mac, no account",
    }),
  ).toBeVisible();
  await expect(card(page)).toContainText(
    "Google and LinkedIn open in your browser. Studio never sees your password.",
  );

  // The toolbar is the real one: its buttons exist, disabled, with a reason
  // (See-through is the one control that is never locked).
  const locked = await lockedControls(page);
  expect(locked.length).toBeGreaterThanOrEqual(7);
  for (const control of locked)
    await expectLocked(page, control, "Sign in first");
  await expect(
    bar(page).getByRole("button", { name: "Analyze screen" }),
  ).toBeDisabled();
  await expect(bar(page).getByTestId("pn-chip-out")).toHaveText(
    "Not signed in",
  );

  // The footer: the build id stays, "Not signed in" at the end.
  await expect(
    page.getByRole("button", { name: /^Copy build / }),
  ).toBeVisible();
  await expect(page.getByTestId("ov-status")).toHaveText("Not signed in");
  await expect(page.getByRole("button", { name: /^(Pause|End)/ })).toHaveCount(
    0,
  );

  // The window's own controls are not session controls.
  const dots = page.getByRole("group", { name: "Window controls" });
  await expect(dots.getByRole("button", { name: "Hide window" })).toBeEnabled();
  await context.close();
});

test("@native sign-in a Studio that offers no local profile draws no local button, and one that offers nothing says so", async ({
  browser,
  stack,
}) => {
  // The designed sign-in is always drawn: a provider the Studio has not set up
  // is a disabled button, and the card says so.
  const first = await signedOutWindow(browser, stack, {
    configured: true,
    providers: ["google"],
  });
  await expect(
    first.page.getByRole("button", { name: "Continue with Google" }),
  ).toBeEnabled();
  await expect(
    first.page.getByRole("button", { name: /Continue with LinkedIn/ }),
  ).toBeDisabled();
  await expect(
    first.page.getByText("LinkedIn isn’t set up on this Studio."),
  ).toBeVisible();
  await expect(first.page.getByTestId("pn-start-local")).toHaveCount(0);
  await first.context.close();
  const none = await signedOutWindow(browser, stack, {
    configured: false,
    providers: [],
  });
  await expect(
    none.page.getByText(/Google and LinkedIn aren’t set up on this Studio/),
  ).toBeVisible();
  for (const provider of ["Google", "LinkedIn"])
    await expect(
      none.page.getByRole("button", { name: `Continue with ${provider}` }),
    ).toBeDisabled();
  await none.context.close();
});

test("@native sign-in Google: the click asks the shell for the browser, the waiting screen names Google, Reopen, Copy link and Cancel go to the shell, and a finished sign-in lands on the idle screen", async ({
  browser,
  stack,
}) => {
  const { context, page, host } = await signedOutWindow(browser, stack);
  await card(page)
    .getByRole("button", { name: "Continue with Google" })
    .click();
  await expect
    .poll(async () =>
      (await host.calls("signIn")).map((c) => c.params["provider"]),
    )
    .toEqual(["google"]);

  await expect(card(page)).toHaveAttribute("data-stage", "waiting");
  await expect(
    card(page).getByRole("heading", {
      name: "Finish signing in in your browser",
    }),
  ).toBeVisible();
  await expect(card(page)).toContainText(
    "We opened Google in your default browser",
  );
  // Still the same locked chrome.
  await expect(
    bar(page).getByRole("button", { name: "Analyze screen" }),
  ).toBeDisabled();

  await card(page).getByRole("button", { name: "Open browser again" }).click();
  await card(page).getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByTestId("pn-start-toast")).toHaveText(
    "Sign-in link copied",
  );
  expect((await host.calls("reopenSignIn")).length).toBe(1);
  expect((await host.calls("copySignInLink")).length).toBe(1);

  // Cancel: the shell hears it and says the attempt is over; the choices return.
  await card(page).getByRole("button", { name: "Cancel" }).click();
  await expect
    .poll(async () => (await host.calls("cancelSignIn")).length)
    .toBe(1);
  await expect(card(page)).toHaveAttribute("data-stage", "out");

  // A second attempt, this time finished: the shell redeems the one-time code in
  // the web view (the session cookie is set) and loads the panel.
  await card(page)
    .getByRole("button", { name: "Continue with Google" })
    .click();
  await expect(card(page)).toHaveAttribute("data-stage", "waiting");
  await signedInHere(page, stack);
  await expect(card(page)).toHaveAttribute("data-stage", "idle");
  await expect(
    card(page).getByText("No live session", { exact: true }),
  ).toBeVisible();
  // The stack's member is its local user, so the welcome says so.
  await expect(
    page.getByText("Using this Mac without an account"),
  ).toBeVisible();
  await context.close();
});

test("@native sign-in a timed-out browser attempt returns to the choices and says nothing changed", async ({
  browser,
  stack,
}) => {
  const { context, page, host } = await signedOutWindow(browser, stack);
  await card(page)
    .getByRole("button", { name: "Continue with LinkedIn" })
    .click();
  await expect
    .poll(async () =>
      (await host.calls("signIn")).map((c) => c.params["provider"]),
    )
    .toEqual(["linkedin"]);
  await expect(card(page)).toContainText("We opened LinkedIn");
  await host.setSignIn({ phase: "timed-out" });
  await expect(card(page)).toHaveAttribute("data-stage", "out");
  await expect(card(page)).toContainText(
    "Sign-in timed out before it finished. Nothing was changed.",
  );
  await context.close();
});

test("@native sign-in a shell that cannot open the browser says so", async ({
  browser,
  stack,
}) => {
  const { context, page, host } = await signedOutWindow(browser, stack);
  await host.setSignInRefusal(true);
  await card(page)
    .getByRole("button", { name: "Continue with Google" })
    .click();
  await expect(page.getByTestId("pn-start-toast")).toContainText(
    "Couldn’t open your browser",
  );
  await expect(card(page)).toHaveAttribute("data-stage", "out");
  await context.close();
});

test("@native sign-in this Mac: confirm step with true facts, Back, then signs in inside the window (no browser) and shows the local idle screen", async ({
  browser,
  stack,
}) => {
  const { context, page, host } = await signedOutWindow(browser, stack);
  await page.getByTestId("pn-start-local").click();
  await expect(card(page)).toHaveAttribute("data-stage", "local");
  await expect(
    card(page).getByRole("heading", { name: "Use Studio on this Mac only" }),
  ).toBeVisible();
  await expect(card(page)).toContainText("No account and no password.");
  await expect(card(page)).toContainText("Studio is running on this Mac.");
  // Nothing the code cannot stand behind.
  const said = (await card(page).textContent()) ?? "";
  expect(said).not.toMatch(
    /leaves this Mac|stored on this Mac|on device|synced/i,
  );
  await card(page).getByRole("button", { name: "Back" }).click();
  await expect(card(page)).toHaveAttribute("data-stage", "out");

  await page.getByTestId("pn-start-local").click();
  await card(page)
    .getByRole("button", { name: "Continue on this Mac" })
    .click();
  // The page signed in through Studio's own form post and went to the panel.
  await expect(page).toHaveURL(
    /\/t\/[^/]+\/p\/interview\/live\/overlay\?host=native&panel=single&handsfree=1/,
  );
  await expect(card(page)).toHaveAttribute("data-stage", "idle");
  await expect(
    page.getByText("Using this Mac without an account"),
  ).toBeVisible();
  await expect(bar(page).getByTestId("pn-chip")).toContainText("This Mac");
  await expect(page.getByTestId("ov-status")).toHaveText(
    "Local profile · no account",
  );
  // No browser was involved: the shell was never asked to sign in.
  expect((await host.calls("signIn")).length).toBe(0);
  await context.close();
});

test("@native sign-in idle: the start screen waits for Start, shows the Mac's permissions, and gates Start on them", async ({
  native,
  stack,
}) => {
  const before = (await db.sessions()).length;
  await consented(native.context);
  const panel = await native.open();
  await panel.page.goto(
    nativeOverlayUrl(stack.webUrl, stack.tenantSlug, {
      panel: "single",
      handsFree: true,
    }),
  );
  await panel.host.setPermissions({ microphone: "granted", screen: "denied" });
  const { page, host } = panel;
  await expect(card(page)).toHaveAttribute("data-stage", "idle");
  await expect(
    card(page).getByText("No live session", { exact: true }),
  ).toBeVisible();

  // Rehearsal only for the local profile; no interview is invented.
  await expect(page.getByRole("radio")).toHaveCount(1);
  await expect(page.getByRole("radio")).toContainText("Rehearsal");

  // The toolbar is the same one, disabled, saying a session must start first.
  const locked = await lockedControls(page);
  expect(locked.length).toBeGreaterThanOrEqual(7);
  for (const control of locked)
    await expectLocked(page, control, "Start a session first");

  // "Set up in Studio on the web" opens the browser through the shell, never in this window.
  await page
    .getByRole("button", { name: "Set up in Studio on the web" })
    .click();
  await expect
    .poll(async () =>
      (await host.calls("openExternal")).map((c) => String(c.params["url"])),
    )
    .toContainEqual(expect.stringMatching(/\/t\/[^/]+\/p\/interview\/live$/));
  await expect(page).toHaveURL(/panel=single/);

  // THIS MAC: screen recording is not allowed yet.
  const mac = page.getByRole("region", { name: "This Mac" });
  await expect(mac.getByRole("button", { name: "Allow…" })).toHaveCount(2);
  await expect(page.getByTestId("pn-start-hint")).toHaveText(
    "Allow screen recording first",
  );
  // A blocked Start still answers a press (the reason, as a toast); Playwright treats
  // aria-disabled as not clickable, so the press is forced.
  await page
    .getByRole("button", { name: "Start session" })
    .click({ force: true });
  await expect(page.getByTestId("pn-start-toast")).toHaveText(
    "Allow screen recording first",
  );
  expect(await db.sessions()).toHaveLength(before);

  // Allow… opens the macOS Screen Recording pane, through the shell.
  await mac.getByRole("button", { name: "Allow…" }).first().click();
  await expect
    .poll(async () =>
      (await host.calls("openExternal")).map((c) => c.params["url"]),
    )
    .toContain(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );

  // The person allows it in System Settings and comes back: no reload needed.
  await host.setPermissions({ microphone: "granted", screen: "granted" });
  await expect(mac.getByText("Allowed")).toHaveCount(3);
  await expect(page.getByTestId("pn-start-hint")).toHaveText(
    "Listening starts right away",
  );
  expect(await db.sessions()).toHaveLength(before);
});

test("@native sign-in Start hands over to the live window, which is the one that was always there: unlocked toolbar, Pause and End in the footer", async ({
  native,
  stack,
}) => {
  const before = (await db.sessions()).length;
  await consented(native.context);
  const panel = await native.open();
  await panel.page.goto(
    nativeOverlayUrl(stack.webUrl, stack.tenantSlug, {
      panel: "single",
      handsFree: true,
    }),
  );
  const { page } = panel;
  await expect(card(page)).toHaveAttribute("data-stage", "idle");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect.poll(async () => (await db.sessions()).length).toBe(before + 1);
  const created = (await db.sessions()).at(-1);
  expect(created?.status).toBe("active");
  expect(created?.rehearsal_run_id).not.toBeNull();

  await expect(card(page)).toHaveCount(0);
  await expect(page.getByTestId("pn-root")).toBeVisible();
  const analyze = bar(page).getByRole("button", { name: "Analyze screen" });
  await expect(analyze).toBeEnabled();
  await expect(analyze).not.toHaveAttribute("aria-disabled", "true");
  await expect(
    page.getByRole("button", { name: "Pause session" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "End session" })).toBeVisible();
  await expect(page.getByTestId("ov-status")).toHaveCount(0);
  await expect(page.getByTestId("pn-chip")).toHaveCount(0);
});

test("@native sign-in account menu: the chip names this Mac, the menu lists Open Studio, Settings, Sign in with Google or LinkedIn and Sign out, and each goes to the shell", async ({
  native,
  stack,
}) => {
  const panel = await native.open();
  await panel.page.goto(
    nativeOverlayUrl(stack.webUrl, stack.tenantSlug, {
      panel: "single",
      handsFree: true,
    }),
  );
  const { page, host } = panel;
  const chip = bar(page).getByTestId("pn-chip");
  await expect(chip).toContainText("This Mac");
  await chip.click();
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Open Studio on the web",
    "Settings",
    "Sign in with Google or LinkedIn",
    "Sign out of local profile",
  ]);
  await menu.getByRole("menuitem", { name: "Open Studio on the web" }).click();
  await expect
    .poll(async () =>
      (await host.calls("openExternal")).map((c) => String(c.params["url"])),
    )
    .toContainEqual(expect.stringMatching(/\/t\/[^/]+\/p\/interview\/live$/));
  await chip.click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect
    .poll(async () => (await host.calls("openSettings")).length)
    .toBe(1);
  await chip.click();
  await page
    .getByRole("menuitem", { name: "Sign out of local profile" })
    .click();
  await expect.poll(async () => (await host.calls("signOut")).length).toBe(1);
});

test("@native sign-in sign out leaves the window on the sign-in screen with 'Signed out' said once", async ({
  browser,
  stack,
}) => {
  // The shell, on signOut, clears the session cookie and loads the public page
  // with the reason; this is that page.
  const { context, page } = await signedOutWindow(browser, stack);
  await page.goto(
    `${stack.webUrl}/native/sign-in?tenant=${stack.tenantSlug}&notice=signed-out`,
  );
  await expect(card(page)).toHaveAttribute("data-stage", "out");
  await expect(page.getByTestId("pn-start-toast")).toHaveText("Signed out");
  await expect(page.getByTestId("pn-start-toast")).toHaveCount(0, {
    timeout: 6_000,
  });
  await expect(page.getByText(/Your session expired/)).toHaveCount(0);
  await context.close();
});

test("@native sign-in a session Studio stops accepting shows the sign-in card with the expired notice, in the same window", async ({
  browser,
  stack,
}) => {
  const context: BrowserContext = await browser.newContext({
    storageState: stack.storageStatePath,
    viewport: { width: 760, height: 640 },
  });
  await installHostShim(context);
  const page = await context.newPage();
  await page.route("**/api/native-auth/providers", (route) =>
    route.fulfill({ json: PROVIDERS }),
  );
  // Studio refuses the session reads (the cookie expired or was revoked).
  await page.route("**/api/interview/t/*/sessions/**", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "unauthorized" } },
    }),
  );
  await page.goto(
    nativeOverlayUrl(stack.webUrl, stack.tenantSlug, {
      panel: "single",
      handsFree: true,
    }),
  );
  await expect(card(page)).toHaveAttribute("data-stage", "out");
  await expect(card(page)).toContainText(
    "Your session expired. Sign in again to continue.",
  );
  await expect(
    bar(page).getByRole("button", { name: "Analyze screen" }),
  ).toBeDisabled();
  await expect(page.getByTestId("ov-status")).toHaveText("Not signed in");
  await context.close();
});
