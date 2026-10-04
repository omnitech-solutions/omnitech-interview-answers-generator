// The browser side of owner input (ADR-0016): "Analyze latest capture" and a
// typed follow-up, both sent to the one owner-input route. The request names
// the newest screen snapshot by its observation ids (frozen at click time), and
// a follow-up names the task revision the owner last saw; it carries no bytes,
// no identity and no path. The text is passed through to the route only: it is
// never logged, stored or echoed here.
import type { LiveOwnerInputRequest } from "@omnitech/interview-contracts";
import { createSessionClient, SessionApiError } from "./session-client";
import type { StoreDeps } from "./session-deps";
import type { LiveSnapshot } from "./session-snapshot";

const SCREEN_SNAPSHOT = "screen.snapshot";

// A fresh request id per click: it is the dedup key, so a retried send of the
// same click would reuse one, but each click is its own request.
const requestId = (): string => `r-${globalThis.crypto.randomUUID()}`;

// The newest screen snapshot the store holds, by observation id.
export function latestSnapshotIds(
  snapshot: LiveSnapshot,
): { sourceId: string; eventId: string } | null {
  let newest: LiveSnapshot["observations"][number] | null = null;
  for (const observation of snapshot.observations)
    if (
      observation.kind === SCREEN_SNAPSHOT &&
      observation.screenshotArtifactId !== null &&
      (newest === null || observation.sequence > newest.sequence)
    )
      newest = observation;
  return newest ? { sourceId: newest.sourceId, eventId: newest.eventId } : null;
}

// The task revision the owner last saw an answer for, if any.
export function latestTarget(
  snapshot: LiveSnapshot,
): { taskId: string; revision: number } | null {
  let newest: LiveSnapshot["actions"][number] | null = null;
  for (const action of snapshot.actions)
    if (newest === null || action.createdAt > newest.createdAt) newest = action;
  return newest
    ? { taskId: newest.taskId, revision: newest.taskRevision }
    : null;
}

export function ownerInputDeps(
  tenant: string,
  fetcher: StoreDeps["fetch"],
  snapshot: () => LiveSnapshot,
): Pick<StoreDeps, "analyzeLatestCapture" | "submitFollowUp"> {
  const client = createSessionClient(tenant, fetcher);
  const send = (sessionId: string, input: LiveOwnerInputRequest) =>
    client.sendOwnerInput(sessionId, input);
  return {
    async analyzeLatestCapture(sessionId) {
      const held = snapshot();
      const latest = latestSnapshotIds(held);
      // Nothing was captured yet: there is nothing to analyse.
      if (latest === null) throw new SessionApiError("invalid_input", 0);
      // Analyze always starts its own task; only a typed follow-up revises one.
      await send(sessionId, {
        requestId: requestId(),
        operation: "analyze",
        snapshots: [latest],
      });
    },
    async submitFollowUp(sessionId, text) {
      const target = latestTarget(snapshot());
      await send(sessionId, {
        requestId: requestId(),
        operation: "follow-up",
        text,
        ...(target ? { target } : {}),
        snapshots: [],
      });
    },
  };
}
