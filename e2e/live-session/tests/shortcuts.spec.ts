// The keyboard shortcuts table (`shared/shortcuts.ts`): the keys popover lists
// the Mac shell's chords, and each chord reaches the page as a typed intent
// (`host.fireIntent`, what Hotkeys.swift's registered chord sends) or, for the
// in-page Alt chords, as a real key press on the panel document. Each is proven
// by what it DOES: a bridge call the shell would receive, a label that flips, a
// focus, a task the server holds, a menu that changes.
//
// The Carbon registration itself (the chord reaching the page at all) is the
// shell's job and stays in the manual checklist; this spec starts from the
// intent the shell delivers.
import type { Page } from "@playwright/test";
import { installBrowserSpies } from "../src/fixtures/browser-spies";
import { installHostShim, nativeOverlayUrl } from "../src/fixtures/host-shim";
import { expect, test } from "../src/fixtures/test";
import { startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { expectCaptureMode } from "../src/helpers/toolbar";
import { SCRIPTED } from "../src/stack/scenarios";

// What the shortcut list must say, mirrored from the product tables (the
// page's own Alt chords for the commands, the shell's chords for Show or hide
// and Settings; toolbar-config.ts SHORTCUT_GROUPS) so a change to a label, a
// chord or a group fails here, not silently. Clear session memory closes the
// App group, in the destructive colour.
const SHORTCUT_GROUPS: ReadonlyArray<
  [group: string, rows: ReadonlyArray<[label: string, chord: string]>]
> = [
  [
    "Capture",
    [
      ["Capture & analyze", "⌥⇧A"],
      ["Generate the solution", "⌥⇧S"],
    ],
  ],
  [
    "Listening",
    [
      ["Microphone on or off", "⌥R"],
      ["Auto (hands-free) on or off", "⌥⇧H"],
    ],
  ],
  [
    "View",
    [
      ["See-through on or off", "⌥⇧I"],
      ["Focus the chat", "⌥⇧F"],
    ],
  ],
  [
    "Answer style",
    [
      ["Next skill", "⌥]"],
      ["Previous skill", "⌥["],
    ],
  ],
  [
    "App",
    [
      ["Show or hide", "⌘⇧V"],
      ["Settings", "⌘,"],
      ["Clear session memory", "⌥⇧C"],
    ],
  ],
];

// A native panel on its own session, with the recording shim and the browser
// spies (a controllable SpeechRecognition) in one context.
async function openPanel(
  browser: import("@playwright/test").Browser,
  stack: { storageStatePath: string; webUrl: string; tenantSlug: string },
  options: {
    start?: Parameters<typeof startSessionViaApi>[0];
    // The owner's remembered Auto choice (the panel is hands-free: Auto by default).
    auto?: "on" | "off";
  } = {},
) {
  const context = await browser.newContext({
    storageState: stack.storageStatePath,
    viewport: { width: 760, height: 900 },
  });
  const shimFor = await installHostShim(context);
  const spiesFor = await installBrowserSpies(context);
  if (options.auto)
    await context.addInitScript(
      `try { localStorage.setItem("interview-studio.live.auto.${stack.tenantSlug}", "${options.auto}"); } catch {}`,
    );
  const page = await context.newPage();
  const { id } = await startSessionViaApi(options.start);
  await page.goto(
    nativeOverlayUrl(stack.webUrl, stack.tenantSlug, {
      panel: "single",
      handsFree: true,
      sessionId: id,
    }),
  );
  await expect(
    page.getByRole("toolbar", { name: "Session controls" }),
  ).toBeVisible();
  return {
    context,
    page,
    id,
    host: shimFor(page),
    spies: spiesFor(page),
    toolbar: page.getByRole("toolbar", { name: "Session controls" }),
  };
}

// The page runs ONE press of a command per 400 ms, however many documents hear
// it (commands.ts COMMAND_WINDOW_MS: a host hotkey reaches every page it hosts).
// A second press of the same command inside that window is the same press, so
// a spec that presses a command twice waits the window out between them.
const COMMAND_WINDOW_MS = 400;
const nextPress = (page: Page): Promise<void> =>
  page.evaluate(
    (ms) => new Promise<void>((done) => setTimeout(done, ms + 50)),
    COMMAND_WINDOW_MS,
  );

const styleButton = (page: Page) =>
  page.getByRole("button", { name: /^Answer style:/ });
const micButton = (page: Page) =>
  page.getByRole("button", { name: /^(Stop|Start) microphone$/ }).first();

test("@native keys popover: lists every shortcut the shell registers, with its chord", async ({
  browser,
  stack,
}) => {
  const { context, page, toolbar } = await openPanel(browser, stack);
  await toolbar.getByRole("button", { name: "Keyboard shortcuts" }).click();
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  const groups = dialog.getByRole("group");
  await expect(groups).toHaveCount(SHORTCUT_GROUPS.length);
  for (const [at, [name, rows]] of SHORTCUT_GROUPS.entries()) {
    const group = groups.nth(at);
    await expect(group).toHaveAccessibleName(name);
    const items = group.locator('[data-slot="action-menu-item"]');
    await expect(items).toHaveCount(rows.length);
    for (const [index, [label, chord]] of rows.entries()) {
      const row = items.nth(index);
      await expect(row).toContainText(label);
      await expect(row.locator("kbd")).toHaveText(chord);
      await expect(row).not.toHaveAttribute("aria-disabled", "true");
    }
  }
  const clear = groups.last().locator('[data-slot="action-menu-item"]').last();
  await expect(clear).toHaveAttribute("data-tone", "danger");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await context.close();
});

test("@native shortcut ⌘⇧C Focus chat: the intent puts the cursor in the message box", async ({
  browser,
  stack,
}) => {
  const { context, page, host } = await openPanel(browser, stack);
  const message = page.getByRole("textbox", { name: "Message" });
  await expect(message).not.toBeFocused();
  await host.fireIntent("chat.focus");
  await expect(message).toBeFocused();
  await context.close();
});

test("@native shortcut ⌥⇧U Auto on or off: toggles the mode and starts and stops the shell's screen watch", async ({
  browser,
  stack,
}) => {
  const { context, page, host } = await openPanel(browser, stack);
  await expectCaptureMode(page, "Auto");
  await expect
    .poll(async () => (await host.calls("screenWatchStart")).length)
    .toBe(1);

  await host.fireIntent("auto.toggle");
  await expectCaptureMode(page, "Manual");
  await expect
    .poll(async () => (await host.calls("screenWatchStop")).length)
    .toBe(1);

  await nextPress(page);
  await host.fireIntent("auto.toggle");
  await expectCaptureMode(page, "Auto");
  await expect
    .poll(async () => (await host.calls("screenWatchStart")).length)
    .toBe(2);
  await context.close();
});

test("@native shortcut ⌘⇧S Analyze: the intent captures through the shell and the server holds a new task", async ({
  browser,
  stack,
  control,
}) => {
  await control.scenario("plain-answer");
  // Manual, so only the chord captures (Auto also analyses the first frame it sees).
  const { context, page, host, id } = await openPanel(browser, stack, {
    auto: "off",
  });
  await expectCaptureMode(page, "Manual");
  await host.clear();

  await host.fireIntent("capture.analyze");

  await expect
    .poll(async () => (await host.calls("captureScreen")).length)
    .toBe(1);
  // Manual capture stages the screenshot ("Not sent yet"); Apply sends it.
  await expect(page.getByText("Not sent yet").first()).toBeVisible();
  expect(await control.calls()).toEqual([]);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Studio · T1/ }),
  ).toBeVisible();
  await expect(page.getByText(SCRIPTED.plain).first()).toBeVisible();
  expect((await db.actions(id)).map((action) => action.action_kind)).toContain(
    "draft-answer",
  );
  expect(await control.calls()).toHaveLength(1);
  expect((await control.calls())[0]).toMatchObject({ images: 1 });
  await context.close();
});

