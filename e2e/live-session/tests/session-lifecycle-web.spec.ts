// The live session's lifecycle on the web page: Pause, Resume, Stop analysis
// (which is NOT pause and NOT end), the End confirmation, the ended summary,
// history, delete, and "Start another session". Each test observes what the
// server did (the session row, the action row, the cancelled model call), not
// only what the page says.
import { expect, test } from "../src/fixtures/test";
import {
  controlSession,
  envelopes,
  ingest,
  type SessionApiList,
  sessionApi,
  startSessionViaApi,
} from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import type { LivePage } from "../src/pages/live-page";
import type { Control } from "../src/stack/control";

const QUESTION = "What is a closure in JavaScript?";
const _FOLLOW_UP = "And how does it differ from a class?";

// A session that is mid-run: the scripted model is held at its gate, a question
// has been heard, and the worker's draft is in flight.
async function sessionWithRunInFlight(control: Control) {
  await control.scenario("plain-answer", { hold: true });
  const { id, response } = await startSessionViaApi({ liveAssistance: true });
  await hearQuestion(response.credential.value, 0);
  await expect.poll(() => control.waiting()).toBe(1);
  await expect
    .poll(async () => (await db.actions(id)).map((a) => a.dispatch_status))
    .toEqual(["in_flight"]);
  return { id, credential: response.credential.value };
}

async function hearQuestion(
  credential: string,
  sequence: number,
  text = QUESTION,
): Promise<void> {
  const ack = await ingest(
    credential,
    envelopes.transcript("application-audio", sequence, text),
  );
  expect(ack.status).toBe(200);
}

const endDialog = (live: LivePage) =>
  live.page.getByRole("alertdialog", { name: "End this session?" });

