// Capture and tasks in the native panel, through the recording host shim: what
// Analyze, the hotkey intent and the Capture mode menu do (stage on the device
// versus send), how a typed or spoken question becomes a task, how the task
// chips, the Back control and the chat entries choose the task on show, and
// where a follow-up goes. The proof is a server row, a recorded model call, a
// recorded bridge call or a DOM change only that behaviour produces.
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/panel-test";
import { controlSession, startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { say, settled, taskIdsOf } from "../src/helpers/tasks";
import { SCRIPTED } from "../src/stack/scenarios";

const apply = (page: Page) => page.getByTestId("apply-screenshots");
const message = (page: Page) => page.getByRole("textbox", { name: "Message" });
const modeMenu = (page: Page) =>
  page.getByRole("button", { name: /^Capture mode:/ });

// One screenshot staged and applied: a NEW task from the toolbar's Analyze.
async function analyzeAndApply(panel: {
  page: Page;
  analyze: import("@playwright/test").Locator;
}) {
  await panel.analyze.click();
  await expect(apply(panel.page)).toBeEnabled();
  await apply(panel.page).click();
}

test("@native native Analyze screen in Manual: stages the screenshot on this device and nothing reaches the server or the model until Apply", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const { page, host, id, analyze } = await openPanel({ auto: "off" });

  await analyze.click();

  // The shell captured once and the tray holds it, marked as not sent...
  await expect
    .poll(async () => (await host.calls("captureScreen")).length)
    .toBe(1);
  await expect(
    page.getByRole("heading", { name: "To apply (1)" }),
  ).toBeVisible();
  await expect(page.getByTestId("staged-1")).toContainText("Not sent yet");
  // ...and nothing else happened: no model call, no stored screenshot, no action.
  expect(await control.calls()).toEqual([]);
  expect(
    (await db.observations(id)).filter((row) => row.kind === "screen.snapshot"),
  ).toEqual([]);
  expect(await db.actions(id)).toEqual([]);

  // Apply is what sends: one request, one image, one new task.
  await apply(page).click();
  await expect(page.getByText(SCRIPTED.plain).first()).toBeVisible();
  const calls = await control.calls();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ stage: "assist", images: 1 });
  const stored = (await db.observations(id)).filter(
    (row) => row.kind === "screen.snapshot" && row.screenshot_artifact_id,
  );
  expect(stored).toHaveLength(1);
  expect(taskIdsOf(await db.actions(id))).toHaveLength(1);
});

test("@native native hotkey capture.analyze: in Manual it stages, in Auto it sends at once", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const manual = await openPanel({ auto: "off" });
  await manual.host.clear();

  await manual.host.fireIntent("capture.analyze");

  await expect
    .poll(async () => (await manual.host.calls("captureScreen")).length)
    .toBe(1);
  await expect(manual.page.getByTestId("staged-1")).toBeVisible();
  expect(await control.calls()).toEqual([]);
  expect(await db.actions(manual.id)).toEqual([]);
  await manual.context.close();
  // One session is open at a time: end this one before the next panel's starts.
  await controlSession(manual.id, "end");

  // Auto: the same intent goes straight to the model (no tray to stage in).
  const auto = await openPanel({ auto: "on" });
  await expect(auto.page.getByText("Auto · watching the screen")).toBeVisible();
  const before = (await auto.host.calls("captureScreen")).length;
  await auto.host.fireIntent("capture.analyze");
  await expect
    .poll(async () => (await auto.host.calls("captureScreen")).length)
    .toBeGreaterThan(before);
  await expect
    .poll(async () => (await db.actions(auto.id)).map((a) => a.action_kind))
    .toContain("draft-answer");
  await expect(auto.page.getByTestId("staged-1")).toHaveCount(0);
  await expect.poll(async () => (await control.calls()).length).toBe(1);
  expect((await control.calls())[0]).toMatchObject({ images: 1 });
});

