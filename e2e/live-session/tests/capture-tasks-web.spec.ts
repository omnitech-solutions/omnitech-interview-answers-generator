// Capture, tasks and answers on the web Live page: what the capture menu sends,
// how a spoken question becomes a task, how the task chips and Back choose the
// task on show and where a follow-up goes, the stage tiles and the Answer and
// Code views of a coding task (with the real sandboxed test runner), Copy
// answer, and the states of a draft the guards withheld or a model that
// refused, failed or timed out. Each test observes a server row, a recorded
// model call, the clipboard or a DOM state only the real behaviour produces.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/test";
import { startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { say, settled } from "../src/helpers/tasks";
import { SCRIPTED } from "../src/stack/scenarios";

const QUESTION = "What is a closure in JavaScript?";
const SECOND = "What is the event loop?";
const CODING_QUESTION =
  "How would you implement a sliding window rate limiter?";

const stage = (page: Page, id: "answer" | "code" | "verified"): Locator =>
  page.locator(`.live-stage[data-stage="${id}"]`);

// A live page on a session started over the API (its credential in hand so a
// spoken question can be sent).
async function openLive(live: { goto(): Promise<unknown> }) {
  const started = await startSessionViaApi();
  await live.goto();
  return { id: started.id, credential: started.response.credential.value };
}

test("web spoken question: a phrase the companion hears starts a task, answers it, and the transcript keeps what was heard", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("plain-answer");
  const { id, credential } = await openLive(live);
  await expect(page.getByTestId("live-idle")).toBeVisible();

  await say(credential, QUESTION);

  await expect(live.task(1)).toContainText(SCRIPTED.plain);
  const actions = await settled(id, 1);
  expect(actions[0]).toMatchObject({
    action_kind: "draft-answer",
    dispatch_status: "succeeded",
    shown: true,
  });
  expect((await control.calls())[0]).toMatchObject({
    stage: "assist",
    images: 0,
  });
  // No code for an ordinary question, and the tile says why.
  await expect(stage(page, "code")).toHaveAttribute(
    "data-state",
    "unavailable",
  );
  await expect(stage(page, "code")).toContainText("Not a coding question.");
  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(page.getByTestId("transcript-row").first()).toContainText(
    QUESTION,
  );
});

test("web Copy answer: the clipboard holds the suggested answer, and the page says it was copied", async ({
  live,
  control,
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await control.scenario("plain-answer");
  const { credential } = await openLive(live);
  await say(credential, QUESTION);
  await expect(live.task(1)).toContainText(SCRIPTED.plain);

  await page.getByRole("button", { name: "Copy answer" }).click();

  await expect(page.locator(".live-toast")).toHaveText("Copied answer");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    SCRIPTED.plain,
  );
});

