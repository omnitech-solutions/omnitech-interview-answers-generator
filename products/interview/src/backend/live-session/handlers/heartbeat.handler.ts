// A content-free heartbeat updates the contact stamp so resume is observable. A
// companion that reports it stopped capturing pauses the session (never ends
// it); every answer carries the control state. Heartbeats are spaced by
// minHeartbeatIntervalMs against the last contact: a closer one is refused
// rate_limited and stores nothing. A stop report (capturing: false) is never
// delayed by the spacing (rule:pause-only-credential-stop).
import {
  HEARTBEAT_ACK_EVENT_ID,
  heartbeatSchema,
} from "@omnitech/active-session-contracts";
import type { IngestHandler } from "../contracts/ingest";
import {
  heartbeatTooSoon,
  spacingRetryAfterSeconds,
} from "../domain/session-policy";
import { ingestLog } from "../infrastructure/ingest-log";
import { touchContact } from "../repositories/session.repository";
import { transitionLocked } from "../status-transition";
import { accepted, refusal } from "./acknowledgement";

export const handleHeartbeat: IngestHandler = async (context, envelope) => {
  const { tx, scope, session, status, control, closed, cancelJobs, limits } =
    context;
  const parsed = heartbeatSchema.safeParse(envelope);
  if (!parsed.success)
    return {
      ack: refusal("invalid_observation", {
        control,
        issues: [{ path: ["heartbeat"], code: "invalid" }],
      }),
      cancelJobs,
    };
  if (status === "ended" || status === "purging")
    return { ack: refusal(closed ?? "session_ended", { control }), cancelJobs };
  // Standing keeps precedence over the spacing: only an active session's
  // capturing heartbeat is spaced; a paused one still answers session_paused.
  if (heartbeatTooSoon(session, status, parsed.data.capturing, limits))
    return {
      ack: refusal("rate_limited", { control }),
      cancelJobs,
      retryAfterSeconds: spacingRetryAfterSeconds(limits),
    };
  await touchContact(tx, scope, session.id);
  if (status === "active" && !parsed.data.capturing) {
    // The one line that says WHY a session paused by itself: the companion's
    // own state rides the heartbeat as codes (rule:id-only-traces).
    ingestLog.info("companion.heartbeat_stop", {
      sessionId: session.id,
      sourceId: parsed.data.sourceId,
      state: parsed.data.diagnostics?.state ?? "unknown",
      sources: parsed.data.diagnostics?.sources ?? {},
      speechFailure: parsed.data.diagnostics?.speechFailure ?? null,
    });
    await transitionLocked(
      tx,
      { ...session, status },
      "pause",
      "companion-stop",
    );
    return {
      ack: refusal("session_paused", {
        control: { ...control, state: "paused" },
      }),
      cancelJobs: true,
    };
  }
  if (status !== "active")
    return { ack: refusal("session_paused", { control }), cancelJobs };
  return {
    ack: accepted(parsed.data.sourceId, HEARTBEAT_ACK_EVENT_ID, control),
    cancelJobs,
  };
};
