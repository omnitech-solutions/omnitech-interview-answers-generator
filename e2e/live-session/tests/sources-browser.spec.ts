// The browser's own sources on the Live page: the screen share (start, stop,
// lost from the browser's own control, refused in the picker) and the
// microphone (dictation on and off, a heard phrase, permission refused, no
// device). The screen is real `getDisplayMedia`, accepted by Chromium's launch
// flags; the microphone is Chromium's fake device. Two things only Chromium
// cannot give a headless run are stood in for, in the page, before its scripts:
//  - a spy around getDisplayMedia / getUserMedia that keeps the streams, so a
//    spec can read whether a track is really live or really ended, and can make
//    the picker refuse;
//  - a controllable SpeechRecognition (headless Chromium has no recogniser), so
//    a spec decides what was "heard" or which error the browser raises.
// What each source DID is read from the server (observation rows) and from the
// real tracks; the labels are checked against those.
import type { Page } from "@playwright/test";
import { installBrowserSpies } from "../src/fixtures/browser-spies";
import { expect, test } from "../src/fixtures/test";
import { db } from "../src/helpers/sql";

// The hands-free note: the one alert line that says what went wrong with the
// share or the microphone (other alerts on the page are about the companion).
const note = (page: Page) => page.locator("p.ov-note");

// The spies for this page, installed before its first script; `streams()` is
// the reader the specs poll.
async function withSpies(page: Page) {
  const forPage = await installBrowserSpies(page);
  return forPage(page);
}

test("browser screen share: starting shares a real live screen track; Stop sharing ends that track and offers the share again", async ({
  live,
  page,
}) => {
  const spies = await withSpies(page);
  await live.goto();
  await live.startRehearsal();
  await live.useManual();
  const light = page.getByTestId("light-screen");
  await expect(light).toContainText("Screen not shared");
  await expect(page.getByText("No source shared")).toBeVisible();

  await live.shareScreen();
  // The share is a real screen-capture stream with one live video track.
  await expect
    .poll(async () => (await spies.streams()).shares)
    .toEqual([["live"]]);
  await expect(light).toHaveAttribute("data-state", "on");
  await expect(light).not.toContainText("not shared");
  await expect(page.getByText("No source shared")).toBeHidden();

  await live.stopSharing().click();
  // Stop sharing really stopped the capture, not just the label.
  await expect
    .poll(async () => (await spies.streams()).shares)
    .toEqual([["ended"]]);
  await expect(live.stopSharing()).toBeHidden();
  await expect(light).toContainText("Screen not shared");
  await expect(page.getByText("No source shared")).toBeVisible();
  // Nothing was captured by sharing alone.
  expect(
    (await db.observations((await db.latestSession())?.id ?? "")).filter(
      (row) => row.kind === "screen.snapshot",
    ),
  ).toEqual([]);
});

test("browser screen share lost: the browser's own Stop sharing ends it and the page says sharing stopped", async ({
  live,
  page,
}) => {
  const spies = await withSpies(page);
  await live.goto();
  await live.startRehearsal();
  await live.useManual();
  await live.shareScreen();
  await expect(live.stopSharing()).toBeVisible();

  await spies.endShare();

  await expect(live.stopSharing()).toBeHidden();
  await expect(note(page)).toContainText(
    "Sharing stopped. Share a window, tab or screen to capture again.",
  );
  await expect(page.getByTestId("light-screen")).toContainText(
    "Screen not shared",
  );
  // The share can be started again from the same menu, with a new stream.
  await live.shareScreen();
  await expect.poll(async () => (await spies.streams()).shares.length).toBe(2);
  await expect(note(page)).toHaveCount(0);
});

test("browser screen share refused: declining the picker shares nothing and says so", async ({
  live,
  page,
}) => {
  const spies = await withSpies(page);
  await live.goto();
  await live.startRehearsal();
  await live.useManual();
  await spies.refuseShare(true);

  await live.captureAnalyze().click();
  await page
    .getByRole("menuitem", { name: /Share a window, tab or screen/ })
    .click();

  await expect(note(page)).toContainText("Nothing was shared.");
  await expect(live.stopSharing()).toBeHidden();
  expect((await spies.streams()).shares).toEqual([]);
  await expect(page.getByTestId("light-screen")).toContainText(
    "Screen not shared",
  );
  // Declining is not a failure state: the next try works.
  await spies.refuseShare(false);
  await live.shareScreen();
  await expect(note(page)).toHaveCount(0);
});

