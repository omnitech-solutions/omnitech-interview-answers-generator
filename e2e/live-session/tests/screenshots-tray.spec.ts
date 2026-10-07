// The Screenshots icon, the Auto strip and the Manual staging tray (D28-D31),
// on the web page and in the native panel (the controls and words are the
// same). In Manual a capture is STAGED on this device and nothing is sent until
// Apply; Apply is ONE request (a new task from N images in tray order, or one
// new revision of the targeted task, or a plain regenerate); crop, reorder,
// remove and Discard work on the staged images; the viewer zooms and keeps
// focus. Proof: the scripted model's recorded calls (images, bytes, digests),
// the rows the server holds, the screenshots route, and what the page draws.
import type { Locator, Page } from "@playwright/test";
import { expect, type OpenPanel, test } from "../src/fixtures/panel-test";
import { startSessionViaApi } from "../src/helpers/api";
import { db } from "../src/helpers/sql";
import { say, settled, taskIdsOf, taskScreenshots } from "../src/helpers/tasks";
import { chooseCaptureMode } from "../src/helpers/toolbar";
import type { LivePage } from "../src/pages/live-page";
import type { Control } from "../src/stack/control";
import { SCRIPTED } from "../src/stack/scenarios";

const QUESTION = "What is a closure in JavaScript?";

type Surface = {
  kind: "web" | "native";
  page: Page;
  id: string;
  credential: string;
  // Staging one image: the tray's own Add screenshot button.
  add(): Promise<void>;
  // Capture new problem in the Answer pane, confirmed: stages one frame as a NEW task.
  captureNew(): Promise<void>;
};

const toggle = (page: Page): Locator =>
  page.getByRole("button", { name: /^Screenshots \(\d+\)$/ });
const area = (page: Page): Locator => page.getByTestId("screenshots-area");
const apply = (page: Page): Locator => page.getByTestId("apply-screenshots");
const discard = (page: Page): Locator =>
  page.getByTestId("discard-screenshots");
const staged = (page: Page): Locator =>
  page.locator('[data-testid^="staged-"]');
const viewer = (page: Page): Locator => page.getByTestId("image-viewer");

// A surface in Manual with T1 already answered from a spoken question (so the
// tray has a task to add to and nothing about it is a screenshot).
async function manualSurface(
  kind: "web" | "native",
  fixtures: {
    live: LivePage;
    control: Control;
    openPanel: (o?: {
      auto?: "on" | "off";
      sessionId?: string;
    }) => Promise<OpenPanel>;
  },
  options: { start?: Parameters<typeof startSessionViaApi>[0] } = {},
): Promise<Surface> {
  await fixtures.control.scenario("plain-answer");
  const started = await startSessionViaApi(options.start);
  const credential = started.response.credential.value;
  let page: Page;
  if (kind === "web") {
    page = fixtures.live.page;
    await fixtures.live.goto();
  } else {
    ({ page } = await fixtures.openPanel({
      auto: "off",
      sessionId: started.id,
    }));
  }
  await say(credential, QUESTION);
  await expect(page.getByText(SCRIPTED.plain).first()).toBeVisible();
  await settled(started.id, 1);
  return {
    kind,
    page,
    id: started.id,
    credential,
    add: async () => {
      const before = await staged(page).count();
      await page.getByTestId("add-screenshot").click();
      await expect(staged(page)).toHaveCount(before + 1);
    },
    captureNew: async () => {
      const before = await staged(page).count();
      await page.getByTestId("pn-capture-new").click();
      await page.getByRole("button", { name: "Capture", exact: true }).click();
      await expect(staged(page)).toHaveCount(before + 1);
    },
  };
}

// The first 8 hex characters of the sha-256 of each staged image's bytes, in
// tray order: the same digest the control API records for the images a model
// call received, so the two can be compared exactly.
const stagedDigests = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const out: string[] = [];
    for (const item of document.querySelectorAll('[data-testid^="staged-"]')) {
      const src = item.querySelector("img")?.getAttribute("src");
      if (!src) {
        out.push("");
        continue;
      }
      const bytes = await (await fetch(src)).arrayBuffer();
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      out.push(
        Array.from(hash.slice(0, 4), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      );
    }
    return out;
  });

