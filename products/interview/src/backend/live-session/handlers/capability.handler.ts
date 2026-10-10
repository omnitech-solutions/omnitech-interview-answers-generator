// A capability report is the companion's own local readiness (speech support
// and permission states, never content). It is accepted before capture starts
// (a created or paused session) and while active, replaces the owner's latest
// report, and is spaced like a heartbeat.
import {
  CAPABILITY_ACK_EVENT_ID,
  type CapabilityReport,
  capabilityReportSchema,
  validateWireMessage,
} from "@omnitech/active-session-contracts";
import type { IngestHandler } from "../contracts/ingest";
import { validationRefusal } from "../domain/observation";
import { spacingRetryAfterSeconds } from "../domain/session-policy";
import { ingestLog } from "../infrastructure/ingest-log";
import {
  reportedWithin,
  storeCapability,
} from "../repositories/capability.repository";
import { touchContact } from "../repositories/session.repository";
import { accepted, refusal } from "./acknowledgement";

export const handleCapabilityReport: IngestHandler = async (
  context,
  envelope,
) => {
  const { tx, scope, session, control, closed, cancelJobs, limits } = context;
  const validated = validateWireMessage<CapabilityReport>(
    capabilityReportSchema,
    envelope,
  );
  if (!validated.ok) {
    const invalid = validationRefusal(validated.issues);
    return {
      ack: refusal(invalid.code, { control, issues: validated.issues }),
      cancelJobs,
    };
  }
  // [SAFETY] Logged only once it has been validated: a report that failed
  // the wire schema may hold anything, and nothing of it is written.
  ingestLog.debug("companion.capability", {
    sessionId: session.id,
    report: validated.value,
  });
  if (closed && control.state !== "paused" && control.state !== "active")
    return { ack: refusal(closed, { control }), cancelJobs };
  if (await reportedWithin(tx, scope, limits.minHeartbeatIntervalMs))
    return {
      ack: refusal("rate_limited", { control }),
      cancelJobs,
      retryAfterSeconds: spacingRetryAfterSeconds(limits),
    };
  await storeCapability(tx, scope, validated.value, context.declaration);
  await touchContact(tx, scope, session.id);
  return {
    ack: accepted(validated.value.sourceId, CAPABILITY_ACK_EVENT_ID, control),
    cancelJobs,
  };
};
