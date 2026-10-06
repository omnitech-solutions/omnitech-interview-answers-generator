// The native host contract as the panel negotiates it (`window.studioHost`,
// studio-host.ts): which advertised capability switches on which behaviour,
// what the page does when the shell answers a call with a refusal, and what it
// does when the shell does not offer a capability at all. The Mac shell is the
// recording shim (src/fixtures/host-shim.ts); the panel, the server and the
// database are real. A capability is proven by the CALL the shell receives (or
// does not receive) and by what the page then shows; a refusal by the page
// staying honest about it.
import type { Browser } from "@playwright/test";
import {
  type HostShim,
  installHostShim,
  nativeOverlayUrl,
  type ShimOptions,
} from "../src/fixtures/host-shim";
import { expect, test } from "../src/fixtures/test";
import { startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import type { StackConfig } from "../src/stack/config";
import { SCRIPTED } from "../src/stack/scenarios";

const NO_HOST: ShimOptions = {
  capabilities: [],
  presentationCapabilities: [],
  engine: false,
};

async function openPanel(
  browser: Browser,
  stack: StackConfig,
  options: ShimOptions = {},
  open: {
    // Open the panel on a new session of its own (default), or with none.
    session?: boolean;
    // Open the panel on a session that is already running (an owner has one
    // open session at a time).
    sessionId?: string;
    auto?: "on" | "off";
    flag?: boolean;
  } = {},
) {
  const context = await browser.newContext({
    storageState: stack.storageStatePath,
    viewport: { width: 760, height: 900 },
  });
  const shimFor = await installHostShim(context, options);
  if (open.auto)
    await context.addInitScript(
      `try { localStorage.setItem("interview-studio.live.auto.${stack.tenantSlug}", "${open.auto}"); } catch {}`,
    );
  if (open.flag)
    await context.addInitScript(
      `try { localStorage.setItem("studio.shell.consented", "1"); } catch {}`,
    );
  const page = await context.newPage();
  const sessionId =
    open.session === false
      ? undefined
      : (open.sessionId ?? (await startSessionViaApi()).id);
  await page.goto(
    nativeOverlayUrl(stack.webUrl, stack.tenantSlug, {
      panel: "single",
      handsFree: true,
      ...(sessionId ? { sessionId } : {}),
    }),
  );
  return {
    context,
    page,
    sessionId,
    host: shimFor(page) as HostShim,
    toolbar: page.getByRole("toolbar", { name: "Session controls" }),
  };
}

const AUTO_WAITING =
  "Auto · not watching a screen. The browser needs one click to share again: press Share.";

test("@native host capabilities: a shell that advertises screen watch, the engine and hit-regions gets each used; a bare one gets none and the panel says so", async ({
  browser,
  stack,
}) => {
  // The real shell's list: Auto uses its screen watch and its engine, the
  // toolbar offers click-through, the red dot can hide.
  const full = await openPanel(browser, stack);
  await expect(full.toolbar).toBeVisible();
  await expect
    .poll(async () => (await full.host.calls("screenWatchStart")).length)
    .toBe(1);
  expect((await full.host.calls("screenWatchStart"))[0]?.params).toEqual({
    mode: "focused-window",
  });
  await expect
    .poll(async () => (await full.host.calls("engine.start")).length)
    .toBe(1);
  expect((await full.host.calls("engine.start"))[0]?.params).toMatchObject({
    sources: ["microphone"],
    sessionId: full.sessionId,
  });
  // hit-regions: See-through reports the painted surfaces to the shell.
  await full.toolbar.getByRole("button", { name: "See-through" }).click();
  await expect
    .poll(async () => (await full.host.calls("setHitRegions")).length)
    .toBeGreaterThan(0);
  await expect(full.page.getByText(AUTO_WAITING)).toBeHidden();
  await expect(full.page.getByText("Auto · watching the screen")).toBeVisible();
  await full.context.close();

  // A host that offers nothing: Auto cannot watch (the page says why), no
  // engine is started, there is no click-through to offer, and hiding is off
  // with the reason.
  const bare = await openPanel(browser, stack, NO_HOST, {
    sessionId: full.sessionId ?? "",
  });
  await expect(bare.toolbar).toBeVisible();
  await expect(bare.page.getByText(AUTO_WAITING)).toBeVisible();
  // Without hit-regions See-through is only the clear glass: nothing is reported.
  const seeThrough = bare.toolbar.getByRole("button", { name: "See-through" });
  await seeThrough.click();
  await expect(seeThrough).toHaveAttribute("aria-pressed", "true");
  expect(await bare.host.calls("setHitRegions")).toEqual([]);
  await expect(
    bare.toolbar.getByRole("button", { name: "Hide window" }),
  ).toBeDisabled();
  const methods = (await bare.host.calls()).map((call) => call.method);
  expect(methods).not.toContain("screenWatchStart");
  expect(methods).not.toContain("engine.start");
  await bare.context.close();
});

test("@native host capability hotkeys: the shell's intents reach the page only when the host advertises hotkeys", async ({
  browser,
  stack,
}) => {
  const withHotkeys = await openPanel(browser, stack);
  const message = withHotkeys.page.getByRole("textbox", { name: "Message" });
  await expect(message).not.toBeFocused();
  await withHotkeys.host.fireIntent("chat.focus");
  await expect(message).toBeFocused();
  await withHotkeys.context.close();

  // Same intent, host without the capability: the page never subscribed.
  const without = await openPanel(
    browser,
    stack,
    { ...NO_HOST, capabilities: ["capture-screen", "screen-watch"] },
    { sessionId: withHotkeys.sessionId ?? "" },
  );
  const silent = without.page.getByRole("textbox", { name: "Message" });
  await expect(silent).toBeVisible();
  await without.host.fireIntent("chat.focus");
  // Prove the intent had time to land: the same page does react to a key press.
  await without.page.keyboard.press("Alt+Shift+F");
  await expect(silent).toBeFocused();
  // ...and the intent alone, sent first on a fresh page, did nothing.
  const fresh = await openPanel(
    browser,
    stack,
    { ...NO_HOST, capabilities: ["capture-screen", "screen-watch"] },
    { sessionId: withHotkeys.sessionId ?? "" },
  );
  const freshMessage = fresh.page.getByRole("textbox", { name: "Message" });
  await expect(freshMessage).toBeVisible();
  await fresh.host.fireIntent("chat.focus");
  await expect(freshMessage).not.toBeFocused();
  await without.context.close();
  await fresh.context.close();
});

test("@native host capability capture-screen: Analyze goes through the shell, and a shell that cannot capture says why and stores nothing", async ({
  browser,
  stack,
  control,
}) => {
  await control.scenario("plain-answer");
  const { context, page, host, sessionId } = await openPanel(
    browser,
    stack,
    {},
    { auto: "off" },
  );
  // The shell captures: one captureScreen call, one stored screenshot, one
  // model call that carried exactly one image.
  await page.getByRole("button", { name: "Analyze screen" }).first().click();
  await expect
    .poll(async () => (await host.calls("captureScreen")).length)
    .toBe(1);
  // Manual capture stages the screenshot ("Not sent yet"); Apply sends it.
  await expect(page.getByText("Not sent yet").first()).toBeVisible();
  expect(await control.calls()).toEqual([]);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText(SCRIPTED.plain).first()).toBeVisible();
  const stored = (await db.observations(sessionId ?? "")).filter(
    (row) => row.kind === "screen.snapshot" && row.screenshot_artifact_id,
  );
  expect(stored).toHaveLength(1);
  expect(await control.calls()).toHaveLength(1);

  // The shell refuses: the permission is off. The page says what to do and
  // nothing new is stored or sent.
  await host.setCapture({ ok: false, reason: "permission-denied" });
  await page.getByRole("button", { name: "Analyze screen" }).first().click();
  const problem = page.getByTestId("capture-problem");
  await expect(problem).toHaveAttribute("data-reason", "permission-denied");
  await expect(problem.getByTestId("capture-problem-title")).toHaveText(
    "Screen Recording is off for Interview Studio",
  );
  // Its button hands the Privacy_ScreenCapture pane to the shell.
  await host.clear();
  await problem.getByTestId("capture-problem-action").click();
  await expect
    .poll(async () => (await host.calls("openExternal")).length)
    .toBe(1);
  expect((await host.calls("openExternal"))[0]?.params["url"]).toBe(
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  );
  // Not a browser in front: the person's own press says so and offers no button.
  await host.setCapture({ ok: false, reason: "no-focused-window" });
  await page.getByRole("button", { name: "Analyze screen" }).first().click();
  await expect(problem).toHaveAttribute("data-reason", "no-focused-window");
  await expect(problem.getByTestId("capture-problem-title")).toHaveText(
    "No browser window found",
  );
  await expect(problem.getByTestId("capture-problem-action")).toHaveCount(0);
  expect(
    (await db.observations(sessionId ?? "")).filter(
      (row) => row.kind === "screen.snapshot",
    ),
  ).toHaveLength(1);
  expect(await control.calls()).toHaveLength(1);
  // Since the clear: only the last press. It was the person's own, so it
  // asked the shell to capture the last-focused browser (intent explicit).
  const presses = await host.calls("captureScreen");
  expect(presses).toHaveLength(1);
  expect(presses[0]?.params["intent"]).toBe("explicit");
  await context.close();
});

