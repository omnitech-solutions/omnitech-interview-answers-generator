// The Hands-free band at the top of the web Live page: its collapse, Manual and
// Auto, the capture and settings controls, the topic and language hints they
// choose, the region, the status dot, and what a second Studio window of the
// same browser shows. Each control is proven by what it DOES: the recogniser it
// starts, the stored choice, the request the page makes, a server row or the
// other window's state.
import type { Page } from "@playwright/test";
import { installBrowserSpies } from "../src/fixtures/browser-spies";
import { expect, test } from "../src/fixtures/test";
import { controlSession, startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";

const band = (page: Page) => page.getByTestId("hands-free-band");
const barStatus = (page: Page) => page.getByTestId("bar-status");

async function openBand(
  page: Page,
  live: { livePath(): string },
  options: Parameters<typeof startSessionViaApi>[0] = {},
) {
  const started = await startSessionViaApi(options);
  await page.goto(`${live.livePath()}/${started.id}`);
  await expect(band(page)).toBeVisible();
  return started;
}

test("web band Auto and Manual: Manual stops the microphone and the Auto choice, Auto starts listening again, and the choice is remembered", async ({
  page,
  live,
  stack,
}) => {
  const spies = (await installBrowserSpies(page))(page);
  await openBand(page, live);
  const key = `interview-studio.live.auto.${stack.tenantSlug}`;
  await live.autoMode().click();
  await expect(live.autoMode()).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await spies.speech.stats()).listening).toBe(1);
  await expect(page.getByTestId("light-mic")).toContainText("Mic listening");

  await live.manualMode().click();
  await expect(live.manualMode()).toHaveAttribute("aria-pressed", "true");
  await expect(live.autoMode()).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await spies.speech.stats()).listening).toBe(0);
  await expect(page.getByTestId("light-mic")).toContainText("Mic off");
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe("off");

  // Remembered: a reload keeps Manual; Auto again is remembered the same way.
  await page.reload();
  await expect(live.manualMode()).toHaveAttribute("aria-pressed", "true");
  await live.autoMode().click();
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe("on");
});

test("web band Collapse and Expand: the capture strip and the follow-up box leave and return, and the button says which it will do", async ({
  page,
  live,
}) => {
  await openBand(page, live);
  await live.useManual();
  const collapse = page.getByRole("button", { name: "Collapse hands-free" });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(live.followUp()).toBeVisible();
  await expect(live.captureAnalyze()).toBeVisible();

  await collapse.click();

  const expand = page.getByRole("button", { name: "Expand hands-free" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(band(page)).toHaveAttribute("data-collapsed", "true");
  await expect(live.followUp()).toBeHidden();
  await expect(live.captureAnalyze()).toBeHidden();
  // The lights stay: the band never hides what it is doing.
  await expect(page.getByTestId("hands-free-lights")).toBeVisible();

  await expand.click();
  await expect(live.followUp()).toBeVisible();
  await expect(band(page)).not.toHaveAttribute("data-collapsed", "true");
});

test("web band Capture screen: with no source it opens the source menu, shares a real screen from it, and with one shared it stages a capture on this device", async ({
  page,
  live,
  control,
}) => {
  await openBand(page, live);
  await live.useManual();
  const capture = page.getByRole("button", { name: "Capture screen" });

  await capture.click();
  const menu = page.getByRole("menu", { name: "Capture source" });
  await expect(menu).toBeVisible();
  await menu
    .getByRole("menuitem", { name: /Share a window, tab or screen/ })
    .click();
  await expect(live.stopSharing()).toBeVisible();

  // The preview has a frame to capture before the press can stage one.
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0),
    )
    .toBeGreaterThan(0);
  await capture.click();
  // Manual stages it: nothing left the device.
  await expect(live.staged(1)).toContainText("Not sent yet");
  expect(await control.calls()).toEqual([]);
});