test("browser microphone in Auto: it listens through the fake device, a heard phrase is stored as the owner's microphone, and turning Auto off stops it", async ({
  live,
  page,
}) => {
  const spies = await withSpies(page);
  await live.goto();
  const session = await live.startRehearsal();
  // Auto is the default: the page is listening for real.
  await expect(page.getByTestId("light-mic")).toContainText("Mic listening");
  await expect.poll(async () => (await spies.speech.stats()).listening).toBe(1);
  await expect(
    page.getByRole("button", { name: "Stop dictation" }),
  ).toHaveAttribute("aria-pressed", "true");
  // The browser microphone is the Chromium fake device, and it is live.
  await expect
    .poll(async () => (await spies.streams()).mics.flat())
    .toContain("live");

  // A phrase heard is posted as the owner's own microphone.
  await spies.speech.say("Tell me about a time you led a migration.");
  await expect
    .poll(async () =>
      (await db.observations(session.id)).map((row) => [
        row.source_id,
        row.kind,
      ]),
    )
    .toContainEqual(["studio.owner-microphone", "transcript.final"]);

  // Manual stops the listening: the recogniser and the device are released.
  await live.manualMode().click();
  await expect(page.getByTestId("light-mic")).toContainText("Mic off");
  await expect.poll(async () => (await spies.speech.stats()).listening).toBe(0);
  await expect
    .poll(async () => (await spies.streams()).mics.flat())
    .not.toContain("live");
});

test("browser microphone Dictate: on listens, a heard phrase lands in the follow-up box unsent, off stops listening", async ({
  live,
  page,
}) => {
  const spies = await withSpies(page);
  await live.goto();
  const session = await live.startRehearsal();
  await live.useManual();
  await expect(page.getByTestId("light-mic")).toContainText("Mic off");
  const dictate = page.getByRole("button", { name: "Dictate", exact: true });
  await expect(dictate).toHaveAttribute("aria-pressed", "false");

  await dictate.click();
  await expect(
    page.getByRole("button", { name: "Stop dictation" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("light-mic")).toContainText("Mic listening");
  await expect.poll(async () => (await spies.speech.stats()).listening).toBe(1);

  // What was heard is typed into the follow-up box and is NOT sent by itself.
  await spies.speech.say("Walk me through the trade-offs.");
  await expect(live.followUp()).toHaveValue("Walk me through the trade-offs.");
  expect(
    (await db.observations(session.id)).filter(
      (row) => row.source_id === "studio.owner-microphone",
    ),
  ).toEqual([]);

  await page.getByRole("button", { name: "Stop dictation" }).click();
  await expect(dictate).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("light-mic")).toContainText("Mic off");
  await expect.poll(async () => (await spies.speech.stats()).listening).toBe(0);
});

test("browser microphone refused or missing: the page says the microphone is not allowed, or not found, and stops listening", async ({
  live,
  page,
}) => {
  const spies = await withSpies(page);
  await live.goto();
  await live.startRehearsal();
  await live.useManual();
  const dictate = page.getByRole("button", { name: "Dictate", exact: true });

  // Permission refused by the browser.
  await dictate.click();
  await expect.poll(async () => (await spies.speech.stats()).listening).toBe(1);
  await spies.speech.fail("not-allowed");
  await expect(note(page)).toContainText("Microphone permission was denied.");
  await expect(page.getByTestId("light-mic")).toContainText("Mic not allowed");
  await expect(dictate).toHaveAttribute("aria-pressed", "false");

  // No microphone attached.
  await dictate.click();
  await expect.poll(async () => (await spies.speech.stats()).listening).toBe(1);
  await spies.speech.fail("audio-capture");
  await expect(note(page)).toContainText(
    "No microphone was found. Connect one and try again.",
  );
  await expect(dictate).toHaveAttribute("aria-pressed", "false");
});

// Fixed by T27 (kept as a regression guard).
test("browser microphone in Auto: the phrase it heard is shown in the Transcript tab", async ({
  live,
  page,
}) => {
  const spies = await withSpies(page);
  await live.goto();
  const session = await live.startRehearsal();
  await expect.poll(async () => (await spies.speech.stats()).listening).toBe(1);
  await spies.speech.say("Tell me about a time you led a migration.");
  await expect
    .poll(async () => (await db.observations(session.id)).length)
    .toBe(1);
  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(
    page.getByRole("tabpanel", { name: "Transcript" }),
  ).toContainText("Tell me about a time you led a migration.", {
    timeout: 5_000,
  });
});
