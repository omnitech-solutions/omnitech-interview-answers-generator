// Revisions (D34): a task has ONE row and a list of revisions. A follow-up, a
// regenerate or an added screenshot makes a new revision of the SAME task; the
// Revisions control lists them newest first with the current one marked and the
// older ones Outdated; choosing one is view-only and swaps the answer, the code
// AND the task's one chat or transcript row, while a follow-up still goes to the
// current revision. Every claim is read from the server too: the same task id
// with revision + 1, never a second row.
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/panel-test";
import { startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { say, settled, taskIdsOf } from "../src/helpers/tasks";
import { draftFor, SCRIPTED } from "../src/stack/scenarios";

const QUESTION = "What is a closure in JavaScript?";
const REV1 = SCRIPTED.plain;
const REV2 = draftFor(SCRIPTED.plain, 2);

const rev = (page: Page, n: number) => page.getByTestId(`revision-${n}`);

test("web Revisions: newest first with the current one marked and older ones Outdated; choosing rev 1 swaps the answer, the task line and the one transcript row; a follow-up still goes to rev 2", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("plain-answer");
  const started = await startSessionViaApi();
  await live.goto();
  await live.useManual();
  await say(started.response.credential.value, QUESTION);
  await expect(live.task(1)).toContainText(REV1);
  const first = await settled(started.id, 1);
  const taskId = taskIdsOf(first)[0] as string;

  // One revision: nothing to choose, so no control.
  await expect(page.getByTestId("revisions-button")).toHaveCount(0);

  // A follow-up: revision 2 of the SAME task (never a second task).
  await live.followUp().fill("Please add an example.");
  await live.sendFollowUp().click();
  await expect(live.task(1)).toContainText(REV2);
  await expect
    .poll(async () =>
      (await db.actions(started.id))
        .filter((a) => a.task_id === taskId && a.action_kind === "draft-answer")
        .map((a) => a.task_revision),
    )
    .toEqual([1, 2]);
  expect(taskIdsOf(await db.actions(started.id))).toEqual([taskId]);

  const button = page.getByTestId("revisions-button");
  await expect(button).toHaveAccessibleName("Revisions: rev 2 of 2");
  await button.click();
  const menu = page.getByRole("menu", { name: "Revisions" });
  await expect(menu).toBeVisible();
  const items = menu.getByRole("menuitemradio");
  await expect(items).toHaveCount(2);
  // Newest first: rev 2 (current, selected), then rev 1 (outdated).
  await expect(items.nth(0)).toContainText("rev 2 · Current");
  await expect(items.nth(0)).toHaveAttribute("aria-checked", "true");
  await expect(items.nth(1)).toContainText("rev 1 · Outdated");
  await expect(items.nth(1)).toHaveAttribute("aria-checked", "false");
  await expect(items.nth(1)).toContainText("First answer");
  await expect(items.nth(0)).toContainText("Follow-up");

  // Escape closes it and gives the focus back to the button.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();

  // Choose rev 1: the answer on show is rev 1's, the line says which revision
  // it is and which is current.
  await button.click();
  await rev(page, 1).click();
  await expect(menu).toBeHidden();
  await expect(live.task(1)).toContainText(REV1);
  await expect(live.task(1)).not.toContainText(REV2);
  await expect(live.task(1)).toContainText("rev 1 of 2");
  await expect(page.getByTestId("earlier-revision")).toHaveText(
    "Viewing an earlier revision. The current one is rev 2.",
  );
  // Viewing is not changing: the server still has the same two revisions and
  // the follow-up box says where a message would really go.
  await expect(page.getByTestId("ov-followup-note")).toHaveText(
    "Follow-up goes to rev 2",
  );
  expect(
    (await db.actions(started.id)).map((a) => [a.task_id, a.task_revision]),
  ).toEqual(
    first.map((a) => [a.task_id, a.task_revision]).concat([[taskId, 2]]),
  );

  // The transcript has ONE row for the task, and it shows rev 1's text.
  await page.getByRole("tab", { name: "Transcript" }).click();
  const rows = page.locator(`[data-task-row="${taskId}"]`);
  await expect(rows).toHaveCount(1);
  await expect(rows.getByTestId("task-row-text")).toHaveText(REV1);
  await expect(rows.getByTestId("task-row-rev")).toContainText(
    "rev 1 of 2 · First answer",
  );

  // Back to the current revision: everything follows and the note goes.
  await button.click();
  await rev(page, 2).click();
  await expect(live.task(1)).toContainText(REV2);
  await expect(page.getByTestId("earlier-revision")).toHaveCount(0);
  await expect(page.getByTestId("ov-followup-note")).toHaveCount(0);
  await expect(rows).toHaveCount(1);
  await expect(rows.getByTestId("task-row-text")).toHaveText(REV2);
});

