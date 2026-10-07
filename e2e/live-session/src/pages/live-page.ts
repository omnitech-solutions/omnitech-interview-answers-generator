// The web Live session page as a person sees it, by accessible role and name
// (plus the few existing test ids). Web-first: every method waits on a visible
// state, none sleeps.
import { expect, type Locator, type Page } from "@playwright/test";
import { db, type SessionRow } from "../helpers/sql";
import { stackConfig } from "../stack/config";

export class LivePage {
  constructor(readonly page: Page) {}

  readonly livePath = () => `/t/${stackConfig().tenantSlug}/p/interview/live`;

  goto(): Promise<unknown> {
    return this.page.goto(this.livePath());
  }

  // ---- setup ------------------------------------------------------------
  readonly rehearsal = (): Locator =>
    this.page.getByRole("radio", { name: /^Rehearsal/ });
  readonly consent = (): Locator =>
    this.page.getByRole("checkbox", { name: /Everyone in this interview/ });
  readonly startButton = (): Locator =>
    this.page.getByRole("button", { name: "Start session" });

  // Rehearsal, consent, Start; resolves with the new session's row once the
  // server holds it (the DB is the proof the click did something).
  async startRehearsal(): Promise<SessionRow> {
    const before = new Set((await db.sessions()).map((row) => row.id));
    await this.rehearsal().check();
    await this.consent().check();
    await expect(this.startButton()).toBeEnabled();
    await this.startButton().click();
    await expect(this.sessionBar()).toBeVisible();
    let created: SessionRow | undefined;
    await expect
      .poll(async () => {
        created = (await db.sessions()).find((row) => !before.has(row.id));
        return created?.status;
      })
      .toBe("active");
    return created as SessionRow;
  }

  // ---- live ---------------------------------------------------------------
  readonly sessionBar = (): Locator => this.page.getByTestId("session-bar");
  readonly task = (n: number): Locator =>
    this.page.getByRole("article", { name: new RegExp(`^Task ${n}:`) });

  // Task chips (T{n} · kind), the screenshots area and its tray, by the test
  // ids the product gives them (the area has no other stable handle).
  readonly chip = (n: number): Locator =>
    this.page.getByRole("button", { name: new RegExp(`^T${n} · `) });
  readonly screenshotsToggle = (): Locator =>
    this.page.getByRole("button", { name: /^Screenshots \(\d+\)$/ });
  readonly area = (): Locator => this.page.getByTestId("screenshots-area");
  readonly addScreenshot = (): Locator =>
    this.page.getByTestId("add-screenshot");
  readonly apply = (): Locator => this.page.getByTestId("apply-screenshots");
  readonly discard = (): Locator =>
    this.page.getByTestId("discard-screenshots");
  readonly staged = (n: number): Locator =>
    this.page.getByTestId(`staged-${n}`);

  readonly stagedItems = (): Locator =>
    this.page.locator('[data-testid^="staged-"]');

  // Stages one screenshot with the tray's own Add screenshot button (the page
  // asks for a source in the same click; the harness accepts the browser's
  // picker through launch flags). Nothing is sent until Apply.
  async stageScreenshot(): Promise<void> {
    // A branch, not an assertion: open the area only when it is closed.
    if (!(await this.area().isVisible()))
      await this.screenshotsToggle().click();
    const before = await this.stagedItems().count();
    await this.addScreenshot().click();
    await expect(this.stagedItems()).toHaveCount(before + 1);
  }

  // A fresh screenshot that starts a NEW task (T{n}): staged, "New problem"
  // chosen when the tray offers the choice, then Apply.
  async captureNewTask(): Promise<void> {
    await this.stageScreenshot();
    const newProblem = this.page.getByRole("radio", { name: /^New problem$/ });
    // A branch, not an assertion: the choice only exists once a task does.
    if (await newProblem.isVisible()) await newProblem.check();
    await expect(this.apply()).toBeEnabled();
    await this.apply().click();
  }

  // ---- end ----------------------------------------------------------------
  async end(): Promise<void> {
    await this.sessionBar()
      .getByRole("button", { name: "End", exact: true })
      .click();
    const dialog = this.page.getByRole("alertdialog", {
      name: "End this session?",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "End session" }).click();
  }
}