test("@native host without capture-screen: Analyze says a share is needed first, sends nothing and records no bridge capture", async ({
  browser,
  stack,
  control,
}) => {
  await control.scenario("plain-answer");
  const { context, page, host, sessionId } = await openPanel(
    browser,
    stack,
    { ...NO_HOST, capabilities: ["hotkeys"] },
    { auto: "off" },
  );
  await expect(page.getByRole("toolbar")).toBeVisible();

  await page.getByRole("button", { name: "Analyze screen" }).first().click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Share a window, tab or screen first" }),
  ).toBeVisible();
  // Nothing was asked of the shell, stored, or sent to a model.
  expect(await host.calls("captureScreen")).toEqual([]);
  expect(
    (await db.observations(sessionId ?? "")).filter(
      (row) => row.kind === "screen.snapshot",
    ),
  ).toEqual([]);
  expect(await control.calls()).toEqual([]);
  await context.close();
});

test("@native host capability open-external: Open summary hands the web summary URL to the shell, or opens a browser tab when the shell cannot", async ({
  browser,
  stack,
}) => {
  const url = (id: string | undefined) =>
    `${stack.webUrl}/t/${stack.tenantSlug}/p/interview/live/${id}`;

  const advertised = await openPanel(browser, stack);
  await advertised.page.getByRole("button", { name: "End session" }).click();
  await advertised.page.getByRole("button", { name: "End now" }).click();
  await advertised.page.getByRole("button", { name: "Open summary" }).click();
  await expect
    .poll(async () => (await advertised.host.calls("openExternal")).length)
    .toBe(1);
  expect((await advertised.host.calls("openExternal"))[0]?.params).toEqual({
    url: url(advertised.sessionId),
  });
  await advertised.context.close();

  const missing = await openPanel(browser, stack, {
    ...NO_HOST,
    capabilities: ["capture-screen", "screen-watch", "hotkeys"],
  });
  await missing.page.getByRole("button", { name: "End session" }).click();
  await missing.page.getByRole("button", { name: "End now" }).click();
  const opened = missing.context.waitForEvent("page");
  await missing.page.getByRole("button", { name: "Open summary" }).click();
  const tab = await opened;
  await expect.poll(() => tab.url()).toBe(url(missing.sessionId));
  expect(await missing.host.calls("openExternal")).toEqual([]);
  await missing.context.close();
});

