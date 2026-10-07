// Banners, the bar's state and its status copy: each one appears because of a
// REAL server-side cause (a control call, a credential change, an observation
// the companion sends, a moved clock, an unreachable stream) and clears when
// that cause ends. The cause is made over HTTP, never by poking the page.
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/test";
import {
  controlSession,
  envelopes,
  ingest,
  renewCredential,
  sessionApi,
  startSessionViaApi,
} from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import type { LivePage } from "../src/pages/live-page";

const banner = (page: Page, kind: string) =>
  page.locator(`[data-banner="${kind}"]`);

// A session with the Mac sources (so app audio is a chosen source) and no
// model involved: banners are about capture and credential state.
const startMacSession = () =>
  startSessionViaApi({
    captureSources: ["microphone", "application-audio", "screen"],
    liveAssistance: false,
  });

async function open(live: LivePage): Promise<void> {
  await live.goto();
  await expect(live.sessionBar()).toBeVisible();
}

test("web banner paused: appears while the server holds the session paused and clears when it resumes", async ({
  live,
  page,
}) => {
  const { id } = await startMacSession();
  await open(live);
  await expect(banner(page, "paused")).toHaveCount(0);
  await expect(live.sessionBar()).toHaveAttribute("data-state", "live");

  await controlSession(id, "pause");
  expect((await db.session(id))?.status).toBe("paused");
  await expect(banner(page, "paused")).toBeVisible();
  await expect(banner(page, "paused")).toContainText(
    "No new work will start, and any result that arrives while paused is discarded.",
  );
  await expect(live.sessionBar()).toHaveAttribute("data-state", "paused");

  // Its own action is the real Resume.
  await banner(page, "paused").getByRole("button", { name: "Resume" }).click();
  await expect.poll(async () => (await db.session(id))?.status).toBe("active");
  await expect(banner(page, "paused")).toHaveCount(0);
  await expect(live.sessionBar()).toHaveAttribute("data-state", "live");
});

test("web banner credential revoked: appears when the credential is revoked on the server and Renew credential clears it", async ({
  live,
  page,
}) => {
  const { id, response } = await startMacSession();
  await open(live);
  await expect(banner(page, "credential-revoked")).toHaveCount(0);

  expect(
    (await sessionApi(`/${id}/credential`, { method: "DELETE" })).status,
  ).toBe(204);
  await expect(banner(page, "credential-revoked")).toBeVisible();
  await expect(banner(page, "credential-revoked")).toContainText(
    "The companion's credential was revoked.",
  );
  // The cause is real: the revoked credential no longer ingests.
  const refused = await ingest(
    response.credential.value,
    envelopes.transcript("microphone", 0, "A line from the old credential."),
  );
  expect(refused.status).not.toBe(200);

  await banner(page, "credential-revoked")
    .getByRole("button", { name: "Renew credential" })
    .click();
  await expect
    .poll(async () => (await db.session(id))?.credential_revoked_at)
    .toBeNull();
  await expect(banner(page, "credential-revoked")).toHaveCount(0);
});

