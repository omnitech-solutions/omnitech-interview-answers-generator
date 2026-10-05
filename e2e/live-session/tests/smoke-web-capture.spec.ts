import { expect, test } from "../src/fixtures/test";
import { db } from "../src/helpers/sql";
import { SCRIPTED } from "../src/stack/scenarios";

test("web smoke: sign in, start a rehearsal, capture and analyze shows the scripted answer as T1", async ({
  live,
  control,
}) => {
  await control.scenario("plain-answer");
  await live.goto();

  // Setup (Rehearsal, consent) and Start: the server must hold an active row.
  const session = await live.startRehearsal();
  expect(session.status).toBe("active");
  expect(session.rehearsal_run_id).not.toBeNull();

  // Manual mode so only the press below captures; the share picker is accepted
  // by the browser flags, and the press captures the shared source.
  await live.useManual();
  await live.captureNewTask();

  // T1 appears with the scripted answer text and its provenance...
  const task = live.task(1);
  await expect(task).toContainText(SCRIPTED.plain);
  await expect(task).toContainText("T1 · rev 1 · from screenshot S1");

  // ...and the claim is true on the server: a draft-answer action for that
  // task, an owner-capture observation with a stored screenshot artifact, and
  // exactly one model call that carried exactly one image.
  await expect
    .poll(async () => (await db.actions(session.id)).map((a) => a.action_kind))
    .toContain("draft-answer");
  const observations = await db.observations(session.id);
  const capture = observations.find(
    (row) =>
      row.kind === "screen.snapshot" &&
      row.source_id === "studio.owner-capture",
  );
  expect(capture?.screenshot_artifact_id).toBeTruthy();
  const calls = await control.calls();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    stage: "assist",
    scenario: "plain-answer",
    images: 1,
    via: "agent-runtime",
    outcome: "completed",
  });
});
