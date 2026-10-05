// Sources tab and the session bar's source chips: each says the source's REAL
// state, as the capture companion reported it to the server (heartbeat,
// source.disconnected, capture.gap, a transcript or screenshot that clears a
// problem). The companion is the scripted side (src/helpers/companion.ts speaks
// the ingest wire with the pairing credential); the page and the server are real.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/test";
import { startSessionViaApi } from "../src/helpers/api";
import { Companion } from "../src/helpers/companion";
import { db } from "../src/helpers/sql";

const ALL_SOURCES = ["microphone", "application-audio", "screen"] as const;

// Opens an existing session on the Sources tab; `row` is one source's line in
// the tab, `chip` its chip in the session bar.
async function openSources(
  page: Page,
  live: { livePath(): string },
  sessionId: string,
) {
  await page.goto(`${live.livePath()}/${sessionId}`);
  await page.getByRole("tab", { name: "Sources" }).click();
  const panel = page.getByRole("tabpanel", { name: "Sources" });
  await expect(panel).toBeVisible();
  const row = (name: string): Locator =>
    panel
      .locator('li.live-source:not([data-testid="companion-row"])')
      .filter({ has: page.getByText(name, { exact: true }) });
  const chip = (source: string): Locator =>
    page
      .getByTestId("session-bar")
      .locator(`li.live-chip[data-source="${source}"]`);
  return { panel, row, chip };
}

const kinds = async (sessionId: string): Promise<string[]> =>
  (await db.observations(sessionId)).map((row) => row.kind);

test("sources tab: with no companion contact each selected source says it is not receiving and what it needs", async ({
  live,
  page,
}) => {
  const { id } = await startSessionViaApi({ captureSources: [...ALL_SOURCES] });
  const { row, chip, panel } = await openSources(page, live, id);

  await expect(row("Microphone")).toContainText("Not receiving");
  await expect(row("Microphone")).toContainText(
    "Needs the capture companion. Dictation in the browser works without it.",
  );
  await expect(row("App audio")).toContainText(
    "Needs the capture companion for system audio.",
  );
  await expect(row("Screen")).toContainText(
    "Use Capture & analyze to share a window or screen.",
  );
  // The bar's chip carries the same state in its tooltip and the companion chip
  // says, once, that the companion is not connected.
  await expect(chip("microphone")).toHaveAttribute(
    "title",
    "Microphone · not receiving",
  );
  await expect(page.getByTestId("companion-chip")).toHaveText(
    "Capture companion: not connected",
  );
  await expect(panel.getByTestId("pairing-status")).toHaveText(
    "Capture companion hasn’t made contact",
  );
  // Nothing was observed: the server holds no observation row either.
  expect(await kinds(id)).toEqual([]);
});

test("sources tab: a heartbeat puts the companion in contact and the selected sources read Receiving", async ({
  live,
  page,
}) => {
  const { id, response } = await startSessionViaApi({
    captureSources: [...ALL_SOURCES],
  });
  const { row, chip, panel } = await openSources(page, live, id);
  await expect(panel.getByTestId("pairing-status")).toContainText(
    "hasn’t made contact",
  );

  // The server accepts the heartbeat and stamps contact; the page follows.
  const ack = await new Companion(response.credential.value).heartbeat();
  expect(ack.status).toBe(200);
  expect(ack.body).toMatchObject({ status: "accepted" });

  await expect(panel.getByTestId("pairing-status")).toContainText(
    "In contact · last heard",
  );
  await expect(row("Microphone")).toContainText("Receiving");
  await expect(row("App audio")).toContainText("Receiving");
  await expect(chip("screen")).toHaveAttribute("title", "Screen · receiving");
  await expect(page.getByTestId("companion-chip")).toBeHidden();
  // The note that said the companion was needed is gone with the contact.
  await expect(row("Microphone")).not.toContainText(
    "Needs the capture companion",
  );
});

