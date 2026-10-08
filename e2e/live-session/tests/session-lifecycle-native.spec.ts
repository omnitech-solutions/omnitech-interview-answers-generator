// The native panel's lifecycle controls, through the recording host shim: the
// footer's Pause/Resume and End, the ended card, and the window dots (red Quit,
// yellow Hide, green Full screen). The effect is the session row the server
// holds or the bridge call the shell would have received, never the label.
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/test";
import { controlSession, startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import type { NativePanel } from "../src/pages/native-panel";

async function openPanel(
  native: { open(): Promise<NativePanel> },
  sessionId: string,
): Promise<NativePanel> {
  const panel = await native.open();
  await panel.goto({ panel: "single", handsFree: true, sessionId });
  await expect(
    panel.page.getByRole("toolbar", { name: "Session controls" }),
  ).toBeVisible();
  return panel;
}

// The footer's End confirmation is the library's popover (a dialog that carries
// its question as text, not as a name).
const endDialog = (page: Page) =>
  page.getByRole("dialog").filter({ hasText: "End this session?" });

test("@native native footer Pause and Resume: toggle the session on the server and the engine and footer follow", async ({
  native,
}) => {
  const { id } = await startSessionViaApi();
  const panel = await openPanel(native, id);
  const { page, host } = panel;

  // Pause: the row is paused, the capture engine is told to hold, the toggle
  // becomes Resume and the footer says paused.
  await host.clear();
  await page.getByRole("button", { name: "Pause session" }).click();
  await expect.poll(async () => (await db.session(id))?.status).toBe("paused");
  await expect
    .poll(async () => (await host.calls("engine.pause")).length)
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: "Resume session" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pause session" }),
  ).toBeHidden();
  // Design change: the paused strip row and banner are gone; paused is shown by
  // the footer (the amber clock group named "..., paused", one Resume) and the locks.
  const footer = page.getByRole("toolbar", { name: "Session footer" });
  await expect(
    footer.getByRole("group", { name: /^Session time .*, paused$/ }),
  ).toBeVisible();
  await expect(footer).toContainText("Paused");
  await expect(page.getByTestId("pn-strip")).toHaveCount(0);

  // The one Resume resumes the session (and re-arms the engine).
  await host.clear();
  await footer.getByRole("button", { name: "Resume session" }).click();
  await expect.poll(async () => (await db.session(id))?.status).toBe("active");
  await expect
    .poll(async () => (await host.calls("engine.resume")).length)
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: "Pause session" }),
  ).toBeVisible();
  await expect(
    footer.getByRole("group", { name: /^Session time .*, paused$/ }),
  ).toHaveCount(0);

  // The footer toggle resumes too.
  await page.getByRole("button", { name: "Pause session" }).click();
  await expect.poll(async () => (await db.session(id))?.status).toBe("paused");
  await page.getByRole("button", { name: "Resume session" }).click();
  await expect.poll(async () => (await db.session(id))?.status).toBe("active");
});

test("@native native footer End session: nothing ends until End now, Keep going keeps it, and the dialog stays closed after End", async ({
  native,
}) => {
  const { id } = await startSessionViaApi();
  const { page } = await openPanel(native, id);
  const dialog = endDialog(page);
  const endButton = page.getByRole("button", { name: "End session" });

  // Opening the confirmation changes nothing; Keep going closes it and the
  // session stays active.
  await endButton.click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Keep going" }),
  ).toBeFocused();
  expect((await db.session(id))?.status).toBe("active");
  await dialog.getByRole("button", { name: "Keep going" }).click();
  await expect(dialog).toBeHidden();
  await expect(endButton).toBeFocused();
  expect((await db.session(id))?.status).toBe("active");

  // Escape keeps the session too.
  await endButton.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect((await db.session(id))?.status).toBe("active");

  // End now ends it on the server, the ended card replaces the controls, and
  // the dialog does NOT linger over the ended card (T09 M3 regression).
  await endButton.click();
  await dialog.getByRole("button", { name: "End now" }).click();
  await expect.poll(async () => (await db.session(id))?.status).toBe("ended");
  const ended = page.getByTestId("pn-ended");
  await expect(ended).toBeVisible();
  await expect(ended).toContainText("Session ended");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start a new session" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "End session" })).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Pause session" }),
  ).toBeHidden();
  // It stays closed once the page has settled on the ended state.
  await expect(
    page.getByRole("button", { name: "Open summary" }),
  ).toBeEnabled();
  await expect(dialog).toHaveCount(0);
});