test("@native native Capture mode menu: Auto starts the shell's screen watch and a change makes a task; Manual stops it and a change does nothing", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const { page, host, id } = await openPanel({ auto: "off" });
  await expect(modeMenu(page)).toHaveText("Manual");
  await host.clear();

  // Manual: a changed screen is not captured.
  await host.fireScreenChange(40);
  expect(await host.calls("captureScreen")).toEqual([]);
  expect(await db.actions(id)).toEqual([]);

  // Choose Auto: the watch starts, the menu now says Auto, and a change is
  // captured and analysed as a new task.
  await modeMenu(page).click();
  await page.getByRole("menuitemradio", { name: /^Auto / }).click();
  await expect(modeMenu(page)).toHaveText("Auto");
  await expect
    .poll(async () => (await host.calls("screenWatchStart")).length)
    .toBeGreaterThan(0);
  await host.clear();
  await host.fireScreenChange(40);
  await expect
    .poll(async () => (await host.calls("captureScreen")).length)
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await db.actions(id)).map((a) => a.action_kind))
    .toContain("draft-answer");
  await expect(page.getByText(SCRIPTED.plain).first()).toBeVisible();

  // Back to Manual: the watch stops and the next change captures nothing.
  await modeMenu(page).click();
  await page.getByRole("menuitemradio", { name: /^Manual / }).click();
  await expect(modeMenu(page)).toHaveText("Manual");
  await expect
    .poll(async () => (await host.calls("screenWatchStop")).length)
    .toBeGreaterThan(0);
  await settled(id, 1);
  const captures = (await host.calls("captureScreen")).length;
  const actions = (await db.actions(id)).length;
  await host.fireScreenChange(40);
  expect((await host.calls("captureScreen")).length).toBe(captures);
  expect((await db.actions(id)).length).toBe(actions);
});

test("@native native Add screen to T1: disabled with its reason before any task, then stages an Add to T1 capture that Apply makes revision 2 of the same task", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const { page, id, analyze } = await openPanel({ auto: "off" });

  // Before any task the item is disabled and says why; pressing it does nothing.
  await modeMenu(page).click();
  const item = page.getByRole("menuitem", { name: /^Add screen to / });
  await expect(item).toHaveAttribute("aria-disabled", "true");
  await expect(item).toContainText("Needs a task first");
  await item.click({ force: true });
  expect(await db.actions(id)).toEqual([]);
  await page.keyboard.press("Escape");

  await analyzeAndApply({ page, analyze });
  const first = await settled(id, 1);
  const taskId = taskIdsOf(first)[0] as string;

  await modeMenu(page).click();
  const enabled = page.getByRole("menuitem", { name: "Add screen to T1" });
  await expect(enabled).not.toHaveAttribute("aria-disabled", "true");
  await enabled.click();

  // It staged an image for the SAME task (Add to T1 is the chosen intent) and
  // the server has not heard of it yet.
  await expect(page.getByTestId("staged-1")).toBeVisible();
  await expect(page.getByTestId("intent-add")).toBeChecked();
  expect((await db.actions(id)).length).toBe(first.length);
  await apply(page).click();
  await expect
    .poll(
      async () =>
        (await db.actions(id)).filter(
          (a) => a.task_id === taskId && a.task_revision === 2,
        ).length,
    )
    .toBeGreaterThan(0);
  expect(taskIdsOf(await db.actions(id))).toEqual([taskId]);
});

test("@native native typed question: Send message with no task starts a task; with a task on show it revises that task", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const { page, id } = await openPanel({ auto: "off" });
  const send = page.getByRole("button", { name: "Send message" });

  await expect(message(page)).toHaveAttribute(
    "placeholder",
    "Ask anything, or add context",
  );
  await message(page).fill("What is a closure in JavaScript?");
  await send.click();
  await expect(page.getByText(SCRIPTED.plain).first()).toBeVisible();
  const first = await settled(id, 1);
  const taskId = taskIdsOf(first)[0] as string;
  // The typed words are kept as the owner's input, not as a screenshot.
  expect((await db.observations(id)).map((row) => row.kind)).toContain(
    "owner.input",
  );

  // With the task on show the placeholder names it, and a second message is a
  // new revision of that same task.
  await expect(message(page)).toHaveAttribute(
    "placeholder",
    "Add context to T1, or ask a follow-up",
  );
  await message(page).fill("Add that it should be memory efficient.");
  await send.click();
  await expect
    .poll(async () =>
      (await db.actions(id)).some(
        (a) => a.task_id === taskId && a.task_revision === 2,
      ),
    )
    .toBe(true);
  expect(taskIdsOf(await db.actions(id))).toEqual([taskId]);
  await expect(message(page)).toHaveValue("");
});

