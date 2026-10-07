// The native Code pane and its Tests drawer (the |>| handle), with the REAL
// sandboxed test runner behind the scripted model: what the server established
// about the generated tests (counts, one row per test, a failure's own message,
// syntax problems, fully verified or not), Copy answer and Copy code, and the
// states of a draft the guards withheld or a model that refused, failed or
// timed out. The drawer's counts and rows are the server's; the page never
// recomputes them.
import type { Locator, Page } from "@playwright/test";
import { expect, type OpenPanel, test } from "../src/fixtures/panel-test";
import { startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { say, settled } from "../src/helpers/tasks";
import { SCRIPTED } from "../src/stack/scenarios";

const handle = (page: Page): Locator =>
  page.getByRole("button", { name: "Tests", exact: true });
const drawer = (page: Page): Locator => page.getByTestId("pn-tests-drawer");
// The code card's file tabs: the generated test source is its Tests file (the
// drawer holds the counts and rows, not the source).
const testsFile = (page: Page): Locator =>
  page
    .getByRole("group", { name: "File" })
    .getByRole("button", { name: /test|spec/i });

// A coding task through the toolbar: one screenshot staged and applied, then
// wait for the server to finish the solution action (the runner takes a few
// seconds).
async function codingTask(panel: OpenPanel) {
  await panel.analyze.click();
  await panel.page.getByTestId("apply-screenshots").click();
  await expect
    .poll(
      async () =>
        (await db.actions(panel.id)).find((a) => a.action_kind === "solve-code")
          ?.dispatch_status,
      { timeout: 90_000 },
    )
    .toBe("succeeded");
  await expect(panel.page.getByTestId("pn-code")).toBeVisible();
}

test("@native native Tests drawer: |>| opens and closes it, the counts and the test row are the server's, and the choice survives a reload", async ({
  openPanel,
  control,
}) => {
  await control.scenario("coding-answer");
  const panel = await openPanel({ auto: "off" });
  const { page } = panel;
  await codingTask(panel);

  // Closed by default: the handle says so, and nothing of the drawer is
  // reachable (it is hidden and inert).
  await expect(handle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(handle(page)).toHaveText("|>|");
  await expect(drawer(page)).toBeHidden();
  await expect(drawer(page)).toHaveAttribute("inert", "");

  await handle(page).click();

  await expect(handle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(handle(page)).toHaveText("|<|");
  await expect(drawer(page)).toBeVisible();
  // The counts: one generated test, passed (the real runner's report).
  const counts = drawer(page).getByRole("list", {
    name: "Tests: 1 of 1 passed",
  });
  await expect(counts).toContainText("Generated yes");
  await expect(counts).toContainText("Passed 1");
  await expect(counts).toContainText("Failed 0");
  await expect(counts).toContainText("Skipped 0");
  // One row for the one test, named as the runner reported it, saying which
  // constraint it covers; and the honest line that passing is not verification.
  const rows = drawer(page).getByTestId("pn-test");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(SCRIPTED.testName);
  await expect(rows.first()).toContainText(
    "covers: a fixed number of requests per client in a sliding window",
  );
  await expect(rows.first()).toHaveAttribute("data-status", "passed");
  await expect(drawer(page).getByTestId("pn-tests-honesty")).toHaveText(
    "Generated tests passing is not full verification.",
  );
  await expect(drawer(page).getByTestId("pn-tests-notverified")).toHaveCount(0);
  await testsFile(page).click();
  await expect(
    page.getByRole("textbox", { name: "Generated test source" }),
  ).toContainText(`it("${SCRIPTED.testName}"`);

  // The choice is the viewer's own and survives a reload.
  await panel.reload();
  await expect(handle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(drawer(page)).toBeVisible();

  await handle(page).click();
  await expect(handle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(drawer(page)).toBeHidden();
  await panel.reload();
  await expect(handle(page)).toHaveAttribute("aria-expanded", "false");
});

test("@native native Tests drawer Copy tests: the clipboard holds the generated test source the runner ran", async ({
  openPanel,
  control,
  browserName,
}) => {
  await control.scenario("coding-answer");
  const panel = await openPanel({ auto: "off" });
  test.skip(
    browserName === "webkit",
    "Playwright cannot grant clipboard permissions in WebKit; Chromium proves the clipboard",
  );
  await panel.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await codingTask(panel);
  // The Tests file is shown; the panel's Copy puts the shown file on the
  // clipboard.
  await testsFile(panel.page).click();

  await panel.page.getByRole("button", { name: "Copy code" }).click();

  await expect(
    panel.page.getByRole("button", { name: "Copied" }).first(),
  ).toBeVisible();
  const copied = await panel.page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(copied).toContain('import { expect, it } from "vitest";');
  expect(copied).toContain(`it("${SCRIPTED.testName}"`);
});

test("@native native Code pane: a clean real run shows Fully verified, and Copy code puts the solution on the clipboard", async ({
  openPanel,
  control,
  browserName,
}) => {
  await control.scenario("coding-answer");
  const panel = await openPanel({ auto: "off" });
  test.skip(
    browserName === "webkit",
    "Playwright cannot grant clipboard permissions in WebKit; Chromium proves the clipboard",
  );
  await panel.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { page } = panel;
  await codingTask(panel);

  const badges = page.getByRole("list", {
    name: "What is established about this code",
  });
  await expect(badges).toContainText("Generated");
  await expect(badges).toContainText("1/1 generated tests");
  await expect(badges).toContainText("Fully verified");
  await expect(page.getByTestId("pn-code-reasons")).toHaveCount(0);
  await expect(page.getByTestId("pn-language")).toHaveText("TYPESCRIPT");
  await expect(page.getByRole("textbox", { name: "Solution" })).toContainText(
    "export const allow = (n: number): boolean => n > 0;",
  );

  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(
    page.getByRole("button", { name: "Copied" }).first(),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "export const allow = (n: number): boolean => n > 0; // rev 1",
  );
});

test("@native native Code pane with a failing generated test: Not fully verified, the drawer lists the failed test with the runner's own message, and the one repair is named", async ({
  openPanel,
  control,
}) => {
  await control.scenario("coding-failing-tests");
  const panel = await openPanel({ auto: "off" });
  const { page } = panel;
  await codingTask(panel);

  const badges = page.getByRole("list", {
    name: "What is established about this code",
  });
  await expect(badges).toContainText("0/1 generated tests");
  await expect(badges).toContainText("Not fully verified");
  await expect(badges).not.toContainText(/^Fully verified/);
  await expect(page.getByTestId("pn-code-reasons")).toContainText(
    "Not fully verified: The test run ended with an error. A test failed.",
  );
  await expect(page.getByTestId("pn-code-repair")).toHaveText(
    "Repair attempted",
  );
  // The model was asked for the solution and then, once, for the repair.
  expect(
    (await control.calls()).filter((call) => call.stage === "solve"),
  ).toHaveLength(2);

  await handle(page).click();
  const counts = drawer(page).getByRole("list", {
    name: "Tests: 0 of 1 passed",
  });
  await expect(counts).toContainText("Passed 0");
  await expect(counts).toContainText("Failed 1");
  const row = drawer(page).getByTestId("pn-test");
  await expect(row).toHaveAttribute("data-status", "failed");
  await expect(row).toContainText(SCRIPTED.failingTestName);
  await expect(row).toContainText(SCRIPTED.failureMessage);
  await expect(drawer(page).getByTestId("pn-tests-notverified")).toContainText(
    "A test failed.",
  );
  // The failure links to the line of the test that failed.
  await expect(
    row.getByRole("button", { name: /^Go to line \d+ \(tests\)$/ }),
  ).toBeVisible();
  // Following it marks the failing line of the generated test source.
  await expect(page.locator(".pn-line-hit")).toHaveCount(0);
  await row.getByRole("button", { name: /^Go to line \d+ \(tests\)$/ }).click();
  await expect(page.locator(".pn-line-hit")).toHaveCount(1);
});

test("@native native Code pane with a syntax error: the syntax check's problem is listed with its line, and Fully verified is not claimed", async ({
  openPanel,
  control,
}) => {
  await control.scenario("coding-syntax-error");
  const panel = await openPanel({ auto: "off" });
  const { page } = panel;
  await codingTask(panel);

  const problems = page.getByRole("region", { name: "Problems" });
  await expect(problems).toBeVisible();
  await expect(problems).toContainText("',' expected.");
  const line = problems.getByRole("button", { name: /^Line 1:\d+$/ });
  await expect(line).toBeVisible();
  await expect(page.getByTestId("pn-code-reasons")).toContainText(
    "The syntax check found problems.",
  );
  await expect(
    page.getByRole("list", { name: "What is established about this code" }),
  ).not.toContainText(/^Fully verified/);
  // The link marks that line in the solution (the editor scrolls to it).
  await expect(page.locator(".pn-line-hit")).toHaveCount(0);
  await line.click();
  await expect(page.locator(".pn-line-hit")).toHaveCount(1);
  await expect(page.locator(".pn-line-hit")).toContainText(
    "export const allow",
  );
});

test("@native native Copy answer: the clipboard holds the approach the pane shows, and the button says Copied only after the write", async ({
  openPanel,
  control,
  browserName,
}) => {
  await control.scenario("plain-answer");
  const { id: sessionId, response } = await startSessionViaApi();
  const panel = await openPanel({ auto: "off", sessionId });
  test.skip(
    browserName === "webkit",
    "Playwright cannot grant clipboard permissions in WebKit; Chromium proves the clipboard",
  );
  await panel.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { page } = panel;
  await say(response.credential.value, "What is a closure in JavaScript?");
  await settled(sessionId, 1);
  await expect(page.getByRole("button", { name: "Copy answer" })).toBeVisible();

  await page.getByRole("button", { name: "Copy answer" }).click();

  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(SCRIPTED.plain);
  // It settles back to Copy answer by itself.
  await expect(page.getByRole("button", { name: "Copy answer" })).toBeVisible();
});

for (const [scenario, text] of [
  ["withheld-preference", SCRIPTED.preferenceOnly],
  ["withheld-figure", SCRIPTED.ungroundedFigure],
] as const) {
  test(`@native native withheld draft (${scenario}): the answer pane says it was stopped in the guard's words and the draft is never shown`, async ({
    openPanel,
    control,
  }) => {
    await control.scenario(scenario);
    const { id: sessionId, response } = await startSessionViaApi();
    const { page } = await openPanel({ auto: "off", sessionId });

    await say(response.credential.value, "What salary do you expect?");

    await expect(page.getByTestId("pn-no-answer")).toContainText(
      "It could not be checked against your approved experience, so nothing was published.",
    );
    await expect(page.getByTestId("pn-no-answer")).toContainText("Flagged:");
    await expect(page.getByText(text)).toHaveCount(0);
    const [action] = await settled(sessionId, 1);
    expect(action).toMatchObject({ shown: false });
    expect((await db.session(sessionId))?.shown_draft_count).toBe(0);
  });
}

test("@native native model refusal: the answer pane says the step was refused, and nothing is published or retried", async ({
  openPanel,
  control,
}) => {
  await control.scenario("refusal");
  const { id: sessionId, response } = await startSessionViaApi();
  const { page } = await openPanel({ auto: "off", sessionId });

  await say(response.credential.value, "What is a closure in JavaScript?");

  await expect(page.getByTestId("pn-no-answer")).toBeVisible();
  const [action] = await settled(sessionId, 1);
  expect(action).toMatchObject({ shown: false });
  expect(action?.dispatch_status).not.toBe("succeeded");
  expect(await control.calls()).toHaveLength(1);
  await expect(page.getByText(SCRIPTED.plain)).toHaveCount(0);
});

test("@native native provider failure: the pane says the answer stopped, nothing is published, and the next question is answered", async ({
  openPanel,
  control,
}) => {
  await control.scenario("provider-failure");
  const { id: sessionId, response } = await startSessionViaApi();
  const { page } = await openPanel({ auto: "off", sessionId });

  await say(response.credential.value, "What is a closure in JavaScript?");

  await expect(page.getByTestId("pn-no-answer")).toContainText("Stopped");
  const [action] = await settled(sessionId, 1);
  expect(action).toMatchObject({ shown: false });
  await expect(page.getByText(SCRIPTED.plain)).toHaveCount(0);

  await control.scenario("plain-answer");
  await say(response.credential.value, "What is the event loop?");
  await expect(page.getByText(SCRIPTED.plain).first()).toBeVisible();
});

test("@native native model timeout: the attempt is retried, and when it keeps timing out the pane says the answer stopped with nothing published", async ({
  openPanel,
  control,
}) => {
  await control.scenario("timeout");
  const { id: sessionId, response } = await startSessionViaApi();
  const { page } = await openPanel({ auto: "off", sessionId });

  await say(response.credential.value, "What is a closure in JavaScript?");

  await expect(page.getByTestId("pn-no-answer")).toContainText("Stopped", {
    timeout: 60_000,
  });
  expect((await control.calls()).length).toBeGreaterThan(1);
  expect((await db.actions(sessionId)).every((a) => a.shown === false)).toBe(
    true,
  );
  await expect(page.getByText(SCRIPTED.plain)).toHaveCount(0);
});
