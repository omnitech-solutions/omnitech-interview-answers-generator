// The Setup page ("Start a live session") by accessible role and name. Every
// method waits on a visible state; none sleeps. Starting resolves with the row
// the server created, so a spec asserts what each choice WROTE, not what the
// page looks like.
import { expect, type Locator, type Page } from "@playwright/test";
import { db, type SessionRow } from "../helpers/sql";
import { stackConfig } from "../stack/config";

export type PolicyChoice = "Allow remote" | "Device only";
export type RetentionChoice = "Delete at end" | "30 days" | "Until I delete";

export class SetupPage {
  constructor(readonly page: Page) {}

  readonly livePath = () => `/t/${stackConfig().tenantSlug}/p/interview/live`;

  async goto(): Promise<void> {
    await this.page.goto(this.livePath());
    await expect(this.page.getByTestId("live-setup")).toBeVisible();
  }

  readonly rehearsal = (): Locator =>
    this.page.getByRole("radio", { name: /^Rehearsal Practice with no/ });
  readonly strict = (): Locator =>
    this.page.getByRole("checkbox", { name: /^Strict rehearsal/ });
  readonly consent = (): Locator =>
    this.page.getByRole("checkbox", { name: /^Everyone in this interview/ });
  readonly hostMac = (): Locator =>
    this.page.getByRole("radio", {
      name: /^Mac app Can.t tell from a browser/,
    });
  readonly hostBrowser = (): Locator =>
    this.page.getByRole("radio", { name: /^This browser only/ });
  readonly source = (name: "Microphone" | "App audio" | "Screen"): Locator =>
    this.page.getByRole("switch", { name, exact: true });
  readonly assistance = (): Locator =>
    this.page.getByRole("switch", { name: "Live assistance", exact: true });
  readonly policy = (name: PolicyChoice): Locator =>
    this.page.getByRole("radio", { name, exact: true });
  readonly retention = (name: RetentionChoice): Locator =>
    this.page.getByRole("radio", { name, exact: true });
  readonly start = (): Locator =>
    this.page.getByRole("button", { name: "Start session" });
  // "Ready", or the one thing in the way of Start.
  readonly footerState = (): Locator =>
    this.page.locator("#setup-footer-state");

  // The minimum a session needs: rehearsal and consent.
  async fillRequired(): Promise<void> {
    await this.rehearsal().check();
    await this.consent().check();
  }

  // Presses Start and resolves with the row the server created for it.
  async pressStart(): Promise<SessionRow> {
    const before = new Set((await db.sessions()).map((row) => row.id));
    await expect(this.start()).toBeEnabled();
    await this.start().click();
    await expect(this.page.getByTestId("session-bar")).toBeVisible();
    let created: SessionRow | undefined;
    await expect
      .poll(async () => {
        created = (await db.sessions()).find((row) => !before.has(row.id));
        return created?.status;
      })
      .toBe("active");
    return created as SessionRow;
  }
}