test("@native native spoken question: a phrase the companion hears becomes a task and its answer shows in the chat", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const { id: sessionId, response } = await startSessionViaApi();
  const { page, id } = await openPanel({ auto: "off", sessionId });

  await say(response.credential.value, "What is a closure in JavaScript?");

  await expect(page.getByText(SCRIPTED.plain).first()).toBeVisible();
  const actions = await settled(id, 1);
  expect(actions.map((a) => a.action_kind)).toContain("draft-answer");
  // The heard words are in the chat log as the other side's, with their answer.
  await expect(
    page.getByRole("log", { name: "Transcript and chat" }),
  ).toContainText("Interviewer · app audio");
  await expect(
    page.getByRole("button", { name: /^Studio · T1/ }),
  ).toBeVisible();
});

test("@native native task chips and Back: choosing an earlier chip shows that task and names it, a follow-up goes to it, and Back returns to the newest", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const { id: sessionId, response } = await startSessionViaApi();
  const { page, id } = await openPanel({ auto: "off", sessionId });
  await say(response.credential.value, "What is a closure in JavaScript?");
  await settled(id, 1);
  await say(response.credential.value, "What is the event loop?");
  const both = await settled(id, 2);
  const [first, second] = taskIdsOf(both) as [string, string];

  const chips = page.getByRole("group", { name: "Tasks" });
  await expect(chips.getByRole("button")).toHaveCount(2);
  await expect(chips.getByRole("button", { name: /^T2 · / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Choose T1: it is the one on show, it is labelled earlier, and the message
  // box now names it.
  await chips.getByRole("button", { name: /^T1 · / }).click();
  await expect(chips.getByRole("button", { name: /^T1 · / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("pn-earlier")).toHaveText("earlier task");
  await expect(message(page)).toHaveAttribute(
    "placeholder",
    "Add context to T1, or ask a follow-up",
  );
  // A message now revises T1 (not the newest task).
  await message(page).fill("Add an example please.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect
    .poll(async () =>
      (await db.actions(id)).some(
        (a) => a.task_id === first && a.task_revision === 2,
      ),
    )
    .toBe(true);
  expect(
    (await db.actions(id)).some(
      (a) => a.task_id === second && a.task_revision === 2,
    ),
  ).toBe(false);

  // Back to T2 returns to the newest task.
  await page.getByRole("button", { name: "Back to T2" }).click();
  await expect(page.getByTestId("pn-earlier")).toHaveCount(0);
  await expect(chips.getByRole("button", { name: /^T2 · / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(message(page)).toHaveAttribute(
    "placeholder",
    "Add context to T2, or ask a follow-up",
  );
});

test("@native native chat entry: choosing an answer in the chat brings its task into the answer pane", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const { id: sessionId, response } = await startSessionViaApi();
  const { page, id } = await openPanel({ auto: "off", sessionId });
  await say(response.credential.value, "What is a closure in JavaScript?");
  await settled(id, 1);
  await say(response.credential.value, "What is the event loop?");
  await settled(id, 2);
  // T2 is on show; choosing T1's answer in the chat shows T1.
  await expect(page.getByTestId("pn-task-line")).toContainText("T2");
  await page.getByRole("button", { name: /^Studio · T1/ }).click();
  await expect(page.getByTestId("pn-task-line")).toContainText("T1");
  await expect(page.getByTestId("pn-earlier")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Studio · T1/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("@native native Stop: while work runs the capture button stops it (the model call is cancelled, nothing is published) and the session stays live", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer", { hold: true });
  const { page, id, analyze } = await openPanel({ auto: "off" });
  await analyze.click();
  await apply(page).click();
  await expect.poll(() => control.waiting()).toBe(1);
  const stop = page
    .getByRole("toolbar", { name: "Session controls" })
    .getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();

  await stop.click();

  await expect
    .poll(async () => (await db.actions(id))[0]?.suppression_reason)
    .toBe("owner_stopped");
  await expect.poll(() => control.waiting()).toBe(0);
  expect((await control.calls())[0]).toMatchObject({ outcome: "cancelled" });
  expect((await db.session(id))?.status).toBe("active");
  expect((await db.actions(id))[0]).toMatchObject({ shown: false });
  await expect(analyze).toHaveAccessibleName("Analyze screen");
});
