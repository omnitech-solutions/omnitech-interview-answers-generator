// The Setup page: every choice, and what it WRITES server-side. Each test
// starts a session through the page and then reads the row the server holds
// (or the model call the worker made), never the page's own state.
import { expect, test } from "../src/fixtures/test";
import { envelopes, ingest, renewCredential } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { SetupPage } from "../src/pages/setup-page";

const QUESTION = "What is a closure in JavaScript?";

type Sources = { captureSources: string[]; liveAssistance: boolean };
const sourcesOf = (row: { sources: unknown }) => row.sources as Sources;

// What the other side's audio carries into the session, as the companion would
// send it (the page never holds the credential after Start).
async function hear(sessionId: string, text = QUESTION): Promise<void> {
  const credential = await renewCredential(sessionId);
  const ack = await ingest(
    credential,
    envelopes.transcript("application-audio", 0, text),
  );
  expect(ack.status).toBe(200);
}

test("setup consent: Start is blocked with its reason until the box is checked, and no consent answer is stored", async ({
  page,
}) => {
  const setup = new SetupPage(page);
  await setup.goto();
  const before = (await db.sessions()).length;

  // Nothing chosen: Start is disabled and says the first thing in the way.
  await expect(setup.start()).toBeDisabled();
  await expect(setup.footerState()).toHaveText(
    "Choose what the session is for.",
  );
  await setup.rehearsal().check();
  await expect(setup.footerState()).toHaveText("Confirm everyone has agreed.");
  await expect(setup.start()).toBeDisabled();

  // Checking consent is what makes Start possible; unchecking takes it away.
  await setup.consent().check();
  await expect(setup.footerState()).toHaveText("Ready");
  await expect(setup.start()).toBeEnabled();
  await setup.consent().uncheck();
  await expect(setup.start()).toBeDisabled();
  expect(await db.sessions()).toHaveLength(before);

  // Studio asks and does not store the answer: no consent column, no consent
  // key in the stored start snapshot.
  await setup.consent().check();
  const row = await setup.pressStart();
  const columns = await db.sessionColumns();
  expect(columns.filter((name) => /consent|agree/i.test(name))).toEqual([]);
  expect(Object.keys(row.sources as object).join(" ")).not.toMatch(/consent/i);
});

test("setup strict rehearsal: turns live assistance off, stores strict and a heard question drafts nothing", async ({
  page,
  control,
}) => {
  await control.scenario("plain-answer");
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.rehearsal().check();
  await setup.hostMac().check();

  // Before: assistance is on and adjustable.
  await expect(setup.assistance()).toHaveAttribute("aria-checked", "true");
  await expect(setup.assistance()).toBeEnabled();
  await setup.strict().check();
  // After: the switch is off, locked, and says why.
  await expect(setup.assistance()).toHaveAttribute("aria-checked", "false");
  await expect(setup.assistance()).toBeDisabled();
  await expect(
    page.getByText("A strict rehearsal turns live assistance off."),
  ).toBeVisible();

  await setup.consent().check();
  const session = await setup.pressStart();
  expect(session.strict).toBe(true);
  expect(session.rehearsal_run_id).not.toBeNull();
  expect(sourcesOf(session).liveAssistance).toBe(false);

  // A question the other side asks is stored, shown, and answered by nobody.
  await hear(session.id);
  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(page.getByText(QUESTION)).toBeVisible();
  expect(await db.actions(session.id)).toEqual([]);
  expect(await control.calls()).toEqual([]);
});

