// "Screenshots to the model" (D35, OBJ-8): the per-session setting and the
// words that say what was sent. Two halves, both proven by effects:
//  - the CONTROL on each surface (web setup, web Sources tab, the web band's
//    Settings popover, the native Settings window, the card's popover) makes
//    exactly one POST per change and the server's `screenshot_send` column holds
//    it; a device-only or ended session refuses with the reason in words;
//  - the CONSEQUENCE: each value changes what the scripted model call receives
//    (image count), the server records `sentByRevision`, and the thumbnail, the
//    viewer and the toggle's tooltip say what that record says.
// The native panel is driven in Auto through the host shim: the frame carries the
// `ocr` block the shim is told to report (Apple Vision's text and metrics), so
// the image gate's decision is the SERVER's, from what the page forwarded.
import type { Page } from "@playwright/test";
import { nativeOverlayUrl } from "../src/fixtures/host-shim";
import { expect, test as panelTest } from "../src/fixtures/panel-test";
import {
  controlSession,
  sessionApi,
  startSessionViaApi,
} from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { taskScreenshots } from "../src/helpers/tasks";
import { SetupPage } from "../src/pages/setup-page";

const test = panelTest;

const OPTION = {
  always: /^Always send/,
  "text-only-when-text": /^Text only when the screen is just text/,
  never: /^Never send images/,
} as const;
type Setting = keyof typeof OPTION;

const DEVICE_ONLY_REASON =
  "This session is device-only, so no screenshot image is ever sent to a model, whatever this says.";
const ENDED_REASON =
  "This session has ended, so the setting can no longer change.";

const radio = (page: Page, setting: Setting) =>
  page.getByRole("radio", { name: OPTION[setting] });

// Counts the POSTs the page makes to the setting's route.
function countPosts(page: Page): { count(): number } {
  let posts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/screenshot-send")
    )
      posts += 1;
  });
  return { count: () => posts };
}

// One change in a control: one POST, the server's column, and the radio shown.
async function choose(
  page: Page,
  id: string,
  setting: Setting,
  posts: { count(): number },
) {
  const before = posts.count();
  await radio(page, setting).check();
  await expect.poll(() => db.screenshotSend(id)).toBe(setting);
  await expect(radio(page, setting)).toBeChecked();
  expect(posts.count()).toBe(before + 1);
}

// ---- the control, on every surface ----------------------------------------

test("web setup: the Screenshots to the model row starts on Always; a choice rides the start request and the started session holds it; Device only disables it with the reason", async ({
  page,
}) => {
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.fillRequired();
  await expect(radio(page, "always")).toBeChecked();

  await radio(page, "never").check();
  await expect(radio(page, "never")).toBeChecked();
  const started = await setup.pressStart();
  expect(await db.screenshotSend(started.id)).toBe("never");
});

test("web setup: Device only disables the Screenshots to the model row with the reason, and the start request carries no choice", async ({
  page,
}) => {
  const setup = new SetupPage(page);
  await setup.goto();
  await setup.fillRequired();
  await setup.policy("Device only").check();
  for (const setting of Object.keys(OPTION) as Setting[])
    await expect(radio(page, setting)).toBeDisabled();
  await expect(page.getByTestId("screenshot-send-status")).toHaveText(
    DEVICE_ONLY_REASON,
  );
  // The start request carries no screenshotSend for a device-only session (no
  // image is ever sent, so there is nothing to choose). The request is read on
  // the wire and stopped there: starting a device-only session from the setup
  // page crashes the bundled headless Chromium's renderer (plan.md 7.16), so the
  // session itself is started over the API in the other specs.
  let body: Record<string, unknown> | null = null;
  await page.route("**/api/interview/t/*/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    body = route.request().postDataJSON() as Record<string, unknown>;
    return route.abort();
  });
  await setup.start().click();
  await expect.poll(() => body).not.toBeNull();
  expect(body).toMatchObject({ processingPolicy: "device-only" });
  expect(body).not.toHaveProperty("screenshotSend");
});

test("web Sources tab: each radio posts once, the server holds it, and a reload shows the saved value", async ({
  page,
  live,
}) => {
  const { id } = await startSessionViaApi();
  await page.goto(`${live.livePath()}/${id}`);
  await page.getByRole("tab", { name: "Sources" }).click();
  const posts = countPosts(page);
  await expect(radio(page, "always")).toBeChecked();
  expect(await db.screenshotSend(id)).toBe("always");

  await choose(page, id, "text-only-when-text", posts);
  await choose(page, id, "never", posts);
  // Choosing the checked one again is not a change: nothing is posted.
  const settled = posts.count();
  await radio(page, "never").click();
  expect(posts.count()).toBe(settled);

  await page.reload();
  await page.getByRole("tab", { name: "Sources" }).click();
  await expect(radio(page, "never")).toBeChecked();
  expect(await db.screenshotSend(id)).toBe("never");
});

