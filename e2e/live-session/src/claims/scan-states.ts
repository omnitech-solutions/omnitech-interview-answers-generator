// Drives the web page and the native panel through every state that shows
// different controls, scanning each. A control that appears in any of these
// states must be in the claims inventory. Add a state here when a new feature
// brings controls the existing states never show (a paused panel, a missing
// context strip, a failed run ...).
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { installHostShim, nativeOverlayUrl } from "../fixtures/host-shim";
import { startSessionViaApi } from "../helpers/api";
import { type FoundControl, scanControls } from "../helpers/aria-scan";
import { LivePage } from "../pages/live-page";
import type { StackConfig } from "../stack/config";
import type { Control } from "../stack/control";
import type { ScenarioName } from "../stack/scenarios";

export type Sighting = FoundControl & { state: string };
export type Sightings = { surface: "web" | "native"; found: Sighting[] };

function recorder(surface: "web" | "native") {
  const sightings: Sightings = { surface, found: [] };
  return {
    sightings,
    async note(state: string, page: Page): Promise<void> {
      for (const control of await scanControls(page))
        sightings.found.push({ ...control, state });
    },
  };
}

export async function scanSignIn(
  context: BrowserContext,
  stack: StackConfig,
): Promise<Sightings> {
  const { sightings, note } = recorder("web");
  const page = await context.newPage();
  await page.goto(`${stack.webUrl}/sign-in`);
  await expect(
    page.getByRole("button", { name: "Continue as local user" }),
  ).toBeVisible();
  await note("sign-in", page);
  await page.close();
  return sightings;
}

export async function scanWeb(
  page: Page,
  control: Control,
): Promise<Sightings> {
  const { sightings, note } = recorder("web");
  const live = new LivePage(page);
  await live.goto();
  await expect(live.rehearsal()).toBeVisible();
  await note("setup", page);
  await live.rehearsal().check();
  await live.consent().check();
  await note("setup-ready", page);
  await live.startRehearsal();
  await live.useManual();
  await note("live-empty", page);
  for (const tab of ["Transcript", "Activity", "Sources"]) {
    await page.getByRole("tab", { name: tab }).click();
    await note(`live-tab-${tab.toLowerCase()}`, page);
  }
  await live.captureAnalyze().click();
  await note("capture-menu-unshared", page);
  await page
    .getByRole("menuitem", { name: /Share a window, tab or screen/ })
    .click();
  await expect(live.stopSharing()).toBeVisible();
  await live.captureAnalyze().click();
  await note("capture-menu-shared", page);
  await page.getByRole("menuitem", { name: /^New task from/ }).click();
  await expect(live.task(1)).toBeVisible();
  await note("live-task", page);

  // One task per scenario that changes what the task card offers.
  const tasks: Array<[number, ScenarioName]> = [
    [2, "coding-answer"],
    [3, "missing-context"],
    [4, "withheld-preference"],
    [5, "withheld-figure"],
    [6, "provider-failure"],
  ];
  for (const [n, name] of tasks) {
    await control.scenario(name);
    await live.captureAnalyze().click();
    if (n === 2) await note("capture-menu-with-task", page);
    await page.getByRole("menuitem", { name: /^New task from/ }).click();
    await expect(live.task(n)).toBeVisible({ timeout: 30_000 });
    await note(`live-task-${name}`, page);
    if (name === "coding-answer") {
      await page.getByRole("tab", { name: "Code" }).click();
      await note("live-task-code-tab", page);
      await page.getByRole("tab", { name: "Answer" }).click();
    }
  }
  // E-B3: an earlier task, a task with two revisions and its menu, the staging
  // tray with its viewer and crop editor, and a no-question note.
  await control.scenario("plain-answer");
  await live.chip(1).click();
  await note("live-earlier-task", page);
  await live.followUp().fill("Please add an example.");
  await live.sendFollowUp().click();
  const revisions = page.getByRole("button", {
    name: /^Revisions: rev 2 of 2$/,
  });
  await expect(revisions).toBeVisible({ timeout: 30_000 });
  await revisions.click();
  await note("live-revisions-menu", page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Back to T\d+$/ }).click();
  await live.addScreenshot().click();
  await expect(live.staged(1)).toBeVisible();
  await note("live-tray-staged", page);
  await page.getByRole("button", { name: "Open New 1" }).click();
  await note("live-viewer", page);
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  await note("live-crop-editor", page);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Close viewer" }).click();
  await live.discard().click();
  await control.scenario("no-question");
  await live.captureAnalyze().click();
  await page.getByRole("menuitem", { name: /^New task from/ }).click();
  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(page.getByTestId("transcript-note")).toBeVisible({
    timeout: 30_000,
  });
  await note("live-no-question-note", page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await note("live-settings-popover", page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Topic/ }).click();
  await note("live-topic-menu", page);
  await page.keyboard.press("Escape");
  const bar = live.sessionBar();
  await bar.getByRole("button", { name: "Pause" }).click();
  await expect(bar.getByRole("button", { name: "Resume" })).toBeVisible();
  await note("live-paused", page);
  await live.end();
  await expect(
    page.getByRole("button", { name: "Delete session data" }),
  ).toBeVisible();
  await note("ended", page);
  return sightings;
}

