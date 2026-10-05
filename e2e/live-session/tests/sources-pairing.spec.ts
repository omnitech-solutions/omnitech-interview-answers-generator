// The pairing credential panel on the Sources tab: Show/Hide, Copy, Renew,
// Revoke and Dismiss, each proven by what the SERVER then does with the
// credential (the companion's ingest accepts or refuses it, the session row's
// credential columns move), never by the panel's own text alone. The session
// is started through the page, because only the start response (or a renewal)
// ever hands the page the credential.
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/test";
import { Companion } from "../src/helpers/companion";
import { db, type SessionRow } from "../src/helpers/sql";

const MASK = "••••••••••••••••";

async function startAndOpenSources(
  live: {
    startRehearsal(): Promise<SessionRow>;
    goto(): Promise<unknown>;
  },
  page: Page,
) {
  await live.goto();
  const session = await live.startRehearsal();
  await page.getByRole("tab", { name: "Sources" }).click();
  const panel = page.getByTestId("pairing-panel");
  await expect(panel).toBeVisible();
  return {
    session,
    panel,
    code: panel.getByTestId("pairing-credential"),
  };
}

// The credential, revealed through the panel's own Show button.
async function reveal(
  panel: ReturnType<Page["getByTestId"]>,
  code: ReturnType<Page["getByTestId"]>,
): Promise<string> {
  await panel.getByRole("button", { name: "Show", exact: true }).click();
  await expect(code).toHaveText(/^asc_/);
  return (await code.textContent()) ?? "";
}

test("pairing Show and Hide: the masked code reveals the real credential and masks it again", async ({
  live,
  page,
}) => {
  const { panel, code } = await startAndOpenSources(live, page);
  await expect(code).toHaveText(MASK);
  const show = panel.getByRole("button", { name: "Show", exact: true });
  await expect(show).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("pairing-panel")).not.toContainText("asc_");

  const value = await reveal(panel, code);
  await expect(
    panel.getByRole("button", { name: "Hide", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  // It is the real credential, not a decoration: the server accepts it.
  const ack = await new Companion(value).heartbeat();
  expect(ack.status).toBe(200);
  expect(ack.body).toMatchObject({ status: "accepted" });

  // Hide masks it and takes it out of the DOM, not just out of sight.
  await panel.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(code).toHaveText(MASK);
  expect(await page.content()).not.toContain(value);
});

test("pairing Copy: the clipboard holds exactly the credential the server accepts", async ({
  live,
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { panel, code } = await startAndOpenSources(live, page);
  await expect(panel).not.toContainText("Copied.");

  await panel.getByRole("button", { name: "Copy", exact: true }).click();
  // The confirmation is said only after the copy succeeded.
  await expect(panel).toContainText("Copied. Paste it into the companion.");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^asc_/);
  // Copy did not reveal it, and what it copied is the live credential.
  await expect(code).toHaveText(MASK);
  expect((await new Companion(copied).heartbeat()).body).toMatchObject({
    status: "accepted",
  });
});

test("pairing Renew: a new credential replaces the old one on the server and moves the expiry later", async ({
  live,
  page,
}) => {
  const { session, panel, code } = await startAndOpenSources(live, page);
  const oldValue = await reveal(panel, code);
  const before = await db.session(session.id);
  expect(before?.credential_expires_at).toBeTruthy();
  const oldExpiry = Date.parse(before?.credential_expires_at ?? "");

  await panel.getByRole("button", { name: "Renew", exact: true }).click();

  // The panel shows the new credential masked again.
  await expect(code).toHaveText(MASK);
  await expect(code).not.toHaveText(oldValue);
  await expect
    .poll(async () => {
      const row = await db.session(session.id);
      return Date.parse(row?.credential_expires_at ?? "");
    })
    .toBeGreaterThan(oldExpiry);

  const newValue = await reveal(panel, code);
  expect(newValue).not.toBe(oldValue);
  // The old credential is dead, the new one is live.
  const refused = await new Companion(oldValue).heartbeat();
  expect(refused.body).toMatchObject({ status: "refused" });
  expect((await new Companion(newValue).heartbeat()).body).toMatchObject({
    status: "accepted",
  });
});

test("pairing Revoke: Keep it changes nothing; revoking sets credential_revoked_at, pauses the session and the companion is refused", async ({
  live,
  page,
}) => {
  const { session, panel, code } = await startAndOpenSources(live, page);
  const value = await reveal(panel, code);
  const revoke = panel.getByRole("button", { name: "Revoke", exact: true });

  // Asking first: Keep it backs out and the credential stays good.
  await revoke.click();
  const confirm = panel.getByRole("button", { name: "Revoke and pause" });
  await expect(confirm).toBeVisible();
  await panel.getByRole("button", { name: "Keep it" }).click();
  await expect(confirm).toBeHidden();
  expect((await db.session(session.id))?.credential_revoked_at).toBeNull();
  expect((await new Companion(value).heartbeat()).body).toMatchObject({
    status: "accepted",
  });

  // Confirming: the server holds the revocation, the session is paused...
  await revoke.click();
  await confirm.click();
  await expect
    .poll(async () => (await db.session(session.id))?.credential_revoked_at)
    .not.toBeNull();
  expect((await db.session(session.id))?.status).toBe("paused");
  // ...the panel says exactly that...
  await expect(panel.getByTestId("revoke-result")).toHaveText(
    "Credential revoked. The session is paused: renew a credential and resume to continue.",
  );
  await expect(page.getByText("Credential revoked.").first()).toBeVisible();
  // ...and the companion is turned away.
  const ack = await new Companion(value).heartbeat();
  expect(ack.body).toMatchObject({ status: "refused" });
});

test("pairing Dismiss: the credential panel is hidden, the value is gone from the page and is never offered again", async ({
  live,
  page,
}) => {
  const { session, panel, code } = await startAndOpenSources(live, page);
  const value = await reveal(panel, code);
  expect(await page.content()).toContain(value);

  await panel.getByRole("button", { name: "Dismiss", exact: true }).click();

  // The panel no longer shows a credential, offers no Dismiss, and the value
  // is nowhere in the document.
  await expect(code).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Dismiss", exact: true }),
  ).toHaveCount(0);
  await expect(panel).toContainText(
    "The pairing credential is no longer shown. Renew to get a new one; it replaces the old one.",
  );
  expect(await page.content()).not.toContain(value);

  // Reloading cannot bring it back: the server never returns it (the session
  // read has no credential field) and the page has no copy.
  await page.reload();
  await page.getByRole("tab", { name: "Sources" }).click();
  expect(await page.content()).not.toContain(value);
  const read = await page.evaluate(async (id) => {
    const slug = location.pathname.split("/")[2];
    const response = await fetch(`/api/interview/t/${slug}/sessions/${id}`);
    return response.text();
  }, session.id);
  expect(read).not.toContain(value);
  // Dismissing is not revoking: the credential still works.
  expect((await new Companion(value).heartbeat()).body).toMatchObject({
    status: "accepted",
  });
});
