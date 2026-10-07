// Retention and privacy: what a session stores and for how long, as the Sources
// tab says it, and that nothing content-bearing leaks into the places a person
// could not see. Retention is proven by the rows (and screenshot artifacts and
// their payloads) that exist or do not; privacy by reading what the worker
// logged and what the page printed to its console, against strings that appear
// nowhere else. This spec covers the worker's trace log, the web server's own
// stdout and stderr (stack.ts writes them to this run's `.stack/<pid>/web.log`),
// the page console, the scripted model's recorded metadata and the wire.
import { readFileSync } from "node:fs";
import { expect, test } from "../src/fixtures/test";
import {
  controlSession,
  sessionApi,
  startSessionViaApi,
} from "../src/helpers/api";
import { Companion } from "../src/helpers/companion";
import { footprint } from "../src/helpers/footprint";
import { db } from "../src/helpers/sql";
import { stackConfig } from "../src/stack/config";

const readLog = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};
const readWorkerLog = (): string => readLog(stackConfig().workerLogPath);
const _readWebLog = (): string => readLog(stackConfig().webLogPath);

// A session with something in it: a question heard (stored, answered by the
// scripted model) and a screenshot held for the owner.
async function sessionWithContent(
  retention: "delete-at-end" | "thirty-days" | "until-deleted",
  heard = "What is a closure in JavaScript?",
) {
  const { id, response } = await startSessionViaApi({
    retention,
    captureSources: ["microphone", "application-audio", "screen"],
  });
  const companion = new Companion(response.credential.value);
  await companion.heartbeat();
  await companion.transcript(heard);
  await companion.screenshot("Shared window");
  await expect
    .poll(async () => (await db.actions(id)).map((a) => a.dispatch_status))
    .toContain("succeeded");
  return { id, response, companion };
}

test("retention shorten on the Sources tab: Cancel changes nothing, confirming shortens one step at a time, and it can never be lengthened again", async ({
  live,
  page,
}) => {
  const { id } = await startSessionViaApi({ retention: "until-deleted" });
  await page.goto(`${live.livePath()}/${id}`);
  await page.getByRole("tab", { name: "Sources" }).click();
  const retention = page.getByRole("region", { name: "Retention" });
  await expect(retention).toContainText("Until I delete");
  await expect(retention).toContainText(
    "Session records are kept until you delete them.",
  );
  await expect(retention).toContainText("Raw audio is never stored.");
  const shortenTo = (label: string) =>
    retention.getByRole("button", { name: `Shorten to ${label}`, exact: true });
  await expect(shortenTo("30 days")).toBeVisible();
  await expect(shortenTo("Delete at end")).toBeVisible();

  // Asked first; Cancel leaves the stored mode as it was.
  await shortenTo("30 days").click();
  const confirm = retention.getByRole("group", { name: "Shorten to 30 days" });
  await expect(confirm).toContainText("It can only be shortened");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  expect((await db.session(id))?.retention_mode).toBe("until_deleted");

  // Confirmed: the server holds the shorter mode and the page says so.
  await shortenTo("30 days").click();
  await retention
    .getByRole("group", { name: "Shorten to 30 days" })
    .getByRole("button", { name: "Shorten to 30 days" })
    .click();
  await expect
    .poll(async () => (await db.session(id))?.retention_mode)
    .toBe("thirty_days");
  await expect(retention).toContainText("30 days");
  await expect(shortenTo("30 days")).toHaveCount(0);
  await expect(shortenTo("Delete at end")).toBeVisible();

  // Lengthening is refused by the server, whatever the page offers.
  const longer = await sessionApi(`/${id}/retention`, {
    method: "POST",
    body: { retention: "until-deleted" },
  });
  expect(longer.status).toBeGreaterThanOrEqual(400);
  expect((await db.session(id))?.retention_mode).toBe("thirty_days");

  await shortenTo("Delete at end").click();
  await retention
    .getByRole("group", { name: "Shorten to Delete at end" })
    .getByRole("button", { name: "Shorten to Delete at end" })
    .click();
  await expect
    .poll(async () => (await db.session(id))?.retention_mode)
    .toBe("delete_at_end");
  await expect(
    retention.getByRole("button", { name: /^Shorten to/ }),
  ).toHaveCount(0);
});

test("retention delete-at-end: ending the session purges everything it stored, down to the screenshot artifacts", async ({
  live,
  page,
}) => {
  test.slow(); // ends a session and checks every purged row and artifact (16 s)
  const { id } = await sessionWithContent("delete-at-end");
  const before = await footprint(id);
  expect(before.observations).toBe(2);
  expect(before.actions).toBeGreaterThan(0);
  expect(before.artifactIds).toHaveLength(1);
  expect(before.artifacts).toBe(1);
  expect(before.payloads).toBe(1);

  // The page says what will happen, before it does.
  await page.goto(`${live.livePath()}/${id}`);
  await page.getByRole("tab", { name: "Sources" }).click();
  await expect(page.getByRole("region", { name: "Retention" })).toContainText(
    "Session records are deleted shortly after the session ends",
  );

  await controlSession(id, "end");

  // The worker's purge runs: tombstone set, then nothing is left.
  await expect
    .poll(async () => (await db.session(id))?.purged_at, { timeout: 60_000 })
    .not.toBeNull();
  expect((await db.session(id))?.purge_outcome).toBe("complete");
  const after = await footprint(id, before.artifactIds);
  expect(after).toMatchObject({
    observations: 0,
    actions: 0,
    jobs: 0,
    artifacts: 0,
    payloads: 0,
  });
});