test("setup host Mac app: selects the Mac host, says what a browser cannot know, and starts with the Mac sources", async ({
  page,
}) => {
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.hostMac().check();
  await expect(setup.hostMac()).toBeChecked();
  await expect(setup.hostBrowser()).not.toBeChecked();

  // A plain browser cannot see the Mac app's abilities: those lines say so
  // ("Not known"), the status says it cannot tell, and nothing claims
  // "Installed" or "Yes".
  const lines = page.getByTestId("host-lines-mac");
  await expect(lines).toContainText("known only inside the Mac app");
  await expect(lines.getByText("Not known:").first()).toBeVisible();
  await expect(page.getByTestId("host-status-mac")).toHaveText(
    "Can’t tell from a browser",
  );
  await expect(page.getByTestId("live-setup")).not.toContainText(/Installed/);
  // The lines about the app's own abilities never say Yes from a browser. (The
  // speech and permission lines are the companion's own report and may read Yes
  // when an earlier test in the same stack left a report: real data, not a claim.)
  for (const ability of ["Sees the screen", "Floating window"])
    await expect(lines.locator("li", { hasText: ability })).toHaveAttribute(
      "data-state",
      "unknown",
    );
  // The Mac host's default sources are all three.
  for (const name of ["Microphone", "App audio", "Screen"] as const)
    await expect(setup.source(name)).toHaveAttribute("aria-checked", "true");

  await setup.fillRequired();
  const row = await setup.pressStart();
  expect(sourcesOf(row).captureSources).toEqual([
    "microphone",
    "application-audio",
    "screen",
  ]);
});

