// The capture companion's capture loop (ADR-0018, ADR-0020) from the web page:
// the three Capture & analyze menu items that depend on the companion. The test
// plays the companion on the wire (helpers/companion.ts): it declares
// `capture-request.v1`, reads the ONE pending request from its heartbeat answers,
// captures once and answers with a snapshot naming the request, or reports a
// closed failure code. What each menu item did is read from the server (the
// observations, the actions) and from the scripted model's recorded calls.
import type { Page } from "@playwright/test";
import { expect, test } from "../src/fixtures/test";
import { startSessionViaApi } from "../src/helpers/api";
import {
  type CaptureRequestWire,
  Companion,
  captureRequestHeaders,
} from "../src/helpers/companion";
import { db } from "../src/helpers/sql";
import { settled, taskIdsOf } from "../src/helpers/tasks";
import { SCRIPTED } from "../src/stack/scenarios";

const snapshots = async (id: string) =>
  (await db.observations(id)).filter((row) => row.kind === "screen.snapshot");

// A session with the companion in contact, its screen receiving and one stored
// capture, and the web page open on it in Manual.
async function withCompanion(
  live: {
    livePath(): string;
    useManual(): Promise<void>;
    captureAnalyze(): import("@playwright/test").Locator;
  },
  page: Page,
) {
  const started = await startSessionViaApi({
    captureSources: ["microphone", "screen"],
  });
  const companion = new Companion(
    started.response.credential.value,
    captureRequestHeaders(),
  );
  expect((await companion.heartbeat()).status).toBe(200);
  // Its capability report carries the screen selection a region is bound to.
  expect((await companion.capabilityReport()).status).toBe(200);
  expect((await companion.screenshot()).status).toBe(200);
  await page.goto(`${live.livePath()}/${started.id}`);
  await live.useManual();
  return { id: started.id, companion };
}

const menuItem = (page: Page, name: RegExp) =>
  page.getByRole("menuitem", { name });

// The companion's side: waits for the request the page made, as the companion
// would see it in a heartbeat answer.
async function nextRequest(
  companion: Companion,
  mode: CaptureRequestWire["mode"],
): Promise<CaptureRequestWire> {
  let seen: CaptureRequestWire | null = null;
  await expect
    .poll(async () => {
      seen = await companion.pendingCapture();
      return seen?.mode ?? null;
    })
    .toBe(mode);
  return seen as unknown as CaptureRequestWire;
}

test("web Analyze stored capture: starts a task from the capture the companion already sent, with no new capture and one image to the model", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("plain-answer");
  const { id } = await withCompanion(live, page);
  expect(await snapshots(id)).toHaveLength(1);

  await live.captureAnalyze().click();
  const item = menuItem(page, /^Analyze stored capture/);
  await expect(item).toBeEnabled();
  await expect(item).toContainText("Not a new capture: S1");
  await item.click();

  await expect(live.task(1)).toContainText(SCRIPTED.plain);
  const actions = await settled(id, 1);
  expect(taskIdsOf(actions)).toHaveLength(1);
  // It reused the stored screenshot: nothing was captured, and the model got it.
  expect(await snapshots(id)).toHaveLength(1);
  expect((await control.calls())[0]).toMatchObject({
    stage: "assist",
    images: 1,
  });
});

test("web Analyze stored capture: disabled with its reason until the companion has sent a capture", async ({
  live,
  page,
}) => {
  const started = await startSessionViaApi({
    captureSources: ["microphone", "screen"],
  });
  await page.goto(`${live.livePath()}/${started.id}`);
  await live.useManual();
  await live.captureAnalyze().click();
  const item = menuItem(page, /^Analyze stored capture/);
  await expect(item).toBeDisabled();
  await expect(item).toContainText(
    "No stored capture, or the companion’s screen source isn’t receiving",
  );
});

test("web Follow focused window: asks the companion once, the companion's capture that names the request becomes a new task, and the progress line follows", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("plain-answer");
  const { id, companion } = await withCompanion(live, page);

  await live.captureAnalyze().click();
  await menuItem(page, /^Follow focused window/).click();

  // The page asked: the progress line says so and the server holds the request.
  await expect(page.getByTestId("capture-progress")).toContainText(
    "Asking the companion to capture your focused window…",
  );
  const request = await nextRequest(companion, "focused-window");
  expect(request.region).toBeUndefined();
  expect((await control.calls()).length).toBe(0);

  // The companion captures once and names the request.
  expect((await companion.fulfil(request)).status).toBe(200);

  await expect(live.task(1)).toContainText(SCRIPTED.plain);
  await expect(page.getByTestId("capture-progress")).toHaveCount(0, {
    timeout: 30_000,
  });
  expect(await snapshots(id)).toHaveLength(2);
  expect((await control.calls())[0]).toMatchObject({ images: 1 });
  expect(taskIdsOf(await settled(id, 1))).toHaveLength(1);
  // The request is spent: the next heartbeat carries none.
  expect(await companion.pendingCapture()).toBeNull();
});

test("web Follow focused window: when the companion reports it could not capture, the page says why in the closed code's words and nothing is analysed", async ({
  live,
  control,
  page,
}) => {
  const { id, companion } = await withCompanion(live, page);

  await live.captureAnalyze().click();
  await menuItem(page, /^Follow focused window/).click();
  const request = await nextRequest(companion, "focused-window");
  expect(
    (await companion.captureFailure(request, "permission-denied")).status,
  ).toBe(200);

  await expect(page.getByTestId("capture-progress")).toContainText(
    "The companion isn’t allowed to record the screen.",
  );
  expect(await snapshots(id)).toHaveLength(1);
  expect(await control.calls()).toEqual([]);
  expect(await db.actions(id)).toEqual([]);
});

test("web Companion region: the drawn area rides the request as a normalised region, and the companion's capture of it becomes a new task", async ({
  live,
  control,
  page,
}) => {
  await control.scenario("plain-answer");
  const { id, companion } = await withCompanion(live, page);

  await live.captureAnalyze().click();
  await menuItem(page, /^Companion · region/).click();
  const editor = page.getByTestId("mask-editor");
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Left side" }).click();
  await editor.getByRole("button", { name: "Save & capture" }).click();

  await expect(page.getByTestId("capture-progress")).toContainText(
    "Asking the companion to capture your region…",
  );
  const request = await nextRequest(companion, "region");
  // The left half of the display, normalised, bound to the companion's own
  // screen selection token.
  expect(request.region).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
  expect(request.selection).toBe("display-1.gen-1");

  expect((await companion.fulfil(request, "Region")).status).toBe(200);
  await expect(live.task(1)).toContainText(SCRIPTED.plain);
  expect(await snapshots(id)).toHaveLength(2);
  expect((await control.calls())[0]).toMatchObject({ images: 1 });
});