export async function scanNative(
  browser: Browser,
  stack: StackConfig,
  control: Control,
): Promise<Sightings> {
  const { sightings, note } = recorder("native");
  const context = await browser.newContext({
    storageState: stack.storageStatePath,
    viewport: { width: 760, height: 560 },
  });
  const shimFor = await installHostShim(context);
  const page = await context.newPage();
  const url = (options: Parameters<typeof nativeOverlayUrl>[2]) =>
    nativeOverlayUrl(stack.webUrl, stack.tenantSlug, options);

  await page.goto(url({ panel: "single", handsFree: true }));
  await expect(
    page.getByRole("button", { name: "Review consent" }),
  ).toBeVisible();
  await note("native-no-session", page);
  // The idle start screen's account menu and a permission that is not allowed.
  await page.getByRole("button", { name: /^Account: / }).click();
  await note("native-account-menu", page);
  await page.keyboard.press("Escape");
  await shimFor(page).setPermissions({
    microphone: "granted",
    screen: "denied",
  });
  await expect(
    page.getByRole("button", { name: "Allow…" }).first(),
  ).toBeVisible();
  await note("native-permission-denied", page);

  // The signed-out window: Studio's public sign-in page with no session cookie,
  // the waiting screen of the browser round trip, and the local-profile step.
  const signedOut = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 760, height: 640 },
  });
  await installHostShim(signedOut);
  const out = await signedOut.newPage();
  await out.route("**/api/native-auth/providers", (route) =>
    route.fulfill({
      json: { configured: true, providers: ["google", "linkedin", "local"] },
    }),
  );
  await out.goto(`${stack.webUrl}/native/sign-in?tenant=${stack.tenantSlug}`);
  await expect(
    out.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await note("native-signed-out", out);
  await out.getByRole("button", { name: "Continue with Google" }).click();
  await expect(
    out.getByRole("button", { name: "Open browser again" }),
  ).toBeVisible();
  await note("native-signin-waiting", out);
  await out.getByRole("button", { name: "Cancel" }).click();
  await out.getByTestId("pn-start-local").click();
  await expect(
    out.getByRole("button", { name: "Continue on this Mac" }),
  ).toBeVisible();
  await note("native-signin-local", out);
  await signedOut.close();

  const { id } = await startSessionViaApi();
  await page.goto(url({ panel: "single", handsFree: true, sessionId: id }));
  const toolbar = page.getByRole("toolbar", { name: "Session controls" });
  await expect(toolbar).toBeVisible();
  await note("native-active", page);
  for (const [button, state] of [
    ["Keyboard shortcuts", "native-keys"],
    [/^Answer style/, "native-style-menu"],
    [/^Screen to capture/, "native-mode-menu"],
    ["Microphone options", "native-mic-menu"],
  ] as const) {
    await toolbar.getByRole("button", { name: button }).click();
    await note(state, page);
    await page.keyboard.press("Escape");
  }
  // See-through: the one control for clear glass and pass-through by region.
  await toolbar.getByRole("button", { name: "See-through" }).click();
  await note("native-see-through", page);
  await toolbar.getByRole("button", { name: "See-through" }).click();
  await page.getByRole("button", { name: "Analyze screen" }).first().click();
  await expect(page.getByRole("button", { name: /^T1 · / })).toBeVisible({
    timeout: 30_000,
  });
  await note("native-task", page);
  // E-B3: the screen menu, the staging tray with its viewer and crop editor, a
  // second revision and its menu, the window-size menu and the Mini player, and
  // a coding task with its Tests drawer.
  await page.setViewportSize({ width: 1320, height: 900 });
  await toolbar.getByRole("button", { name: /^Screen to capture/ }).click();
  await note("native-screen-menu", page);
  await page.keyboard.press("Escape");
  // Auto keeps the area closed until the icon is pressed.
  await page.getByRole("button", { name: /^Screenshots \(/ }).click();
  await page.getByTestId("add-screenshot").click();
  await expect(page.getByTestId("staged-1")).toBeVisible();
  await note("native-tray-staged", page);
  await page.getByRole("button", { name: "Open New 1" }).click();
  await note("native-viewer", page);
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  await note("native-crop-editor", page);
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Close viewer" }).click();
  await page.getByTestId("discard-screenshots").click();
  await page.getByRole("textbox", { name: "Message" }).fill("Add an example.");
  await page.getByRole("button", { name: "Send message" }).click();
  const revisions = page.getByRole("button", {
    name: /^Revisions: rev 2 of 2$/,
  });
  await expect(revisions).toBeVisible({ timeout: 30_000 });
  await revisions.click();
  await note("native-revisions-menu", page);
  await page.keyboard.press("Escape");
  const sizeDot = page.getByTestId("pn-dot-size");
  await sizeDot.focus();
  await page.keyboard.press("ArrowDown");
  await note("native-size-menu", page);
  await page
    .getByRole("menu", { name: "Window size" })
    .getByRole("menuitemradio", { name: /^Mini player/ })
    .click();
  await expect(page.getByTestId("pn-mini-card")).toBeVisible();
  await note("native-mini-player", page);
  await page.getByTestId("pn-mini-back").click();
  await control.scenario("coding-answer");
  await page.getByRole("button", { name: "Analyze screen" }).first().click();
  const tests = page.getByRole("button", { name: "Tests", exact: true });
  await expect(tests).toBeVisible({ timeout: 90_000 });
  await note("native-code-pane", page);
  await tests.click();
  await note("native-tests-drawer", page);
  // The Settings window is its own page; like the panel it needs the session
  // (with none it shows "Consent required").
  const settings = await context.newPage();
  await settings.goto(url({ panel: "settings", sessionId: id }));
  await expect(settings.getByRole("button", { name: "Quit" })).toBeVisible();
  await note("native-settings", settings);
  await settings.close();
  // The red dot asks before quitting; its confirmation is a state of its own.
  await toolbar.getByRole("button", { name: "Quit Interview Studio" }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Quit Interview Studio?" }),
  ).toBeVisible();
  await note("native-quit-confirm", page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Pause session" }).click();
  await expect(
    page.getByRole("button", { name: "Resume session" }),
  ).toBeVisible();
  await note("native-paused", page);
  await page.getByRole("button", { name: "Resume session" }).click();
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByRole("button", { name: "End now" })).toBeVisible();
  await note("native-end-dialog", page);
  await page.getByRole("button", { name: "End now" }).click();
  await expect(
    page.getByRole("button", { name: "Open summary" }),
  ).toBeVisible();
  await note("native-ended", page);

  await context.close();
  return sightings;
}