test("web device-only and ended: the Sources control is locked with its reason, and the server refuses a change", async ({
  page,
  live,
}) => {
  const deviceOnly = await startSessionViaApi({
    processingPolicy: "device-only",
    captureSources: ["microphone", "application-audio", "screen"],
  });
  await page.goto(`${live.livePath()}/${deviceOnly.id}`);
  await page.getByRole("tab", { name: "Sources" }).click();
  for (const setting of Object.keys(OPTION) as Setting[])
    await expect(radio(page, setting)).toBeDisabled();
  await expect(page.getByTestId("screenshot-send-status")).toHaveText(
    DEVICE_ONLY_REASON,
  );
  expect(await db.screenshotSend(deviceOnly.id)).toBe("always");
  await controlSession(deviceOnly.id, "end");

  // An ended session: the server refuses the change whatever the page says.
  const ended = await startSessionViaApi();
  await controlSession(ended.id, "end");
  const refused = await sessionApi(`/${ended.id}/screenshot-send`, {
    method: "POST",
    body: { screenshotSend: "never" },
  });
  expect(refused.status).toBeGreaterThanOrEqual(400);
  expect(await db.screenshotSend(ended.id)).toBe("always");
});

test("@native native Settings window (Privacy): the choice posts once, the server holds it, the panel's Screenshots tooltip follows, and a reload keeps it", async ({
  openPanel,
  stack,
  control,
}) => {
  void control;
  const { context, page: panel, id, host } = await openPanel({ auto: "on" });
  // A task with a screenshot, so the panel has the Screenshots toggle.
  await host.fireIntent("capture.analyze");
  const toggle = panel.getByRole("button", { name: /^Screenshots \(\d+\)$/ });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute(
    "title",
    /Screenshots to the model: Always$/,
  );

  const settings = await context.newPage();
  await settings.goto(
    nativeOverlayUrl(stack.webUrl, stack.tenantSlug, {
      panel: "settings",
      sessionId: id,
    }),
  );
  await expect(settings.getByText("Privacy")).toBeVisible();
  const posts = countPosts(settings);
  await choose(settings, id, "never", posts);
  await choose(settings, id, "text-only-when-text", posts);

  // The panel is another document: its tooltip names the saved setting.
  await expect(toggle).toHaveAttribute(
    "title",
    /Screenshots to the model: Text only when text$/,
    { timeout: 30_000 },
  );

  await settings.reload();
  await expect(radio(settings, "text-only-when-text")).toBeChecked();
});

test("@native native Settings window on a device-only or ended session: locked with the reason, nothing posted", async ({
  openPanel,
  stack,
}) => {
  const deviceOnly = await openPanel({
    auto: "off",
    start: {
      processingPolicy: "device-only",
      captureSources: ["microphone", "application-audio", "screen"],
    },
  });
  const url = (id: string) =>
    nativeOverlayUrl(stack.webUrl, stack.tenantSlug, {
      panel: "settings",
      sessionId: id,
    });
  const settings = await deviceOnly.context.newPage();
  await settings.goto(url(deviceOnly.id));
  const posts = countPosts(settings);
  for (const setting of Object.keys(OPTION) as Setting[])
    await expect(radio(settings, setting)).toBeDisabled();
  await expect(settings.getByTestId("screenshot-send-status")).toHaveText(
    DEVICE_ONLY_REASON,
  );
  expect(posts.count()).toBe(0);
  expect(await db.screenshotSend(deviceOnly.id)).toBe("always");
  await controlSession(deviceOnly.id, "end");

  const ended = await openPanel({ auto: "off" });
  await controlSession(ended.id, "end");
  const window = await ended.context.newPage();
  await window.goto(url(ended.id));
  for (const setting of Object.keys(OPTION) as Setting[])
    await expect(radio(window, setting)).toBeDisabled();
  await expect(window.getByTestId("screenshot-send-status")).toHaveText(
    ENDED_REASON,
  );
  expect(await db.screenshotSend(ended.id)).toBe("always");
});

// ---- the consequence: what the model receives and what is said about it ----

