// Native panel details with an effect of their own: the pane toggles (the shell is
// asked for the window the panes need), the Answer style menu (the choice is
// remembered and rides the next message as a hint), the answer pane's Analyze
// screen, the Mini player's Stop analysis, and the Settings window (its own page:
// Consent required without a session, Active Skill and Coding Language shared
// with the panel, Close and Quit asking the shell).
import type { Page } from "@playwright/test";
import { nativeOverlayUrl } from "../src/fixtures/host-shim";
import { expect, test } from "../src/fixtures/panel-test";
import {
  controlSession,
  envelopes,
  ingest,
  startSessionViaApi,
} from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { settled } from "../src/helpers/tasks";

const styleButton = (page: Page) =>
  page.getByRole("button", { name: /^Answer style:/ });
const message = (page: Page) => page.getByRole("textbox", { name: "Message" });

test("@native native pane toggles Chat, Answer and Code: each hides and shows its pane and the shell is asked for the window the visible panes need", async ({
  openPanel,
}) => {
  const { page, host } = await openPanel({ auto: "off" });
  const toggle = (name: "Chat" | "Answer" | "Code") =>
    page.getByRole("button", { name, exact: true });
  const widthNow = async () => {
    const sizes = await host.calls("setWindowSize");
    return Number(sizes.at(-1)?.params["width"]);
  };
  for (const name of ["Chat", "Answer", "Code"] as const)
    await expect(toggle(name)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("pn-chat")).toBeVisible();
  await expect(page.getByTestId("pn-answer-pane")).toBeVisible();
  await expect.poll(widthNow).toBeGreaterThan(900);
  const wide = await widthNow();

  await toggle("Chat").click();
  await expect(toggle("Chat")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("pn-chat")).toHaveCount(0);
  await expect.poll(widthNow).toBeLessThan(wide);
  const narrower = await widthNow();

  await toggle("Answer").click();
  await expect(toggle("Answer")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("pn-answer-pane")).toHaveCount(0);
  await expect.poll(widthNow).toBeLessThan(narrower);

  await toggle("Chat").click();
  await toggle("Answer").click();
  await expect(page.getByTestId("pn-chat")).toBeVisible();
  await expect(page.getByTestId("pn-answer-pane")).toBeVisible();
  await expect.poll(widthNow).toBe(wide);
  await toggle("Code").click();
  await expect(toggle("Code")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(widthNow).toBeLessThan(wide);
  await toggle("Code").click();
  await expect.poll(widthNow).toBe(wide);
});

test("@native native Answer style menu: choosing an item changes the button, is remembered after a reload and rides the next message as the topic hint", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const panel = await openPanel({ auto: "off" });
  const { page, id } = panel;
  await expect(styleButton(page)).toHaveAccessibleName(
    "Answer style: Data Structures & Algorithms",
  );

  await styleButton(page).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitemradio", { name: /System Design/ }).click();
  await expect(styleButton(page)).toHaveAccessibleName(
    "Answer style: System Design",
  );
  await expect(menu).toBeHidden();

  // Sent as a hint with the next message.
  const input = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes(`/sessions/${id}/input`),
  );
  await message(page).fill("What is a closure in JavaScript?");
  await page.getByRole("button", { name: "Send message" }).click();
  expect(((await input).postDataJSON() as { skill?: string }).skill).toBe(
    "system-design",
  );
  await settled(id, 1);

  await panel.reload();
  await expect(styleButton(page)).toHaveAccessibleName(
    "Answer style: System Design",
  );
});

test("@native native answer pane empty state: Capture screenshot in Manual stages through the shell, Analyze screen in Auto sends a new task at once", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer");
  const manual = await openPanel({ auto: "off" });
  await manual.host.clear();
  await manual.page.locator("button.pn-primary").click();
  await expect
    .poll(async () => (await manual.host.calls("captureScreen")).length)
    .toBe(1);
  await expect(manual.page.getByTestId("staged-1")).toContainText(
    "Not sent yet",
  );
  expect(await control.calls()).toEqual([]);
  await manual.context.close();
  await controlSession(manual.id, "end");

  const auto = await openPanel({ auto: "on" });
  const press = auto.page.locator("button.pn-primary");
  await expect(press).toContainText("Analyze screen");
  await auto.host.clear();
  await press.click();
  await expect
    .poll(async () => (await auto.host.calls("captureScreen")).length)
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await db.actions(auto.id)).map((a) => a.action_kind))
    .toContain("draft-answer");
  await expect.poll(async () => (await control.calls()).length).toBe(1);
  expect((await control.calls())[0]).toMatchObject({ images: 1 });
});