test("web coding answer: Answer and Code views, the scripted solution, and every stage Done because the real runner passed the test that names the constraint", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("coding-answer");
  const { id, credential } = await openLive(live);
  await say(credential, CODING_QUESTION);
  await expect(live.task(1)).toBeVisible();

  // The server finished BOTH actions; its own states decide the tiles.
  await expect
    .poll(
      async () =>
        (await db.actions(id)).find((a) => a.action_kind === "solve-code")
          ?.dispatch_status,
      { timeout: 90_000 },
    )
    .toBe("succeeded");
  await expect(stage(page, "answer")).toHaveAttribute("data-state", "done");
  await expect(stage(page, "code")).toHaveAttribute("data-state", "done");
  await expect(stage(page, "code")).toContainText("1/1 generated tests");
  await expect(stage(page, "verified")).toHaveAttribute("data-state", "done");

  // Answer view (the default for a task with an answer): the model's
  // restatement and answer.
  await expect(page.getByRole("tab", { name: "Answer" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const answerPanel = page.getByRole("tabpanel", { name: "Answer" });
  await expect(answerPanel).toContainText(SCRIPTED.codingBriefRestatement);
  await expect(answerPanel).toContainText(SCRIPTED.coding);

  // Code view: the scripted solution (revision-stamped) and the three facts.
  await page.getByRole("tab", { name: "Code" }).click();
  await expect(page.getByRole("tab", { name: "Code" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const code = page.getByRole("tabpanel", { name: "Code" });
  await expect(code.getByRole("textbox").first()).toContainText(
    "export const allow = (n: number): boolean => n > 0; // rev 1",
  );
  const badges = code.getByRole("list", { name: "What is established" });
  await expect(badges).toContainText("Generated");
  await expect(badges).toContainText("Fully verified");
  await expect(code).toContainText(`passed: ${SCRIPTED.testName}`);
  await expect(code.getByTestId("runner-note")).toContainText(
    "Tests ran in the code-runner container",
  );
  // The Answer view comes back with its text intact.
  await page.getByRole("tab", { name: "Answer" }).click();
  await expect(answerPanel).toContainText(SCRIPTED.coding);
});

test("web coding answer with a failing generated test: Code is done but Fully verified is not established, and the failed test is listed", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("coding-failing-tests");
  const { id, credential } = await openLive(live);
  await say(credential, CODING_QUESTION);
  await expect(live.task(1)).toBeVisible();
  await expect
    .poll(
      async () =>
        (await db.actions(id)).find((a) => a.action_kind === "solve-code")
          ?.dispatch_status,
      { timeout: 90_000 },
    )
    .toBe("succeeded");

  await expect(stage(page, "code")).toHaveAttribute("data-state", "done");
  await expect(stage(page, "verified")).toHaveAttribute(
    "data-state",
    "not-established",
  );
  await expect(stage(page, "verified")).toContainText("A test failed");
  // The model was asked once for the solution and once for the one repair; the
  // repair did not fix it, and the page still says so.
  expect(
    (await control.calls()).filter((call) => call.stage === "solve"),
  ).toHaveLength(2);
  await page.getByRole("tab", { name: "Code" }).click();
  const code = page.getByRole("tabpanel", { name: "Code" });
  await expect(
    code.getByRole("list", { name: "What is established" }),
  ).toContainText("Not fully verified");
  await expect(code).toContainText(`failed: ${SCRIPTED.failingTestName}`);
  await expect(code).toContainText("1 failed");
});

test("web coding answer with a syntax error: the syntax check's finding stops Fully verified and says why", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("coding-syntax-error");
  const { id, credential } = await openLive(live);
  await say(credential, CODING_QUESTION);
  await expect(live.task(1)).toBeVisible();
  await expect
    .poll(
      async () =>
        (await db.actions(id)).find((a) => a.action_kind === "solve-code")
          ?.dispatch_status,
      { timeout: 90_000 },
    )
    .toBe("succeeded");

  await expect(stage(page, "verified")).toHaveAttribute(
    "data-state",
    "not-established",
  );
  await expect(stage(page, "verified")).toContainText(
    "The syntax check found problems.",
  );
});

for (const [scenario, text, flag] of [
  [
    "withheld-preference",
    SCRIPTED.preferenceOnly,
    "pay, notice or availability wasn't backed by your preferences",
  ],
  [
    "withheld-figure",
    SCRIPTED.ungroundedFigure,
    "a number in the draft isn't in your experience",
  ],
] as const) {
  test(`web withheld draft (${scenario}): the guard says why in its fixed words and the draft itself is never shown or published`, async ({
    live,
    control,
    page,
  }) => {
    await control.scenario(scenario);
    const { id, credential } = await openLive(live);
    await say(
      credential,
      "How soon could you start, and what do you expect to earn?",
    );

    const notice = page.getByTestId("run-notice");
    await expect(notice.first()).toContainText("Draft withheld.");
    await expect(notice.first()).toContainText(
      "could not be checked against your approved experience, so no draft was shown",
    );
    await expect(notice.first()).toContainText(flag);
    // The withheld sentence is nowhere on the page, and the server did not
    // publish it: the action is not shown and no hint was counted.
    await expect(page.getByText(text)).toHaveCount(0);
    const [action] = await settled(id, 1);
    expect(action).toMatchObject({ shown: false });
    expect(action?.dispatch_status).not.toBe("succeeded");
    expect((await db.session(id))?.shown_draft_count).toBe(0);
    await expect(
      page.getByRole("heading", { name: "Suggested answer" }),
    ).toHaveCount(0);
  });
}

test("web model refusal: a session that no longer permits the request says so, publishes nothing and is not retried", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("refusal");
  const { id, credential } = await openLive(live);
  await say(credential, QUESTION);

  const notice = page.getByTestId("run-notice").first();
  await expect(notice).toBeVisible();
  const [action] = await settled(id, 1);
  expect(action).toMatchObject({ shown: false });
  expect(action?.dispatch_status).not.toBe("succeeded");
  expect(await control.calls()).toHaveLength(1);
  await expect(page.getByText(SCRIPTED.plain)).toHaveCount(0);
});

test("web provider failure: the page says the step failed, nothing is published, and a later question works again", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("provider-failure");
  const { id, credential } = await openLive(live);
  await say(credential, QUESTION);

  const notice = page.getByTestId("run-notice").first();
  await expect(notice).toContainText("Failed.");
  const [action] = await settled(id, 1);
  expect(action).toMatchObject({ shown: false });
  expect(action?.dispatch_status).not.toBe("succeeded");
  await expect(page.getByText(SCRIPTED.plain)).toHaveCount(0);

  await control.scenario("plain-answer");
  // The scripted model recovers (the failure was one-shot): the next question
  // is answered and shown.
  await say(credential, SECOND);
  await expect(live.task(2)).toContainText(SCRIPTED.plain);
});

test("web model timeout: the attempt is retried and, when it keeps timing out, ends failed with nothing published", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("timeout");
  const { id, credential } = await openLive(live);
  await say(credential, QUESTION);

  await expect(page.getByTestId("run-notice").first()).toContainText(
    "Failed.",
    { timeout: 60_000 },
  );
  // A timeout is retryable: the model was asked more than once.
  expect((await control.calls()).length).toBeGreaterThan(1);
  const actions = await db.actions(id);
  expect(actions.every((a) => a.shown === false)).toBe(true);
  await expect(page.getByText(SCRIPTED.plain)).toHaveCount(0);
});
