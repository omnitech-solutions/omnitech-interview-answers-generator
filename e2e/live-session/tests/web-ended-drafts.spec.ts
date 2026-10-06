// What the ended page offers for the drafts a session published: Copy puts the
// answer draft on the clipboard, and Open takes a code draft to its Workspace
// route. The scripted model supplies the drafts; the clipboard and the URL are
// the proof.
import { expect, test } from "../src/fixtures/test";
import { startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { say } from "../src/helpers/tasks";
import { SCRIPTED } from "../src/stack/scenarios";

test("web ended Copy Answer draft: the clipboard holds the published answer draft", async ({
  live,
  control,
  context,
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Playwright cannot grant clipboard permissions in WebKit; Chromium proves the clipboard",
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await control.scenario("plain-answer");
  const started = await startSessionViaApi();
  await live.goto();
  await live.useManual();
  await say(
    started.response.credential.value,
    "What is a closure in JavaScript?",
  );
  await expect(live.task(1)).toContainText(SCRIPTED.plain);
  await live.end();

  await expect(page.getByTestId("ended-answer")).toHaveCount(1);
  await page.getByRole("button", { name: /^Copy Answer draft \d+$/ }).click();
  await expect(
    page.getByRole("button", { name: /^Copy Answer draft \d+: copied$/ }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    SCRIPTED.plain,
  );
});

test("web ended Open Workspace draft: the code draft opens at its Workspace route for this session", async ({
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
  await expect
    .poll(
      async () =>
        (await db.actions(started.id)).find(
          (a) => a.action_kind === "solve-code",
        )?.dispatch_status,
      { timeout: 90_000 },
    )
    .toBe("succeeded");
  await live.end();

  const open = page.getByRole("button", { name: "Open Workspace draft" });
  await expect(open).toBeVisible();
  await open.click();
  await expect(page).toHaveURL(/\/work\?/);
  await expect(page).toHaveURL(
    new RegExp(`workspace=active-session(%3A|:)${started.id}`),
  );
  await expect(page).toHaveURL(/artifact=coding/);
});
