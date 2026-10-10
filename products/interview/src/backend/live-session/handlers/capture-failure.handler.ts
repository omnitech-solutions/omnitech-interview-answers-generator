// The companion's report that it could not capture for one request: closed
// code, correlated by id, content-free. It is accepted in any capturing state
// (a paused or ended session answers with its standing) and changes only the
// matching pending request. Not spaced: only the first report for a request
// writes, and a repeat or a stranger's id changes nothing.
import {
  CAPTURE_FAILURE_ACK_EVENT_ID,
  captureFailureSchema,
} from "@omnitech/active-session-contracts";
import { failCaptureRequest } from "../capture-request";
import type { IngestHandler } from "../contracts/ingest";
import { touchContact } from "../repositories/session.repository";
import { accepted, refusal } from "./acknowledgement";

export const handleCaptureFailure: IngestHandler = async (
  context,
  envelope,
) => {
  const { tx, scope, session, status, control, closed, cancelJobs } = context;
  const parsed = captureFailureSchema.safeParse(envelope);
  if (!parsed.success)
    return {
      ack: refusal("invalid_observation", {
        control,
        issues: [{ path: ["capture.failure"], code: "invalid" }],
      }),
      cancelJobs,
    };
  if (closed && status !== "active")
    return { ack: refusal(closed, { control }), cancelJobs };
  await failCaptureRequest(
    tx,
    scope,
    session,
    parsed.data.requestId,
    parsed.data.code,
  );
  await touchContact(tx, scope, session.id);
  return {
    ack: accepted(parsed.data.sourceId, CAPTURE_FAILURE_ACK_EVENT_ID, control),
    cancelJobs,
  };
};
