// The browser side of owner input (ADR-0016): "Analyze latest capture" and a
// typed follow-up, both sent to the one owner-input route. The request names
// the newest screen snapshot by its observation ids (frozen at click time), and
// a follow-up names the task revision the caller selected; it carries no bytes,
// no identity and no path. The text is passed through to the route only: it is
// never logged, stored or echoed here.
import type { LiveOwnerInputRequest } from "@omnitech/interview-contracts";
import type { CompanionCaptureInput, OwnerHints } from "./session-capture";
import { createSessionClient, SessionApiError } from "./session-client";
import type { StoreDeps } from "./session-deps";
import type { LiveSnapshot } from "./session-snapshot";

const SCREEN_SNAPSHOT = "screen.snapshot";

// Only the hints that are set: an unset one is simply absent from the request.
const hintFields = (hints?: OwnerHints): OwnerHints => ({
  ...(hints?.skill ? { skill: hints.skill } : {}),
  ...(hints?.language ? { language: hints.language } : {}),
});

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

export function ownerInputDeps(
  tenant: string,
  fetcher: StoreDeps["fetch"],
  snapshot: () => LiveSnapshot,
): Pick<
  StoreDeps,
  | "analyzeLatestCapture"
  | "analyzeCapture"
  | "requestCapture"
  | "captureStatus"
  | "submitFollowUp"
  | "submitHeard"
  | "solveTask"
> {
  const client = createSessionClient(tenant, fetcher);
  const solveIds = new Map<string, string>();
  const send = (sessionId: string, input: LiveOwnerInputRequest) =>
    client.sendOwnerInput(sessionId, input);
  return {
    async analyzeLatestCapture(sessionId, target, hints, chosen) {
      const held = snapshot();
      const latest = chosen ?? latestSnapshotIds(held);
      // Nothing was captured yet: there is nothing to analyse.
      if (latest === null) throw new SessionApiError("invalid_input", 0);
      // Without a target Analyze starts its own task; with one (the owner's
      // "Attach to T<n>") the capture revises that task revision.
      await send(sessionId, {
        requestId: requestId(),
        operation: "analyze",
        ...(target ? { target } : {}),
        ...hintFields(hints),
        snapshots: [latest],
      });
    },
    async analyzeCapture(sessionId, input) {
      await client.sendCapture(sessionId, {
        requestId: requestId(),
        image: input.image,
        ...(input.label ? { label: input.label } : {}),
        ...(input.target ? { target: input.target } : {}),
        ...hintFields(input),
      });
    },
    async requestCapture(sessionId, input: CompanionCaptureInput) {
      return client.sendCaptureRequest(sessionId, {
        requestId: requestId(),
        mode: input.mode,
        ...(input.region ? { region: input.region } : {}),
        ...(input.selection ? { selection: input.selection } : {}),
        ...(input.target
          ? {
              targetTaskId: input.target.taskId,
              targetRevision: input.target.revision,
            }
          : {}),
        ...hintFields(input),
      });
    },
    captureStatus(sessionId, id) {
      return client.getCaptureRequest(sessionId, id);
    },
    async submitHeard(sessionId, text, heardId) {
      await client.sendHeard(sessionId, {
        requestId: heardId,
        operation: "heard",
        text,
      });
    },
    async solveTask(sessionId, target, hints) {
      // One request id per task revision, so a repeat is the server's
      // idempotent resend and never a second run.
      const key = `${sessionId}/${target.taskId}/${target.revision}`;
      let id = solveIds.get(key);
      if (!id) {
        id = requestId();
        solveIds.set(key, id);
      }
      await send(sessionId, {
        requestId: id,
        operation: "solve",
        target,
        ...hintFields(hints),
        snapshots: [],
      });
    },
    async submitFollowUp(sessionId, text, target, hints) {
      await send(sessionId, {
        requestId: requestId(),
        operation: "follow-up",
        text,
        ...(target ? { target } : {}),
        ...hintFields(hints),
        snapshots: [],
      });
    },
  };
}
