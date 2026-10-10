// The two answers a handler gives: a refusal (a code, the control state and
// issue paths, never content) and the acceptance of a content-free message.
import {
  type Acknowledgement,
  type ControlStatus,
  type ObservationIssue,
  type RefusalCode,
  WIRE_VERSION,
} from "@omnitech/active-session-contracts";
import type { Refused } from "../contracts/ingest";
import { ingestLog } from "../infrastructure/ingest-log";

export const refusal = (
  code: RefusalCode,
  extra: { control?: ControlStatus; issues?: ObservationIssue[] } = {},
): Refused => {
  ingestLog.debug("companion.refused", { code, control: extra.control?.state });
  return {
    version: WIRE_VERSION,
    status: "refused",
    code,
    ...(extra.control ? { control: extra.control } : {}),
    ...(extra.issues ? { issues: extra.issues.slice(0, 20) } : {}),
  };
};

// The acceptance of a message that carries no event id of its own.
export const accepted = (
  sourceId: string,
  eventId: string,
  control: ControlStatus,
): Acknowledgement => ({
  version: WIRE_VERSION,
  status: "accepted",
  sourceId,
  eventId,
  control,
});
