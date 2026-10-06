// The Studio shell around every view: the sidebar's view buttons, the live
// dot, the command palette, the theme switch, the Assistant and the Products
// link. Each is proved by where the page goes or what the document does, and
// the live dot against the server's own session rows.
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/test";
import { controlSession, startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { stackConfig } from "../src/stack/config";

const base = () => `/t/${stackConfig().tenantSlug}/p/interview`;
const views = (page: Page) => page.getByRole("navigation", { name: "Views" });

const VIEWS = [
  ["Home", ""],
  ["Workspace", "/work"],
  ["Briefings", "/briefings"],
  ["Documents", "/documents"],
  ["Knowledge", "/knowledge"],
  ["Rehearsal", "/rehearsal"],
  ["Live session", "/live"],
] as const;

test("web shell view buttons: each opens its own view at its own address and is the current page", async ({
  page,
}) => {
  await page.goto(base());
  // Start away from Home so the first click is a real move.
  await views(page)
    .getByRole("button", { name: /^Rehearsal\b/ })
    .click();
  for (const [name, path] of VIEWS) {
    const button = views(page).getByRole("button", {
      name: new RegExp(`^${name}\\b`),
    });
    await button.click();
    await expect(page).toHaveURL(new RegExp(`${base()}${path}/?$`));
    await expect(button).toHaveAttribute("aria-current", "page");
    // Exactly one view is current.
    await expect(views(page).locator('[aria-current="page"]')).toHaveCount(1);
  }
});

test("web shell Live session dot: present while the server's session is open, gone once it ends", async ({
  page,
}) => {
  await page.goto(base());
  const dot = views(page).getByRole("img", { name: "Session in progress" });
  // The clean slate: no open session row, no dot.
  expect(
    (await db.sessions()).filter(
      (row) => row.status === "active" || row.status === "paused",
    ),
  ).toEqual([]);
  await expect(dot).toHaveCount(0);

  const started = await startSessionViaApi();
  await page.reload();
  await expect
    .poll(
      async () =>
        (await db.sessions()).find((row) => row.id === started.id)?.status,
    )
    .toBe("active");
  await expect(dot).toBeVisible();

  await controlSession(started.id, "end");
  await expect
    .poll(
      async () =>
        (await db.sessions()).find((row) => row.id === started.id)?.status,
    )
    .toBe("ended");
  await page.reload();
  await expect(dot).toHaveCount(0);
});

test("web shell search: the button opens the command palette with a search field, and choosing Live session goes there", async ({
  page,
}) => {
  await page.goto(base());
  await page.getByRole("button", { name: /^Search or jump to/ }).click();
  const field = page.getByRole("combobox", {
    name: /Search questions, briefings/,
  });
  await expect(field).toBeVisible();
  await field.fill("Live session");
  await page
    .getByRole("option", { name: /Live session/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`${base()}/live/?$`));
  await expect(field).toHaveCount(0);
});

test("web shell theme: the button flips the document theme, says what it will do next, and the choice survives a reload", async ({
  page,
}) => {
  await page.goto(base());
  const html = page.locator("html");
  const before = await html.getAttribute("data-theme");
  const flipTo = before === "dark" ? "light" : "dark";
  await page
    .getByRole("button", {
      name: before === "dark" ? "Use light theme" : "Use dark theme",
    })
    .click();
  await expect(html).toHaveAttribute("data-theme", flipTo);
  await expect(
    page.getByRole("button", {
      name: flipTo === "dark" ? "Use light theme" : "Use dark theme",
    }),
  ).toBeVisible();
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", flipTo);
  // Put it back for the specs that follow.
  await page
    .getByRole("button", {
      name: flipTo === "dark" ? "Use light theme" : "Use dark theme",
    })
    .click();
  await expect(html).toHaveAttribute("data-theme", before ?? "light");
});

test("web shell Assistant: the button opens the Studio assistant panel", async ({
  page,
}) => {
  await page.goto(base());
  const assistant = page.getByRole("button", {
    name: "Assistant",
    exact: true,
  });
  const composer = page.getByRole("textbox", {
    name: /message|ask|assistant/i,
  });
  // Nothing of the assistant is on screen until the button is pressed.
  await expect(composer).toHaveCount(0);
  await assistant.click();
  await expect(composer.first()).toBeVisible();
});

test("web shell Presentations: the product link leaves for the Presentations product", async ({
  page,
}) => {
  await page.goto(base());
  await page
    .getByRole("link", { name: "Presentations", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/t/${stackConfig().tenantSlug}/p/presentation/?$`),
  );
});
