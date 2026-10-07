// A capture with no interview question (D36) is a NOTE, never a task: no T
// number, no chip, no answer bubble. The server still holds the capture and its
// result (category no-question); the page says so in one muted line, three or
// more in a row collapse into one, Back goes to the newest REAL task, Auto holds
// after one until the screen really changes, and Manual never holds.
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/panel-test";
import { startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { say, settled, taskIdsOf } from "../src/helpers/tasks";

const NOTE = (n: number) => `S${n} captured: no question found`;
// In the native chat a capture with no question is an event line of the
// transcript, one per capture: "S1 · no question found · 14:05".
const EVENT = (n: number) => `S${n} · no question found`;
const markers = (page: Page) =>
  page
    .getByTestId("pn-chat")
    .locator('[data-slot="transcript-event"]')
    .filter({ hasText: "no question found" });
const AUTO_LINE =
  "No question on screen. Auto is holding until the screen changes.";
const MANUAL_LINE = "No question found in the last capture.";

// Eight row flags -> a known difference hash (see the shim). Flipping one row
// moves the hash 8 bits (Auto's hold applies below 16), three rows 24 bits.
const BASE = Array.from({ length: 8 }, () => true);
const flip = (rows: number[]) =>
  BASE.map((on, row) => (rows.includes(row) ? !on : on));

const answers = async (id: string) =>
  (await db.actionCategories(id)).filter((category) => category !== null);

// The web page: a share, then a capture that sends now (the menu choice).
async function _captureViaMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Capture & analyze/ }).click();
  await page
    .getByRole("menuitem", { name: /^New task from a fresh capture/ })
    .click();
}

test("@native native no-question in Manual: the pane says what the last capture found, the chat gets a note, there is no task; a manual capture is always posted (Manual never holds)", async ({
  openPanel,
  control,
}) => {
  await control.scenario("no-question");
  const { page, id, analyze, host } = await openPanel({ auto: "off" });
  const apply = page.getByTestId("apply-screenshots");

  await analyze.click();
  await apply.click();

  await expect(page.getByTestId("pn-no-question")).toHaveText(MANUAL_LINE);
  await expect.poll(async () => await answers(id)).toEqual(["no-question"]);
  const marker = markers(page);
  await expect(marker).toHaveCount(1);
  await expect(marker).toContainText(EVENT(1));
  // No task anywhere: no chat answer, no chip group, the empty pane.
  await expect(page.getByRole("button", { name: /^Studio · T/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("group", { name: "Tasks" })).toHaveCount(0);
  await expect(page.getByTestId("pn-analysis-empty")).toBeVisible();

  // Manual does not hold: a second press is a second capture, a second model
  // call and a second note; a third is a third (the transcript draws one event
  // per capture; the old "n captures with no question" collapse is not drawn).
  await analyze.click();
  await apply.click();
  await expect.poll(async () => (await control.calls()).length).toBe(2);
  await expect(marker).toHaveCount(2);
  await expect(marker).toContainText([EVENT(1), EVENT(2)]);
  await analyze.click();
  await apply.click();
  await expect.poll(async () => (await control.calls()).length).toBe(3);
  await expect(marker).toHaveCount(3);
  await expect(marker).toContainText([EVENT(1), EVENT(2), EVENT(3)]);
  expect((await host.calls("captureScreen")).length).toBe(3);

  // A real question after them is T1 (the notes took no number).
  await control.scenario("plain-answer");
  await analyze.click();
  await apply.click();
  await expect(
    page.getByRole("button", { name: /^Studio · T1/ }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Tasks" })).toHaveCount(0);
});

test("@native native no-question and Back: with an earlier task on show, a no-question capture leaves Back pointing at the newest real task", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const started = await startSessionViaApi();
  const { page, id, analyze } = await openPanel({
    auto: "off",
    sessionId: started.id,
  });
  const credential = started.response.credential.value;
  await say(credential, "What is a closure in JavaScript?");
  await settled(id, 1);
  await say(credential, "What is the event loop?");
  await settled(id, 2);
  await page
    .getByRole("group", { name: "Tasks" })
    .getByRole("button", { name: /^T1 · / })
    .click();
  await expect(page.getByTestId("pn-earlier")).toBeVisible();

  await control.scenario("no-question");
  await analyze.click();
  await page.getByTestId("apply-screenshots").click();
  await expect.poll(async () => (await answers(id)).at(-1)).toBe("no-question");

  // No third task or chip; Back says T2, and goes there.
  await expect(
    page.getByRole("group", { name: "Tasks" }).getByRole("button"),
  ).toHaveCount(2);
  const back = page.getByRole("button", { name: "Back to T2" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page.getByTestId("pn-task-line")).toContainText("T2");
  await expect(page.getByTestId("pn-earlier")).toHaveCount(0);
});

test("@native native Auto after a no-question capture: it holds through a small change and captures again only for a substantial one", async ({
  openPanel,
  control,
}) => {
  test.slow(); // waits out two Auto intervals (18 s under 4-shard load)
  await control.scenario("no-question");
  const { page, id, host } = await openPanel({ auto: "on" });
  await expect(page.getByText("Auto · watching the screen")).toBeVisible();
  await host.setFramePattern(BASE);

  // The first frame is always analysed; it shows no question.
  await host.fireScreenChange(40);
  await expect.poll(async () => (await control.calls()).length).toBe(1);
  await expect(page.getByTestId("pn-no-question")).toHaveText(AUTO_LINE);
  await expect.poll(async () => await answers(id)).toEqual(["no-question"]);
  expect(await db.actions(id).then(taskIdsOf)).toHaveLength(1);

  // A small change (one row of eight: 8 bits of 64) is a new frame, but Auto
  // holds: the shell is asked for the frame to compare, the model is not.
  await host.setFramePattern(flip([2]));
  const sampled = (await host.calls("captureScreen")).length;
  await host.fireScreenChange(12);
  await expect
    .poll(async () => (await host.calls("captureScreen")).length)
    .toBeGreaterThan(sampled);

  // A substantial change (three rows: 24 bits) is captured and analysed again.
  await host.setFramePattern(flip([1, 2, 3]));
  await host.fireScreenChange(40);
  // (Auto's rate limit may make it wait for its next check.)
  await expect
    .poll(async () => (await control.calls()).length, { timeout: 40_000 })
    .toBe(2);
  // Exactly two analyses in all: the small change never reached the model.
  await expect
    .poll(async () => await answers(id))
    .toEqual(["no-question", "no-question"]);
  await expect(page.getByTestId("pn-no-question")).toHaveText(AUTO_LINE);
  // Two captures, two events (the old row joined consecutive notes into one).
  await expect(markers(page)).toHaveCount(2);
});
