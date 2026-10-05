// Why a capture did not run (T32): a persistent banner with the problem, the
// fix and, where the app can help, a button; never a silent idle. Proven on the
// native panel through the shell's closed failure reasons, plus the capture intent on the wire (a person's own
// press is `explicit`, Auto's capture says nothing).

import { expect, test } from "../src/fixtures/panel-test";
import { controlSession } from "../src/helpers/api";

const SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
const banner = (page: import("@playwright/test").Page) =>
  page.getByTestId("capture-problem");

test("@native native capture problem permission-denied: the banner names the problem and the fix, Open Screen Recording settings hands the exact Privacy URL to the shell, Dismiss removes it and the next good capture leaves none", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const { page, host, analyze, id } = await openPanel({ auto: "off" });
  await host.setCapture({ ok: false, reason: "permission-denied" });

  await analyze.click();

  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toHaveAttribute(
    "data-reason",
    "permission-denied",
  );
  await expect(page.getByTestId("capture-problem-title")).toHaveText(
    "Screen Recording is off for Interview Studio",
  );
  await expect(page.getByTestId("capture-problem-fix")).toContainText(
    "Turn it on in System Settings",
  );
  // Nothing was staged, stored or sent for the failed capture.
  expect(await control.calls()).toEqual([]);
  await expect(page.getByTestId("staged-1")).toHaveCount(0);
  expect((await host.calls("captureScreen")).length).toBe(1);

  await host.clear();
  await page.getByTestId("capture-problem-action").click();
  const opened = await host.calls("openExternal");
  expect(opened).toHaveLength(1);
  expect(opened[0]?.params).toEqual({ url: SETTINGS_URL });

  // It stays until dismissed (it does not fade).
  await expect(banner(page)).toBeVisible();
  await page.getByTestId("capture-problem-dismiss").click();
  await expect(banner(page)).toHaveCount(0);

  // The permission is on now: the next capture stages and no banner shows.
  await host.setCapture(null);
  await analyze.click();
  await expect(page.getByTestId("staged-1")).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  expect((await control.calls()).length).toBe(0);
  expect(id).toBeTruthy();
});

for (const [reason, title, fix, hasAction] of [
  [
    "no-focused-window",
    "No browser window found",
    "Open Chrome or Safari, then try again.",
    false,
  ],
  [
    "busy",
    "A capture is already running",
    "Wait a moment for it to finish, then try again.",
    false,
  ],
  [
    "capture-failed",
    "The capture failed",
    "Try again. If it keeps failing, check Screen Recording in System Settings.",
    false,
  ],
] as const) {
  test(`@native native capture problem ${reason}: the banner says it in the fixed words and offers no settings button`, async ({
    openPanel,
  }) => {
    const { page, host, analyze } = await openPanel({ auto: "off" });
    await host.setCapture({ ok: false, reason });

    await analyze.click();

    await expect(banner(page)).toHaveAttribute("data-reason", reason);
    await expect(page.getByTestId("capture-problem-title")).toHaveText(title);
    await expect(page.getByTestId("capture-problem-fix")).toHaveText(fix);
    await expect(page.getByTestId("capture-problem-action")).toHaveCount(
      hasAction ? 1 : 0,
    );
  });
}

test("@native native capture intent: a person's own press asks the shell for an explicit capture; Auto's capture does not claim to be one", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const manual = await openPanel({ auto: "off" });
  await manual.host.clear();
  await manual.analyze.click();
  await expect
    .poll(async () => (await manual.host.calls("captureScreen")).length)
    .toBe(1);
  expect((await manual.host.calls("captureScreen"))[0]?.params).toMatchObject({
    intent: "explicit",
  });
  await manual.host.clear();
  await manual.host.fireIntent("capture.analyze");
  await expect
    .poll(async () => (await manual.host.calls("captureScreen")).length)
    .toBe(1);
  expect((await manual.host.calls("captureScreen"))[0]?.params).toMatchObject({
    intent: "explicit",
  });
  await manual.context.close();
  // One session is open at a time.
  await controlSession(manual.id, "end");

  const auto = await openPanel({ auto: "on" });
  await expect(auto.page.getByText("Auto · watching the screen")).toBeVisible();
  await auto.host.clear();
  await auto.host.fireScreenChange(40);
  await expect
    .poll(async () => (await auto.host.calls("captureScreen")).length)
    .toBeGreaterThan(0);
  for (const call of await auto.host.calls("captureScreen"))
    expect(call.params).not.toHaveProperty("intent");
});