test("setup host this browser only: selects the browser host, warns it cannot hear the other side, and starts without app audio", async ({
  page,
}) => {
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.hostMac().check();
  await expect(page.getByTestId("browser-warning")).toBeHidden();
  await setup.hostBrowser().check();
  await expect(setup.hostBrowser()).toBeChecked();

  // The browser host says what it can and cannot do, and drops app audio.
  await expect(page.getByTestId("browser-warning")).toContainText(
    "can’t hear app audio",
  );
  await expect(page.getByTestId("host-lines-browser")).toContainText(
    "Can’t hear the other side",
  );
  await expect(setup.source("App audio")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(setup.source("Microphone")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await setup.fillRequired();
  const row = await setup.pressStart();
  expect(sourcesOf(row).captureSources).toEqual(["microphone", "screen"]);
});

test("setup source Microphone: the session records the microphone only when the switch is on", async ({
  page,
}) => {
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.fillRequired();
  await setup.hostMac().check();
  await expect(setup.source("Microphone")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await setup.source("Microphone").click();
  await expect(setup.source("Microphone")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  const row = await setup.pressStart();
  expect(sourcesOf(row).captureSources).toEqual([
    "application-audio",
    "screen",
  ]);
});

test("setup source App audio: the session records application audio only when the switch is on", async ({
  page,
}) => {
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.fillRequired();
  // The browser host leaves it off; the switch turns it on.
  await setup.hostBrowser().check();
  await expect(setup.source("App audio")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await setup.source("App audio").click();
  await expect(setup.source("App audio")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const row = await setup.pressStart();
  expect(sourcesOf(row).captureSources).toEqual([
    "microphone",
    "application-audio",
    "screen",
  ]);
});

test("setup source Screen: the session records the screen only when the switch is on", async ({
  page,
}) => {
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.fillRequired();
  await setup.hostMac().check();
  await setup.source("Screen").click();
  await expect(setup.source("Screen")).toHaveAttribute("aria-checked", "false");
  const row = await setup.pressStart();
  expect(sourcesOf(row).captureSources).toEqual([
    "microphone",
    "application-audio",
  ]);
});

test("setup sources none: with every source off Start is blocked and says so", async ({
  page,
}) => {
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.fillRequired();
  await setup.hostMac().check();
  const before = (await db.sessions()).length;
  for (const name of ["Microphone", "App audio", "Screen"] as const)
    await setup.source(name).click();
  await expect(setup.footerState()).toHaveText("Choose at least one source.");
  await expect(setup.start()).toBeDisabled();
  expect(await db.sessions()).toHaveLength(before);
});

test("setup live assistance on: a question heard from the other side is drafted by the model", async ({
  page,
  control,
}) => {
  await control.scenario("plain-answer");
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.fillRequired();
  await setup.hostMac().check();
  await expect(setup.assistance()).toHaveAttribute("aria-checked", "true");
  const session = await setup.pressStart();
  expect(sourcesOf(session).liveAssistance).toBe(true);

  await hear(session.id);
  await expect
    .poll(async () => (await db.actions(session.id)).map((a) => a.action_kind))
    .toContain("draft-answer");
  await expect.poll(async () => (await control.calls()).length).toBe(1);
});

test("setup live assistance off: nothing is drafted for a question heard from the other side", async ({
  page,
  control,
}) => {
  await control.scenario("plain-answer");
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.fillRequired();
  await setup.hostMac().check();
  await setup.assistance().click();
  await expect(setup.assistance()).toHaveAttribute("aria-checked", "false");
  const session = await setup.pressStart();
  expect(sourcesOf(session).liveAssistance).toBe(false);

  // The same question the "on" test sends: it is stored and shown, but no
  // draft action and no model call ever follows.
  await hear(session.id);
  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(page.getByText(QUESTION)).toBeVisible();
  expect(await db.actions(session.id)).toEqual([]);
  expect(await control.calls()).toEqual([]);
});

test("setup import matrix: with no matrix the link takes you to Briefings", async ({
  page,
}) => {
  const setup = new SetupPage(page);
  await setup.goto();
  await expect(
    page.getByText("You have no experience matrix yet."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import one in Briefings" }).click();
  await expect(page).toHaveURL(/\/briefings/);
  await expect(page.getByTestId("live-setup")).toBeHidden();
});

test("setup policy Allow remote: the session is remote and its question goes through the agent runtime", async ({
  page,
  control,
}) => {
  await control.scenario("plain-answer");
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.fillRequired();
  await setup.hostMac().check();
  await setup.policy("Allow remote").check();
  await expect(setup.policy("Allow remote")).toBeChecked();
  const session = await setup.pressStart();
  expect(session.processing_policy).toBe("permitted_remote");

  await hear(session.id);
  await expect.poll(async () => (await control.calls()).length).toBe(1);
  expect((await control.calls())[0]).toMatchObject({ via: "agent-runtime" });
});

test("setup policy Device only: the session is device-only and its question never reaches the agent runtime", async ({
  page,
  control,
}) => {
  await control.scenario("plain-answer");
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.fillRequired();
  await setup.hostMac().check();
  await setup.policy("Device only").check();
  await expect(setup.policy("Device only")).toBeChecked();
  await expect(page.getByTestId("device-only-warning")).toBeVisible();
  const session = await setup.pressStart();
  expect(session.processing_policy).toBe("device_only");

  await hear(session.id);
  await expect
    .poll(async () => (await control.calls()).length)
    .toBeGreaterThan(0);
  const calls = await control.calls();
  expect(calls.filter((call) => call.via === "agent-runtime")).toEqual([]);
  expect(calls[0]).toMatchObject({ via: "direct-model" });
});

test("setup retention Delete at end: the session is stored with delete-at-end retention", async ({
  page,
}) => {
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.fillRequired();
  await setup.retention("30 days").check();
  await setup.retention("Delete at end").check();
  await expect(setup.retention("Delete at end")).toBeChecked();
  expect((await setup.pressStart()).retention_mode).toBe("delete_at_end");
});

test("setup retention 30 days: the session is stored with thirty-day retention", async ({
  page,
}) => {
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.fillRequired();
  await setup.retention("30 days").check();
  await expect(setup.retention("30 days")).toBeChecked();
  expect((await setup.pressStart()).retention_mode).toBe("thirty_days");
});

test("setup retention Until I delete: the session is stored as kept until deleted", async ({
  page,
}) => {
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.fillRequired();
  await setup.retention("Until I delete").check();
  await expect(setup.retention("Until I delete")).toBeChecked();
  expect((await setup.pressStart()).retention_mode).toBe("until_deleted");
});