// The text and metrics Apple Vision would report for a frame (the shell's
// `ocr` block). A clean page of prose covers the frame, reads confidently and
// has no untouched region.
const PROSE =
  "Design a rate limiter that allows at most N requests per client in any sliding window of W seconds. ".repeat(
    4,
  );
const METRICS = {
  coverage: 0.8,
  meanConfidence: 0.95,
  largestGap: 0.05,
  boxes: 12,
};
const vision = (
  text: string,
  metrics: Record<string, number> | null = METRICS,
) => ({
  engine: "vision",
  text,
  confidence: 0.95,
  truncated: false,
  ...(metrics ? { metrics } : {}),
});
const CODE = [
  "function allow(client) {",
  "  const now = Date.now();",
  "  if (now > limit) {",
  "    return false;",
  "  }",
  "  return true;",
  "}",
].join("\n");

const SENT_AS = {
  image: "Image sent",
  "text-only": "Sent as text only",
  none: "Not sent",
} as const;
type Sent = keyof typeof SENT_AS;

// One Auto capture in a native panel whose shell reports `ocr`: the model call
// it caused, what the server recorded as sent, and the words on the thumbnail.
async function captureOnce(
  panel: {
    page: Page;
    host: {
      setCaptureOcr(ocr: unknown): Promise<void>;
      fireIntent(n: string): Promise<void>;
    };
    id: string;
  },
  control: { calls(): Promise<import("../src/stack/control").Call[]> },
  ocr: unknown,
) {
  const before = (await control.calls()).length;
  await panel.host.setCaptureOcr(ocr);
  await panel.host.fireIntent("capture.analyze");
  await expect
    .poll(async () => (await control.calls()).length)
    .toBe(before + 1);
  const call = (await control.calls())[before];
  if (!call?.taskId) throw new Error("no task id on the model call");
  let sent: Sent | undefined;
  await expect
    .poll(async () => {
      const [shot] = await taskScreenshots(panel.id, call.taskId as string);
      sent = shot?.sentByRevision?.[0]?.sent as Sent | undefined;
      return sent;
    })
    .toBeDefined();
  return { call, sent: sent as Sent, taskId: call.taskId };
}