test("web session bar Pause: pauses the session on the server and cancels the work that was running", async ({
  live,
  control,
}) => {
  const { id } = await sessionWithRunInFlight(control);
  await live.goto();
  const bar = live.sessionBar();
  await expect(bar).toHaveAttribute("data-state", "live");

  await bar.getByRole("button", { name: "Pause", exact: true }).click();

  // The server holds the pause...
  await expect.poll(async () => (await db.session(id))?.status).toBe("paused");
  // ...the run that was in flight was cancelled at the model (not left
  // running) and its action was suppressed, not published...
  await expect.poll(() => control.waiting()).toBe(0);
  expect((await control.calls())[0]).toMatchObject({ outcome: "cancelled" });
  const [action] = await db.actions(id);
  expect(action).toMatchObject({ dispatch_status: "suppressed", shown: false });
  // ...and the page says so: the bar reads Paused and the toggle is Resume.
  await expect(bar).toHaveAttribute("data-state", "paused");
  await expect(bar.getByRole("status").first()).toHaveText("Paused");
  await expect(
    bar.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await expect(
    bar.getByRole("button", { name: "Pause", exact: true }),
  ).toBeHidden();
  await expect(bar).toContainText(
    "Paused. Running work is being cancelled and nothing new will start.",
  );

  // What the paused page discards stays discarded when the model finally
  // answers: nothing is published and no hint is counted.
  await control.release();
  await expect.poll(() => control.waiting()).toBe(0);
  expect((await db.actions(id))[0]?.dispatch_status).toBe("suppressed");
  expect((await db.session(id))?.shown_draft_count).toBe(0);
});

test("web session bar Resume: resumes the session on the server and new questions are answered again", async ({
  live,
  control,
}) => {
  await control.scenario("plain-answer");
  const { id, response } = await startSessionViaApi({ liveAssistance: true });
  await controlSession(id, "pause");
  await live.goto();
  const bar = live.sessionBar();
  await expect(bar).toHaveAttribute("data-state", "paused");

  await bar.getByRole("button", { name: "Resume", exact: true }).click();

  await expect.poll(async () => (await db.session(id))?.status).toBe("active");
  await expect(bar).toHaveAttribute("data-state", "live");
  await expect(
    bar.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect(bar).toContainText("Resumed.");

  // Work flows again: a question heard now is drafted.
  await hearQuestion(response.credential.value, 0);
  await expect
    .poll(async () => (await db.actions(id)).map((a) => a.action_kind))
    .toContain("draft-answer");
  await expect
    .poll(async () => (await db.actions(id))[0]?.dispatch_status)
    .toBe("succeeded");
});

test("web session bar End and Keep going: nothing changes until End session is confirmed, and Keep going or Escape keeps the session", async ({
  live,
  page,
}) => {
  const { id } = await startSessionViaApi();
  await live.goto();
  const bar = live.sessionBar();
  const endButton = bar.getByRole("button", { name: "End", exact: true });
  const dialog = endDialog(live);

  // Opening the dialog changes nothing on the server and focuses Keep going.
  await endButton.click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Keep going" }),
  ).toBeFocused();
  expect((await db.session(id))?.status).toBe("active");

  // Keep going closes it, returns focus to End, and the session stays active.
  await dialog.getByRole("button", { name: "Keep going" }).click();
  await expect(dialog).toBeHidden();
  await expect(endButton).toBeFocused();
  expect((await db.session(id))?.status).toBe("active");

  // Escape does the same.
  await endButton.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect((await db.session(id))?.status).toBe("active");
  await expect(bar).toHaveAttribute("data-state", "live");
});

test("web session bar End session: ends the session, cancels running work and discards a result that arrives later", async ({
  live,
  control,
  page,
}) => {
  const { id } = await sessionWithRunInFlight(control);
  await live.goto();

  await live.end();

  await expect.poll(async () => (await db.session(id))?.status).toBe("ended");
  expect((await db.session(id))?.ended_at).not.toBeNull();
  // Capture stops (the credential is revoked), running work is cancelled...
  expect((await db.session(id))?.credential_revoked_at).not.toBeNull();
  await expect.poll(() => control.waiting()).toBe(0);
  expect((await control.calls())[0]).toMatchObject({ outcome: "cancelled" });
  // ...and the result the model produces afterwards is discarded.
  await control.release();
  await expect.poll(() => control.waiting()).toBe(0);
  expect((await db.actions(id))[0]).toMatchObject({
    dispatch_status: "suppressed",
    shown: false,
  });
  await expect(
    page.getByRole("heading", { name: /^Session ended/ }),
  ).toBeVisible();
});

test("web ended summary: the card's counts match what the server stored", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("plain-answer");
  const { id, response } = await startSessionViaApi({ liveAssistance: true });
  await hearQuestion(response.credential.value, 0);
  await expect
    .poll(async () => (await db.actions(id))[0]?.dispatch_status)
    .toBe("succeeded");
  await live.goto();

  await live.end();

  const stat = (label: string) =>
    page
      .getByTestId("ended-stats")
      .locator(".ended-stat")
      .filter({ has: page.getByText(label, { exact: true }) })
      .locator("dd");
  const observations = await db.observations(id);
  const actions = await db.actions(id);
  await expect(stat("Utterances")).toHaveText(
    String(observations.filter((o) => o.kind === "transcript.final").length),
  );
  await expect(stat("Tasks")).toHaveText(
    String(new Set(actions.map((a) => a.task_id)).size),
  );
  await expect(stat("Answers published")).toHaveText(
    String(actions.filter((a) => a.shown).length),
  );
  await expect(stat("Code drafts")).toHaveText("0");
  // The heading carries the server's elapsed time and the retention it kept.
  await expect(
    page.getByRole("heading", { name: /^Session ended · \d+:\d{2}$/ }),
  ).toBeVisible();
  await expect(page.getByTestId("ended-retention")).toContainText(
    "Delete at end",
  );
});