// The byte size of the n-th staged image (1-based).
const stagedBytes = (page: Page, n: number): Promise<number> =>
  page.evaluate(async (at) => {
    const src = document
      .querySelector(`[data-testid="staged-${at}"] img`)
      ?.getAttribute("src");
    return src ? (await (await fetch(src)).blob()).size : -1;
  }, n);

// The natural width of the n-th staged thumbnail's image.
const stagedWidth = (page: Page, n: number): Promise<number> =>
  page.evaluate(
    (at) =>
      (
        document.querySelector(
          `[data-testid="staged-${at}"] img`,
        ) as HTMLImageElement | null
      )?.naturalWidth ?? -1,
    n,
  );

// Design change (native dock): the heading "To apply (n)" is the dock's count
// "To apply · n"; the per-thumbnail Crop button is gone (crop lives in the
// image viewer, opened from the thumbnail); Remove shows on hover or focus.
const toApply = (s: Surface, n: number): Locator =>
  s.kind === "native"
    ? s.page.getByTestId("screenshot-tray").getByText(`To apply \u00b7 ${n}`)
    : s.page.getByRole("heading", { name: `To apply (${n})` });

async function openCrop(s: Surface, n: number): Promise<void> {
  if (s.kind === "web") {
    await s.page.getByRole("button", { name: `Crop New ${n}` }).click();
    return;
  }
  await s.page.getByRole("button", { name: `Open New ${n}` }).click();
  await s.page
    .getByTestId("image-viewer")
    .getByRole("button", { name: "Crop" })
    .click();
}

async function removeStaged(s: Surface, n: number): Promise<void> {
  // The native remove control appears while the thumbnail is hovered or focused.
  if (s.kind === "native") await s.page.getByTestId(`staged-${n}`).hover();
  await s.page.getByRole("button", { name: `Remove New ${n}` }).click();
}

// Move one staged image a place left or right: the web tray's Move buttons;
// in the native dock, Alt+Arrow on the thumbnail's open button.
async function moveStaged(
  s: Surface,
  n: number,
  by: "left" | "right",
): Promise<void> {
  if (s.kind === "web") {
    await s.page.getByRole("button", { name: `Move New ${n} ${by}` }).click();
    return;
  }
  await s.page.getByRole("button", { name: `Open New ${n}` }).focus();
  await s.page.keyboard.press(`Alt+Arrow${by === "left" ? "Left" : "Right"}`);
}

const callsAfter = async (control: Control, count: number) =>
  (await control.calls()).slice(count);