test("web Revisions of a coding task: choosing rev 1 shows rev 1's code and rev 2's returns, each from the revision's own solution", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("coding-answer");
  const started = await startSessionViaApi();
  await live.goto();
  await live.useManual();
  await say(
    started.response.credential.value,
    "How would you implement a sliding window rate limiter?",
  );
  await expect(live.task(1)).toBeVisible();
  const solved = (n: number) =>
    expect
      .poll(
        async () =>
          (await db.actions(started.id)).filter(
            (a) =>
              a.action_kind === "solve-code" &&
              a.dispatch_status === "succeeded",
          ).length,
        { timeout: 90_000 },
      )
      .toBe(n);
  await solved(1);

  await live.followUp().fill("Make the window configurable.");
  await live.sendFollowUp().click();
  await solved(2);
  await expect(page.getByTestId("revisions-button")).toHaveAccessibleName(
    "Revisions: rev 2 of 2",
  );

  const editor = () =>
    page.getByRole("tabpanel", { name: "Code" }).getByRole("textbox").first();
  await page.getByRole("tab", { name: "Code" }).click();
  await expect(editor()).toContainText("// rev 2");
  await expect(editor()).not.toContainText("// rev 1");

  await page.getByTestId("revisions-button").click();
  await rev(page, 1).click();
  // Choosing a revision shows the task at that revision on its Answer view.
  await page.getByRole("tab", { name: "Code" }).click();
  await expect(editor()).toContainText("// rev 1");
  await expect(editor()).not.toContainText("// rev 2");

  await page.getByTestId("revisions-button").click();
  await rev(page, 2).click();
  // Choosing a revision shows the task at that revision on its Answer view.
  await page.getByRole("tab", { name: "Code" }).click();
  await expect(editor()).toContainText("// rev 2");
});

test("web regenerate with nothing staged: Apply asks the model again for the SAME task (revision 2, no image) and marks the first answer Outdated", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("plain-answer");
  const started = await startSessionViaApi();
  await live.goto();
  await live.useManual();
  await say(started.response.credential.value, QUESTION);
  await expect(live.task(1)).toContainText(REV1);
  const first = await settled(started.id, 1);
  const taskId = taskIdsOf(first)[0] as string;

  // Open the screenshots area: with a task and nothing staged it says what
  // Apply would do, and Apply is enabled (regenerate needs no new context).
  await expect(live.screenshotsToggle()).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByTestId("tray-sends")).toHaveText(
    "Nothing staged. Apply regenerates without new context.",
  );
  await expect(live.apply()).toBeEnabled();
  const before = (await control.calls()).length;

  await live.apply().click();

  await expect(live.task(1)).toContainText(REV2);
  await expect
    .poll(async () => (await control.calls()).length)
    .toBe(before + 1);
  const call = (await control.calls())[before];
  expect(call).toMatchObject({ stage: "assist", revision: 2, images: 0 });
  expect(call?.taskId).toBe(taskId);
  const actions = await db.actions(started.id);
  expect(taskIdsOf(actions)).toEqual([taskId]);
  expect(
    actions
      .filter((a) => a.action_kind === "draft-answer")
      .map((a) => a.task_revision),
  ).toEqual([1, 2]);
  await page.getByTestId("revisions-button").click();
  await expect(rev(page, 1)).toContainText("Outdated");
  await expect(rev(page, 2)).toContainText("Current");
});

