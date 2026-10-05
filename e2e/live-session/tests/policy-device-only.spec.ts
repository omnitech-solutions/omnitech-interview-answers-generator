// Processing policy at work: what a permitted-remote session does that a
// device-only session refuses, the refusal copy the page shows for it, the
// direct device-model path (the control server's /v1/chat/completions), and the
// one-way "Switch to this Mac only". Every check is the SERVER's behaviour:
// the action row and its suppression reason, the HTTP answer, the recorded
// model call and which path it took (agent runtime or direct model).
import { expect, test } from "../src/fixtures/test";
import {
  ownerCapture,
  sessionApi,
  startSessionViaApi,
} from "../src/helpers/api";
import { Companion } from "../src/helpers/companion";
import { solidPng } from "../src/helpers/png";
import { db } from "../src/helpers/sql";
import { SCRIPTED } from "../src/stack/scenarios";

const QUESTION = "What is a closure in JavaScript?";
const REFUSED_SCREENSHOT =
  "Device-only mode never sends a screenshot to an assistant.";
const ALL = ["microphone", "application-audio", "screen"] as const;

test("device-only: a heard question is answered by the on-device model through the direct path, never the agent runtime", async ({
  live,
  page,
  control,
}) => {
  await control.scenario("plain-answer");
  const { id, response } = await startSessionViaApi({
    processingPolicy: "device-only",
    captureSources: [...ALL],
  });
  expect((await db.session(id))?.processing_policy).toBe("device_only");
  const companion = new Companion(response.credential.value);
  await companion.heartbeat();
  await companion.transcript(QUESTION);

  await page.goto(`${live.livePath()}/${id}`);
  // The scripted answer reaches the page: the device model's reply, shown.
  await expect(live.task(1)).toContainText(SCRIPTED.plain);
  // The model call went to the OpenAI-compatible endpoint, with no image.
  const calls = await control.calls();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    stage: "assist",
    via: "direct-model",
    images: 0,
    outcome: "completed",
  });
  expect(calls.filter((call) => call.via === "agent-runtime")).toEqual([]);
  // The Activity tab lists the run (what it was, for which task and revision,
  // how it ended) and names the profile and the policy it ran under.
  await page.getByRole("tab", { name: "Activity" }).click();
  const activity = page.getByRole("tabpanel", { name: "Activity" });
  const runs = activity
    .getByRole("list", { name: "Runs" })
    .getByRole("listitem");
  await expect(runs).toHaveCount(1);
  await expect(runs.first()).toContainText("Answer draft");
  await expect(runs.first()).toContainText("T1 · rev 1");
  await expect(runs.first()).toContainText("Published");
  await expect(activity).toContainText(
    "Profile interview-session-device · device-only policy",
  );
  // The bar says where processing runs.
  await expect(page.getByTestId("locality-chip")).toContainText(
    "On this Mac only",
  );
});

test("device-only: a heard coding question gets its answer but the solution step is refused (stage_unlisted) and the page says why", async ({
  live,
  page,
  control,
}) => {
  await control.scenario("coding-answer");
  const { id, response } = await startSessionViaApi({
    processingPolicy: "device-only",
    captureSources: [...ALL],
  });
  const companion = new Companion(response.credential.value);
  await companion.heartbeat();
  await companion.transcript(
    "Write a function that implements a sliding window rate limiter in TypeScript, can you do that?",
  );

  await page.goto(`${live.livePath()}/${id}`);
  await expect(live.task(1)).toContainText(SCRIPTED.coding);
  // The server decided, per action: the answer succeeded, the solve was
  // suppressed because no on-device model lists that stage, and nothing ran.
  await expect
    .poll(async () =>
      (await db.actions(id)).map((a) => [
        a.action_kind,
        a.dispatch_status,
        a.suppression_reason,
      ]),
    )
    .toEqual(
      expect.arrayContaining([
        ["draft-answer", "succeeded", null],
        ["solve-code", "suppressed", "stage_unlisted"],
      ]),
    );
  const calls = await control.calls();
  expect(calls.map((call) => [call.stage, call.via])).toEqual([
    ["assist", "direct-model"],
  ]);
  // The refusal copy, in the Activity tab, the bar and the code panel.
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByRole("tabpanel", { name: "Activity" })).toContainText(
    "No on-device model is available for this step.",
  );
  await expect(live.task(1)).toContainText(
    "Coding needs a remote model, and this session runs AI models on this Mac only.",
  );
});