for (const kind of ["web", "native"] as const) {
  const tag = kind === "native" ? "@native native" : "web";

  // The web live page no longer captures (ADR-0033: the native app owns capture), so there is no
  // "Add screenshot" to stage with there: every staging test is a native-panel test. The two web
  // variants that need no staging (Apply with nothing staged, device-only) stay below.
  if (kind === "native") {
    test(`${tag} screenshots icon and tray modes: open by default in Manual, closed in Auto until something is staged, and the count is stored plus staged`, async ({
      live,
      control,
      openPanel,
    }) => {
      const s = await manualSurface(kind, { live, control, openPanel });
      const { page } = s;

      // Manual: the tray is open without a press, and the icon says so.
      await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
      await expect(area(page)).toBeVisible();
      await expect(toggle(page)).toHaveAccessibleName("Screenshots (0)");

      // The toggle is real: it hides and shows the area.
      await toggle(page).click();
      await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
      await expect(area(page)).toBeHidden();
      await toggle(page).click();
      await expect(area(page)).toBeVisible();

      // Staging adds to the count (stored 0 + staged 1).
      await s.add();
      await expect(staged(page)).toHaveCount(1);
      await expect(toggle(page)).toHaveAccessibleName("Screenshots (1)");
      await expect(page.getByTestId("screenshots-count")).toHaveText("1");

      // Auto: closed by default (the minimised strip), opened by the icon.
      await page.getByTestId("discard-screenshots").click();
      await expect(staged(page)).toHaveCount(0);
      // The web page has no Auto switch (the native app owns capture modes).
      if (kind === "native") {
        await chooseCaptureMode(page, "Auto");
        await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
        await expect(area(page)).toBeHidden();
        await toggle(page).click();
        await expect(area(page)).toBeVisible();
        await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
      }
      // The model was never involved in any of this.
      expect((await control.calls()).length).toBe(1);
    });

    test(`${tag} screenshots Add screenshot: stages on this device marked Not sent yet, sends nothing, and Apply is ONE request with every image, in order, as ONE new task`, async ({
      live,
      control,
      openPanel,
    }) => {
      const s = await manualSurface(kind, { live, control, openPanel });
      const { page } = s;
      const before = (await control.calls()).length;
      const observed = (await db.observations(s.id)).length;
      const tasksBefore = taskIdsOf(await db.actions(s.id));

      // A NEW problem from two images.
      await s.captureNew();
      await s.add();
      await expect(staged(page)).toHaveCount(2);
      await expect(toApply(s, 2)).toBeVisible();
      for (const n of [1, 2])
        await expect(page.getByTestId(`staged-${n}`)).toContainText(
          "Not sent yet",
        );
      await expect(page.getByTestId("tray-sends")).toHaveText(
        "Sends 2 screenshots and the text read from them.",
      );

      // Nothing has left the device: no model call, no new observation.
      expect((await control.calls()).length).toBe(before);
      expect((await db.observations(s.id)).length).toBe(observed);
      const digests = await stagedDigests(page);
      expect(digests).toHaveLength(2);

      await apply(page).click();

      // ONE request, both images in tray order, ONE new task.
      await expect
        .poll(async () => (await control.calls()).length)
        .toBe(before + 1);
      const [call] = await callsAfter(control, before);
      expect(call).toMatchObject({ stage: "assist", revision: 1, images: 2 });
      expect(call?.imageDigests).toEqual(digests);
      const actions = await settled(s.id, 2);
      const tasks = taskIdsOf(actions);
      expect(tasks).toHaveLength(tasksBefore.length + 1);
      const created = tasks[1] as string;
      expect(call?.taskId).toBe(created);
      expect(
        (await db.observations(s.id)).filter(
          (o) => o.kind === "screen.snapshot" && o.screenshot_artifact_id,
        ),
      ).toHaveLength(2);
      expect(await taskScreenshots(s.id, created)).toHaveLength(2);
      // The tray emptied and the new task is on show with its two stored shots.
      await expect(staged(page)).toHaveCount(0);
      await expect(toggle(page)).toHaveAccessibleName("Screenshots (2)");
      await expect(
        page
          .getByRole("list", { name: "Screenshots of this task" })
          .getByRole("listitem"),
      ).toHaveCount(2);
    });

    test(`${tag} screenshots intent Add to T1: Apply makes revision 2 of the SAME task from the staged image, and the first answer is marked Outdated`, async ({
      live,
      control,
      openPanel,
    }) => {
      const s = await manualSurface(kind, { live, control, openPanel });
      const { page } = s;
      const first = await db.actions(s.id);
      const taskId = taskIdsOf(first)[0] as string;
      const before = (await control.calls()).length;

      // With a task on show a staged screenshot adds to it (no choice to make).
      await s.add();
      await expect(staged(page)).toHaveCount(1);
      await apply(page).click();

      await expect
        .poll(async () =>
          (await db.actions(s.id)).some(
            (a) => a.task_id === taskId && a.task_revision === 2,
          ),
        )
        .toBe(true);
      expect(taskIdsOf(await db.actions(s.id))).toEqual([taskId]);
      // (The action row exists before the model call is recorded.)
      await expect
        .poll(async () => (await control.calls()).length)
        .toBe(before + 1);
      const [call] = await callsAfter(control, before);
      expect(call).toMatchObject({ stage: "assist", revision: 2, images: 1 });
      expect(call?.taskId).toBe(taskId);
      expect(await taskScreenshots(s.id, taskId)).toHaveLength(1);
      // The previous answer is kept and marked Outdated; the new one is current.
      await page.getByTestId("revisions-button").click();
      await expect(page.getByTestId("revision-1")).toContainText("Outdated");
      await expect(page.getByTestId("revision-2")).toContainText("Current");
    });

    test(`${tag} screenshots Remove and Discard: Remove drops one image from the request, Discard drops them all and the server hears of neither`, async ({
      live,
      control,
      openPanel,
    }) => {
      const s = await manualSurface(kind, { live, control, openPanel });
      const { page } = s;
      const before = (await control.calls()).length;
      await s.captureNew();
      await s.add();
      await expect(staged(page)).toHaveCount(2);
      const both = await stagedDigests(page);

      await removeStaged(s, 1);

      await expect(staged(page)).toHaveCount(1);
      await expect(toApply(s, 1)).toBeVisible();
      expect((await control.calls()).length).toBe(before);
      const rest = await stagedDigests(page);
      expect(rest).toHaveLength(1);
      await apply(page).click();
      await expect
        .poll(async () => (await control.calls()).length)
        .toBe(before + 1);
      const [call] = await callsAfter(control, before);
      expect(call).toMatchObject({ images: 1 });
      expect(call?.imageDigests).toEqual(rest);
      // (Which image was removed: the first. The one sent is the survivor.)
      expect(both).toHaveLength(2);

      // Discard: stage again, drop everything.
      await settled(s.id, 2);
      await s.captureNew();
      await s.add();
      await expect(staged(page)).toHaveCount(2);
      const observed = (await db.observations(s.id)).length;
      const calls = (await control.calls()).length;
      await discard(page).click();
      await expect(staged(page)).toHaveCount(0);
      await expect(discard(page)).toBeHidden();
      expect((await control.calls()).length).toBe(calls);
      expect((await db.observations(s.id)).length).toBe(observed);
    });

    test(`${tag} screenshots Crop: the crop editor makes a smaller image of the exact size chosen, Reset and Cancel leave it as it was, and Apply sends the cropped bytes`, async ({
      live,
      control,
      openPanel,
    }) => {
      const s = await manualSurface(kind, { live, control, openPanel });
      const { page } = s;
      const before = (await control.calls()).length;
      await s.captureNew();
      await expect(staged(page)).toHaveCount(1);
      const wholeBytes = await stagedBytes(page, 1);
      const wholeWidth = await stagedWidth(page, 1);
      expect(wholeWidth).toBeGreaterThan(400);

      // Crop opens the editor on the staged image (a dialog).
      await openCrop(s, 1);
      const dialog = viewer(page);
      await expect(dialog).toBeVisible();
      const editor = page.getByTestId("crop-editor");
      await expect(editor).toBeVisible();
      // Type exact pixels: the readout follows, clamped to the image.
      const width = editor.getByRole("spinbutton", { name: "Width" });
      const height = editor.getByRole("spinbutton", { name: "Height" });
      await width.fill("400");
      await height.fill("300");
      await expect(page.getByTestId("crop-output")).toContainText(
        "Output 400 × 300 px",
      );
      // Below the minimum side it is clamped, never smaller than 32.
      await width.fill("5");
      await expect(page.getByTestId("crop-output")).toContainText(
        /Output 32 × 300 px/,
      );
      // Reset restores the whole image.
      await editor.getByRole("button", { name: "Reset" }).click();
      await expect(page.getByTestId("crop-output")).toContainText(
        `Output ${wholeWidth} × `,
      );
      // Cancel leaves the staged image untouched.
      await width.fill("400");
      await editor.getByRole("button", { name: "Cancel" }).click();
      await expect(editor).toBeHidden();
      expect(await stagedWidth(page, 1)).toBe(wholeWidth);
      expect(await stagedBytes(page, 1)).toBe(wholeBytes);
      await page.getByRole("button", { name: "Close viewer" }).click();

      // Apply crop: a NEW, smaller image replaces the staged one.
      await openCrop(s, 1);
      await page
        .getByTestId("crop-editor")
        .getByRole("spinbutton", { name: "Width" })
        .fill("400");
      await page
        .getByTestId("crop-editor")
        .getByRole("spinbutton", { name: "Height" })
        .fill("300");
      await page.getByRole("button", { name: "Apply crop" }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => stagedWidth(page, 1)).toBe(400);
      const croppedBytes = await stagedBytes(page, 1);
      expect(croppedBytes).toBeLessThan(wholeBytes);
      const digests = await stagedDigests(page);

      // What is uploaded is exactly the cropped image.
      await apply(page).click();
      await expect
        .poll(async () => (await control.calls()).length)
        .toBe(before + 1);
      const [call] = await callsAfter(control, before);
      expect(call).toMatchObject({ images: 1, imageBytes: croppedBytes });
      expect(call?.imageDigests).toEqual(digests);
    });

    test(`${tag} screenshots crop handles: an edge handle moves with the arrow keys, never below the smallest size, and the readout follows`, async ({
      live,
      control,
      openPanel,
    }) => {
      const s = await manualSurface(kind, { live, control, openPanel });
      const { page } = s;
      await s.captureNew();
      await openCrop(s, 1);
      const output = page.getByTestId("crop-output");
      await expect(output).toBeVisible();
      const full = await stagedWidth(page, 1);

      // The right edge nudged left: one pixel per press, ten with Shift.
      const east = page.getByRole("button", { name: "Crop edge: right" });
      await east.focus();
      await page.keyboard.press("ArrowLeft");
      await expect(output).toContainText(`Output ${full - 1} × `);
      await page.keyboard.press("Shift+ArrowLeft");
      await expect(output).toContainText(`Output ${full - 11} × `);
      // Pulled far in, it stops at the smallest side.
      for (let n = 0; n < 200; n += 1)
        await page.keyboard.press("Shift+ArrowLeft");
      await expect(output).toContainText("Output 32 × ");
      await page.getByRole("button", { name: "Cancel" }).click();
    });

    test(`${tag} screenshots reorder: Move right and left change the order the images are sent in`, async ({
      live,
      control,
      openPanel,
    }) => {
      const s = await manualSurface(kind, { live, control, openPanel });
      const { page } = s;
      const before = (await control.calls()).length;
      await s.captureNew();
      await s.add();
      await expect(staged(page)).toHaveCount(2);
      // Make the two different (the web share shows one still frame): crop the
      // second, so the two images have different bytes.
      await openCrop(s, 2);
      await page
        .getByTestId("crop-editor")
        .getByRole("spinbutton", { name: "Width" })
        .fill("500");
      await page.getByRole("button", { name: "Apply crop" }).click();
      await expect.poll(() => stagedWidth(page, 2)).toBe(500);
      const original = await stagedDigests(page);
      expect(original[0]).not.toBe(original[1]);
      // The first cannot move left; the last cannot move right.
      await moveStaged(s, 1, "left");
      await moveStaged(s, 2, "right");
      expect(await stagedDigests(page)).toEqual(original);

      await moveStaged(s, 2, "left");

      const reordered = await stagedDigests(page);
      expect(reordered).toEqual([original[1], original[0]]);
      await expect.poll(() => stagedWidth(page, 1)).toBe(500);
      await apply(page).click();
      await expect
        .poll(async () => (await control.calls()).length)
        .toBe(before + 1);
      const [call] = await callsAfter(control, before);
      expect(call?.imageDigests).toEqual(reordered);

      // And back with Move right on the next batch.
      await settled(s.id, 2);
      await s.captureNew();
      await s.add();
      await openCrop(s, 1);
      await page
        .getByTestId("crop-editor")
        .getByRole("spinbutton", { name: "Width" })
        .fill("500");
      await page.getByRole("button", { name: "Apply crop" }).click();
      await expect.poll(() => stagedWidth(page, 1)).toBe(500);
      const second = await stagedDigests(page);
      await moveStaged(s, 1, "right");
      expect(await stagedDigests(page)).toEqual([second[1], second[0]]);
    });

    test(`${tag} screenshots viewer: Zoom, Fit and 100% change the drawn scale, Escape closes it and focus returns to the thumbnail that opened it`, async ({
      live,
      control,
      openPanel,
      browserName,
    }) => {
      // Safari does not focus a button on click, so there is no opener to return
      // to in WebKit; Chromium proves the focus return.
      const returnsFocus = browserName !== "webkit";
      const s = await manualSurface(kind, { live, control, openPanel });
      const { page } = s;
      await s.captureNew();
      const thumb = page.getByRole("button", { name: "Open New 1" });
      await thumb.click();

      const dialog = viewer(page);
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAccessibleName("Screenshot New 1");
      await expect(page.getByTestId("viewer-label")).toHaveText("New 1");
      await expect(dialog).toContainText("Not sent yet");
      const zoom = page.getByTestId("viewer-zoom");
      const picture = dialog.getByRole("img", { name: "Screenshot New 1" });
      await expect(zoom).toHaveText("Fit");
      const natural = await stagedWidth(page, 1);

      // 100% draws one image pixel per CSS pixel; Fit fills the window; Zoom in
      // and out step the scale.
      await dialog.getByRole("button", { name: "100%", exact: true }).click();
      await expect(zoom).toHaveText("100%");
      await expect
        .poll(async () => (await picture.boundingBox())?.width ?? 0)
        .toBeCloseTo(natural, -1);
      await dialog.getByRole("button", { name: "Zoom in" }).click();
      await expect(zoom).toHaveText("150%");
      await dialog.getByRole("button", { name: "Zoom out" }).click();
      await expect(zoom).toHaveText("100%");
      await dialog.getByRole("button", { name: "Zoom out" }).click();
      await expect(zoom).toHaveText("75%");
      await dialog.getByRole("button", { name: "Fit", exact: true }).click();
      await expect(zoom).toHaveText("Fit");
      // The keys do the same.
      await dialog.press("1");
      await expect(zoom).toHaveText("100%");
      await dialog.press("f");
      await expect(zoom).toHaveText("Fit");

      // Escape closes it and puts the focus back on the thumbnail.
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      if (returnsFocus) await expect(thumb).toBeFocused();
      // The Close button does the same.
      await thumb.click();
      await expect(dialog).toBeVisible();
      await page.getByRole("button", { name: "Close viewer" }).click();
      await expect(dialog).toBeHidden();
      if (returnsFocus) await expect(thumb).toBeFocused();
    });

    test(`${tag} screenshots viewer Zoom in enlarges the drawn image`, async ({
      live,
      control,
      openPanel,
    }) => {
      const s = await manualSurface(kind, { live, control, openPanel });
      const { page } = s;
      await s.captureNew();
      await page.getByRole("button", { name: "Open New 1" }).click();
      const dialog = viewer(page);
      const picture = dialog.getByRole("img", { name: "Screenshot New 1" });
      const natural = await stagedWidth(page, 1);
      await dialog.getByRole("button", { name: "100%", exact: true }).click();
      await dialog.getByRole("button", { name: "Zoom in" }).click();
      await expect(page.getByTestId("viewer-zoom")).toHaveText("150%");
      await expect
        .poll(async () => (await picture.boundingBox())?.width ?? 0, {
          timeout: 5_000,
        })
        .toBeGreaterThan(natural * 1.4);
    });

    test(`${tag} screenshots viewer Crop: Crop from the viewer opens the editor, and Apply crop closes the viewer with a smaller image staged`, async ({
      live,
      control,
      openPanel,
    }) => {
      const s = await manualSurface(kind, { live, control, openPanel });
      const { page } = s;
      await s.captureNew();
      const whole = await stagedBytes(page, 1);
      await page.getByRole("button", { name: "Open New 1" }).click();

      await viewer(page)
        .getByRole("button", { name: "Crop", exact: true })
        .click();
      await expect(page.getByTestId("crop-editor")).toBeVisible();
      await page
        .getByTestId("crop-editor")
        .getByRole("spinbutton", { name: "Left" })
        .fill("40");
      await page
        .getByTestId("crop-editor")
        .getByRole("spinbutton", { name: "Width" })
        .fill("320");
      await page.getByRole("button", { name: "Apply crop" }).click();

      await expect(viewer(page)).toBeHidden();
      await expect.poll(() => stagedWidth(page, 1)).toBe(320);
      expect(await stagedBytes(page, 1)).toBeLessThan(whole);
    });

    test(`${tag} screenshots stored thumbnails: a thumbnail opens its screenshot from the server's screenshot route only, and the strip scrolls when it overflows`, async ({
      live,
      control,
      openPanel,
    }) => {
      const s = await manualSurface(kind, { live, control, openPanel });
      const { page } = s;
      const urls: string[] = [];
      page.on("request", (request) => {
        if (request.resourceType() === "image") urls.push(request.url());
      });
      // Capture new problem stages the first image; three more join it.
      await s.captureNew();
      for (let n = 0; n < 3; n += 1) await s.add();
      await apply(page).click();
      const actions = await settled(s.id, 2);
      const created = taskIdsOf(actions)[1] as string;
      const stored = await taskScreenshots(s.id, created);
      expect(stored).toHaveLength(4);

      const strip = page.getByRole("list", {
        name: "Screenshots of this task",
      });
      await expect(strip.getByRole("listitem")).toHaveCount(4);
      // Each caption names its S number; the display (native only) and the
      // revision it fed.
      const firstItem = strip.getByRole("listitem").first();
      await expect(firstItem).toContainText(`S${stored[0]?.ordinal}`);
      await expect(firstItem).toContainText("rev 1");

      // A thumbnail opens that screenshot; its image is the authenticated route.
      await page
        .getByRole("button", { name: `Open S${stored[0]?.ordinal}` })
        .click();
      const dialog = viewer(page);
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId("viewer-label")).toHaveText(
        `S${stored[0]?.ordinal}`,
      );
      await expect(dialog.getByText("Not sent yet")).toHaveCount(0);
      const image = dialog.getByRole("img", {
        name: `Screenshot S${stored[0]?.ordinal}`,
      });
      await expect(image).toHaveAttribute(
        "src",
        new RegExp(`/sessions/${s.id}/screenshots/${stored[0]?.artifactId}$`),
      );
      await expect
        .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
        .toBeGreaterThan(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      // Every stored image the page loaded came through that one route.
      const stored404 = urls.filter((url) => url.includes("/screenshots/"));
      expect(stored404.length).toBeGreaterThan(0);
      for (const url of stored404)
        expect(url).toMatch(new RegExp(`/sessions/${s.id}/screenshots/[^/]+$`));

      // The strip: with four thumbnails the arrows show; when the strip is
      // narrower than its content, an arrow scrolls it.
      await page.setViewportSize({ width: 760, height: 900 });
      const right = page.getByRole("button", {
        name: "Scroll screenshots right",
      });
      const left = page.getByRole("button", {
        name: "Scroll screenshots left",
      });
      await expect(right).toBeVisible();
      await expect(left).toBeVisible();
      const track = page.getByTestId("screenshot-strip");
      const overflow = await track.evaluate(
        (el) => el.scrollWidth - el.clientWidth,
      );
      if (overflow > 0) {
        await right.click();
        await expect
          .poll(() => track.evaluate((el) => el.scrollLeft))
          .toBeGreaterThan(0);
        // Smooth scrolling settles; read the settled position, then go back.
        let settled = -1;
        await expect
          .poll(async () => {
            const now = await track.evaluate((el) => el.scrollLeft);
            const same = now === settled;
            settled = now;
            return same;
          })
          .toBe(true);
        await left.click();
        await expect
          .poll(() => track.evaluate((el) => el.scrollLeft))
          .toBeLessThan(settled);
      }
    });
  }

  test(`${tag} screenshots Apply with nothing staged: it regenerates the task (revision 2, no image), and with no task there is nothing to apply`, async ({
    live,
    control,
    openPanel,
  }) => {
    const s = await manualSurface(kind, { live, control, openPanel });
    const { page } = s;
    const before = (await control.calls()).length;
    await expect(page.getByTestId("tray-sends")).toHaveText(
      "Nothing staged. Apply regenerates without new context.",
    );
    await expect(apply(page)).toBeEnabled();

    await apply(page).click();

    await expect
      .poll(async () => (await control.calls()).length)
      .toBe(before + 1);
    const [call] = await callsAfter(control, before);
    expect(call).toMatchObject({ stage: "assist", revision: 2, images: 0 });
    expect(taskIdsOf(await db.actions(s.id))).toHaveLength(1);
  });
}