test("sources tab: stopped, revoked, lost and dropped each read differently, and the next thing heard clears them", async ({
  live,
  page,
}) => {
  const { id, response } = await startSessionViaApi({
    captureSources: [...ALL_SOURCES],
  });
  const companion = new Companion(response.credential.value);
  await companion.heartbeat();
  const { row, chip } = await openSources(page, live, id);
  await expect(row("Microphone")).toContainText("Receiving");

  // The person stopped the microphone in the companion.
  await companion.disconnected("microphone", "user-stopped");
  await expect(row("Microphone")).toContainText("Disconnected");
  await expect(chip("microphone")).toHaveAttribute(
    "title",
    "Microphone · disconnected",
  );
  await expect(chip("microphone")).toHaveAttribute("data-alert", "true");

  // The system withdrew screen access: its own state, with the reason on the chip.
  await companion.disconnected("screen", "permission-revoked");
  await expect(row("Screen")).toContainText("Permission revoked");
  await expect(chip("screen")).toHaveAttribute(
    "data-reason",
    "permission-revoked",
  );
  await expect(chip("screen")).toHaveAttribute(
    "title",
    "Screen · permission revoked, the system withdrew access",
  );

  // The device went away.
  await companion.disconnected("application-audio", "device-lost");
  await expect(row("App audio")).toContainText("Capture lost");
  await expect(chip("application-audio")).toHaveAttribute(
    "title",
    "App audio · capture lost, device lost",
  );

  // Every label above is backed by a row the server holds.
  await expect
    .poll(
      async () =>
        (await kinds(id)).filter((kind) => kind === "source.disconnected")
          .length,
    )
    .toBe(3);

  // The next thing HEARD from a source clears its problem.
  await companion.transcript("hello again", "microphone");
  await expect(row("Microphone")).toContainText("Receiving");
  await expect(chip("microphone")).toHaveAttribute(
    "title",
    "Microphone · receiving",
  );
  // A screenshot clears the screen; the lost app audio stays lost until the
  // app audio itself is heard again.
  await companion.screenshot();
  await expect(row("Screen")).toContainText("Receiving");
  await expect(row("App audio")).toContainText("Capture lost");
  await companion.transcript("and the other side", "application-audio");
  await expect(row("App audio")).toContainText("Receiving");

  // A dropped-audio gap reads as such, with its length.
  await companion.gap("application-audio", "buffer-overflow");
  await expect(row("App audio")).toContainText("Audio dropped");
  await expect(chip("application-audio")).toHaveAttribute(
    "title",
    "App audio · audio dropped for 4 s",
  );
});

test("sources tab: a source the session did not select is Not selected and has no bar chip", async ({
  live,
  page,
}) => {
  const { id } = await startSessionViaApi({ captureSources: ["microphone"] });
  const { row, chip } = await openSources(page, live, id);
  await expect(row("Screen")).toContainText("Not selected");
  await expect(row("App audio")).toContainText("Not selected");
  await expect(chip("microphone")).toBeVisible();
  await expect(chip("screen")).toHaveCount(0);
  await expect(chip("application-audio")).toHaveCount(0);
});

test("app audio: what the other side said is stored and shown as a transcript, and a source the session never selected is refused by the server", async ({
  live,
  page,
}) => {
  const { id, response } = await startSessionViaApi({
    captureSources: ["microphone", "application-audio"],
    liveAssistance: false,
  });
  const companion = new Companion(response.credential.value);
  await companion.heartbeat();
  const heard = "Walk me through how you would design a rate limiter.";
  expect((await companion.transcript(heard)).body).toMatchObject({
    status: "accepted",
  });
  await page.goto(`${live.livePath()}/${id}`);
  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(
    page.getByRole("tabpanel", { name: "Transcript" }),
  ).toContainText(heard);
  expect(await kinds(id)).toContain("transcript.final");

  // The screen was never selected: its snapshot is refused and nothing is stored.
  const before = (await db.observations(id)).length;
  const refused = await companion.screenshot();
  expect(refused.body).toMatchObject({ status: "refused" });
  expect((await db.observations(id)).length).toBe(before);
});

test("capability report: the companion's own speech and permission state is shown as reported, not assumed", async ({
  live,
  page,
}) => {
  const { id, response } = await startSessionViaApi({
    captureSources: [...ALL_SOURCES],
  });
  const companion = new Companion(response.credential.value);
  await companion.heartbeat();
  // The report is read when the page opens (and re-read every 15 s in the tab
  // and every 30 s in the bar), so it is sent before opening the page.
  expect(
    (
      await companion.capabilityReport({
        onDeviceAvailable: false,
        microphone: "denied",
        screen: "not-determined",
      })
    ).body,
  ).toMatchObject({ status: "accepted" });
  const { panel } = await openSources(page, live, id);

  await expect(panel).toContainText("Not available on this Mac (en-US)");
  await expect(panel).toContainText("denied");
  await expect(page.getByTestId("speech-chip")).toContainText(
    "Speech: Not available on this Mac",
  );
});