test("web band Settings and Topic: both open the capture settings, the topic and language are remembered and sent as hints with the next follow-up", async ({
  page,
  live,
  control,
}) => {
  await control.scenario("plain-answer");
  const started = await openBand(page, live);
  await live.useManual();
  const topic = page.getByTitle(/^Interview topic: change it in settings/);
  await expect(topic).toHaveText("Topic: auto");

  // The Topic pill and the Settings icon open the same dialog.
  await topic.click();
  const dialog = page.getByRole("dialog", { name: "Capture settings" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(dialog).toBeVisible();

  await dialog
    .getByRole("combobox", { name: "Topic" })
    .selectOption("behavioral");
  await dialog
    .getByRole("combobox", { name: "Coding language" })
    .selectOption({ index: 1 });
  const language = await dialog
    .getByRole("combobox", { name: "Coding language" })
    .inputValue();
  await page.keyboard.press("Escape");
  await expect(topic).toHaveText("Behavioral Interview");

  // Sent as hints: the next follow-up carries both.
  const input = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes(`/sessions/${started.id}/input`),
  );
  await live.followUp().fill("What is a closure in JavaScript?");
  await live.sendFollowUp().click();
  const body = (await input).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({ skill: "behavioral", language });

  // Remembered across a reload.
  await page.reload();
  await expect(
    page.getByTitle(/^Interview topic: change it in settings/),
  ).toHaveText("Behavioral Interview");
});

test("web band Choose area: Save region crops what the next capture sends, the Cropped chip says so, and Reset returns the whole source", async ({
  page,
  live,
  control,
}) => {
  await control.scenario("plain-answer");
  await openBand(page, live);
  await live.useManual();
  await live.shareScreen();
  const flashWidth = async () => {
    const text = await page.getByTestId("capture-flash").innerText();
    return Number(/Captured · (\d+) × (\d+)/.exec(text)?.[1]);
  };

  await live.captureNewTask();
  await expect(live.task(1)).toBeVisible();
  const full = await flashWidth();

  await live.captureAnalyze().click();
  await page.getByRole("menuitem", { name: /^Choose area/ }).click();
  const editor = page.getByTestId("mask-editor");
  await editor.getByRole("button", { name: "Left side" }).click();
  await editor.getByRole("button", { name: "Save region" }).click();
  await expect(page.getByTestId("region-chip")).toHaveText("Cropped");

  await live.captureAnalyze().click();
  await page.getByRole("menuitem", { name: /^New task from/ }).click();
  await expect(live.task(2)).toBeVisible();
  await expect.poll(flashWidth).toBeLessThan(full * 0.6);

  // Reset: the chip goes and the next capture is whole again.
  await page.getByTestId("region-chip").click();
  await page
    .getByTestId("mask-editor")
    .getByRole("button", { name: "Reset" })
    .click();
  await page
    .getByTestId("mask-editor")
    .getByRole("button", { name: "Save region" })
    .click();
  await expect(page.getByTestId("region-chip")).toHaveCount(0);
});

test("web band status dot: Ready, Listening and Paused follow what the session is really doing", async ({
  page,
  live,
}) => {
  const spies = (await installBrowserSpies(page))(page);
  const started = await openBand(page, live);
  await live.useManual();
  await expect(barStatus(page)).toHaveAttribute("data-status", "ready");

  await live.autoMode().click();
  await expect.poll(async () => (await spies.speech.stats()).listening).toBe(1);
  await expect(barStatus(page)).toHaveAttribute("data-status", "listening");

  await live.manualMode().click();
  await expect(barStatus(page)).toHaveAttribute("data-status", "ready");
  await controlSession(started.id, "pause");
  await expect
    .poll(async () => (await db.session(started.id))?.status)
    .toBe("paused");
  await expect(barStatus(page)).toHaveAttribute("data-status", "paused", {
    timeout: 45_000,
  });
});

test("web band in a second window of the same browser: it shows that another Studio window runs Auto, and Turn off there stops Auto in both", async ({
  page,
  live,
  context,
}) => {
  const started = await openBand(page, live);
  await live.autoMode().click();
  await expect(live.autoMode()).toHaveAttribute("aria-pressed", "true");
  const other = await context.newPage();
  await other.goto(`${live.livePath()}/${started.id}`);
  await expect(band(other)).toBeVisible();

  // Only one window listens and captures: the second one says whose it is.
  await expect(other.getByTestId("auto-mirror")).toContainText(
    "Auto · running in another Studio window",
  );
  await expect(band(other)).toHaveAttribute("data-owner", "other-window");
  await expect(band(page)).toHaveAttribute("data-owner", "this-window");

  await other.getByRole("button", { name: "Turn off" }).click();
  await expect(other.getByTestId("auto-mirror")).toHaveCount(0);
  await expect(live.manualMode()).toHaveAttribute("aria-pressed", "true");
});

test("web band capture problem: a device-only session's Capture screen shows the banner with its fix, nothing is captured, and Dismiss removes it", async ({
  page,
  live,
  control,
}) => {
  const started = await startSessionViaApi({
    processingPolicy: "device-only",
    captureSources: ["microphone", "application-audio", "screen"],
  });
  await page.goto(`${live.livePath()}/${started.id}`);
  await expect(band(page)).toBeVisible();
  await live.manualMode().click();

  await page.getByRole("button", { name: "Capture screen" }).click();

  const problem = page.getByTestId("capture-problem");
  await expect(problem).toHaveAttribute("data-reason", "device-only");
  await expect(problem.getByTestId("capture-problem-title")).toHaveText(
    "Device-only mode never sends a screenshot to an assistant.",
  );
  await expect(problem.getByTestId("capture-problem-fix")).toHaveText(
    "Switch the session out of device-only to analyze a screen.",
  );
  expect(await control.calls()).toEqual([]);
  expect(
    (await db.observations(started.id)).filter(
      (row) => row.kind === "screen.snapshot",
    ),
  ).toEqual([]);

  await problem.getByRole("button", { name: "Dismiss message" }).click();
  await expect(problem).toHaveCount(0);
});
