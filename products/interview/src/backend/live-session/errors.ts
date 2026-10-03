// Content-free errors for the Active Session repository layer. Every message is
// a fixed string chosen by the code, so no id, credential, text or other
// session content can ride along in an error (rule:id-only-traces,
// rule:credential-storage). Callers branch on `code`.
export type SessionErrorCode =
  | "not_found"
  | "invalid_input"
  | "link_refused"
  | "open_session_exists"
  | "status_refused"
  | "loosening_refused"
  | "retention_lengthening_refused"
  | "credential_renewal_required"
  | "duration_cap_reached"
  | "job_cancellation_failed"
  | "job_creation_refused"
  | "purge_incomplete";

const MESSAGES: Record<SessionErrorCode, string> = {
  not_found: "Active Session not found.",
  invalid_input: "Active Session input is invalid.",
  link_refused: "An Active Session link does not belong to its owner.",
  open_session_exists: "The owner already has an open Active Session.",
  status_refused: "The Active Session status does not allow this action.",
  loosening_refused: "An Active Session never loosens its processing policy.",
  retention_lengthening_refused:
    "An Active Session never lengthens its retention.",
  credential_renewal_required:
    "The Active Session credential must be renewed first.",
  duration_cap_reached: "The Active Session reached its duration cap.",
  job_cancellation_failed:
    "A session job could not be confirmed cancelled and fails closed.",
  job_creation_refused:
    "The session no longer permits creating this job for the holder.",
  purge_incomplete: "The Active Session purge final check did not pass.",
};

export class SessionError extends Error {
  // Table names the purge's final check found uncovered. Names are schema
  // identifiers, never content.
  readonly uncoveredTables: readonly string[];

  constructor(
    readonly code: SessionErrorCode,
    uncoveredTables: readonly string[] = [],
  ) {
    super(MESSAGES[code]);
    this.name = "SessionError";
    this.uncoveredTables = uncoveredTables;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

// A malformed id is "not found", never a database error that echoes it.
export function assertUuid(value: unknown): asserts value is string {
  if (!isUuid(value)) throw new SessionError("not_found");
}