test("web ended Open session history: lists the server's sessions newest first and Open reopens that session", async ({
  live,
  page,
}) => {
  // Two finished sessions so "newest first" is observable.
  const first = await startSessionViaApi({ retention: "until-deleted" });
  await controlSession(first.id, "end");
  const second = await startSessionViaApi();
  await live.goto();
  await live.end();
  await expect
    .poll(async () => (await db.session(second.id))?.status)
    .toBe("ended");

  const historyButton = page.getByRole("button", {
    name: "Open session history",
  });
  await expect(historyButton).toHaveAttribute("aria-expanded", "false");
  await historyButton.click();
  await expect(
    page.getByRole("button", { name: "Hide session history" }),
  ).toHaveAttribute("aria-expanded", "true");

  // The page lists exactly what the server's list route returns.
  const listed = (await sessionApi("?limit=10")).body as SessionApiList;
  expect(listed.sessions[0]?.id).toBe(second.id);
  expect(listed.sessions[1]?.id).toBe(first.id);
  const rows = page.getByTestId("session-history").locator("li");
  await expect(rows).toHaveCount(Math.min(10, listed.sessions.length));
  await expect(rows.nth(0)).toContainText("Ended");
  await expect(rows.nth(0)).toContainText("Delete at end");
  await expect(rows.nth(1)).toContainText("Ended");
  await expect(rows.nth(1)).toContainText("Until I delete");

  // Open on the second row reopens the OLDER session: the URL names it and
  // the ended view shows its retention.
  await rows
    .nth(1)
    .getByRole("button", { name: /^Open .* session from / })
    .click();
  await expect(page).toHaveURL(new RegExp(`${first.id}$`));
  await expect(page.getByTestId("live-ended")).toBeVisible();
  await expect(page.getByTestId("ended-retention")).toContainText(
    "Until I delete",
  );
});

test("web ended Delete session data: asks first, then removes the session's content and shows it deleted", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("plain-answer");
  const { id, response } = await startSessionViaApi({ liveAssistance: true });
  await hearQuestion(response.credential.value, 0);
  await expect
    .poll(async () => (await db.actions(id))[0]?.dispatch_status)
    .toBe("succeeded");
  expect((await db.observations(id)).length).toBeGreaterThan(0);
  await controlSession(id, "end");
  await page.goto(`${live.livePath()}/${id}`);
  await expect(page.getByTestId("live-ended")).toBeVisible();

  const deleteButton = page.getByRole("button", {
    name: "Delete session data",
  });
  const confirm = page.getByRole("group", {
    name: "Confirm deleting session data",
  });

  // Asking is not deleting: Keep session data backs out and nothing is touched.
  await deleteButton.click();
  await expect(confirm).toBeVisible();
  await page.getByRole("button", { name: "Keep session data" }).click();
  await expect(confirm).toBeHidden();
  await expect(deleteButton).toBeFocused();
  expect((await db.session(id))?.status).toBe("ended");
  expect((await db.observations(id)).length).toBeGreaterThan(0);

  // Confirming deletes: the server purges the content and sets the tombstone.
  await deleteButton.click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect
    .poll(async () => (await db.session(id))?.purged_at, { timeout: 60_000 })
    .not.toBeNull();
  expect(await db.observations(id)).toEqual([]);
  expect(await db.actions(id)).toEqual([]);
  expect((await db.session(id))?.purge_outcome).toBe("complete");
  // The page shows it deleted, not the content it used to hold.
  await expect(page.getByTestId("ended-tombstone")).toContainText(
    "Session data deleted",
  );
  await expect(page.getByTestId("ended-retention")).toContainText("Deleted");
  await expect(page.getByTestId("ended-stats")).toBeHidden();
});

test("web ended Start another session: returns to a blank setup page with nothing carried over", async ({
  live,
  page,
}) => {
  await live.goto();
  await live.startRehearsal();
  await live.end();
  await expect(page.getByTestId("live-ended")).toBeVisible();
  const sessionsBefore = (await db.sessions()).length;

  await page.getByRole("button", { name: "Start another session" }).click();

  await expect(page.getByTestId("live-setup")).toBeVisible();
  await expect(page.getByTestId("live-ended")).toBeHidden();
  // Nothing carried over: no target, no consent, Start blocked, and the click
  // itself created no session.
  await expect(live.rehearsal()).not.toBeChecked();
  await expect(live.consent()).not.toBeChecked();
  await expect(live.startButton()).toBeDisabled();
  expect(await db.sessions()).toHaveLength(sessionsBefore);
  expect(
    (await db.sessions()).filter((row) =>
      ["active", "paused"].includes(row.status),
    ),
  ).toEqual([]);
});
