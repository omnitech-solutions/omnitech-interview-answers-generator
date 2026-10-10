// The standing check the worker's agent port runs after any capacity wait
// (ADR-0016 Decision 1): the session must still be active and still allow
// remote processing, read from the session row alone in the owner's scope. The
// session id is the first segment of the dispatch's idempotency key, which the
// processor builds from the claimed session; an unreadable key, an unknown
// session or any read failure answers a typed verdict, never "permitted" (fail
// closed).
import type { PlatformDatabase } from "@omnitech/database";
import { isUuid } from "./errors";
import { policyFromDb } from "./mapping";
import { readStanding } from "./repositories/lease.repository";
import { inOwnerScope } from "./scope";

// `true` permits, `false` is a real policy denial (final: the session is not
// remote-permitted, or the request names no session), and the two strings are
// RETRYABLE: the session is not active right now (a pause, an end), or the row
// could not be read. Only the first is ever a refusal of the task for good.
export type StandingVerdict = boolean | "not-active" | "read-failed";

export function standingVerdictOf(
  row: { status: string; processing_policy: string } | undefined,
): StandingVerdict {
  if (row === undefined || row.status !== "active") return "not-active";
  try {
    return policyFromDb(row.processing_policy) === "permitted-remote";
  } catch {
    // An unreadable policy value is never remote-permitted.
    return false;
  }
}

export function createSessionStillPermitted(database: PlatformDatabase) {
  return async (request: {
    tenantId: string;
    actorId: string;
    idempotencyKey?: string | undefined;
  }): Promise<StandingVerdict> => {
    const sessionId = request.idempotencyKey?.split(":")[0];
    if (!isUuid(sessionId)) return false;
    try {
      const scope = { tenantId: request.tenantId, actorId: request.actorId };
      const row = await inOwnerScope(database, scope, (tx) =>
        readStanding(tx, scope, sessionId),
      );
      return standingVerdictOf(row);
    } catch {
      return "read-failed";
    }
  };
}