test("device-only: a screenshot is stored for the owner but refused for analysis (vision_device_only) and no model is called", async ({
  live,
  page,
  control,
}) => {
  const { id } = await startSessionViaApi({
    processingPolicy: "device-only",
    captureSources: [...ALL],
  });
  await page.goto(`${live.livePath()}/${id}`);

  // The page's own control is disabled, with the reason as its tooltip.
  const analyze = live.captureAnalyze();
  await expect(analyze).toBeDisabled();
  await expect(analyze).toHaveAttribute("title", REFUSED_SCREENSHOT);

  // The server enforces it regardless of the page: the upload is accepted as
  // the owner's own screenshot, its analysis is refused with the closed reason.
  const upload = await ownerCapture(id, solidPng(64, 64));
  expect(upload.status).toBe(202);
  await expect
    .poll(async () => {
      const shot = (await db.observations(id)).find(
        (row) => row.kind === "screen.snapshot",
      );
      return shot?.screenshot_artifact_id ? "stored" : "missing";
    })
    .toBe("stored");
  await expect
    .poll(async () =>
      (await db.actions(id)).map((a) => [
        a.action_kind,
        a.dispatch_status,
        a.suppression_reason,
      ]),
    )
    .toEqual([["draft-answer", "suppressed", "vision_device_only"]]);
  expect(await control.calls()).toEqual([]);

  // The refusal is shown, in the page's words, where the work is listed.
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByRole("tabpanel", { name: "Activity" })).toContainText(
    REFUSED_SCREENSHOT,
  );
});

test("remote: the same screenshot upload is analysed by the agent runtime with exactly that image", async ({
  live,
  page,
  control,
}) => {
  await control.scenario("plain-answer");
  const { id } = await startSessionViaApi({
    processingPolicy: "permitted-remote",
    captureSources: [...ALL],
  });
  await page.goto(`${live.livePath()}/${id}`);
  const upload = await ownerCapture(id, solidPng(64, 64));
  expect(upload.status).toBe(202);
  await expect(live.task(1)).toContainText(SCRIPTED.plain);
  const calls = await control.calls();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ via: "agent-runtime", images: 1 });
  expect(
    (await db.actions(id)).filter((a) => a.suppression_reason !== null),
  ).toEqual([]);
});

test("device-only: asking the companion to capture is refused with vision_device_only and the companion is never asked", async ({
  control,
}) => {
  const { id, response } = await startSessionViaApi({
    processingPolicy: "device-only",
    captureSources: [...ALL],
  });
  const companion = new Companion(response.credential.value, {
    "x-companion-features": "capture-request.v1",
  });
  await companion.heartbeat();

  const asked = await sessionApi(`/${id}/capture-request`, {
    method: "POST",
    body: { requestId: "ask-1", mode: "focused-window" },
  });
  expect(asked.status).toBe(202);
  expect(asked.body).toMatchObject({
    requestId: "ask-1",
    status: "refused",
    reason: "vision_device_only",
  });
  // The companion's next message carries no instruction to capture.
  const ack = await companion.heartbeat();
  expect(JSON.stringify(ack.body)).not.toContain("ask-1");
  expect((ack.body["control"] as Record<string, unknown>)["capture"]).toBe(
    undefined,
  );
  expect(await control.calls()).toEqual([]);
});

test("Switch to this Mac only: cancelling changes nothing; confirming makes the session device-only for good", async ({
  live,
  page,
  control,
}) => {
  await control.scenario("plain-answer");
  const { id, response } = await startSessionViaApi({
    processingPolicy: "permitted-remote",
    captureSources: [...ALL],
  });
  const companion = new Companion(response.credential.value);
  await companion.heartbeat();
  await page.goto(`${live.livePath()}/${id}`);
  await page.getByRole("tab", { name: "Sources" }).click();
  const processing = page.getByRole("region", { name: "Processing" });
  await expect(processing).toContainText("Remote allowed");
  await expect(processing).toContainText(
    "Remote model, through Studio's AI gateway",
  );

  // Asked first; Cancel leaves the policy as it was.
  await processing
    .getByRole("button", { name: "Switch to this Mac only" })
    .click();
  const confirm = processing.getByRole("group", {
    name: "Switch to this Mac only",
  });
  await expect(confirm).toContainText("This can’t be undone for this session.");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  expect((await db.session(id))?.processing_policy).toBe("permitted_remote");

  // Confirm: the server holds the tightened policy and the page follows.
  await processing
    .getByRole("button", { name: "Switch to this Mac only" })
    .click();
  await processing
    .getByRole("group", { name: "Switch to this Mac only" })
    .getByRole("button", { name: "Switch to this Mac only" })
    .click();
  await expect
    .poll(async () => (await db.session(id))?.processing_policy)
    .toBe("device_only");
  await expect(processing).toContainText("On this Mac only");
  await expect(processing).toContainText("Refused: needs a remote model");
  // The one-way control is gone: there is nothing left to tighten.
  await expect(
    processing.getByRole("button", { name: "Switch to this Mac only" }),
  ).toHaveCount(0);

  // It cannot be loosened again, by any request.
  const loosen = await sessionApi(`/${id}/policy`, {
    method: "POST",
    body: { processingPolicy: "permitted-remote" },
  });
  expect(loosen.status).toBeGreaterThanOrEqual(400);
  expect((await db.session(id))?.processing_policy).toBe("device_only");

  // From now on a question goes to the device model, not the agent runtime.
  await companion.transcript(QUESTION);
  await expect.poll(async () => (await control.calls()).length).toBe(1);
  expect((await control.calls())[0]).toMatchObject({ via: "direct-model" });
});