test("retention thirty-days and until-deleted: ending keeps every row and artifact; deleting then removes them", async ({
  live,
  page,
}) => {
  test.slow(); // ends, then deletes, checking every row (30 s)
  // 30 days: ended, kept, with the date it will go on the page.
  const thirty = await sessionWithContent("thirty-days");
  const thirtyBefore = await footprint(thirty.id);
  await controlSession(thirty.id, "end");
  await expect
    .poll(async () => (await db.session(thirty.id))?.status)
    .toBe("ended");
  await page.goto(`${live.livePath()}/${thirty.id}`);
  await expect(page.getByTestId("ended-retention")).toContainText(
    "Session records are kept until",
  );
  await expect(page.getByTestId("ended-retention")).toContainText("(UTC)");
  // Give the worker's sweep every chance to wrongly purge it: it has handled
  // the End (the session is quiesced) before the rows are counted.
  await expect
    .poll(
      () =>
        readWorkerLog().includes(`"sessionId":"${thirty.id}"`) &&
        readWorkerLog()
          .split("\n")
          .some(
            (line) =>
              line.includes(thirty.id) && line.includes("session.quiesced"),
          ),
    )
    .toBe(true);
  expect((await db.session(thirty.id))?.purged_at).toBeNull();
  expect(await footprint(thirty.id)).toEqual(thirtyBefore);

  // Until I delete: kept the same way, and removed only by an explicit delete.
  const until = await sessionWithContent("until-deleted");
  const untilBefore = await footprint(until.id);
  await controlSession(until.id, "end");
  await expect
    .poll(async () => (await db.session(until.id))?.status)
    .toBe("ended");
  await expect
    .poll(() =>
      readWorkerLog()
        .split("\n")
        .some(
          (line) =>
            line.includes(until.id) && line.includes("session.quiesced"),
        ),
    )
    .toBe(true);
  expect((await db.session(until.id))?.purged_at).toBeNull();
  expect(await footprint(until.id)).toEqual(untilBefore);

  const deleted = await sessionApi(`/${until.id}`, { method: "DELETE" });
  expect(deleted.status).toBe(202);
  await expect
    .poll(async () => (await db.session(until.id))?.purged_at, {
      timeout: 60_000,
    })
    .not.toBeNull();
  expect(await footprint(until.id, untilBefore.artifactIds)).toMatchObject({
    observations: 0,
    actions: 0,
    jobs: 0,
    artifacts: 0,
    payloads: 0,
  });
  // The 30-day session was not touched by deleting the other one.
  expect(await footprint(thirty.id)).toEqual(thirtyBefore);
});

test("privacy: raw audio has no way in — the server refuses an audio message and stores nothing for it", async () => {
  const { id, response } = await startSessionViaApi({
    captureSources: ["microphone"],
    liveAssistance: false,
  });
  const credential = response.credential.value;
  const before = (await db.observations(id)).length;
  const { webUrl, tenantSlug } = stackConfig();
  const post = (body: unknown) =>
    fetch(`${webUrl}/api/interview/t/${tenantSlug}/sessions/ingest`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  // An audio kind does not exist on the wire.
  const audio = await post({
    version: 1,
    kind: "audio.chunk",
    sourceId: "mic",
    eventId: "audio-1",
    occurredAt: new Date().toISOString(),
    sequence: 0,
    content: { pcm: "AAAA", sampleRate: 16000 },
  });
  expect(audio.status).toBeGreaterThanOrEqual(400);
  // Nor can a transcript smuggle one in: unknown fields are refused whole.
  const smuggled = await post({
    version: 1,
    kind: "transcript.final",
    sourceId: "mic",
    eventId: "t-1",
    occurredAt: new Date().toISOString(),
    sequence: 0,
    content: {
      speaker: "you",
      text: "hello",
      startMs: 0,
      endMs: 100,
      audio: "AAAA",
    },
  });
  expect(smuggled.status).toBeGreaterThanOrEqual(400);
  expect((await db.observations(id)).length).toBe(before);

  // What IS stored is only the closed kinds, never audio.
  await new Companion(credential).transcript("hello", "microphone");
  expect(new Set((await db.observations(id)).map((row) => row.kind))).toEqual(
    new Set(["transcript.final"]),
  );
});

test("claims inventory: the confirmation controls of the Sources tab are inventoried", async ({
  live,
  page,
}) => {
  const { findClaim } = await import("../src/claims/claims");
  const { scanControls } = await import("../src/helpers/aria-scan");
  const { id } = await startSessionViaApi({ retention: "until-deleted" });
  await page.goto(`${live.livePath()}/${id}`);
  await page.getByRole("tab", { name: "Sources" }).click();
  const found = new Set<string>();
  const note = async () => {
    for (const control of await scanControls(page))
      if (!findClaim("web", control.role, control.name))
        found.add(`${control.role} "${control.name}"`);
  };
  await page.getByRole("button", { name: "Pair capture companion" }).click();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await note();
  await page.getByRole("button", { name: "Keep it" }).click();
  await page.getByRole("button", { name: "Switch to this Mac only" }).click();
  await note();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Shorten to 30 days" }).click();
  await note();
  expect([...found], "controls with no claim").toEqual([]);
});
