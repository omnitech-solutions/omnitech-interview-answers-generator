// The missing-context journey (T08, D36, T17b) on the web page and in the native
// panel. A capture whose scripted result says what the model could not see shows
// the strip ("The AI may be missing: ..."); its three actions are proven by their
// effects: Add context opens a field in the strip itself (never the composer),
// Add another screenshot STAGES a capture for the task on show and Apply makes
// the next revision of THAT task, Looks complete hides what was named for that
// revision and keeps it hidden across a reload. In the native panel the strip is
// always offered ("Did AI miss anything?" when nothing was named). A follow-up
// goes to the task on show, not the newest. A draft the guards reject a sentence
// of is still shown (grounding by subtraction), and a follow-up revises it.
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/panel-test";
import { startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { chooseProblem } from "../src/helpers/task-bar";
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

// The native strip with nothing named: the question is still offered, the
// warning is not.
async function expectNothingMissing(page: Page) {
  await expect(strip(page)).toBeVisible();
  await expect(strip(page)).toContainText("Did AI miss anything?");
  await expect(strip(page)).not.toContainText("The AI may be missing:");
  await expect(strip(page)).not.toHaveAttribute("data-missing");
}

const revisionsOf = (
  actions: Awaited<ReturnType<typeof db.actions>>,
  taskId: string,
) =>
  actions
    .filter((a) => a.task_id === taskId && a.action_kind === "draft-answer")
    .map((a) => a.task_revision);

// ---- web ------------------------------------------------------------------

// Grounding by subtraction (2026-10-07): the sentence the guard rejects is
// dropped, the rest of the draft is shown, nothing is withheld and no strip
// is drawn (the model named nothing missing).
for (const [scenario, text] of [
  ["withheld-preference", SCRIPTED.preferenceOnly],
  ["withheld-figure", SCRIPTED.ungroundedFigure],
] as const) {
  test(`web grounded draft (${scenario}): the rest of the draft is shown, nothing is withheld, and there is no strip`, async ({
    live,
    control,
    page,
  }) => {
    await control.scenario(scenario);
    const started = await startSessionViaApi();
    await page.goto(`${live.livePath()}/${started.id}`);
    await say(started.response.credential.value, QUESTION);
    await expect(live.task(1)).toContainText(SCRIPTED.plain);
    await expect(page.getByText(text)).toHaveCount(0);
    await expect(
      page.getByTestId("run-notice").filter({ hasText: "Draft withheld" }),
    ).toHaveCount(0);
    await expect(strip(page)).toHaveCount(0);
    const [shown] = await settled(started.id, 1);
    expect(shown).toMatchObject({ shown: true, dispatch_status: "succeeded" });
  });
}

// ---- native ---------------------------------------------------------------

const message = (page: Page) => page.getByRole("textbox", { name: "Message" });

test("@native native missing context: the strip, Add context opens a field in the strip, Add another screenshot staged then Apply as revision 2 of the same task", async ({
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

  // Add context opens a field right in the strip and the composer is left
  // alone; it is focused and ready for the words.
  await action(page, "Add context").click();
  const form = page.getByTestId("missing-context-form");
  await expect(form).toBeVisible();
  await expect(
    form.getByRole("textbox", { name: "Context for this problem" }),
  ).toBeFocused();
  await expect(message(page)).not.toBeFocused();

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
  // The plain answer named nothing missing: the strip is the question again.
  await settled(id, 1);
  await expectNothingMissing(page);
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
  // T2 is on show, and it named nothing.
  await expect(page.getByTestId("pn-problem-button")).toHaveText(/^T2 · /);
  await expectNothingMissing(page);

  // Back to T1 through the Problem menu: its strip still names what it
  // missed, and a follow-up revises T1, not the newest task.
  await chooseProblem(page, /^T1 · /);
  await expectStrip(page);
  await message(page).fill("The constraint is N up to 1000.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect
    .poll(async () => revisionsOf(await db.actions(id), earlier))
    .toContain(2);
  expect(revisionsOf(await db.actions(id), newest)).toEqual([1]);

  await settled(id, 2);
  await expectNothingMissing(page);
  // The scripted plain answer cleared revision 2's strip; make revision 3 missing
  // again, dismiss it, and reload.
  await control.scenario("missing-context");
  await message(page).fill("Another detail.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expectStrip(page);
  await action(page, "Looks complete").click();
  await expectNothingMissing(page);
  await panel.reload();
  await chooseProblem(page, /^T1 · /);
  await expectNothingMissing(page);
});

// Grounding by subtraction: the draft is shown without the sentence the guard
// rejected, nothing is named missing, and a follow-up revises it as usual.
for (const [scenario, text] of [
  ["withheld-preference", SCRIPTED.preferenceOnly],
  ["withheld-figure", SCRIPTED.ungroundedFigure],
] as const) {
  test(`@native native grounded draft (${scenario}): shown without the rejected sentence, nothing missing, and a follow-up revises it`, async ({
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
    const [shown] = await settled(id, 1);
    expect(shown).toMatchObject({ shown: true, dispatch_status: "succeeded" });
    await expect(page.getByText(SCRIPTED.plain).first()).toBeVisible();
    await expect(page.getByText(text)).toHaveCount(0);
    await expectNothingMissing(page);

    await control.scenario("plain-answer");
    await message(page).fill("Please add a short example.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect
      .poll(async () =>
        (await db.actions(id))
          .filter((a) => a.shown)
          .map((a) => a.task_revision),
      )
      .toEqual([1, 2]);
  });
}