test("@native shortcuts ⌘↑ and ⌘↓ answer style: step through the styles", async ({
  browser,
  stack,
}) => {
  const { context, page, host } = await openPanel(browser, stack);
  await expect(styleButton(page)).toHaveAccessibleName(
    "Answer style: Data Structures & Algorithms",
  );

  await host.fireIntent("skill.next");
  await expect(styleButton(page)).toHaveAccessibleName(
    "Answer style: System Design",
  );
  await host.fireIntent("skill.prev");
  await expect(styleButton(page)).toHaveAccessibleName(
    "Answer style: Data Structures & Algorithms",
  );
  await nextPress(page);
  await host.fireIntent("skill.prev");
  await expect(styleButton(page)).toHaveAccessibleName(
    "Answer style: Programming",
  );

  await context.close();
});

test("@native shortcut ⌘⇧\\ Clear session memory: the chat is cleared", async ({
  browser,
  stack,
}) => {
  const { context, page, host } = await openPanel(browser, stack);
  const log = page.getByRole("log", { name: "Transcript and chat" });
  // The conversation has a line to clear: the captured task's row. (Design
  // change, requirement M1: the transcript holds no system lines, so the old
  // "Recording in Progress." / "Session memory has been cleared" lines are gone
  // and the clear is observable only as the rows disappearing.)
  await expect(log).toContainText("Restate the question aloud");

  await host.fireIntent("session.clear");

  await expect(log).not.toContainText("Restate the question aloud");
  await context.close();
});

