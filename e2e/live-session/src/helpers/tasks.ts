// Task-shaped reads and the spoken-question helper the capture, revision and
// no-question specs share. Reads only ids, kinds, counts and the screenshots
// route's own fields (never answer or prompt text).
import { expect } from "@playwright/test";
import { envelopes, ingest, sessionApi } from "./api";
import { type ActionRow, db } from "./sql";

// Distinct task ids in the order their first action was created.
export const taskIdsOf = (actions: readonly ActionRow[]): string[] => [
  ...new Set(actions.map((action) => action.task_id)),
];

// The draft-answer actions of one task, by revision.
export const draftsOf = (
  actions: readonly ActionRow[],
  taskId: string,
): ActionRow[] =>
  actions.filter(
    (action) =>
      action.task_id === taskId && action.action_kind === "draft-answer",
  );

// Waits until `count` distinct tasks exist and every draft-answer action has
// settled (none queued or in flight).
export async function settled(
  sessionId: string,
  count: number,
  timeout = 60_000,
): Promise<ActionRow[]> {
  let latest: ActionRow[] = [];
  await expect
    .poll(
      async () => {
        latest = await db.actions(sessionId);
        const open = latest.filter((action) =>
          ["pending", "queued", "in_flight"].includes(action.dispatch_status),
        );
        return open.length === 0 ? taskIdsOf(latest).length : -1;
      },
      { timeout },
    )
    .toBe(count);
  return latest;
}

// What the companion's microphone would send for one spoken phrase (the
// credential alone is the principal, as in production).
let spoken = 0;
export async function say(
  credential: string,
  text: string,
  source: "application-audio" | "microphone" = "application-audio",
): Promise<void> {
  spoken += 1;
  const ack = await ingest(
    credential,
    envelopes.transcript(source, 1000 + spoken, text),
  );
  expect(ack.status).toBe(200);
}

export type StoredShot = {
  ordinal: number;
  sourceId: string;
  eventId: string;
  artifactId: string | null;
  display?: { name: string; index: number; count: number } | null;
  revisions: number[];
  sentByRevision?: Array<{ revision: number; sent: string }>;
};

// GET .../sessions/:id/tasks/:taskId/screenshots, the same list the page draws.
export async function taskScreenshots(
  sessionId: string,
  taskId: string,
): Promise<StoredShot[]> {
  const { status, body } = await sessionApi(
    `/${sessionId}/tasks/${encodeURIComponent(taskId)}/screenshots`,
  );
  expect(status).toBe(200);
  return (body as { screenshots: StoredShot[] }).screenshots;
}