test("@native native Mini player Stop analysis: cancels the running work but leaves the session live", async ({
  openPanel,
  control,
}) => {
  await control.scenario("plain-answer", { hold: true });
  const started = await startSessionViaApi();
  const { page, id } = await openPanel({ auto: "off", sessionId: started.id });
  const heard = await ingest(
    started.response.credential.value,
    envelopes.transcript(
      "application-audio",
      1,
      "What is a closure in JavaScript?",
    ),
  );
  expect(heard.status).toBe(200);
  await expect.poll(() => control.waiting()).toBe(1);

  const dot = page.getByTestId("pn-dot-size");
  await dot.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByTestId("pn-size-mini").click();
  await expect(page.getByTestId("pn-mini-card")).toBeVisible();
  const stop = page.getByTestId("pn-mini-card").getByRole("button", {
    name: "Stop analysis",
  });
  await expect(stop).toBeVisible();

  await stop.click();

  await expect.poll(() => control.waiting()).toBe(0);
  await expect
    .poll(async () => (await db.actions(id))[0]?.suppression_reason)
    .toBe("owner_stopped");
  expect((await control.calls())[0]).toMatchObject({ outcome: "cancelled" });
  expect((await db.session(id))?.status).toBe("active");
  await expect(stop).toBeHidden();
});

// ---- the Settings window (its own page) -----------------------------------

const settingsUrl = (
  stack: { webUrl: string; tenantSlug: string },
  sessionId?: string,
) =>
  nativeOverlayUrl(stack.webUrl, stack.tenantSlug, {
    panel: "settings",
    ...(sessionId ? { sessionId } : {}),
  });

test("@native native Settings window with no session: says Consent required and offers no settings", async ({
  native,
  stack,
}) => {
  const panel = await native.open();
  await panel.page.goto(settingsUrl(stack));
  await expect(panel.page.getByText("Consent required")).toBeVisible();
  await expect(
    panel.page.getByRole("combobox", { name: "Active Skill" }),
  ).toHaveCount(0);
});

test("@native native Settings window Active Skill and Coding Language: shared with the panel through storage and sent as hints with the next message", async ({
  openPanel,
  stack,
  control,
}) => {
  await control.scenario("plain-answer");
  const panel = await openPanel({ auto: "off" });
  const settings = await panel.context.newPage();
  await settings.goto(settingsUrl(stack, panel.id));
  const skill = settings.getByRole("combobox", { name: "Active Skill" });
  const language = settings.getByRole("combobox", { name: "Coding Language" });
  await expect(skill).toBeVisible();

  await skill.selectOption("behavioral");
  await language.selectOption({ index: 1 });
  const chosen = await language.inputValue();
  // An unsupported language is listed but cannot be chosen.
  await expect(language.locator("option:disabled").first()).toContainText(
    "not supported yet",
  );

  // The panel, another document, follows through storage.
  await expect(styleButton(panel.page)).toHaveAccessibleName(
    "Answer style: Behavioral Interview",
  );
  const input = panel.page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().includes(`/sessions/${panel.id}/input`),
  );
  await message(panel.page).fill("What is a closure in JavaScript?");
  await panel.page.getByRole("button", { name: "Send message" }).click();
  expect((await input).postDataJSON()).toMatchObject({
    skill: "behavioral",
    language: chosen,
  });
});

test("@native native Settings window Close and Quit: Close asks the shell to close it, Quit asks the shell to quit", async ({
  openPanel,
  stack,
}) => {
  const panel = await openPanel({ auto: "off" });
  const settings = await panel.context.newPage();
  await settings.goto(settingsUrl(stack, panel.id));
  const host = panel.host.constructor as unknown as new (
    page: Page,
  ) => typeof panel.host;
  const shell = new host(settings);
  await expect(settings.getByTestId("pn-settings")).toBeVisible();

  await settings.getByTestId("pn-close").click();
  await expect
    .poll(async () => (await shell.calls("closeSettings")).length)
    .toBe(1);

  await settings.getByTestId("pn-quit").click();
  await expect.poll(async () => (await shell.calls("quit")).length).toBe(1);
});