test("@native native ended card Open summary: opens the web summary of that session through the host", async ({
  native,
  context,
  stack,
}) => {
  void context;
  const { id } = await startSessionViaApi();
  const { page, host } = await openPanel(native, id);
  // Ended from this window: the ended card stays (a session ended elsewhere
  // is a lost one, and the window goes back to its start screen instead).
  await page.getByRole("button", { name: "End session" }).click();
  await endDialog(page).getByRole("button", { name: "End now" }).click();
  await expect.poll(async () => (await db.session(id))?.status).toBe("ended");
  await expect(page.getByTestId("pn-ended")).toBeVisible();

  await host.clear();
  await page.getByRole("button", { name: "Open summary" }).click();

  // The shell is asked to open exactly the Studio page of this session...
  await expect
    .poll(async () => (await host.calls("openExternal")).length)
    .toBe(1);
  const [call] = await host.calls("openExternal");
  const url = (call!.params as { url: string }).url;
  expect(url).toBe(
    `${stack.webUrl}/t/${stack.tenantSlug}/p/interview/live/${id}`,
  );
  // ...and that address really is the ended summary of the session.
  const summary = await native.context.newPage();
  await summary.goto(url);
  await expect(summary.getByTestId("live-ended")).toBeVisible();
  await expect(
    summary.getByRole("heading", { name: /^Session ended/ }),
  ).toBeVisible();
});

test("@native native ended card Start a new session: starts a second session on the server", async ({
  native,
}) => {
  const { id } = await startSessionViaApi();
  const { page } = await openPanel(native, id);
  await controlSession(id, "end");
  await expect(page.getByTestId("pn-ended")).toBeVisible();
  const before = (await db.sessions()).length;

  await page.getByRole("button", { name: "Start a new session" }).click();

  // A new row exists, is active, and is not the one that ended.
  await expect
    .poll(
      async () =>
        (await db.sessions()).filter((row) => row.status === "active").length,
    )
    .toBe(1);
  const sessions = await db.sessions();
  expect(sessions).toHaveLength(before + 1);
  const fresh = sessions.find((row) => row.status === "active");
  expect(fresh?.id).not.toBe(id);
  expect((await db.session(id))?.status).toBe("ended");
  // The panel is live again: controls back, ended card and dialog gone.
  await expect(
    page.getByRole("button", { name: "Pause session" }),
  ).toBeVisible();
  await expect(page.getByTestId("pn-ended")).toBeHidden();
  await expect(endDialog(page)).toHaveCount(0);
});

test("@native native red dot Quit: asks first and records quit only after Quit is confirmed", async ({
  native,
}) => {
  const { id } = await startSessionViaApi();
  const { page, host } = await openPanel(native, id);
  const red = page.getByRole("button", { name: "Quit Interview Studio" });
  const confirm = page.getByRole("alertdialog", {
    name: "Quit Interview Studio?",
  });
  await host.clear();

  // Pressing the dot only asks; the shell is told nothing, the session is
  // untouched, and focus starts on Cancel.
  await red.click();
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(
    "Your session stays on the server; capture and listening stop here.",
  );
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  expect(await host.calls("quit")).toHaveLength(0);

  // Cancel (and Escape) close it without quitting.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await red.click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  expect(await host.calls("quit")).toHaveLength(0);

  // Only Quit tells the shell, once; and the session stays on the server.
  await red.click();
  await confirm.getByRole("button", { name: "Quit", exact: true }).click();
  await expect.poll(async () => (await host.calls("quit")).length).toBe(1);
  await expect(confirm).toBeHidden();
  expect((await db.session(id))?.status).toBe("active");
});

test("@native native yellow dot Hide window: pauses the live session first, then hides the window", async ({
  native,
}) => {
  const { id } = await startSessionViaApi();
  const { page, host } = await openPanel(native, id);
  await host.clear();

  await page.getByRole("button", { name: "Hide window" }).click();

  // The shell is asked to hide; by then the server already holds the pause
  // (hiding never leaves a session capturing in the background).
  await expect
    .poll(async () => (await host.calls("setVisible")).length)
    .toBe(1);
  expect((await host.calls("setVisible"))[0]?.params).toMatchObject({
    visible: false,
  });
  expect((await db.session(id))?.status).toBe("paused");
  // Resume stays one press away when the window comes back.
  await expect(
    page.getByRole("button", { name: "Resume session" }),
  ).toBeVisible();
});

test("@native native green dot Full screen: asks the shell for full screen, and again to leave it", async ({
  native,
}) => {
  const { id } = await startSessionViaApi();
  const { page, host } = await openPanel(native, id);
  const green = page.getByRole("button", { name: /^Full screen: click/ });
  await host.clear();

  await green.click();
  await expect
    .poll(async () => (await host.calls("setFullScreen")).length)
    .toBe(1);
  expect((await host.calls("setFullScreen"))[0]?.params).toMatchObject({
    on: true,
  });

  await green.click();
  await expect
    .poll(async () => (await host.calls("setFullScreen")).length)
    .toBe(2);
  expect((await host.calls("setFullScreen"))[1]?.params).toMatchObject({
    on: false,
  });
  expect((await db.session(id))?.status).toBe("active");
});
