// The missing-context journey (T08, D36, T17b) on the web page and in the native
// panel. A capture whose scripted result says what the model could not see shows
// the strip ("The AI may be missing: ..."); its three actions are proven by their
// effects: Add context focuses the follow-up box, Add another screenshot STAGES a
// capture for the task on show and Apply makes the next revision of THAT task,
// Looks complete hides the strip for that revision and keeps it hidden across a
// reload. A follow-up goes to the task on show, not the newest. A draft the
// guards withheld says so in fixed words, and a follow-up recovers it.
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/panel-test";
import { startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { say, settled, taskIdsOf } from "../src/helpers/tasks";
import { SCRIPTED } from "../src/stack/scenarios";

const QUESTION = "What is a closure in JavaScript?";
const SECOND = "What is the event loop?";

const strip = (page: Page) => page.getByTestId("missing-context");
const action = (page: Page, name: string) =>
  strip(page).getByRole("button", { name, exact: true });

async function expectStrip(page: Page) {
  await expect(strip(page)).toBeVisible();
  await expect(strip(page)).toContainText("The AI may be missing:");
  await expect(strip(page)).toContainText(
    `Constraints: ${SCRIPTED.missingNotes.constraints}`,
  );
  await expect(strip(page)).toContainText(
    `Examples: ${SCRIPTED.missingNotes.examples}`,
  );
}

const revisionsOf = (
  actions: Awaited<ReturnType<typeof db.actions>>,
  taskId: string,
) =>
  actions
    .filter((a) => a.task_id === taskId && a.action_kind === "draft-answer")
    .map((a) => a.task_revision);

// ---- web ------------------------------------------------------------------

for (const [scenario, flag] of [
  ["withheld-preference", "pay, notice or availability"],
  ["withheld-figure", "a number in the draft isn't in your experience"],
] as const) {
  test(`web withheld draft (${scenario}): says it was withheld in fixed words, shows no strip`, async ({
    live,
    control,
    page,
  }) => {
    await control.scenario(scenario);
    const started = await startSessionViaApi();
    await page.goto(`${live.livePath()}/${started.id}`);
    await say(started.response.credential.value, QUESTION);
    const notice = page.getByTestId("run-notice").first();
    await expect(notice).toContainText("Draft withheld.");
    await expect(notice).toContainText(flag);
    await expect(strip(page)).toHaveCount(0);
    const [withheld] = await settled(started.id, 1);
    expect(withheld).toMatchObject({ shown: false });
  });
}

// ---- native ---------------------------------------------------------------

const message = (page: Page) => page.getByRole("textbox", { name: "Message" });

test("@native native missing context: the strip, Add context focus, Add another screenshot staged then Apply as revision 2 of the same task", async ({
  openPanel,
  control,
}) => {
  await control.scenario("missing-context");
  const { page, id, analyze } = await openPanel({ auto: "off" });
  await analyze.click();
  await page.getByTestId("apply-screenshots").click();
  await expectStrip(page);
  const first = await settled(id, 1);
  const taskId = taskIdsOf(first)[0] as string;

  await action(page, "Add context").click();
  await expect(message(page)).toBeFocused();

  const callsBefore = (await control.calls()).length;
  await control.scenario("plain-answer");
  await action(page, "Add another screenshot").click();
  await expect(page.getByTestId("staged-1")).toContainText("Not sent yet");
  expect((await control.calls()).length).toBe(callsBefore);
  await page.getByTestId("apply-screenshots").click();
  await expect
    .poll(async () => revisionsOf(await db.actions(id), taskId))
    .toContain(2);
  await expect
    .poll(async () => (await control.calls()).length)
    .toBeGreaterThan(callsBefore);
  expect((await control.calls())[callsBefore]).toMatchObject({
    revision: 2,
    images: 2,
  });
  await expect(strip(page)).toHaveCount(0);
});

test("@native native missing context Looks complete: hides the strip, it stays hidden after a reload, and a follow-up to an earlier task revises that task", async ({
  openPanel,
  control,
}) => {
  const started = await startSessionViaApi();
  const panel = await openPanel({ auto: "off", sessionId: started.id });
  const { page, id } = panel;
  await control.scenario("missing-context", { once: true });
  await say(started.response.credential.value, QUESTION);
  await expectStrip(page);
  await control.scenario("plain-answer");
  await say(started.response.credential.value, SECOND);
  const both = await settled(id, 2);
  const [earlier, newest] = taskIdsOf(both) as [string, string];
  await expect(strip(page)).toHaveCount(0);

  await page.getByRole("button", { name: /^T1 · / }).click();
  await expectStrip(page);
  await message(page).fill("The constraint is N up to 1000.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect
    .poll(async () => revisionsOf(await db.actions(id), earlier))
    .toContain(2);
  expect(revisionsOf(await db.actions(id), newest)).toEqual([1]);

  await settled(id, 2);
  await expect(strip(page)).toHaveCount(0);
  // The scripted plain answer cleared revision 2's strip; make revision 3 missing
  // again, dismiss it, and reload.
  await control.scenario("missing-context");
  await message(page).fill("Another detail.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expectStrip(page);
  await action(page, "Looks complete").click();
  await expect(strip(page)).toHaveCount(0);
  await panel.reload();
  await page.getByRole("button", { name: /^T1 · / }).click();
  await expect(strip(page)).toHaveCount(0);
});

for (const scenario of ["withheld-preference", "withheld-figure"] as const) {
  test(`@native native withheld draft (${scenario}): no strip, and a follow-up recovers a shown answer`, async ({
    openPanel,
    control,
  }) => {
    await control.scenario(scenario);
    const started = await startSessionViaApi();
    const { page, id } = await openPanel({
      auto: "off",
      sessionId: started.id,
    });
    await say(started.response.credential.value, QUESTION);
    const [withheld] = await settled(id, 1);
    expect(withheld).toMatchObject({ shown: false });
    await expect(strip(page)).toHaveCount(0);

    await control.scenario("plain-answer");
    await message(page).fill("Please add a short example.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(SCRIPTED.plain).first()).toBeVisible();
    await expect
      .poll(async () => (await db.actions(id)).some((a) => a.shown))
      .toBe(true);
  });
}