test("@native host consent: with no session the start screen asks the shell's consent first and starts nothing; with consent it still waits for Start", async ({
  browser,
  stack,
}) => {
  const before = (await db.sessions()).length;

  // Not consented, and the shell offers its dialog: Review consent calls it,
  // and nothing starts, however long the window waits.
  const asking = await openPanel(
    browser,
    stack,
    { consent: false },
    { session: false },
  );
  await expect(asking.page.getByTestId("pn-start-hint")).toHaveText(
    "Consent required",
  );
  await asking.page.getByRole("button", { name: "Review consent" }).click();
  await expect
    .poll(async () => (await asking.host.calls("consent.open")).length)
    .toBe(1);
  // A blocked Start still answers a press; Playwright treats aria-disabled as
  // not clickable, so the press is forced.
  await asking.page
    .getByRole("button", { name: "Start session" })
    .click({ force: true });
  expect(await db.sessions()).toHaveLength(before);
  await asking.context.close();

  // Consented (the shell's flag, as StudioWebView.swift sets it): the window
  // shows the start screen and starts NOTHING by itself; Start starts one.
  const granted = await openPanel(
    browser,
    stack,
    {},
    { session: false, flag: true },
  );
  await expect(granted.page.getByTestId("pn-start")).toBeVisible();
  await expect(granted.page.getByTestId("pn-start-hint")).toHaveText(
    "Listening starts right away",
  );
  await granted.page.waitForTimeout(2_500);
  expect(await db.sessions()).toHaveLength(before);
  await granted.page.getByRole("button", { name: "Start session" }).click();
  await expect.poll(async () => (await db.sessions()).length).toBe(before + 1);
  const created = (await db.sessions()).at(-1);
  expect(created?.status).toBe("active");
  await expect(granted.page.getByTestId("pn-start")).toBeHidden();
  await expect(granted.toolbar).toBeVisible();
  await granted.context.close();
});