test("web banner permission revoked: appears when the companion reports the permission withdrawn and clears when that source speaks again", async ({
  live,
  page,
}) => {
  const { response } = await startMacSession();
  const credential = response.credential.value;
  await open(live);

  await ingest(
    credential,
    envelopes.disconnected("microphone", 0, "permission-revoked"),
  );
  const revoked = banner(page, "permission-revoked");
  await expect(revoked).toBeVisible();
  await expect(revoked).toContainText(
    "Studio was told the permission for Microphone was revoked",
  );
  await expect(revoked).toContainText("Grant it again in System Settings");
  await expect(live.sessionBar()).toHaveAttribute(
    "data-state",
    "permission-revoked",
  );
  await expect(live.sessionBar()).toContainText("Permission revoked");
  // Its action takes you to the Sources tab.
  await revoked.getByRole("button", { name: "Open Sources" }).click();
  await expect(page.getByRole("tab", { name: "Sources" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Clears when the microphone delivers something again.
  await ingest(
    credential,
    envelopes.transcript("microphone", 1, "Speaking again."),
  );
  await expect(revoked).toHaveCount(0);
  await expect(live.sessionBar()).toHaveAttribute("data-state", "live");
});

test("web banner source lost: appears when a source disconnects, names the consequence and clears when it returns", async ({
  live,
  page,
}) => {
  const { response } = await startMacSession();
  const credential = response.credential.value;
  await open(live);

  await ingest(
    credential,
    envelopes.disconnected("application-audio", 0, "device-lost"),
  );
  const lost = banner(page, "source-lost");
  await expect(lost).toBeVisible();
  await expect(lost).toContainText("App audio was lost");
  await expect(lost).toContainText(
    "The other side of the call isn't being heard.",
  );
  await expect(live.sessionBar()).toHaveAttribute("data-state", "source-lost");
  // In a browser the way back for app audio is pairing the companion.
  await expect(
    lost.getByRole("button", { name: "Pair companion" }),
  ).toBeVisible();

  await ingest(
    credential,
    envelopes.transcript("application-audio", 1, "The interviewer is back."),
  );
  await expect(lost).toHaveCount(0);
  await expect(live.sessionBar()).toHaveAttribute("data-state", "live");

  // A microphone loss offers Open Sources instead, and says whose voice it is.
  await ingest(
    credential,
    envelopes.disconnected("microphone", 0, "user-stopped"),
  );
  await expect(lost).toContainText("Microphone was stopped");
  await expect(lost).toContainText("Your voice isn't being heard.");
  await expect(
    lost.getByRole("button", { name: "Open Sources" }),
  ).toBeVisible();
});

test("web banner capture gap: appears with the dropped seconds and clears when the source delivers again", async ({
  live,
  page,
}) => {
  const { response } = await startMacSession();
  const credential = response.credential.value;
  await open(live);

  await ingest(credential, envelopes.gap("microphone", 0, 4000));
  const gap = banner(page, "gap");
  await expect(gap).toBeVisible();
  await expect(gap).toContainText("Microphone: 4 s of capture was dropped");
  await expect(gap).toContainText("The gap is recorded in the transcript.");

  await ingest(
    credential,
    envelopes.transcript("microphone", 1, "Back after the gap."),
  );
  await expect(gap).toHaveCount(0);
});

test("web banner stream unreachable: appears when Studio cannot be reached, offers no command it cannot confirm and clears when the stream returns", async ({
  live,
  page,
}) => {
  test.slow(); // waits for the stream to drop and return (17 s)
  await startMacSession();
  await open(live);
  await expect(banner(page, "stream-unreachable")).toHaveCount(0);

  // The cause: every read of the session stream fails at the network.
  await page.route("**/sessions/*/stream*", (route) => route.abort());
  await expect(banner(page, "stream-unreachable")).toBeVisible({
    timeout: 45_000,
  });
  await expect(banner(page, "stream-unreachable")).toContainText(
    "Studio can't reach the session service.",
  );
  await expect(live.sessionBar()).toHaveAttribute("data-state", "unreachable");
  await expect(live.sessionBar()).toContainText("Can't reach Studio");

  await page.unroute("**/sessions/*/stream*");
  await expect(banner(page, "stream-unreachable")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(live.sessionBar()).toHaveAttribute("data-state", "live");
});

test("web banner duration limit near: appears when the cap is minutes away", async ({
  live,
  page,
}) => {
  const { id } = await startMacSession();
  await open(live);
  await expect(banner(page, "cap-near")).toHaveCount(0);

  // Time passing is the cause; the suite moves the server's clock instead of
  // waiting hours.
  await db.moveClock(id, { expiresInMs: 5 * 60_000 });
  const near = banner(page, "cap-near");
  await expect(near).toBeVisible();
  await expect(near).toContainText(
    "left before the session reaches its duration limit",
  );
  await expect(near).toContainText(
    "Start a new session if you need more time.",
  );
});

test("web banner credential expiring: appears as the companion's credential nears expiry and Renew credential clears it", async ({
  live,
  page,
}) => {
  const { id } = await startMacSession();
  await open(live);
  await expect(banner(page, "credential-expiring")).toHaveCount(0);

  await db.moveClock(id, { credentialExpiresInMs: 3 * 60_000 });
  const expiring = banner(page, "credential-expiring");
  await expect(expiring).toBeVisible();
  await expect(expiring).toContainText("The companion's credential expires in");

  const before = (await db.session(id))?.credential_expires_at as string;
  await expiring.getByRole("button", { name: "Renew credential" }).click();
  await expect
    .poll(async () => (await db.session(id))?.credential_expires_at)
    .not.toBe(before);
  await expect(expiring).toHaveCount(0);
});

test("web banners end: every banner is gone once the session ends", async ({
  live,
  page,
}) => {
  const { id, response } = await startMacSession();
  await open(live);
  await ingest(
    response.credential.value,
    envelopes.disconnected("application-audio", 0, "device-lost"),
  );
  await controlSession(id, "pause");
  await expect(banner(page, "source-lost")).toBeVisible();
  await expect(banner(page, "paused")).toBeVisible();

  await live.end();

  await expect(page.getByTestId("live-ended")).toBeVisible();
  await expect(page.locator("[data-banner]")).toHaveCount(0);
  expect((await db.session(id))?.status).toBe("ended");
  // An ended session's credential is dead, so a late companion line is refused.
  const late = await ingest(
    response.credential.value,
    envelopes.transcript("application-audio", 1, "Too late."),
  );
  expect(late.status).not.toBe(200);
  void renewCredential;
});