test("web screenshots in a device-only session: Add is disabled with its reason, Apply cannot send an image, and nothing is stored or sent", async ({
  live,
  control,
  openPanel,
}) => {
  const s = await manualSurface(
    "web",
    { live, control, openPanel },
    { start: { processingPolicy: "device-only" } },
  );
  const { page } = s;

  const add = page.getByTestId("add-screenshot");
  await expect(add).toBeDisabled();
  await expect(page.getByTestId("add-reason")).toContainText(/device/i);
  await expect(page.getByTestId("tray-sends")).toContainText(
    "Device-only: no screenshot leaves this device, so none can be applied.",
  );
  expect(
    (await db.observations(s.id)).filter((o) => o.kind === "screen.snapshot"),
  ).toEqual([]);
  expect((await control.calls()).every((c) => c.images === 0)).toBe(true);
});

test("@native native screenshots in a device-only session: Add is disabled with its reason and nothing is staged, stored or sent", async ({
  live,
  control,
  openPanel,
}) => {
  const s = await manualSurface(
    "native",
    { live, control, openPanel },
    { start: { processingPolicy: "device-only" } },
  );
  const { page } = s;

  await expect(page.getByTestId("add-screenshot")).toBeDisabled();
  await expect(page.getByTestId("add-reason")).toContainText(/device/i);
  await expect(page.getByTestId("tray-sends")).toContainText(
    "Device-only: no screenshot leaves this device, so none can be applied.",
  );
  expect(
    (await db.observations(s.id)).filter((o) => o.kind === "screen.snapshot"),
  ).toEqual([]);
  expect((await control.calls()).every((c) => c.images === 0)).toBe(true);
});