test("@native host See-through: on sends setHitRegions covering the toolbar, off sends null, and a shell that refuses leaves the page usable", async ({
  browser,
  stack,
}) => {
  const { context, page, host, toolbar } = await openPanel(browser, stack);
  const seeThrough = toolbar.getByRole("button", { name: "See-through" });
  const root = page.locator(".pn-root");
  await host.clear();

  await seeThrough.click();
  await expect(seeThrough).toHaveAttribute("aria-pressed", "true");
  await expect(root).toHaveAttribute("data-glass", "clear");
  // The painted UI is what the shell is told to keep: a non-empty list that
  // includes a rectangle over the toolbar.
  await expect
    .poll(async () => (await host.calls("setHitRegions")).length)
    .toBeGreaterThan(0);
  const regions = (await host.calls("setHitRegions")).at(-1)?.params[
    "regions"
  ] as Array<{ x: number; y: number; width: number; height: number }>;
  expect(regions.length).toBeGreaterThan(0);
  const bar = (await toolbar.boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  expect(
    regions.some(
      (r) =>
        r.x <= bar.x + 2 &&
        r.y <= bar.y + 2 &&
        r.x + r.width >= bar.x + bar.width - 2 &&
        r.y + r.height >= bar.y + bar.height - 2,
    ),
  ).toBe(true);

  await seeThrough.click();
  await expect(seeThrough).toHaveAttribute("aria-pressed", "false");
  await expect(root).not.toHaveAttribute("data-glass", /.*/);
  await expect
    .poll(
      async () => (await host.calls("setHitRegions")).at(-1)?.params["regions"],
    )
    .toBeNull();

  // Hiding is refused: the shell keeps the window, the page does not pretend
  // otherwise and the session is still there to resume.
  await page.getByRole("button", { name: "Pause session" }).click();
  await expect(
    page.getByRole("button", { name: "Resume session" }),
  ).toBeVisible();
  await host.refuse("setVisible");
  await toolbar.getByRole("button", { name: "Hide window" }).click();
  await expect
    .poll(async () => (await host.calls("setVisible")).length)
    .toBe(1);
  expect((await host.state()).visible).toBe(true);
  await expect(
    page.getByRole("button", { name: "Resume session" }),
  ).toBeEnabled();
  await context.close();
});