test("@native native Revisions: the control lists revisions newest first, choosing rev 1 swaps the answer and the task's ONE chat row, and the message box says the follow-up goes to rev 2", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const started = await startSessionViaApi();
  const { page } = await openPanel({ auto: "off", sessionId: started.id });
  await say(started.response.credential.value, QUESTION);
  const first = await settled(started.id, 1);
  const taskId = taskIdsOf(first)[0] as string;
  const chatRow = page.getByRole("button", { name: /^Studio · T1/ });
  await expect(chatRow).toContainText(REV1);
  // One revision: nothing to choose.
  await expect(page.getByTestId("revisions-button")).toHaveCount(0);

  await page.getByRole("textbox", { name: "Message" }).fill("Add an example.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(chatRow).toContainText(REV2);
  await expect
    .poll(async () =>
      (await db.actions(started.id))
        .filter((a) => a.task_id === taskId && a.action_kind === "draft-answer")
        .map((a) => a.task_revision),
    )
    .toEqual([1, 2]);
  expect(taskIdsOf(await db.actions(started.id))).toEqual([taskId]);

  const button = page.getByTestId("revisions-button");
  await expect(button).toHaveAccessibleName("Revisions: rev 2 of 2");
  await button.click();
  const items = page
    .getByRole("menu", { name: "Revisions" })
    .getByRole("menuitemradio");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("rev 2 · Current");
  await expect(items.nth(1)).toContainText("rev 1 · Outdated");
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();

  await button.click();
  await rev(page, 1).click();
  await expect(page.getByTestId("pn-earlier-revision")).toHaveText(
    "viewing an earlier revision · current is rev 2",
  );
  // The answer pane and the chat's one row both show rev 1 now.
  const answerPane = page.getByRole("region", { name: "Answer", exact: true });
  await expect(answerPane).toContainText(REV1);
  await expect(answerPane).not.toContainText(REV2);
  await expect(chatRow).toContainText(REV1);
  await expect(chatRow).not.toContainText(REV2);
  await expect(page.getByRole("button", { name: /^Studio · T1/ })).toHaveCount(
    1,
  );
  await expect(page.getByTestId("pn-followup-note")).toHaveText(
    "Follow-up goes to rev 2",
  );
  // A message sent now still revises the CURRENT revision: rev 3.
  await page.getByRole("textbox", { name: "Message" }).fill("One more detail.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect
    .poll(async () =>
      (await db.actions(started.id)).some(
        (a) => a.task_id === taskId && a.task_revision === 3,
      ),
    )
    .toBe(true);
  expect(taskIdsOf(await db.actions(started.id))).toEqual([taskId]);

  // Choosing the current revision again clears the note.
  await expect(button).toHaveAccessibleName(/^Revisions: rev \d of 3$/);
  await button.click();
  await rev(page, 3).click();
  await expect(page.getByTestId("pn-earlier-revision")).toHaveCount(0);
  await expect(page.getByTestId("pn-followup-note")).toHaveCount(0);
});

test("@native native Revisions of a coding task: the Code pane shows each revision's own solution and its tests", async ({
  openPanel,
  control,
}) => {
  await control.scenario("coding-answer");
  const started = await startSessionViaApi();
  const { page } = await openPanel({ auto: "off", sessionId: started.id });
  await say(
    started.response.credential.value,
    "How would you implement a sliding window rate limiter?",
  );
  const solved = (n: number) =>
    expect
      .poll(
        async () =>
          (await db.actions(started.id)).filter(
            (a) =>
              a.action_kind === "solve-code" &&
              a.dispatch_status === "succeeded",
          ).length,
        { timeout: 90_000 },
      )
      .toBe(n);
  await solved(1);
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("Make it configurable.");
  await page.getByRole("button", { name: "Send message" }).click();
  await solved(2);
  const solution = page.getByRole("textbox", { name: "Solution" });
  await expect(solution).toContainText("// rev 2");

  await page.getByTestId("revisions-button").click();
  await rev(page, 1).click();
  await expect(solution).toContainText("// rev 1");
  await expect(solution).not.toContainText("// rev 2");
  await page.getByTestId("revisions-button").click();
  await rev(page, 2).click();
  await expect(solution).toContainText("// rev 2");
});