test("@native shortcut ⌘⇧I See-through: the intent flips See-through, the clear glass and the hit regions the shell is given, and again restores them", async ({
  browser,
  stack,
}) => {
  const { context, page, host, toolbar } = await openPanel(browser, stack);
  const button = toolbar.getByRole("button", { name: "See-through" });
  const root = page.locator(".pn-root");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await host.clear();

  await host.fireIntent("see-through.toggle");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(root).toHaveAttribute("data-glass", "clear");
  await expect
    .poll(async () => (await host.calls("setHitRegions")).length)
    .toBeGreaterThan(0);
  expect(
    Array.isArray(
      (await host.calls("setHitRegions")).at(-1)?.params["regions"],
    ),
  ).toBe(true);

  await nextPress(page);
  await host.fireIntent("see-through.toggle");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(root).not.toHaveAttribute("data-glass", /.*/);
  await expect
    .poll(
      async () => (await host.calls("setHitRegions")).at(-1)?.params["regions"],
    )
    .toBeNull();
  await context.close();
});

// Design change (native-ui-swap-plan 4.3): the microphone keeps listening in
// Manual, so the shell's engine (not browser dictation) owns it in both modes.
test("@native shortcut ⌥R Listening on or off: in Manual the intent stops and restarts the shell's engine and the button label follows", async ({
  browser,
  stack,
}) => {
  const { context, page, host, spies } = await openPanel(browser, stack, {
    auto: "off",
  });
  await expectCaptureMode(page, "Manual");
  await expect(micButton(page)).toHaveAccessibleName("Stop microphone");
  await expect
    .poll(async () => (await host.calls("engine.start")).length)
    .toBe(1);
  await host.clear();

  await host.fireIntent("transcribe.toggle");
  await expect
    .poll(async () => (await host.calls("engine.stop")).length)
    .toBe(1);
  await expect(micButton(page)).toHaveAccessibleName("Start microphone");

  await nextPress(page);
  await host.fireIntent("transcribe.toggle");
  await expect
    .poll(async () => (await host.calls("engine.start")).length)
    .toBe(1);
  await expect(micButton(page)).toHaveAccessibleName("Stop microphone");
  // Never a browser recogniser beside the engine.
  expect((await spies.speech.stats()).listening).toBe(0);
  await context.close();
});

