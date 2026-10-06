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
  readonly handsFree = (): Locator =>
    this.page.getByRole("region", { name: "Hands-free controls" });
  readonly manualMode = (): Locator =>
    this.page.getByRole("button", { name: "Manual", exact: true });
  readonly autoMode = (): Locator =>
    this.page.getByRole("button", { name: "Auto", exact: true });
  readonly captureAnalyze = (): Locator =>
    this.page.getByRole("button", { name: /^Capture & analyze/ });
  readonly followUp = (): Locator =>
    this.page.getByRole("textbox", { name: "Follow-up" });
  readonly sendFollowUp = (): Locator =>
    this.page.getByRole("button", { name: "Send follow-up" });
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

  async useManual(): Promise<void> {
    await this.manualMode().click();
    await expect(this.manualMode()).toHaveAttribute("aria-pressed", "true");
  }

  readonly stopSharing = (): Locator =>
    this.page.getByRole("button", { name: "Stop sharing" });

  // Shares a window, tab or screen once (the harness accepts the browser's
  // picker through launch flags) and waits until the share is live.
  async shareScreen(): Promise<void> {
    await this.captureAnalyze().click();
    await this.page
      .getByRole("menuitem", { name: /Share a window, tab or screen/ })
      .click();
    await expect(this.stopSharing()).toBeVisible();
  }

  // A fresh capture that starts a NEW task (T{n}); shares first when needed.
  async captureNewTask(): Promise<void> {
    // A branch, not an assertion: share only when no share is running yet; the
    // menu item clicked next waits for itself (web-first).
    if (!(await this.stopSharing().isVisible())) await this.shareScreen();
    await this.captureAnalyze().click();
    await this.page
      .getByRole("menuitem", { name: /^New task from a fresh capture/ })
      .click();
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
