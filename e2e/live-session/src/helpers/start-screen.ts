// The native Start screen's interview: a session always starts for one of the
// owner's candidacies, so a spec that presses Start adds one first, the way the
// person does (Add an interview: company, role, Save), and a spec about the
// empty state serves the screen an empty list whatever earlier specs added.
import { expect, type Page } from "@playwright/test";

// Adds an interview through the context form and leaves it picked. Its one
// interview stage means the recording agreement is asked for; `agree` ticks it.
export async function addInterview(
  page: Page,
  input: { company: string; role: string; agree?: boolean },
): Promise<void> {
  await page.getByTestId("pn-start-add-interview").click();
  const modal = page.getByTestId("pn-context-modal");
  await expect(modal).toBeVisible();
  await page.getByTestId("pn-context-company").fill(input.company);
  await page.getByTestId("pn-context-role").fill(input.role);
  await page.getByTestId("pn-context-save").click();
  // Saved: the picker behind the form names it (company first).
  await expect(page.getByTestId("pn-start-interview")).toContainText(
    `${input.company} · ${input.role}`,
  );
  await modal
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByTestId("pn-start-edit-context")).toBeVisible();
  if (input.agree === false) return;
  const agreed = page.getByRole("checkbox", { name: /Everyone has agreed/ });
  await agreed.click();
  await expect(agreed).toHaveAttribute("aria-checked", "true");
}

const CHOICES = /\/sessions\/choices(?:\?|$)/;

// Serves the Start screen the real choices with no candidacy in them, until
// `restore` is called.
export async function withNoInterviews(
  page: Page,
): Promise<{ restore(): Promise<void> }> {
  await page.route(CHOICES, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, candidacies: [] } });
  });
  return { restore: () => page.unroute(CHOICES) };
}
