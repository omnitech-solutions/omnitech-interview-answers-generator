// T31, the 'Allow "127.0.0.1" to use your microphone?' prompt in the native
// panel (plan.md 7.0m). The native engine owns the microphone, so the PAGE must
// never ask for it by itself: no getUserMedia (the prompt's own trigger: the
// dictation level meter and 'Start hands-free') and no SpeechRecognition built,
// whatever the engine does (listening, refusing, restarting). The proof is the
// spy in browser-spies.ts, which counts every request the page makes, granted or
// not, beside the recorded engine calls of the host shim. A manual press with
// Auto off is the one place the page may fall back to browser dictation.
//
// A real WKWebView prompt cannot be seen from a test; what is proven here is
// that the page never calls the APIs that raise it.
import type { Page } from "@playwright/test";
import {
  browserSpiesInit,
  installBrowserSpies,
  spiesFor,
} from "../src/fixtures/browser-spies";
import { installHostShim } from "../src/fixtures/host-shim";
import { expect, test } from "../src/fixtures/panel-test";
import { chooseCaptureMode, expectCaptureMode } from "../src/helpers/toolbar";
import { SetupPage } from "../src/pages/setup-page";

const micButton = (page: Page) =>
  page.getByRole("button", { name: /^(Stop|Start) microphone$/ }).first();
const nothingAsked = { getUserMedia: 0, speechConstructed: 0 };

test("@native native T31 Auto with the engine present: over 30 seconds the page asks for no microphone and builds no recogniser, through an engine refusal and a restart", async ({
  openPanel,
}) => {
  const { page, host } = await openPanel({
    auto: "on",
    init: [browserSpiesInit()],
  });
  const spies = spiesFor(page);
  // The engine took the session and is the listener.
  await expect
    .poll(async () => (await host.calls("engine.start")).length)
    .toBe(1);
  await expect(micButton(page)).toHaveAccessibleName("Stop microphone");
  expect(await spies.asked()).toEqual(nothingAsked);

  // Thirty seconds of the page's own timers (Auto's interval, the engine poll,
  // every retry) run in an instant on the page's clock.
  await page.clock.install();
  await page.clock.runFor(30_000);
  expect(await spies.asked()).toEqual(nothingAsked);
  expect((await spies.speech.stats()).started).toBe(0);

  // The shell now refuses to start (a transient store failure): the old page
  // started dictation + the meter here, which raised the WebKit prompt.
  // Design change: Auto/Manual no longer touch the microphone (it listens in
  // both), so the restart is the microphone press itself: stop, then start.
  await host.setEngineRefusal("store-failed");
  await chooseCaptureMode(page, "Manual");
  await chooseCaptureMode(page, "Auto");
  await micButton(page).click();
  await expect(micButton(page)).toHaveAccessibleName("Start microphone");
  await micButton(page).click();
  // The shell refused: the engine is not listening, so the label says so.
  await expect(micButton(page)).toHaveAccessibleName("Start microphone");
  await expect
    .poll(async () => (await host.calls("engine.start")).length)
    .toBeGreaterThan(1);
  await page.clock.runFor(30_000);
  expect(await spies.asked()).toEqual(nothingAsked);
  expect((await spies.speech.stats()).started).toBe(0);

  // The shell recovers and the engine restarts: still nothing from the page.
  await host.setEngineRefusal(null);
  await micButton(page).click();
  await expect(micButton(page)).toHaveAccessibleName("Stop microphone");
  await page.clock.runFor(30_000);
  expect(await spies.asked()).toEqual(nothingAsked);
  expect((await spies.speech.stats()).started).toBe(0);
});

test("@native native T31 Auto from the start with an engine that refuses: the page still asks for no microphone and builds no recogniser", async ({
  openPanel,
}) => {
  const { page, host } = await openPanel({
    auto: "on",
    init: [
      browserSpiesInit(),
      // After the shim (added first), before the page: every start is refused.
      `window.__e2eHost.setEngineRefusal("store-failed");`,
    ],
  });
  const spies = spiesFor(page);
  await expect
    .poll(async () => (await host.calls("engine.start")).length)
    .toBeGreaterThan(0);
  // The shell refused: the engine is not listening, so the label says so.
  await expect(micButton(page)).toHaveAccessibleName("Start microphone");
  await page.clock.install();
  await page.clock.runFor(30_000);
  expect(await spies.asked()).toEqual(nothingAsked);
  expect((await spies.speech.stats()).started).toBe(0);
});

// Design change (native-ui-swap-plan 4.3): the microphone keeps listening in
// Manual, so with an engine present the press drives the ENGINE (stop, start)
// in Manual too; browser dictation is only the no-engine fallback. The T31
// point stays: no recogniser, no getUserMedia meter.
test("@native native T31 Manual microphone press with an engine present: stops and restarts the engine, never builds a recogniser or asks for the microphone's level meter", async ({
  openPanel,
}) => {
  const { page, host } = await openPanel({
    auto: "off",
    init: [browserSpiesInit()],
  });
  const spies = spiesFor(page);
  await expectCaptureMode(page, "Manual");
  await expect(micButton(page)).toHaveAccessibleName("Stop microphone");
  await host.clear();
  expect(await spies.asked()).toEqual(nothingAsked);

  await micButton(page).click();

  await expect
    .poll(async () => (await host.calls("engine.stop")).length)
    .toBe(1);
  await expect(micButton(page)).toHaveAccessibleName("Start microphone");
  expect(await spies.asked()).toEqual(nothingAsked);

  await micButton(page).click();
  await expect
    .poll(async () => (await host.calls("engine.start")).length)
    .toBe(1);
  await expect(micButton(page)).toHaveAccessibleName("Stop microphone");
  expect(await spies.asked()).toEqual(nothingAsked);
  expect((await spies.speech.stats()).started).toBe(0);
});

test("@native native T31 Start session on the setup page in a shell with an engine: the click asks for no microphone and the engine takes over", async ({
  browser,
  stack,
}) => {
  const context = await browser.newContext({
    storageState: stack.storageStatePath,
    viewport: { width: 1100, height: 1000 },
  });
  const shimFor = await installHostShim(context);
  await installBrowserSpies(context);
  const page = await context.newPage();
  const setup = new SetupPage(page);
  await setup.goto();
  const host = shimFor(page);
  const spies = spiesFor(page);
  await setup.fillRequired();
  // 'This browser only' is the path that used to ask for the microphone in the
  // Start click (prepareHandsFree).
  await setup.hostBrowser().check();

  await setup.pressStart();

  await expect
    .poll(async () => (await host.calls("engine.start")).length)
    .toBeGreaterThan(0);
  expect(await spies.asked()).toEqual(nothingAsked);
  await page.clock.install();
  await page.clock.runFor(30_000);
  expect(await spies.asked()).toEqual(nothingAsked);
  await context.close();
});