// Fixed by T27 (kept as a regression guard).
test("@native shortcut ⌥R and the microphone button stop the native engine while Auto is on", async ({
  browser,
  stack,
}) => {
  const { context, page, host, spies } = await openPanel(browser, stack);
  await expect
    .poll(async () => (await host.calls("engine.start")).length)
    .toBe(1);
  await expect(micButton(page)).toHaveAccessibleName("Stop microphone");
  // The engine was started for the microphone source.
  expect((await host.calls("engine.start"))[0]?.params["sources"]).toContain(
    "microphone",
  );
  await host.clear();

  await micButton(page).click();

  await expect
    .poll(async () => (await host.calls("engine.stop")).length, {
      timeout: 5_000,
    })
    .toBeGreaterThan(0);
  await expect(micButton(page)).toHaveAccessibleName("Start microphone", {
    timeout: 5_000,
  });
  // And never two listeners.
  expect((await spies.speech.stats()).listening).toBe(0);

  // Pressed again it starts the native engine for the microphone again, and the
  // label follows.
  await host.clear();
  await micButton(page).click();
  await expect
    .poll(async () => (await host.calls("engine.start")).length, {
      timeout: 5_000,
    })
    .toBeGreaterThan(0);
  expect((await host.calls("engine.start"))[0]?.params["sources"]).toContain(
    "microphone",
  );
  await expect(micButton(page)).toHaveAccessibleName("Stop microphone", {
    timeout: 5_000,
  });
  expect((await spies.speech.stats()).listening).toBe(0);
  await context.close();
});

// The in-page Alt chords, pressed on the panel document.
test("@native web chords on the panel: Alt+Shift+F focuses the chat, Alt+Shift+H toggles Auto, Alt+] and Alt+[ step the answer style, Alt+Shift+C clears the memory", async ({
  browser,
  stack,
}) => {
  const { context, page, host } = await openPanel(browser, stack);
  await page.locator("body").click({ position: { x: 4, y: 4 } });

  await page.keyboard.press("Alt+Shift+F");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeFocused();

  await page.keyboard.press("Alt+Shift+H");
  await expectCaptureMode(page, "Manual");
  await expect
    .poll(async () => (await host.calls("screenWatchStop")).length)
    .toBe(1);
  await nextPress(page);
  await page.keyboard.press("Alt+Shift+H");
  await expectCaptureMode(page, "Auto");

  await page.keyboard.press("Alt+BracketRight");
  await expect(styleButton(page)).toHaveAccessibleName(
    "Answer style: System Design",
  );
  await page.keyboard.press("Alt+BracketLeft");
  await expect(styleButton(page)).toHaveAccessibleName(
    "Answer style: Data Structures & Algorithms",
  );

  await page.keyboard.press("Alt+Shift+C");
  // M1: no "Session memory has been cleared" line any more; the rows go.
  await expect(
    page.getByRole("log", { name: "Transcript and chat" }),
  ).not.toContainText("Restate the question aloud");
  await context.close();
});

test("@native web chord Alt+Shift+A captures and analyzes, and Alt+Shift+S generates the solution for a coding task", async ({
  browser,
  stack,
  control,
}) => {
  await control.scenario("coding-answer");
  const { context, page, host, id } = await openPanel(browser, stack, {
    auto: "off",
  });
  await expectCaptureMode(page, "Manual");
  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await host.clear();

  // No coding problem yet: the chord says so and sends nothing.
  await page.keyboard.press("Alt+Shift+S");
  await expect(
    page.getByText("There is no coding problem to solve yet.").first(),
  ).toBeVisible();
  expect(
    (await db.actions(id)).filter((a) => a.action_kind === "solve-code"),
  ).toEqual([]);

  await page.keyboard.press("Alt+Shift+A");
  await expect
    .poll(async () => (await host.calls("captureScreen")).length)
    .toBe(1);
  // Manual capture stages the screenshot ("Not sent yet"); Apply sends it.
  await expect(page.getByText("Not sent yet").first()).toBeVisible();
  expect(await control.calls()).toEqual([]);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^Studio · T1/ }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      (await db.actions(id)).map((action) => action.action_kind),
    )
    .toContain("draft-answer");

  // A coding problem is on show now: the chord asks for the solution.
  await page.keyboard.press("Alt+Shift+S");
  await expect
    .poll(async () =>
      (await db.actions(id)).map((action) => action.action_kind),
    )
    .toContain("solve-code");
  expect((await control.calls()).map((call) => call.stage)).toContain("solve");
  await context.close();
});
