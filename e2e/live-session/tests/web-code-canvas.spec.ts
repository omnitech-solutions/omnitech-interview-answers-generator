// The web Code view's canvas (a coding task's Code tab): the Solution, Usage
// and Tests files, Wrap, Copy all, editing, Run in the real sandboxed runner,
// and the Results panel with its Tests and Output views. The scripted model
// supplies the solution; what Run reports is the real runner's own output.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/test";
import { startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { say } from "../src/helpers/tasks";
import { SCRIPTED } from "../src/stack/scenarios";

const CODING_QUESTION =
  "How would you implement a sliding window rate limiter?";
const SOLUTION = "export const allow = (n: number): boolean => n > 0; // rev 1";

const canvas = (page: Page): Locator =>
  page.getByRole("region", { name: "Code canvas" });
const files = (page: Page): Locator =>
  canvas(page).getByRole("tablist", { name: "Code files" });
const views = (page: Page): Locator =>
  canvas(page).getByRole("tablist", { name: "Result views" });
const editor = (page: Page): Locator =>
  canvas(page).getByTestId("canvas-editor").getByRole("textbox");

test("web code canvas: the file tabs show the scripted solution, usage and tests; Wrap, editing, Copy all, Run, Results and Output do what they say", async ({
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
  await control.scenario("coding-answer");
  const started = await startSessionViaApi();
  await live.goto();
  await say(started.response.credential.value, CODING_QUESTION);
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
  await page.getByRole("tab", { name: "Code" }).click();
  await expect(canvas(page)).toBeVisible();

  // Solution: the scripted solution. Tests: the scripted test source.
  await expect(
    files(page).getByRole("tab", { name: "Solution" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(editor(page)).toContainText(SOLUTION);
  await files(page).getByRole("tab", { name: "Tests" }).click();
  await expect(files(page).getByRole("tab", { name: "Tests" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(editor(page)).toContainText(`it("${SCRIPTED.testName}"`);
  // Usage: a different file again, with neither of the other two's text.
  await files(page).getByRole("tab", { name: "Usage" }).click();
  await expect(files(page).getByRole("tab", { name: "Usage" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(editor(page)).not.toContainText(SOLUTION);
  await expect(editor(page)).not.toContainText(`it("${SCRIPTED.testName}"`);

  // Wrap flips the editor's wrapping (the pressed state and the CodeMirror
  // class that only the real toggle produces).
  const wrap = canvas(page).getByRole("button", { name: "Wrap", exact: true });
  const wrapped = canvas(page).locator(".cm-lineWrapping");
  await expect(wrap).toHaveAttribute("aria-pressed", "false");
  await expect(wrapped).toHaveCount(0);
  await wrap.click();
  await expect(wrap).toHaveAttribute("aria-pressed", "true");
  await expect(wrapped).toHaveCount(1);
  await wrap.click();
  await expect(wrapped).toHaveCount(0);

  // Editing changes the code Copy all and Run use.
  await files(page).getByRole("tab", { name: "Solution" }).click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n// edited by the candidate");
  await expect(canvas(page)).toHaveAttribute("data-edited", "true");
  await canvas(page).getByRole("button", { name: "Copy all" }).click();
  await expect(
    canvas(page).getByRole("button", { name: "Copied all" }),
  ).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(SOLUTION);
  expect(copied).toContain("// edited by the candidate");
  expect(copied).toContain(`it("${SCRIPTED.testName}"`);

  // Results: the header opens and closes the panel; Nothing has run yet is not
  // claimed once the worker's own result is there.
  const results = canvas(page).getByRole("button", { name: /^Results/ });
  if ((await results.getAttribute("aria-expanded")) !== "true")
    await results.click();
  await expect(results).toHaveAttribute("aria-expanded", "true");
  // The rows are the server's report of the generated test (one, passed).
  await expect(canvas(page)).toContainText(SCRIPTED.testName);
  await results.click();
  await expect(results).toHaveAttribute("aria-expanded", "false");
  await expect(views(page)).toHaveCount(0);

  // Output: before any run it says so; the view switches and switches back.
  await results.click();
  await views(page).getByRole("tab", { name: "Output" }).click();
  await expect(
    views(page).getByRole("tab", { name: "Output" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(canvas(page).locator("pre.ws-output")).toBeVisible();
  await views(page).getByRole("tab", { name: "Tests" }).click();
  await expect(canvas(page).locator("pre.ws-output")).toHaveCount(0);
});

// Run posts the code, as edited, to /api/v1/run-all through the /api/v1 session
// gate (HO-SEC-02). The gate once answered every POST from the signed-in page
// 401 (it compared Origin with a request URL that `next start` builds as
// localhost); it now compares Origin with the Host the browser used.
test("web code canvas Run: the code as edited goes to the real runner and its result shows as Your run", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("coding-answer");
  const started = await startSessionViaApi();
  await live.goto();
  await say(started.response.credential.value, CODING_QUESTION);
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
  await page.getByRole("tab", { name: "Code" }).click();
  await canvas(page).getByRole("button", { name: "Run", exact: true }).click();
  await expect(canvas(page)).toContainText(SCRIPTED.testName, {
    timeout: 60_000,
  });
  await expect(canvas(page)).toContainText("Your run");
});

test("web code canvas Open in Workspace: the Code view's button opens this task's draft at its Workspace route", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("coding-answer");
  const started = await startSessionViaApi();
  await live.goto();
  await say(started.response.credential.value, CODING_QUESTION);
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
  await page.getByRole("tab", { name: "Code" }).click();
  await page.getByRole("button", { name: "Open in Workspace" }).click();
  await expect(page).toHaveURL(/\/work\?/);
  await expect(page).toHaveURL(
    new RegExp(`workspace=active-session(%3A|:)${started.id}`),
  );
  await expect(page).toHaveURL(/artifact=coding/);
});