// Opens the screenshots area when it is closed (never closes it).
async function openArea(page: Page) {
  const toggle = page.getByRole("button", { name: /^Screenshots \(\d+\)$/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
}

// The caption of the first thumbnail says `text`, opening the area if needed.
async function expectSentAs(page: Page, text: string) {
  await expect(async () => {
    // A branch, not an assertion: the area may already be open, and the web-first
    // expect below is what proves the caption; this retries as a whole.
    if (!(await page.getByTestId("sent-as").first().isVisible()))
      await openArea(page);
    await expect(page.getByTestId("sent-as").first()).toHaveText(text, {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
}

const SESSION: Record<Setting, { screenshotSend: Setting }> = {
  always: { screenshotSend: "always" },
  "text-only-when-text": { screenshotSend: "text-only-when-text" },
  never: { screenshotSend: "never" },
};

// Text-only-when-text: only a clean, fully read, prose frame goes as text alone.
// Every doubt keeps the image (image-gate.ts: any doubt sends the image).
const GATE_CASES: Array<{
  name: string;
  ocr: unknown;
  sent: Sent;
}> = [
  {
    name: "a clean text frame (high coverage, confident, no gap)",
    ocr: vision(PROSE),
    sent: "text-only",
  },
  {
    name: "code-like text, even with clean metrics",
    ocr: vision(CODE),
    sent: "image",
  },
  {
    name: "a diagram: low coverage and a big untouched region",
    ocr: vision(PROSE, {
      coverage: 0.3,
      meanConfidence: 0.95,
      largestGap: 0.4,
      boxes: 12,
    }),
    sent: "image",
  },
  {
    name: "a big untouched region alone (coverage high, gap 0.3)",
    ocr: vision(PROSE, {
      coverage: 0.8,
      meanConfidence: 0.95,
      largestGap: 0.3,
      boxes: 12,
    }),
    sent: "image",
  },
  {
    name: "low confidence",
    ocr: vision(PROSE, {
      coverage: 0.8,
      meanConfidence: 0.6,
      largestGap: 0.05,
      boxes: 12,
    }),
    sent: "image",
  },
  {
    name: "Tesseract text (the engine reports no metrics the gate may trust)",
    ocr: {
      engine: "tesseract",
      text: PROSE,
      confidence: 0.95,
      truncated: false,
      metrics: METRICS,
    },
    sent: "image",
  },
  { name: "text without metrics", ocr: vision(PROSE, null), sent: "image" },
  { name: "no text read at all", ocr: null, sent: "image" },
];

for (const gate of GATE_CASES) {
  test(`@native native Screenshots to the model, text only when the screen is just text: ${gate.name} sends ${gate.sent === "image" ? "the image" : "text only"}, the server records it and the thumbnail says ${SENT_AS[gate.sent]}`, async ({
    openPanel,
    control,
  }) => {
    const panel = await openPanel({
      auto: "on",
      start: SESSION["text-only-when-text"],
    });
    expect(await db.screenshotSend(panel.id)).toBe("text-only-when-text");

    const { call, sent } = await captureOnce(panel, control, gate.ocr);

    // The model received exactly what the gate decided.
    expect(sent).toBe(gate.sent);
    expect(call.images).toBe(gate.sent === "image" ? 1 : 0);
    // The screenshot says so, from the server's record.
    await expectSentAs(panel.page, SENT_AS[gate.sent]);
  });
}

test("@native native Screenshots to the model, Always: the image and the text read from it both go to the model, and the thumbnail says Image sent", async ({
  openPanel,
  control,
}) => {
  const panel = await openPanel({ auto: "on", start: SESSION.always });
  const withText = await captureOnce(panel, control, vision(PROSE));
  const withoutText = await captureOnce(panel, control, null);

  expect(withText.sent).toBe("image");
  expect(withText.call.images).toBe(1);
  expect(withoutText.call.images).toBe(1);
  // The text rode along: the model's prompt is longer by about the text.
  expect(
    withText.call.promptLength - withoutText.call.promptLength,
  ).toBeGreaterThanOrEqual(PROSE.length * 0.8);
  await expectSentAs(panel.page, "Image sent");
});

test("@native native Screenshots to the model, Never: no image reaches the model, the text still does, and a frame with no text is Not sent", async ({
  openPanel,
  control,
}) => {
  const panel = await openPanel({ auto: "on", start: SESSION.never });
  const withText = await captureOnce(panel, control, vision(PROSE));
  expect(withText.sent).toBe("text-only");
  expect(withText.call.images).toBe(0);
  expect(withText.call.imageBytes).toBe(0);

  const withoutText = await captureOnce(panel, control, null);
  expect(withoutText.sent).toBe("none");
  expect(withoutText.call.images).toBe(0);
  // The text rode along on the first call only.
  expect(
    withText.call.promptLength - withoutText.call.promptLength,
  ).toBeGreaterThanOrEqual(PROSE.length * 0.8);

  // The thumbnails: the newest task (no text) says Not sent; the earlier one
  // (open it from its chip) says Sent as text only.
  await panel.page.getByRole("button", { name: /^T2 · / }).click();
  await expectSentAs(panel.page, "Not sent");
  await panel.page.getByRole("button", { name: /^T1 · / }).click();
  await expectSentAs(panel.page, "Sent as text only");
});

test("@native native Screenshots to the model: a change applies to the next model call (Always, then Never, then back) and each thumbnail keeps what ITS call sent", async ({
  openPanel,
  control,
  stack,
}) => {
  const panel = await openPanel({ auto: "on", start: SESSION.always });
  const settings = await panel.context.newPage();
  await settings.goto(
    nativeOverlayUrl(stack.webUrl, stack.tenantSlug, {
      panel: "settings",
      sessionId: panel.id,
    }),
  );
  const posts = countPosts(settings);

  const first = await captureOnce(panel, control, vision(PROSE));
  expect(first.call.images).toBe(1);
  await choose(settings, panel.id, "never", posts);
  const second = await captureOnce(panel, control, vision(PROSE));
  expect(second.call.images).toBe(0);
  await choose(settings, panel.id, "always", posts);
  const third = await captureOnce(panel, control, vision(PROSE));
  expect(third.call.images).toBe(1);

  // The server recorded each call's own outcome; the first task still says Image sent.
  expect(first.sent).toBe("image");
  expect(second.sent).toBe("text-only");
  expect(third.sent).toBe("image");
  // The panel polls: wait until it shows the newest task (and has made it the
  // one on show) before choosing an earlier chip, or the newest task arriving
  // late takes the view back from the click.
  await expect(
    panel.page.getByRole("button", { name: /^T3 · / }),
  ).toBeVisible();
  await expectSentAs(panel.page, "Image sent");
  await panel.page.getByRole("button", { name: /^T1 · / }).click();
  await expectSentAs(panel.page, "Image sent");
  await panel.page.getByRole("button", { name: /^T2 · / }).click();
  await expectSentAs(panel.page, "Sent as text only");
});
